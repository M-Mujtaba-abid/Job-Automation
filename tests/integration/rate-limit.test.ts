import { like, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { rateLimitBuckets } from "@/server/db/schema";
import { createPgRateLimiter, enforceRateLimit } from "@/server/lib/rate-limit";

const hasDb = Boolean(process.env.DATABASE_URL);
const PREFIX = "itest:";
const limiter = createPgRateLimiter();
const cleanup = () =>
  db()
    .delete(rateLimitBuckets)
    .where(like(rateLimitBuckets.key, `${PREFIX}%`));

describe.skipIf(!hasDb)("Postgres rate limiter", () => {
  afterEach(cleanup);
  afterAll(cleanup);

  it("allows up to the limit within a window, then blocks with a retry hint", async () => {
    const key = `${PREFIX}login:1.2.3.4`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume(key, { points: 3, windowSec: 60 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]!.retryAfterSec).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("counts concurrent requests exactly (atomic upsert)", async () => {
    const key = `${PREFIX}burst`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.consume(key, { points: 5, windowSec: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("starts a fresh window after expiry", async () => {
    const key = `${PREFIX}expiring`;
    await limiter.consume(key, { points: 1, windowSec: 60 });
    expect((await limiter.consume(key, { points: 1, windowSec: 60 })).allowed).toBe(false);
    await db()
      .update(rateLimitBuckets)
      .set({ expireAt: sql`now() - interval '1 minute'` })
      .where(like(rateLimitBuckets.key, key));
    expect((await limiter.consume(key, { points: 1, windowSec: 60 })).allowed).toBe(true);
  });

  it("enforceRateLimit throws RATE_LIMITED with retryAfterSec", async () => {
    const key = `${PREFIX}enforce`;
    await enforceRateLimit(key, { points: 1, windowSec: 30 }, limiter);
    await expect(enforceRateLimit(key, { points: 1, windowSec: 30 }, limiter)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retryAfterSec: expect.any(Number) },
    });
  });
});
