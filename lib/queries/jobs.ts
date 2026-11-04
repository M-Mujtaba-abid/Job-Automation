import { and, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobContacts, jobs, sources, type JobContact } from "@/lib/db/schema";

const boolParam = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

export const jobFiltersSchema = z.object({
  filter: z.enum(["all", "email", "phone", "form"]).default("all"),
  status: z.enum(["new", "saved", "applied", "hidden"]).optional(),
  q: z.string().trim().max(200).optional(),
  sourceId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  hideApplied: boolParam.default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type JobFilters = z.infer<typeof jobFiltersSchema>;

/** Must match the GIN index expression in schema.ts exactly so Postgres uses it. */
const searchVector = sql`to_tsvector('english', ${jobs.title} || ' ' || coalesce(${jobs.company}, '') || ' ' || coalesce(${jobs.description}, ''))`;

/** Conditions shared by list, counts and select-all (everything except the contact tab). */
export function baseConditions(f: JobFilters): SQL[] {
  const conds: SQL[] = [];
  if (f.status) conds.push(eq(jobs.status, f.status));
  else conds.push(notInArray(jobs.status, f.hideApplied ? ["hidden", "applied"] : ["hidden"]));
  if (f.q) conds.push(sql`${searchVector} @@ websearch_to_tsquery('english', ${f.q})`);
  if (f.sourceId) conds.push(eq(jobs.sourceId, f.sourceId));
  if (f.from) conds.push(gte(jobs.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lte(jobs.createdAt, new Date(`${f.to}T23:59:59.999Z`)));
  return conds;
}

export function tabCondition(filter: JobFilters["filter"]): SQL | undefined {
  if (filter === "email") return eq(jobs.hasEmail, true);
  if (filter === "phone") return eq(jobs.hasPhone, true);
  if (filter === "form") return eq(jobs.hasForm, true);
  return undefined;
}

const sortKey = sql`coalesce(${jobs.postedAt}, ${jobs.createdAt})`;

export type JobListItem = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  isRemote: boolean;
  snippet: string;
  applyUrl: string | null;
  postedAt: Date | null;
  createdAt: Date;
  status: (typeof jobs.$inferSelect)["status"];
  hasEmail: boolean;
  hasPhone: boolean;
  hasForm: boolean;
  sourceName: string | null;
  sourceType: string | null;
  contacts: Pick<JobContact, "id" | "type" | "value" | "normalized">[];
};

export async function listJobs(f: JobFilters) {
  const base = baseConditions(f);
  const where = and(...base, tabCondition(f.filter));

  const [rows, [totals], [counts]] = await Promise.all([
    db()
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        employmentType: jobs.employmentType,
        isRemote: jobs.isRemote,
        snippet: sql<string>`left(coalesce(${jobs.description}, ''), 280)`,
        applyUrl: jobs.applyUrl,
        postedAt: jobs.postedAt,
        createdAt: jobs.createdAt,
        status: jobs.status,
        hasEmail: jobs.hasEmail,
        hasPhone: jobs.hasPhone,
        hasForm: jobs.hasForm,
        sourceName: sources.name,
        sourceType: sources.type,
      })
      .from(jobs)
      .leftJoin(sources, eq(sources.id, jobs.sourceId))
      .where(where)
      .orderBy(desc(sortKey), desc(jobs.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(jobs).where(where),
    db()
      .select({
        all: sql<number>`count(*)::int`,
        email: sql<number>`(count(*) filter (where ${jobs.hasEmail}))::int`,
        phone: sql<number>`(count(*) filter (where ${jobs.hasPhone}))::int`,
        form: sql<number>`(count(*) filter (where ${jobs.hasForm}))::int`,
      })
      .from(jobs)
      .where(and(...base)),
  ]);

  const contacts = rows.length
    ? await db()
        .select({
          id: jobContacts.id,
          jobId: jobContacts.jobId,
          type: jobContacts.type,
          value: jobContacts.value,
          normalized: jobContacts.normalized,
        })
        .from(jobContacts)
        .where(inArray(jobContacts.jobId, rows.map((r) => r.id)))
    : [];

  const items: JobListItem[] = rows.map((r) => ({
    ...r,
    contacts: contacts.filter((c) => c.jobId === r.id).map(({ jobId: _jobId, ...c }) => c),
  }));

  return { items, total: totals.total, counts, page: f.page, pageSize: f.pageSize };
}

/** All matching job ids (for "select all N matching") with their emails. */
export async function matchingJobIds(f: JobFilters, limit = 5000) {
  const rows = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(...baseConditions(f), tabCondition(f.filter)))
    .orderBy(desc(sortKey), desc(jobs.id))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  const emails = ids.length
    ? await db()
        .selectDistinct({ jobId: jobContacts.jobId, email: jobContacts.normalized })
        .from(jobContacts)
        .where(and(inArray(jobContacts.jobId, ids), eq(jobContacts.type, "email")))
    : [];
  return { ids, emails, truncated: rows.length === limit };
}
