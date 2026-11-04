---
name: drizzle-postgresql
description: Drizzle ORM + drizzle-kit on PostgreSQL (Neon serverless, pgvector halfvec) for this project - v2 tables in pgSchema("app"), snake_case naming, UUIDv7 ids, tenant-scoped repositories, transactions with optimistic concurrency, SKIP LOCKED work claiming (BackgroundJob queue), vector search, keyset pagination, migrations with drizzle-kit generate/migrate, SQLSTATE 23505 error mapping and DB testing against real Postgres. Use when editing src/server/db/schema, drizzle/ migrations, repositories, or any database query.
---

# Drizzle + PostgreSQL

## When to activate
- Adding or changing tables, enums, relations, indexes, constraints or migrations (`src/server/db/schema/**`, `drizzle/**`).
- Writing a repository function or any query (query builder or the `sql` template).
- Designing transactions, locking, pagination, queue claims or vector search.
- Debugging a slow query, a drizzle-kit diff or a Postgres error code.

Design source of truth: `plan/DATABASE_DESIGN.md` (logical schema §5.3, mapping §5.1, worked example §5.2, reference DDL §6). Decisions: ADR-004 (Drizzle) and ADR-024 (schema `app`).

## Version note
The repo pins `drizzle-orm ^0.45` and `drizzle-kit ^0.31` (as v1 does). That means the **v1 relational API** (`relations()`, `db.query.*`). Drizzle 1.0's `defineRelations` / RQB v2 is not used unless an ADR upgrades the packages. `node_modules` may be incomplete: run `npm ci`, then **verify each API against the installed typings** (`node_modules/drizzle-orm/pg-core/**/*.d.ts`) before relying on it, and update this skill when something differs.

## Layout
```
src/server/db/
  client.ts              # the only place a connection is created
  schema/_shared.ts      # app = pgSchema("app"), id(), createdAt(), updatedAt(), citext, bytea
  schema/<domain>.ts     # identity, resume, catalog, matching, applications, mail, automation, platform
  schema/index.ts        # barrel: re-exports every table, enum and relations object
  seed.ts                # synthetic data only
drizzle/                 # generated migrations (v1 history 0000-0001 + v2), meta/ snapshots
lib/db/                  # v1 (public schema), legacy: never import from v2 code
```

## Client setup (one per process)
```ts
// src/server/db/client.ts  (mirrors v1 lib/db/index.ts)
import "server-only";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import { env } from "@/server/lib/env";

neonConfig.webSocketConstructor = ws;                  // Node runtime; verify if still required on the current Vercel runtime

export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __appDb?: Db };

/** Lazy singleton: no connection at import time (safe for `next build`), survives dev HMR. */
export function db(): Db {
  globalForDb.__appDb ??= drizzle({
    client: new Pool({ connectionString: env().DATABASE_URL }),   // pooled URL on the web tier
    schema,
  });
  return globalForDb.__appDb;
}
```
- `neon-serverless` (WebSocket `Pool`) supports interactive `db().transaction()`. `drizzle-orm/neon-http` is cheaper per call but has **no interactive transactions**; use it only for single-statement reads, and only if a measured cold-start problem justifies a second client.
- Migrations and the local automation runner use the **direct** (unpooled) URL (`DATABASE_URL_UNPOOLED`).
- Do not set the `casing` option: column names are explicit in the schema, so drizzle-kit output, raw SQL and the reference DDL match exactly.

## Schema conventions
```ts
// src/server/db/schema/_shared.ts
import { customType, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

export const app = pgSchema("app");                    // ADR-024: never pgTable() for v2 tables

export const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** precision 3 so the value round-trips exactly through JS Date (needed for optimistic concurrency checks). */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date());

export const citext = customType<{ data: string }>({ dataType: () => "citext" });
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
```
```ts
// src/server/db/schema/automation.ts (excerpt)
export const automationTaskStatus = app.enum("automation_task_status", [
  "PREPARING", "AWAITING_APPROVAL", "APPROVED", "SUBMITTING", "SUBMITTED", "NEEDS_MANUAL", "FAILED", "CANCELLED", "EXPIRED",
]);

export const automationTasks = app.table(
  "automation_tasks",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }),
    status: automationTaskStatus("status").notNull().default("PREPARING"),
    /** PII: shown to the user only */
    preparedPayload: jsonb("prepared_payload").$type<PreparedPayload>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // …
  },
  (t) => [
    index("automation_tasks_user_status_idx").on(t.userId, t.status, t.createdAt.desc()),
    uniqueIndex("automation_tasks_one_active_idx")
      .on(t.userId, t.jobId)
      .where(sql`${t.status} IN ('PREPARING', 'AWAITING_APPROVAL', 'APPROVED', 'SUBMITTING')`),
  ],
);
```
Rules:
- Tables: `app.table("snake_case_plural", …)`; columns: `camelCase: type("snake_case")`; enums: `app.enum("snake_case", ["UPPER_CASE", …])`.
- Every FK declares `onDelete` explicitly (`"cascade"` / `"set null"` / `"restrict"`) consistent with DATABASE_DESIGN §8. Circular or self references use `(): AnyPgColumn => table.id`.
- Vectors: `halfvec("embedding", { dimensions: 768 })`. HNSW: `index("jobs_embedding_hnsw_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")).where(…)`.
- GIN/trigram/expression indexes and `check()` constraints are declared in the table's extra-config array, referencing columns as `${t.col}`.
- JSON columns: `jsonb().$type<T>()` where `T` is `z.infer` of a Zod schema (type-only import). Validate on write.
- `relations()` objects live next to their table and are exported from the barrel (needed for `db.query.*`).
- Index names `<table>_<purpose>_idx`, unique `<table>_<cols>_key`, checks `<table>_<rule>`.
- Types: `typeof t.$inferSelect` / `$inferInsert` stay inside repositories; services return DTOs (no `Date`/`numeric` string surprises leaking to the client).

## Tenant-scoped repository pattern
```ts
// src/server/modules/applications/repository.ts
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { companies, jobApplications, jobs } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth";

const t = jobApplications;

export const applicationRepo = {
  /** Returns undefined for missing OR foreign rows; callers map it to NOT_FOUND. */
  async findById(ctx: TenantContext, id: string) {
    const [row] = await db()
      .select({ id: t.id, stage: t.stage, boardPosition: t.boardPosition, jobId: t.jobId, updatedAt: t.updatedAt })
      .from(t)
      .where(and(eq(t.id, id), eq(t.userId, ctx.userId)))
      .limit(1);
    return row;
  },

  listBoard(ctx: TenantContext) {
    return db()
      .select({
        id: t.id, stage: t.stage, boardPosition: t.boardPosition, appliedAt: t.appliedAt,
        job: { id: jobs.id, title: jobs.title }, company: { name: companies.name, logoUrl: companies.logoUrl },
      })
      .from(t)
      .innerJoin(jobs, eq(jobs.id, t.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(t.userId, ctx.userId), isNull(t.archivedAt)))
      .orderBy(asc(t.stage), asc(t.boardPosition));
  },
};
```
Relational API equivalent (same rule: the tenant predicate is always present):
```ts
db().query.jobApplications.findFirst({
  where: (a, { and, eq }) => and(eq(a.id, id), eq(a.userId, ctx.userId)),
  columns: { id: true, stage: true },
  with: { job: { columns: { id: true, title: true } } },
});
```
Rules: every `select`/`update`/`delete` on a tenant table has `eq(t.userId, ctx.userId)` in its `where` (`and(eq(t.id, id), eq(t.userId, ctx.userId))` for single rows). `userId` comes from `TenantContext`, never from input. List queries always pick columns explicitly. Never select `extractedText`, tokens, `raw` or file bytes unless the use case needs them. Updates and deletes check `.returning({ id })` length to detect "not found or foreign".

## Transactions with optimistic concurrency
```ts
export async function moveStage(ctx: TenantContext, input: MoveStageInput) {
  return db().transaction(async (tx) => {
    const [app] = await tx
      .select({ id: t.id, stage: t.stage, boardPosition: t.boardPosition, updatedAt: t.updatedAt })
      .from(t)
      .where(and(eq(t.id, input.applicationId), eq(t.userId, ctx.userId)))
      .limit(1);
    if (!app) throw new AppError("NOT_FOUND", "Application not found");
    assertTransition(app.stage, input.toStage);                         // pure, unit-tested state machine

    // Only update if nobody changed it since we read it (updated_at has precision 3, see _shared.ts).
    const updated = await tx
      .update(t)
      .set({ stage: input.toStage, boardPosition: input.boardPosition ?? app.boardPosition, lastActivityAt: new Date() })
      .where(and(eq(t.id, app.id), eq(t.userId, ctx.userId), eq(t.updatedAt, app.updatedAt)))
      .returning({ id: t.id });
    if (updated.length === 0) throw new AppError("CONFLICT", "Application was changed elsewhere, refresh and retry");

    await tx.insert(applicationStageChanges).values({
      userId: ctx.userId, applicationId: app.id, fromStage: app.stage, toStage: input.toStage, actorType: "USER", note: input.note,
    });
    return { id: app.id, stage: input.toStage };
  });
}
```
- Pessimistic alternative for short critical sections: `.for("update")` on the select inside the transaction.
- No network calls (LLM, Gmail, HTTP) inside transactions. Enqueue `BackgroundJob` rows **inside** the same transaction (the zero-cost outbox, DATABASE_DESIGN §2); kick `after()` only after commit.
- Pass `tx` (type `Tx`) down to helper repository functions that must join the transaction; do not call `db()` inside them.

## Work claiming with SKIP LOCKED
### BackgroundJob claim (query builder)
```ts
// src/server/jobs/queue-repository.ts
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { backgroundJobs as q } from "@/server/db/schema";

export async function claimJobs(workerId: string, limit: number) {
  const claimable = db()
    .select({ id: q.id })
    .from(q)
    .where(and(eq(q.status, "QUEUED"), lte(q.notBefore, sql`now()`)))
    .orderBy(asc(q.priority), asc(q.notBefore))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db()
    .update(q)
    .set({ status: "RUNNING", lockedAt: sql`now()`, lockedBy: workerId, attempts: sql`${q.attempts} + 1` })
    .where(inArray(q.id, claimable))
    .returning({ id: q.id, queue: q.queue, payload: q.payload, attempts: q.attempts, maxAttempts: q.maxAttempts });
}
```
Completion and failure are guarded updates (`where(and(eq(q.id, id), eq(q.lockedBy, workerId), eq(q.status, "RUNNING")))`). Failure sets `status = attempts >= maxAttempts ? "DEAD" : "QUEUED"` and `notBefore = now() + backoff`. The maintenance job resets `RUNNING` rows with `locked_at < now() - interval '5 minutes'`. Enqueue with `dedupeKey` + `.onConflictDoNothing({ target: q.dedupeKey })`.

### Raw `sql` claim (when the builder cannot express it)
```ts
import { sql } from "drizzle-orm";
import { followUpReminders as r } from "@/server/db/schema";

export async function claimDueReminders(limit = 100) {
  const res = await db().execute<{ id: string; user_id: string }>(sql`
    UPDATE ${r} SET status = 'NOTIFIED', notified_at = now()
    WHERE id IN (
      SELECT id FROM ${r}
      WHERE status = 'PENDING' AND due_at <= now()
      ORDER BY due_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, user_id`);
  return res.rows.map((row) => ({ id: row.id, userId: row.user_id }));
}
```
- `${r}` renders the schema-qualified table (`"app"."follow_up_reminders"`). `${limit}` becomes a bound parameter.
- Column names in raw SQL are snake_case constants written in the source. Use `${r.col}` where a qualified reference is valid (`WHERE`, `ORDER BY`, the right-hand side of `SET`), but not as an `UPDATE … SET` target or in an `INSERT` column list.
- Raw SQL bypasses `$defaultFn`/`$onUpdate`: supply `id` (UUIDv7) on inserts and `updated_at = now()` on updates yourself.
- `db().execute()` returns `{ rows }` with **snake_case** keys: map them to camelCase in the repository.

## Vector search (only in `matching/vector-repository.ts`)
```ts
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { jobs, userProfiles } from "@/server/db/schema";

export async function nearestActiveJobs(ctx: TenantContext, args: { since: Date; limit: number; countryCodes: string[] }) {
  // Profile vector stays in SQL (scalar subquery) instead of shipping 768 floats through JS.
  const profileVec = sql`(SELECT ${userProfiles.embedding} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${ctx.userId})`;
  const distance = sql<number>`${jobs.embedding} <=> ${profileVec}`;

  return db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`);
    return tx
      .select({ id: jobs.id, distance })
      .from(jobs)
      .where(and(
        eq(jobs.status, "ACTIVE"), isNotNull(jobs.embedding),      // must imply the partial HNSW index predicate
        gt(jobs.firstSeenAt, args.since),
        args.countryCodes.length > 0
          ? or(inArray(jobs.countryCode, args.countryCodes), eq(jobs.workMode, "REMOTE"))
          : undefined,
      ))
      .orderBy(distance)
      .limit(args.limit);
  });
}
```
- When the vector is already in memory, use the helper: `cosineDistance(jobs.embedding, vec)`.
- Writing: `db().update(jobs).set({ embedding: vec, embeddingModel }).where(eq(jobs.id, id))`. Validate `vec` with Zod first (`z.array(z.number().finite()).length(768)`).
- Confirm with `EXPLAIN` that `jobs_embedding_hnsw_idx` is used (the `WHERE` must imply the index predicate `embedding IS NOT NULL AND status = 'ACTIVE'`).

## Pagination (keyset)
```ts
// cursor = base64url(JSON.stringify([score, id])), decoded and validated with Zod
const m = jobMatches;
const rows = await db()
  .select({ id: m.id, score: m.score, jobId: m.jobId, title: jobs.title })
  .from(m)
  .innerJoin(jobs, eq(jobs.id, m.jobId))
  .where(and(
    eq(m.userId, ctx.userId),
    inArray(m.status, ["NEW", "SEEN"]),
    cursor ? or(lt(m.score, cursor.score), and(eq(m.score, cursor.score), lt(m.id, cursor.id))) : undefined,
  ))
  .orderBy(desc(m.score), desc(m.id))
  .limit(limit + 1);                     // one extra row tells us whether there is a next page
```

## Migrations workflow
1. Edit `src/server/db/schema/<domain>.ts` (and export new objects from `index.ts`).
2. `npm run db:generate -- --name <verb_noun>` (`drizzle-kit generate`). Config: schemas `lib/db/schema.ts` + `src/server/db/schema/index.ts`, `schemaFilter: ["public", "app"]`, `out: "./drizzle"`.
3. **Review the SQL** in `drizzle/NNNN_<verb_noun>.sql`: renames (drizzle-kit may propose drop + add), enum changes, index predicates, and FK `ON DELETE`. Compare against the reference DDL in DATABASE_DESIGN §6.
4. Things drizzle-kit does not manage (`CREATE EXTENSION`, data backfills): `npx drizzle-kit generate --custom --name <verb_noun>`, write the SQL with a header comment:
   ```sql
   -- MANUAL: extensions are not managed by drizzle-kit; created in public for both schemas (ADR-024).
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
5. Apply locally (local Docker DB or your own Neon dev branch): `npm run db:migrate`, then run the tests. Commit schema + SQL + `drizzle/meta/` snapshot together.
6. Shared environments are migrated **only by the owner or the CI release step** (`drizzle-kit migrate`). Agents never run migrations against shared databases.

Never: `drizzle-kit push` against any shared DB, editing an applied migration, deleting files in `drizzle/` or `drizzle/meta/`, adding v2 tables to `lib/db/schema.ts`. Breaking changes use expand → backfill → contract across releases.

## Error mapping (SQLSTATE)
```ts
// src/server/db/errors.ts
const PG = { UNIQUE: "23505", FOREIGN_KEY: "23503", CHECK: "23514", SERIALIZATION: "40001" } as const;

/** Drizzle wraps driver errors (DrizzleQueryError); the Postgres error is the error itself or its `cause`. */
export function pgErrorOf(err: unknown): { code: string; constraint?: string } | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return e as { code: string; constraint?: string };
  }
  return undefined;
}

export function mapDbError(err: unknown): never {
  const pg = pgErrorOf(err);
  if (!pg) throw err;
  logger.warn({ pgCode: pg.code, constraint: pg.constraint }, "db constraint violation");   // never the bound values
  if (pg.code === PG.UNIQUE) throw new AppError("CONFLICT", "Already exists");
  if (pg.code === PG.FOREIGN_KEY) throw new AppError("CONFLICT", "Related record constraint");
  if (pg.code === PG.CHECK) throw new AppError("VALIDATION_FAILED", "Invalid value");
  throw err;
}
```
The constraint name goes to logs only, never to client-visible `details`. "Not found" is not an exception in Drizzle: check for an empty result or `.returning()` length. Prefer `onConflictDoNothing` / `onConflictDoUpdate({ target, targetWhere, set })` over catching `23505` when the conflict is expected (idempotent upserts).

## Better Auth adapter
```ts
import { drizzleAdapter } from "better-auth/adapters/drizzle";
database: drizzleAdapter(db(), { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } }),
```
Tables are `app.users`, `app.sessions`, `app.accounts`, `app.verifications`; ids are UUIDv7 via Better Auth's advanced database id-generation option. Verify option names against the installed `better-auth` version.

## Anti-patterns
- ❌ Tenant query without `eq(t.userId, ctx.userId)`; `where(eq(t.id, id))` alone on tenant tables.
- ❌ `sql.raw()` with anything that is not a literal written in the source; string-concatenated SQL; dynamic identifiers without an allowlist map of column objects.
- ❌ `pgTable()` for v2 tables (lands in `public`, clashes with v1); bare v2 table names in raw SQL (use `${table}`).
- ❌ Importing `db` outside `src/server/db/**` and `**/repository.ts` / `**/*-repository.ts` (ESLint `no-restricted-imports`).
- ❌ Read-then-insert for uniqueness (race): rely on unique constraints + `onConflict*` or `23505` mapping.
- ❌ Offset pagination on large feeds; unbounded `select()` without `limit`.
- ❌ `select()` with no column list on list pages (over-fetching PII and bytea).
- ❌ Long transactions or external calls inside them; using the neon-http client for transactional work.
- ❌ Business decisions in repositories; returning `$inferSelect` rows from services.
- ❌ Storing filterable data inside JSON columns.
- ❌ `drizzle-kit push` on shared databases; hand-editing generated snapshots.

## Performance checklist
- An index supports the `where` + `orderBy` of every hot query (leading `user_id` on tenant tables).
- `EXPLAIN (ANALYZE, BUFFERS)` on seeded perf data for new hot-path queries; record the plan in `docs/architecture/query-plans.md`. Use `.toSQL()` to get the exact SQL Drizzle sends.
- HNSW: `SET LOCAL hnsw.ef_search` inside a transaction; filter on indexed columns before ordering.
- Batch inserts with `db().insert(t).values(rows)` in chunks of ≤ 1000 rows (Postgres caps bind parameters at 65,535 per statement); `.onConflictDoNothing()` for ingest dedupe.
- One `Pool` per process; never create clients per request. Keep Neon Free compute low: no polling loops against the DB (ADR-023).

## Security considerations
- Tenant isolation is enforced here. Every new table with a `userId` column must be in the tenancy registry (`tests/integration/tenancy/registry.ts`), or the meta-test fails.
- PII columns (`extractedText`, `bodyText`, payloads, file bytes) are excluded from default selects and never logged. Drizzle's `logger: true` is dev-only and never runs with production data.
- Encrypted columns (`bytea`) hold ciphertext from the crypto helper only.
- v2 code never imports `lib/db/**` or `@/legacy/**`; the M6 import runs as a reviewed SQL script (`public.*` → `app.*`).

## Testing requirements
- Integration tests run against **real Postgres + pgvector**: local Docker (`pgvector/pgvector:pg16`) or a disposable Neon dev branch, with all migrations applied via `drizzle-kit migrate`. Never mock `db` for repository tests.
- Test the `sql`-template code (claims, vectors, partial unique indexes, CHECKs) only against real Postgres.
- Concurrency tests for claim functions: two concurrent claimers → disjoint results; stale-lock reset works.
- Tenancy meta-test: enumerate tables exported from `src/server/db/schema/index.ts` (`getTableConfig(t)` → schema `app`, columns) and assert that every table with `user_id` is registered.
- Migration smoke test in CI: empty DB → `drizzle-kit migrate` succeeds → `drizzle-kit generate` produces no new migration (no drift) → `drizzle-kit check` passes.
