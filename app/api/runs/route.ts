import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { fetchRuns, sources } from "@/lib/db/schema";

export const GET = route(async () => {
  const rows = await db()
    .select({ run: fetchRuns, sourceName: sources.name })
    .from(fetchRuns)
    .leftJoin(sources, eq(sources.id, fetchRuns.sourceId))
    .orderBy(desc(fetchRuns.startedAt))
    .limit(100);
  return {
    items: rows.map((r) => ({
      ...r.run,
      sourceName: r.sourceName,
      apifyUrl: r.run.apifyRunId ? `https://console.apify.com/view/runs/${r.run.apifyRunId}` : null,
    })),
  };
});
