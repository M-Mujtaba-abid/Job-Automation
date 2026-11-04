import "server-only";
import { lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db/client";
import { rateLimitBuckets } from "@/server/db/schema";
import { AppError } from "./errors";

export type Limit = { points: number; windowSec: number };

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

/** Profile-independent seam (SYSTEM_ARCHITECTURE §8.4). Postgres now; Redis adapter in the scale profile. */
export interface RateLimiter {
  consume(key: string, limit: Limit): Promise<RateLimitResult>;
  /** Housekeeping: delete expired buckets. */
  prune(): Promise<number>;
}

/**
 * Fixed-window limiter on app.rate_limit_buckets (ADR-017, zero-cost profile).
 * One atomic upsert per call: starts a new window when the old one has expired,
 * otherwise increments. Concurrency-safe because the row is locked by ON CONFLICT.
 * Implemented in-house instead of rate-limiter-flexible to avoid a dependency.
 */
export function createPgRateLimiter(conn: () => DbOrTx = db): RateLimiter {
  return {
    async consume(key, { points, windowSec }) {
      if (points < 1 || windowSec < 1) throw new Error("Invalid rate limit");
      const window = `${Math.floor(windowSec)} seconds`;
      const result = await conn().execute<{ points: number; retry_after: number }>(sql`
        INSERT INTO "app"."rate_limit_buckets" AS b (key, points, expire_at)
        VALUES (${key}, 1, now() + ${window}::interval)
        ON CONFLICT (key) DO UPDATE SET
          points    = CASE WHEN b.expire_at <= now() THEN 1 ELSE b.points + 1 END,
          expire_at = CASE WHEN b.expire_at <= now() THEN now() + ${window}::interval ELSE b.expire_at END
        RETURNING b.points, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (b.expire_at - now()))))::int AS retry_after`);
      const row = result.rows[0];
      if (!row) throw new Error("rate limiter returned no row");
      const used = Number(row.points);
      return { allowed: used <= points, remaining: Math.max(0, points - used), retryAfterSec: Number(row.retry_after) };
    },
    async prune() {
      const rows = await conn()
        .delete(rateLimitBuckets)
        .where(lt(rateLimitBuckets.expireAt, new Date()))
        .returning({ key: rateLimitBuckets.key });
      return rows.length;
    },
  };
}

export const rateLimiter = createPgRateLimiter();

/** Throws AppError("RATE_LIMITED") with retryAfterSec when the limit is exceeded. */
export async function enforceRateLimit(key: string, limit: Limit, limiter: RateLimiter = rateLimiter): Promise<void> {
  const r = await limiter.consume(key, limit);
  if (!r.allowed)
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", {
      retryAfterSec: r.retryAfterSec,
    });
}
