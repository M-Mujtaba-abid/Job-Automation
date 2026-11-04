import type { z } from "zod";
import type { Logger } from "@/server/lib/logger";

export type EnqueueOptions = {
  /** Same key while a job is pending → second enqueue is a no-op. */
  dedupeKey?: string;
  /** Lower runs first. User-triggered work 10–50, bulk work 100+. */
  priority?: number;
  notBefore?: Date;
  maxAttempts?: number;
};

export type ClaimedJob = {
  id: string;
  queue: string;
  payload: unknown;
  /** Attempt number of this run (1-based). */
  attempts: number;
  maxAttempts: number;
};

export type FailOutcome = "retry" | "dead";

/** Profile-independent queue seam (SYSTEM_ARCHITECTURE §8.4). Postgres now; BullMQ adapter later. */
export interface JobQueue {
  enqueue(
    queue: string,
    payload: Record<string, unknown>,
    opts?: EnqueueOptions,
  ): Promise<{ id: string | null; deduped: boolean }>;
  claimNext(workerId: string): Promise<ClaimedJob | null>;
  complete(jobId: string): Promise<void>;
  fail(job: ClaimedJob, error: string, opts: { retryable: boolean }): Promise<FailOutcome>;
  /** Re-queue without counting the attempt (e.g. free AI quota exhausted until `until`). */
  defer(job: ClaimedJob, until: Date): Promise<void>;
  /** RUNNING jobs locked longer than `olderThanMs` (crashed runs) go back to the queue. */
  releaseStale(olderThanMs: number): Promise<number>;
  /** Housekeeping: delete finished rows older than the given ages. */
  pruneFinished(opts: { doneOlderThanMs: number; deadOlderThanMs: number }): Promise<number>;
  countDue(): Promise<number>;
}

export type HandlerContext = {
  jobId: string;
  attempt: number;
  /** Epoch ms by which the handler should finish (chunk work and enqueue continuations). */
  deadline: number;
  logger: Logger;
  queue: JobQueue;
};

export type JobHandler<S extends z.ZodType = z.ZodType> = {
  queue: string;
  payload: S;
  handle(payload: z.infer<S>, ctx: HandlerContext): Promise<void>;
};

/** Permanent failure: do not retry (bad payload, missing row, auth error at a provider). */
export class NonRetryableError extends Error {
  override name = "NonRetryableError";
}

/** Not a failure: try again after `until` without consuming an attempt (e.g. AI budget exhausted). */
export class DeferError extends Error {
  override name = "DeferError";
  constructor(
    public readonly until: Date,
    reason: string,
  ) {
    super(reason);
  }
}
