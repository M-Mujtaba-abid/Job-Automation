import "server-only";
import { after } from "next/server";
import { serverEnv } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import { uuidv7 } from "@/server/lib/uuid";
import { drain, type DrainSummary } from "./drain";
import { createPgQueue } from "./pg-queue";
import { handlers } from "./registry";

export type { EnqueueOptions, JobQueue } from "./types";
export { DeferError, NonRetryableError } from "./types";
export { createPgQueue } from "./pg-queue";

/** Default queue on the pooled connection. Use createPgQueue(() => tx) to enqueue inside a transaction. */
export const jobQueue = createPgQueue();

const log = logger.child({ module: "jobs" });

export function runDrain(budgetMs: number, source: string): Promise<DrainSummary> {
  return drain({ queue: jobQueue, handlers, workerId: `${source}:${uuidv7()}`, budgetMs, logger: log });
}

/** Ensures today's maintenance job exists (cheap no-op insert when it already does). */
export async function scheduleDailyMaintenance(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await jobQueue.enqueue("maintenance", { day }, { dedupeKey: `maintenance:${day}`, priority: 200 });
}

/**
 * After the current response is sent, process a few due jobs so user-triggered work
 * starts within seconds instead of waiting for the next cron ping (ADR-023).
 */
export function kickDrain(budgetMs = 10_000): void {
  after(async () => {
    try {
      const summary = await runDrain(Math.min(budgetMs, serverEnv().DRAIN_TIME_BUDGET_MS), "kick");
      log.info({ ...summary }, "drain.kick");
    } catch (err) {
      log.error({ error: err }, "drain.kick_failed");
    }
  });
}
