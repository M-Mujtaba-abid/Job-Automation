import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { app, createdAt, id } from "./_shared";

export const BACKGROUND_JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "DEAD"] as const;
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

/**
 * Zero-cost job queue (ADR-023). Rows are claimed with FOR UPDATE SKIP LOCKED by
 * /api/cron/drain and after() kicks. FAILED = waiting for retry; DEAD = gave up.
 */
export const backgroundJobs = app.table(
  "background_jobs",
  {
    id: id(),
    queue: text("queue").notNull(),
    /** Collapses duplicates, e.g. "match:{userId}:{yyyy-mm-dd}". Cleared when the job finishes. */
    dedupeKey: text("dedupe_key").unique("background_jobs_dedupe_key_key"),
    /** ids and small enums only: never PII or tokens */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<BackgroundJobStatus>().notNull().default("QUEUED"),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("background_jobs_claim_idx").on(t.status, t.notBefore, t.priority),
    index("background_jobs_queue_status_idx").on(t.queue, t.status),
    // Unqualified column name on purpose: drizzle-kit renders `${t.status}` schema-qualified inside CREATE TABLE.
    check("background_jobs_status_check", sql`"status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')`),
  ],
);

/** Fixed-window counters for the Postgres rate limiter (ADR-017). */
export const rateLimitBuckets = app.table(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    points: integer("points").notNull(),
    expireAt: timestamp("expire_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limit_buckets_expire_at_idx").on(t.expireAt)],
);

export type BackgroundJobRow = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;
