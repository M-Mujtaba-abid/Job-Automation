import { errorMessage } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";
import { DeferError, NonRetryableError, type JobHandler, type JobQueue } from "./types";

export type DrainSummary = {
  processed: number;
  succeeded: number;
  retried: number;
  dead: number;
  deferred: number;
  stoppedBy: "empty" | "budget";
  durationMs: number;
};

export type DrainOptions = {
  queue: JobQueue;
  handlers: ReadonlyMap<string, JobHandler>;
  workerId: string;
  budgetMs: number;
  logger: Logger;
  /** Injected clock for tests. */
  now?: () => number;
};

/**
 * Runs due jobs one at a time until the queue is empty or the time budget is spent.
 * Handler errors never escape (one bad job must not fail the cron call); only queue/DB
 * errors propagate. Keep budgetMs < 30 s while cron-job.org waits for the response.
 */
export async function drain(opts: DrainOptions): Promise<DrainSummary> {
  const now = opts.now ?? Date.now;
  const started = now();
  const deadline = started + opts.budgetMs;
  const s: DrainSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    deferred: 0,
    stoppedBy: "empty",
    durationMs: 0,
  };

  while (true) {
    if (now() >= deadline) {
      s.stoppedBy = "budget";
      break;
    }
    const job = await opts.queue.claimNext(opts.workerId);
    if (!job) break;
    s.processed++;
    const log = opts.logger.child({ jobId: job.id, queue: job.queue, attempt: job.attempts });

    const handler = opts.handlers.get(job.queue);
    if (!handler) {
      await opts.queue.fail(job, `No handler registered for queue "${job.queue}"`, { retryable: false });
      s.dead++;
      log.error({}, "job.no_handler");
      continue;
    }
    const parsed = handler.payload.safeParse(job.payload);
    if (!parsed.success) {
      await opts.queue.fail(job, "Invalid payload", { retryable: false });
      s.dead++;
      log.error({}, "job.invalid_payload");
      continue;
    }

    const jobStarted = now();
    try {
      await handler.handle(parsed.data, {
        jobId: job.id,
        attempt: job.attempts,
        deadline,
        logger: log,
        queue: opts.queue,
      });
      await opts.queue.complete(job.id);
      s.succeeded++;
      log.info({ durationMs: now() - jobStarted }, "job.done");
    } catch (err) {
      if (err instanceof DeferError) {
        await opts.queue.defer(job, err.until);
        s.deferred++;
        log.info({ until: err.until.toISOString(), reason: err.message }, "job.deferred");
        continue;
      }
      const outcome = await opts.queue.fail(job, errorMessage(err), { retryable: !(err instanceof NonRetryableError) });
      if (outcome === "retry") s.retried++;
      else s.dead++;
      log.warn({ outcome, error: errorMessage(err), durationMs: now() - jobStarted }, "job.failed");
    }
  }

  s.durationMs = now() - started;
  return s;
}
