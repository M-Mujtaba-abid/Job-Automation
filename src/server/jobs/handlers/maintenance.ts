import { z } from "zod";
import type { RateLimiter } from "@/server/lib/rate-limit";
import type { JobHandler } from "../types";

const STALE_RUNNING_MS = 5 * 60_000;
const DONE_RETENTION_MS = 14 * 86_400_000;
const DEAD_RETENTION_MS = 30 * 86_400_000;

const payload = z.object({ day: z.iso.date() });

/**
 * Daily housekeeping (SYSTEM_ARCHITECTURE §8.2): release crashed RUNNING jobs, prune old queue
 * rows and expired rate-limit buckets. Idempotent: enqueued with dedupeKey "maintenance:{day}".
 * Storage-budget checks and data-retention purges are added here in later milestones.
 */
export function createMaintenanceHandler(deps: { rateLimiter: RateLimiter }): JobHandler<typeof payload> {
  return {
    queue: "maintenance",
    payload,
    async handle(_payload, ctx) {
      const released = await ctx.queue.releaseStale(STALE_RUNNING_MS);
      const pruned = await ctx.queue.pruneFinished({
        doneOlderThanMs: DONE_RETENTION_MS,
        deadOlderThanMs: DEAD_RETENTION_MS,
      });
      const buckets = await deps.rateLimiter.prune();
      ctx.logger.info({ released, pruned, buckets }, "maintenance.done");
    },
  };
}
