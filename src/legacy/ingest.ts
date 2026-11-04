import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/legacy/db";
import {
  fetchRuns,
  jobContacts,
  jobs,
  sources,
  type FetchRun,
  type NewJob,
  type Source,
} from "@/legacy/db/schema";
import { env } from "@/legacy/env";
import { extractContacts, type ExtractedContact } from "@/legacy/extract/contacts";
import { dedupeHash, toPlainText, truncate } from "@/legacy/extract/normalize";
import {
  deriveTitle,
  detectEmploymentType,
  detectLocation,
  detectRemote,
  isHiringPost,
} from "@/legacy/extract/post";
import { adapterFor, type RawJob } from "@/legacy/sources";

const MAX_AGE_DAYS = 14;
const CLEANUP_AFTER_DAYS = 45;
const STALE_RUN_HOURS = 6;
const OVERLAP_MINUTES = 30;

export type PreparedJob = { job: Omit<NewJob, "sourceId">; contacts: ExtractedContact[] };
export type SkipReason = "not_hiring" | "too_old" | "empty";

/** Pure: RawJob → row + contacts, or a reason to skip. No DB access (unit-tested). */
export function prepareJob(
  raw: RawJob,
  opts: { countryCode?: string; now?: Date } = {},
): PreparedJob | { skip: SkipReason } {
  const description = toPlainText(raw.descriptionHtmlOrText);
  if (!description) return { skip: "empty" };

  const now = opts.now ?? new Date();
  if (raw.postedAt && now.getTime() - raw.postedAt.getTime() > MAX_AGE_DAYS * 86_400_000) {
    return { skip: "too_old" };
  }

  const title = truncate(raw.title?.trim() || deriveTitle(description), 160);
  const contacts = extractContacts(`${title}\n${description}\n${raw.applyUrl ?? ""}`, {
    countryCode: opts.countryCode,
  });
  if (!isHiringPost(description, contacts.length)) return { skip: "not_hiring" };

  const company = raw.company?.trim() || null;
  return {
    job: {
      externalId: raw.externalId ?? null,
      dedupeHash: dedupeHash({ title, company, applyUrl: raw.applyUrl, description }),
      title,
      company,
      location: raw.location ?? detectLocation(description) ?? null,
      employmentType: raw.employmentType ?? detectEmploymentType(description) ?? null,
      isRemote: raw.isRemote ?? detectRemote(description),
      description,
      applyUrl: raw.applyUrl ?? null,
      postedAt: raw.postedAt ?? null,
      hasEmail: contacts.some((c) => c.type === "email"),
      hasPhone: contacts.some((c) => c.type === "phone"),
      hasForm: contacts.some((c) => c.type === "google_form"),
      raw: raw.raw as NewJob["raw"],
    },
    contacts,
  };
}

/** Upsert one job + its contacts. Returns whether a new row was created. */
export async function upsertJob(sourceId: string | null, prepared: PreparedJob): Promise<"inserted" | "duplicate"> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({ ...prepared.job, sourceId })
      .onConflictDoUpdate({
        target: jobs.dedupeHash,
        // Never overwrite status; only refresh timestamps and OR-in new contact flags.
        set: {
          updatedAt: new Date(),
          hasEmail: sql`${jobs.hasEmail} or excluded.has_email`,
          hasPhone: sql`${jobs.hasPhone} or excluded.has_phone`,
          hasForm: sql`${jobs.hasForm} or excluded.has_form`,
        },
      })
      .returning({ id: jobs.id, inserted: sql<boolean>`(xmax = 0)` });

    if (prepared.contacts.length) {
      await tx
        .insert(jobContacts)
        .values(prepared.contacts.map((c) => ({ ...c, jobId: row.id })))
        .onConflictDoNothing();
    }
    return row.inserted ? "inserted" : "duplicate";
  });
}

// ---------- runs ----------

/** Start an async Apify run for a source and record it in fetch_runs. */
export async function startSourceRun(source: Source, trigger: "cron" | "manual"): Promise<FetchRun> {
  const adapter = adapterFor(source.type);
  const [run] = await db().insert(fetchRuns).values({ sourceId: source.id, trigger }).returning();
  await db().update(sources).set({ lastFetchedAt: new Date() }).where(eq(sources.id, source.id));

  try {
    if (!adapter) throw new Error(`No adapter for source type "${source.type}"`);
    if (!adapter.isConfigured()) throw new Error("Source is not configured (missing APIFY_TOKEN)");
    const started = await adapter.start(source, run.id);
    const [updated] = await db()
      .update(fetchRuns)
      .set({ apifyRunId: started.apifyRunId, datasetId: started.datasetId })
      .where(eq(fetchRuns.id, run.id))
      .returning();
    return updated;
  } catch (err) {
    const [failed] = await db()
      .update(fetchRuns)
      .set({ status: "failed", error: errorMessage(err), finishedAt: new Date() })
      .where(eq(fetchRuns.id, run.id))
      .returning();
    return failed;
  }
}

export type CollectResult =
  | { state: "pending"; rawStatus: string }
  | { state: "done"; run: FetchRun }
  | { state: "skipped"; reason: string };

/**
 * If the Apify run behind a fetch_run has finished, ingest its dataset.
 * Idempotent: called by the webhook, the cron fallback and the "Collect" button.
 */
export async function collectRun(fetchRunId: string, opts: { force?: boolean } = {}): Promise<CollectResult> {
  const run = await db().query.fetchRuns.findFirst({ where: eq(fetchRuns.id, fetchRunId) });
  if (!run) return { state: "skipped", reason: "run not found" };
  if (run.status !== "running" && !opts.force) return { state: "skipped", reason: `run is ${run.status}` };
  if (!run.apifyRunId) return { state: "skipped", reason: "run has no Apify run id" };

  const source = run.sourceId
    ? await db().query.sources.findFirst({ where: eq(sources.id, run.sourceId) })
    : undefined;
  const adapter = source ? adapterFor(source.type) : adapterFor("apify_linkedin");
  if (!adapter) return { state: "skipped", reason: "no adapter" };

  const remote = await adapter.getRun(run.apifyRunId);
  if (remote.status === "pending") {
    if (Date.now() - run.startedAt.getTime() > STALE_RUN_HOURS * 3_600_000) {
      const [stale] = await finishRun(run.id, {
        status: "failed",
        error: `Stale: Apify run still ${remote.rawStatus} after ${STALE_RUN_HOURS}h`,
      });
      return { state: "done", run: stale };
    }
    return { state: "pending", rawStatus: remote.rawStatus };
  }
  if (remote.status === "failed") {
    const [failed] = await finishRun(run.id, {
      status: "failed",
      error: `Apify run ${remote.rawStatus}${remote.message ? `: ${remote.message}` : ""}`,
    });
    return { state: "done", run: failed };
  }

  const countryCode = env().DEFAULT_COUNTRY_CODE;
  const counts = { fetched: 0, inserted: 0, duplicate: 0, skipped: 0, errors: 0 };
  let firstError: string | null = null;

  for await (const page of adapter.items(remote.datasetId ?? run.datasetId ?? "")) {
    for (const item of page) {
      counts.fetched++;
      const raw = adapter.mapItem(item);
      if (!raw) {
        counts.skipped++;
        continue;
      }
      const prepared = prepareJob(raw, { countryCode });
      if ("skip" in prepared) {
        counts.skipped++;
        continue;
      }
      try {
        counts[await upsertJob(run.sourceId, prepared)]++;
      } catch (err) {
        counts.errors++;
        firstError ??= errorMessage(err);
      }
    }
  }

  const timedOut = remote.rawStatus.startsWith("TIMED");
  const [done] = await finishRun(run.id, {
    status: counts.errors || timedOut ? "partial" : "success",
    error: firstError ?? (timedOut ? "Apify run timed out; ingested partial results" : null),
    fetchedCount: counts.fetched,
    insertedCount: counts.inserted,
    duplicateCount: counts.duplicate,
    skippedCount: counts.skipped,
  });
  return { state: "done", run: done };
}

function finishRun(id: string, values: Partial<typeof fetchRuns.$inferInsert>) {
  return db()
    .update(fetchRuns)
    .set({ ...values, finishedAt: new Date() })
    .where(eq(fetchRuns.id, id))
    .returning();
}

// ---------- cron ----------

export type CronReport = {
  collected: { runId: string; state: CollectResult["state"] }[];
  started: { sourceId: string; name: string; runId: string; status: string; error?: string | null }[];
  skippedSources: { name: string; reason: string }[];
  cleanedUp: number;
};

export async function runCron(trigger: "cron" | "manual" = "cron"): Promise<CronReport> {
  const report: CronReport = { collected: [], started: [], skippedSources: [], cleanedUp: 0 };

  // 1. Fallback collector for runs whose webhook never arrived (or local dev).
  const running = await db().select({ id: fetchRuns.id }).from(fetchRuns).where(eq(fetchRuns.status, "running"));
  for (const r of running) {
    try {
      const res = await collectRun(r.id);
      report.collected.push({ runId: r.id, state: res.state });
    } catch (err) {
      console.error("[cron] collect failed", r.id, err);
    }
  }

  // 2. Start due sources (respecting the min interval + overlap lock).
  const minIntervalMs = env().FETCH_MIN_INTERVAL_HOURS * 3_600_000;
  const enabled = await db().select().from(sources).where(eq(sources.enabled, true));
  const busy = new Set(
    (
      await db()
        .select({ sourceId: fetchRuns.sourceId })
        .from(fetchRuns)
        .where(
          and(
            eq(fetchRuns.status, "running"),
            sql`${fetchRuns.startedAt} > now() - make_interval(mins => ${OVERLAP_MINUTES})`,
          ),
        )
    ).map((r) => r.sourceId),
  );

  const due = enabled.filter((s) => {
    if (busy.has(s.id)) {
      report.skippedSources.push({ name: s.name, reason: "a run is already in progress" });
      return false;
    }
    if (s.lastFetchedAt && Date.now() - s.lastFetchedAt.getTime() < minIntervalMs) {
      report.skippedSources.push({ name: s.name, reason: "fetched recently" });
      return false;
    }
    return true;
  });

  const results = await Promise.allSettled(due.map((s) => startSourceRun(s, trigger)));
  results.forEach((r, i) => {
    const s = due[i];
    if (r.status === "fulfilled") {
      report.started.push({ sourceId: s.id, name: s.name, runId: r.value.id, status: r.value.status, error: r.value.error });
    } else {
      report.started.push({ sourceId: s.id, name: s.name, runId: "", status: "failed", error: errorMessage(r.reason) });
    }
  });

  // 3. Cleanup: hide untouched jobs that are too old to be useful.
  report.cleanedUp = await cleanupOldJobs();
  return report;
}

export async function cleanupOldJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - CLEANUP_AFTER_DAYS * 86_400_000);
  const rows = await db()
    .update(jobs)
    .set({ status: "hidden" })
    .where(and(eq(jobs.status, "new"), lt(jobs.createdAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
