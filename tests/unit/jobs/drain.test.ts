import { describe, expect, it } from "vitest";
import { z } from "zod";
import { drain } from "@/server/jobs/drain";
import { DeferError, NonRetryableError, type JobHandler } from "@/server/jobs/types";
import { createLogger } from "@/server/lib/logger";
import { createFakeQueue } from "./fake-queue";

const silent = createLogger();
process.env.LOG_LEVEL = "error";

function handler(queue: string, fn: (p: { n: number }) => Promise<void> | void): JobHandler {
  return { queue, payload: z.object({ n: z.number() }), handle: async (p) => fn(p as { n: number }) };
}

function run(q: ReturnType<typeof createFakeQueue>["queue"], hs: JobHandler[], budgetMs = 10_000, now?: () => number) {
  return drain({
    queue: q,
    handlers: new Map(hs.map((h) => [h.queue, h])),
    workerId: "test",
    budgetMs,
    logger: silent,
    ...(now && { now }),
  });
}

describe("drain", () => {
  it("runs due jobs in priority order and completes them", async () => {
    const { queue, rows } = createFakeQueue();
    const seen: number[] = [];
    await queue.enqueue("work", { n: 2 }, { priority: 50 });
    await queue.enqueue("work", { n: 1 }, { priority: 10 });
    const s = await run(queue, [handler("work", (p) => void seen.push(p.n))]);
    expect(seen).toEqual([1, 2]);
    expect(s).toMatchObject({ processed: 2, succeeded: 2, stoppedBy: "empty" });
    expect(rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("retries retryable errors and marks DEAD after maxAttempts", async () => {
    const { queue, rows } = createFakeQueue();
    await queue.enqueue("work", { n: 1 }, { maxAttempts: 1 });
    await queue.enqueue("work", { n: 2 }, { maxAttempts: 3 });
    const s = await run(queue, [
      handler("work", () => {
        throw new Error("boom");
      }),
    ]);
    expect(s).toMatchObject({ processed: 2, dead: 1, retried: 1 });
    expect(rows.map((r) => r.status)).toEqual(["DEAD", "FAILED"]);
    expect(rows[1]?.lastError).toBe("boom");
  });

  it("does not retry NonRetryableError", async () => {
    const { queue, rows } = createFakeQueue();
    await queue.enqueue("work", { n: 1 }, { maxAttempts: 5 });
    const s = await run(queue, [
      handler("work", () => {
        throw new NonRetryableError("bad");
      }),
    ]);
    expect(s.dead).toBe(1);
    expect(rows[0]?.status).toBe("DEAD");
  });

  it("defers without consuming an attempt", async () => {
    const { queue, rows } = createFakeQueue();
    await queue.enqueue("work", { n: 1 });
    const until = new Date(Date.now() + 3_600_000);
    const s = await run(queue, [
      handler("work", () => {
        throw new DeferError(until, "quota");
      }),
    ]);
    expect(s.deferred).toBe(1);
    expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 0, notBefore: until.getTime() });
  });

  it("kills jobs with no handler or an invalid payload instead of looping", async () => {
    const { queue, rows } = createFakeQueue();
    await queue.enqueue("unknown", { n: 1 });
    await queue.enqueue("work", { wrong: true });
    const s = await run(queue, [handler("work", () => {})]);
    expect(s.dead).toBe(2);
    expect(rows.map((r) => r.status)).toEqual(["DEAD", "DEAD"]);
  });

  it("stops when the time budget is spent and leaves the rest queued", async () => {
    let t = 0;
    const clock = () => t;
    const { queue, rows } = createFakeQueue(clock);
    for (let i = 0; i < 5; i++) await queue.enqueue("work", { n: i });
    const s = await run(
      queue,
      [
        handler("work", () => {
          t += 400;
        }),
      ],
      1_000,
      clock,
    );
    expect(s.stoppedBy).toBe("budget");
    expect(s.succeeded).toBe(3);
    expect(rows.filter((r) => r.status === "QUEUED")).toHaveLength(2);
  });

  it("dedupeKey collapses duplicate enqueues while pending", async () => {
    const { queue } = createFakeQueue();
    const a = await queue.enqueue("maintenance", { day: "2026-11-04" }, { dedupeKey: "maintenance:2026-11-04" });
    const b = await queue.enqueue("maintenance", { day: "2026-11-04" }, { dedupeKey: "maintenance:2026-11-04" });
    expect(a.deduped).toBe(false);
    expect(b).toEqual({ id: null, deduped: true });
  });
});
