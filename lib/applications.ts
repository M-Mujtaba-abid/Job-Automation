import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applications,
  emailTemplates,
  jobContacts,
  jobs,
  type Application,
  type EmailTemplate,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api";
import { getCv, getCvMeta } from "@/lib/cv";
import { env } from "@/lib/env";
import { errorMessage } from "@/lib/ingest";
import { sendMail } from "@/lib/mail";
import { sleep } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { jobVars, profileVars, renderTemplate, type TemplateVars } from "@/lib/template";

const RECENT_DAYS = 30;

type JobWithEmails = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  emails: { contactId: string; email: string }[];
};

async function loadJobsWithEmails(jobIds: string[]): Promise<JobWithEmails[]> {
  if (!jobIds.length) return [];
  const [rows, contacts] = await Promise.all([
    db()
      .select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location })
      .from(jobs)
      .where(inArray(jobs.id, jobIds)),
    db()
      .select({ jobId: jobContacts.jobId, contactId: jobContacts.id, email: jobContacts.normalized })
      .from(jobContacts)
      .where(and(inArray(jobContacts.jobId, jobIds), eq(jobContacts.type, "email"))),
  ]);
  return rows.map((r) => ({
    ...r,
    emails: contacts.filter((c) => c.jobId === r.id).map(({ contactId, email }) => ({ contactId, email })),
  }));
}

/** Group jobs by recipient address (one email per address). */
function groupByRecipient(list: JobWithEmails[], exclude: Set<string>) {
  const map = new Map<string, { email: string; jobs: { job: JobWithEmails; contactId: string }[] }>();
  for (const job of list) {
    for (const { email, contactId } of job.emails) {
      if (exclude.has(email)) continue;
      const entry = map.get(email) ?? { email, jobs: [] };
      entry.jobs.push({ job, contactId });
      map.set(email, entry);
    }
  }
  return [...map.values()];
}

export async function getTemplate(templateId?: string | null): Promise<EmailTemplate | null> {
  if (templateId) {
    const t = await db().query.emailTemplates.findFirst({ where: eq(emailTemplates.id, templateId) });
    if (!t) throw new ApiError(404, "Template not found");
    return t;
  }
  return (
    (await db().query.emailTemplates.findFirst({ where: eq(emailTemplates.isDefault, true) })) ??
    (await db().query.emailTemplates.findFirst({ orderBy: desc(emailTemplates.updatedAt) })) ??
    null
  );
}

/** Data for the compose dialog. The client renders previews live from `vars`. */
export async function prepareEmail(jobIds: string[], templateId?: string | null) {
  const [list, template, profile, cv] = await Promise.all([
    loadJobsWithEmails(jobIds),
    getTemplate(templateId),
    getSettings(),
    getCvMeta(),
  ]);
  const recipients = groupByRecipient(list, new Set());
  const addresses = recipients.map((r) => r.email);

  const recent = addresses.length
    ? await db()
        .select({ to: applications.toAddress, sentAt: sql<Date>`max(${applications.sentAt})` })
        .from(applications)
        .where(
          and(
            eq(applications.channel, "email"),
            eq(applications.status, "sent"),
            inArray(applications.toAddress, addresses),
            gte(applications.sentAt, new Date(Date.now() - RECENT_DAYS * 86_400_000)),
          ),
        )
        .groupBy(applications.toAddress)
    : [];
  const recentMap = new Map(recent.map((r) => [r.to, r.sentAt]));

  return {
    template,
    profileVars: profileVars(profile),
    cv: cv ? { fileName: cv.fileName } : null,
    recipients: recipients.map((r) => ({
      email: r.email,
      jobs: r.jobs.map(({ job }) => ({ id: job.id, title: job.title, company: job.company })),
      vars: jobVars(r.jobs.map(({ job }) => job)),
      lastEmailedAt: recentMap.get(r.email) ?? null,
    })),
    jobsWithoutEmail: list.filter((j) => !j.emails.length).map((j) => ({ id: j.id, title: j.title })),
  };
}

/** Create queued applications (one email per address, one row per job). */
export async function queueEmails(input: {
  jobIds: string[];
  subject: string;
  body: string;
  templateId?: string | null;
  attachCv: boolean;
  excludeEmails?: string[];
}) {
  const [list, profile, cv] = await Promise.all([loadJobsWithEmails(input.jobIds), getSettings(), getCvMeta()]);
  if (input.attachCv && !cv) {
    throw new ApiError(400, "Attach CV is on but no CV is uploaded. Upload one in Settings first.");
  }
  const recipients = groupByRecipient(list, new Set(input.excludeEmails ?? []));
  if (!recipients.length) throw new ApiError(400, "None of the selected jobs have an email address.");

  const batchId = randomUUID();
  const me: TemplateVars = profileVars(profile);
  let queued = 0;
  const skipped: { email: string; jobTitle: string; reason: string }[] = [];

  for (const r of recipients) {
    const vars = { ...me, ...jobVars(r.jobs.map(({ job }) => job)) };
    const subject = renderTemplate(input.subject, vars);
    const body = renderTemplate(input.body, vars);
    const inserted = await db()
      .insert(applications)
      .values(
        r.jobs.map(({ job, contactId }) => ({
          jobId: job.id,
          contactId,
          channel: "email" as const,
          toAddress: r.email,
          subject,
          body,
          templateId: input.templateId ?? null,
          attachCv: input.attachCv,
          batchId,
        })),
      )
      .onConflictDoNothing()
      .returning({ jobId: applications.jobId });

    const insertedIds = new Set(inserted.map((i) => i.jobId));
    for (const { job } of r.jobs) {
      if (!insertedIds.has(job.id)) {
        skipped.push({ email: r.email, jobTitle: job.title, reason: "Already applied to this job at this address" });
      }
    }
    if (inserted.length) queued++;
  }

  return { batchId, queued, skipped };
}

async function sentInLast24h(): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(distinct coalesce(${applications.messageId}, ${applications.id}::text))::int` })
    .from(applications)
    .where(
      and(
        eq(applications.channel, "email"),
        eq(applications.status, "sent"),
        gte(applications.sentAt, new Date(Date.now() - 86_400_000)),
      ),
    );
  return row.n;
}

/**
 * Send up to `limit` queued emails (one per address). The client calls this in a loop.
 * Rows are claimed with SKIP LOCKED so concurrent callers never double-send.
 */
export async function processQueue({ batchId, limit = 5 }: { batchId?: string; limit?: number }) {
  const e = env();
  const remainingToday = e.MAIL_DAILY_LIMIT - (await sentInLast24h());
  if (remainingToday <= 0) {
    return { sent: 0, failed: 0, remaining: await countQueued(batchId), limitReached: true, results: [] };
  }
  const take = Math.min(limit, remainingToday);

  // Claim rows for `take` distinct addresses.
  const batchFilter = batchId ? sql`and batch_id = ${batchId}` : sql``;
  const claimed = await db().execute<{ id: string }>(sql`
    update applications set status = 'sending'
    where id in (
      select id from applications
      where channel = 'email' and status = 'queued' ${batchFilter}
        and to_address in (
          select distinct to_address from applications
          where channel = 'email' and status = 'queued' ${batchFilter}
          limit ${take}
        )
      for update skip locked
    )
    returning id
  `);
  const ids = claimed.rows.map((r) => r.id);
  const rows: Application[] = ids.length
    ? await db().select().from(applications).where(inArray(applications.id, ids))
    : [];

  const groups = new Map<string, Application[]>();
  for (const row of rows) {
    const key = `${row.batchId}|${row.toAddress}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const profile = await getSettings();
  // Load the CV bytes once per call, only if some claimed email needs it.
  const cv = rows.some((r) => r.attachCv) ? await getCv() : null;
  const results: { email: string; ok: boolean; error?: string }[] = [];
  let first = true;

  for (const group of groups.values()) {
    const head = group[0];
    if (!first && e.MAIL_DELAY_MS) await sleep(e.MAIL_DELAY_MS);
    first = false;
    const groupIds = group.map((g) => g.id);
    try {
      const messageId = await sendMail({
        to: head.toAddress,
        subject: head.subject ?? "",
        body: head.body ?? "",
        replyTo: profile.email || undefined,
        cv: head.attachCv && cv ? { fileName: cv.fileName, data: cv.data } : null,
      });
      await db()
        .update(applications)
        .set({ status: "sent", sentAt: new Date(), messageId, error: null })
        .where(inArray(applications.id, groupIds));
      await db()
        .update(jobs)
        .set({ status: "applied" })
        .where(inArray(jobs.id, group.map((g) => g.jobId)));
      results.push({ email: head.toAddress, ok: true });
    } catch (err) {
      const msg = errorMessage(err);
      await db().update(applications).set({ status: "failed", error: msg }).where(inArray(applications.id, groupIds));
      results.push({ email: head.toAddress, ok: false, error: msg });
    }
  }

  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining: await countQueued(batchId),
    limitReached: false,
    results,
  };
}

/** Number of addresses still waiting in the queue. */
export async function countQueued(batchId?: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(distinct (${applications.batchId}, ${applications.toAddress}))::int` })
    .from(applications)
    .where(
      and(
        eq(applications.channel, "email"),
        eq(applications.status, "queued"),
        batchId ? eq(applications.batchId, batchId) : undefined,
      ),
    );
  return row.n;
}

/** Re-queue a failed email (and its siblings sent to the same address in the same batch). */
export async function retryApplication(id: string) {
  const app = await db().query.applications.findFirst({ where: eq(applications.id, id) });
  if (!app) throw new ApiError(404, "Application not found");
  if (app.status !== "failed" || app.channel !== "email") {
    throw new ApiError(400, "Only failed email applications can be retried");
  }
  try {
    const rows = await db()
      .update(applications)
      .set({ status: "queued", error: null })
      .where(
        and(
          eq(applications.status, "failed"),
          eq(applications.toAddress, app.toAddress),
          app.batchId ? eq(applications.batchId, app.batchId) : eq(applications.id, app.id),
        ),
      )
      .returning({ id: applications.id });
    return { batchId: app.batchId, requeued: rows.length };
  } catch {
    throw new ApiError(409, "This job was already applied to at this address in another batch");
  }
}
