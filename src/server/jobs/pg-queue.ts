import "server-only";
import { and, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db/client";
import { backgroundJobs } from "@/server/db/schema";
import { retryDelayMs } from "./backoff";
import type { EnqueueOptions, FailOutcome, JobQueue } from "./types";

const ERROR_MAX = 2_000;

/**
 * Postgres-backed JobQueue (ADR-023). Claiming uses FOR UPDATE SKIP LOCKED so
 * concurrent drainers never run the same job. Pass `tx` to enqueue inside a caller's
 * transaction: the queue row then commits atomically with the state change (outbox).
 */
export function createPgQueue(conn: () => DbOrTx = db): JobQueue {
  return {
    async enqueue(queue, payload, opts: EnqueueOptions = {}) {
      const rows = await conn()
        .insert(backgroundJobs)
        .values({
          queue,
          payload,
          dedupeKey: opts.dedupeKey ?? null,
          priority: opts.priority ?? 100,
          maxAttempts: opts.maxAttempts ?? 5,
          notBefore: opts.notBefore ?? new Date(),
        })
        .onConflictDoNothing({ target: backgroundJobs.dedupeKey })
        .returning({ id: backgroundJobs.id });
      const id = rows[0]?.id ?? null;
      return { id, deduped: id === null };
    },

    async claimNext(workerId) {
      const result = await conn().execute<{
        id: string;
        queue: string;
        payload: unknown;
        attempts: number;
        max_attempts: number;
      }>(sql`
        UPDATE ${backgroundJobs}
        SET status = 'RUNNING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM ${backgroundJobs}
          WHERE status IN ('QUEUED', 'FAILED') AND not_before <= now()
          ORDER BY priority, not_before
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, queue, payload, attempts, max_attempts`);
      const row = result.rows[0];
      return row
        ? { id: row.id, queue: row.queue, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts }
        : null;
    },

    async complete(jobId) {
      await conn()
        .update(backgroundJobs)
        .set({ status: "DONE", finishedAt: new Date(), lockedAt: null, lockedBy: null, dedupeKey: null, lastError: null })
        .where(eq(backgroundJobs.id, jobId));
    },

    async fail(job, error, { retryable, now = new Date() }): Promise<FailOutcome> {
      const outcome: FailOutcome = retryable && job.attempts < job.maxAttempts ? "retry" : "dead";
      await conn()
        .update(backgroundJobs)
        .set(
          outcome === "retry"
            ? {
                status: "FAILED",
                notBefore: new Date(now.getTime() + retryDelayMs(job.attempts)),
                lockedAt: null,
                lockedBy: null,
                lastError: error.slice(0, ERROR_MAX),
              }
            : {
                status: "DEAD",
                finishedAt: now,
                lockedAt: null,
                lockedBy: null,
                dedupeKey: null,
                lastError: error.slice(0, ERROR_MAX),
              },
        )
        .where(eq(backgroundJobs.id, job.id));
      return outcome;
    },

    async defer(job, until) {
      await conn()
        .update(backgroundJobs)
        .set({
          status: "QUEUED",
          notBefore: until,
          lockedAt: null,
          lockedBy: null,
          attempts: sql`greatest(${backgroundJobs.attempts} - 1, 0)`,
        })
        .where(eq(backgroundJobs.id, job.id));
    },

    async releaseStale(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const rows = await conn()
        .update(backgroundJobs)
        .set({ status: "QUEUED", lockedAt: null, lockedBy: null })
        .where(and(eq(backgroundJobs.status, "RUNNING"), lt(backgroundJobs.lockedAt, cutoff)))
        .returning({ id: backgroundJobs.id });
      return rows.length;
    },

    async pruneFinished({ doneOlderThanMs, deadOlderThanMs }) {
      const now = Date.now();
      const done = await conn()
        .delete(backgroundJobs)
        .where(and(eq(backgroundJobs.status, "DONE"), lt(backgroundJobs.finishedAt, new Date(now - doneOlderThanMs))))
        .returning({ id: backgroundJobs.id });
      const dead = await conn()
        .delete(backgroundJobs)
        .where(and(eq(backgroundJobs.status, "DEAD"), lt(backgroundJobs.finishedAt, new Date(now - deadOlderThanMs))))
        .returning({ id: backgroundJobs.id });
      return done.length + dead.length;
    },

    async countDue() {
      const [row] = await conn()
        .select({ n: count() })
        .from(backgroundJobs)
        .where(and(inArray(backgroundJobs.status, ["QUEUED", "FAILED"]), lte(backgroundJobs.notBefore, new Date())));
      return row?.n ?? 0;
    },
  };
}
