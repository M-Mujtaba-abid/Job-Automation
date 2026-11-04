import { z } from "zod";
import type { JobHandler } from "../types";

const STALE_RUNNING_MS = 5 * 60_000;
const DONE_RETENTION_MS = 14 * 86_400_000;
const DEAD_RETENTION_MS = 30 * 86_400_000;

const payload = z.object({ day: z.iso.date() });

/**
 * Daily housekeeping (SYSTEM_ARCHITECTURE §8.2): release crashed RUNNING jobs, prune old rows.
 * Idempotent: enqueued with dedupeKey "maintenance:{day}", safe to run twice.
 * Storage-budget checks and data-retention purges are added here in later milestones.
 */
export const maintenanceHandler: JobHandler<typeof payload> = {
  queue: "maintenance",
  payload,
  async handle(_payload, ctx) {
    const released = await ctx.queue.releaseStale(STALE_RUNNING_MS);
    const pruned = await ctx.queue.pruneFinished({ doneOlderThanMs: DONE_RETENTION_MS, deadOlderThanMs: DEAD_RETENTION_MS });
    ctx.logger.info({ released, pruned }, "maintenance.done");
  },
};
