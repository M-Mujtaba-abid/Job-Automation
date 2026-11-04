import { and, eq, like, notLike, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { backgroundJobs } from "@/server/db/schema";
import { createPgQueue } from "@/server/jobs/pg-queue";

/**
 * Real-Postgres tests for the zero-cost job queue (ADR-023). Only rows whose queue starts with
 * "itest:" are created and they are deleted afterwards. Skipped when no DATABASE_URL is configured.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const PREFIX = "itest:";
const q = createPgQueue();

async function cleanup() {
  await db()
    .delete(backgroundJobs)
    .where(like(backgroundJobs.queue, `${PREFIX}%`));
}

describe.skipIf(!hasDb)("Postgres JobQueue", () => {
  beforeAll(async () => {
    // claimNext() takes any due job; refuse to run if real jobs are waiting, so tests never steal them.
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(backgroundJobs)
      .where(
        and(
          notLike(backgroundJobs.queue, `${PREFIX}%`),
          sql`${backgroundJobs.status} IN ('QUEUED','FAILED','RUNNING')`,
        ),
      );
    if ((row?.n ?? 0) > 0) throw new Error("Real background jobs are pending; refusing to run queue integration tests");
    await cleanup();
  });
  afterEach(cleanup);
  afterAll(cleanup);

  it("enqueues, dedupes by key, claims with attempt count, completes and frees the key", async () => {
    const a = await q.enqueue(`${PREFIX}work`, { n: 1 }, { dedupeKey: `${PREFIX}k1` });
    const b = await q.enqueue(`${PREFIX}work`, { n: 1 }, { dedupeKey: `${PREFIX}k1` });
    expect(a.deduped).toBe(false);
    expect(b).toEqual({ id: null, deduped: true });

    const job = await q.claimNext("itest-worker");
    expect(job).toMatchObject({ id: a.id, queue: `${PREFIX}work`, payload: { n: 1 }, attempts: 1, maxAttempts: 5 });
    expect(await q.claimNext("itest-worker")).toBeNull();

    await q.complete(job!.id);
    const [row] = await db().select().from(backgroundJobs).where(eq(backgroundJobs.id, job!.id));
    expect(row).toMatchObject({ status: "DONE", dedupeKey: null, lockedBy: null });
    expect((await q.enqueue(`${PREFIX}work`, { n: 1 }, { dedupeKey: `${PREFIX}k1` })).deduped).toBe(false);
  });

  it("claims in priority order and ignores jobs scheduled in the future", async () => {
    await q.enqueue(`${PREFIX}work`, { n: "late" }, { priority: 1, notBefore: new Date(Date.now() + 3_600_000) });
    await q.enqueue(`${PREFIX}work`, { n: "low" }, { priority: 90 });
    await q.enqueue(`${PREFIX}work`, { n: "high" }, { priority: 10 });
    expect((await q.claimNext("w"))?.payload).toEqual({ n: "high" });
    expect((await q.claimNext("w"))?.payload).toEqual({ n: "low" });
    expect(await q.claimNext("w")).toBeNull();
  });

  it("never hands the same job to two concurrent claimers (SKIP LOCKED)", async () => {
    for (let i = 0; i < 12; i++) await q.enqueue(`${PREFIX}work`, { i });
    const claimLoop = async (worker: string) => {
      const ids: string[] = [];
      for (let job = await q.claimNext(worker); job; job = await q.claimNext(worker)) ids.push(job.id);
      return ids;
    };
    const results = await Promise.all(["w1", "w2", "w3", "w4"].map(claimLoop));
    const all = results.flat();
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it("retries with backoff, then marks DEAD after maxAttempts", async () => {
    await q.enqueue(`${PREFIX}work`, { n: 1 }, { maxAttempts: 2 });
    const first = await q.claimNext("w");
    expect(await q.fail(first!, "boom", { retryable: true })).toBe("retry");
    const [retrying] = await db().select().from(backgroundJobs).where(eq(backgroundJobs.id, first!.id));
    expect(retrying?.status).toBe("FAILED");
    expect(retrying!.notBefore.getTime()).toBeGreaterThan(Date.now());
    expect(await q.claimNext("w")).toBeNull(); // backoff not elapsed

    await db()
      .update(backgroundJobs)
      .set({ notBefore: sql`now() - interval '1 minute'` })
      .where(eq(backgroundJobs.id, first!.id));
    const second = await q.claimNext("w");
    expect(second?.attempts).toBe(2);
    expect(await q.fail(second!, "boom again", { retryable: true })).toBe("dead");
    const [dead] = await db().select().from(backgroundJobs).where(eq(backgroundJobs.id, first!.id));
    expect(dead).toMatchObject({ status: "DEAD", lastError: "boom again" });
  });

  it("defer re-queues without consuming an attempt; releaseStale recovers crashed runs", async () => {
    await q.enqueue(`${PREFIX}work`, { n: 1 });
    const job = await q.claimNext("w");
    const until = new Date(Date.now() + 60_000);
    await q.defer(job!, until);
    const [deferred] = await db().select().from(backgroundJobs).where(eq(backgroundJobs.id, job!.id));
    expect(deferred).toMatchObject({ status: "QUEUED", attempts: 0 });

    await db()
      .update(backgroundJobs)
      .set({ notBefore: sql`now() - interval '1 minute'` })
      .where(eq(backgroundJobs.id, job!.id));
    const again = await q.claimNext("w");
    await db()
      .update(backgroundJobs)
      .set({ lockedAt: sql`now() - interval '10 minutes'` })
      .where(eq(backgroundJobs.id, again!.id));
    expect(await q.releaseStale(5 * 60_000)).toBeGreaterThanOrEqual(1);
    const [released] = await db().select().from(backgroundJobs).where(eq(backgroundJobs.id, again!.id));
    expect(released).toMatchObject({ status: "QUEUED", lockedBy: null });
  });
});
