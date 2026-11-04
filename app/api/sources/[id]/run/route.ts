import { and, eq, gt } from "drizzle-orm";
import { ApiError, route } from "@/lib/api";
import { db } from "@/lib/db";
import { fetchRuns, sources } from "@/lib/db/schema";
import { startSourceRun } from "@/lib/ingest";

/** "Run now": starts the Apify run asynchronously; results arrive via webhook / Collect. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const source = await db().query.sources.findFirst({ where: eq(sources.id, params.id) });
  if (!source) throw new ApiError(404, "Source not found");

  const busy = await db().query.fetchRuns.findFirst({
    where: and(
      eq(fetchRuns.sourceId, source.id),
      eq(fetchRuns.status, "running"),
      gt(fetchRuns.startedAt, new Date(Date.now() - 30 * 60 * 1000)),
    ),
  });
  if (busy) throw new ApiError(409, "A run for this source is already in progress");

  const run = await startSourceRun(source, "manual");
  if (run.status === "failed") throw new ApiError(502, run.error ?? "Failed to start run");
  return run;
});
