import { desc, eq, sql } from "drizzle-orm";
import { parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { fetchRuns, jobs, sources } from "@/lib/db/schema";
import { sourceInputSchema } from "@/lib/validators";

export const GET = route(async () => {
  const lastRun = db()
    .selectDistinctOn([fetchRuns.sourceId], {
      sourceId: fetchRuns.sourceId,
      status: fetchRuns.status,
      startedAt: fetchRuns.startedAt,
      error: fetchRuns.error,
      insertedCount: fetchRuns.insertedCount,
    })
    .from(fetchRuns)
    .orderBy(fetchRuns.sourceId, desc(fetchRuns.startedAt))
    .as("last_run");

  const rows = await db()
    .select({
      source: sources,
      lastRun: {
        status: lastRun.status,
        startedAt: lastRun.startedAt,
        error: lastRun.error,
        insertedCount: lastRun.insertedCount,
      },
      jobCount: sql<number>`(select count(*)::int from ${jobs} where ${jobs.sourceId} = ${sources.id})`,
    })
    .from(sources)
    .leftJoin(lastRun, eq(lastRun.sourceId, sources.id))
    .orderBy(sources.createdAt);

  return {
    items: rows.map((r) => ({ ...r.source, lastRun: r.lastRun?.status ? r.lastRun : null, jobCount: r.jobCount })),
  };
});

export const POST = route(async (req) => {
  const input = await parseBody(req, sourceInputSchema);
  const [row] = await db().insert(sources).values(input).returning();
  return row;
});
