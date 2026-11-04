import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { applications, jobContacts, jobs, sources } from "@/lib/db/schema";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const id = z.uuid().parse(params.id);
  const [row] = await db()
    .select({ job: jobs, sourceName: sources.name, sourceType: sources.type })
    .from(jobs)
    .leftJoin(sources, eq(sources.id, jobs.sourceId))
    .where(eq(jobs.id, id));
  if (!row) throw new ApiError(404, "Job not found");

  const [contacts, history] = await Promise.all([
    db().select().from(jobContacts).where(eq(jobContacts.jobId, id)),
    db().select().from(applications).where(eq(applications.jobId, id)).orderBy(desc(applications.createdAt)),
  ]);
  const { raw: _raw, ...job } = row.job;
  return { ...job, sourceName: row.sourceName, sourceType: row.sourceType, contacts, applications: history };
});

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const { status } = await parseBody(req, z.object({ status: z.enum(["new", "saved", "applied", "hidden"]) }));
  const [row] = await db()
    .update(jobs)
    .set({ status })
    .where(eq(jobs.id, z.uuid().parse(params.id)))
    .returning({ id: jobs.id, status: jobs.status });
  if (!row) throw new ApiError(404, "Job not found");
  return row;
});
