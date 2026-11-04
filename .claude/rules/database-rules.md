---
paths:
  - "src/server/db/schema/**"
  - "src/server/db/**"
  - "src/server/modules/**/repository.ts"
  - "src/server/modules/**/*-repository.ts"
  - "src/legacy/db/**"
  - "drizzle/**"
---

# Database Rules

Reference: `plan/DATABASE_DESIGN.md`. Decisions: ADR-004 (Drizzle) and ADR-024 (schema `app`). Skill: `.claude/skills/drizzle-postgresql`. The `database-architect` agent reviews every schema change.

## Schema
- v2 tables are declared only in `src/server/db/schema/<domain>.ts` with `app.table(...)` (`app = pgSchema("app")`), exported from `src/server/db/schema/index.ts`. Never `pgTable()` for v2 (that lands in `public`, which is v1's schema).
- Naming: snake_case plural tables, snake_case columns, camelCase TS properties, enums via `app.enum("snake_case", [...])`, index names `<table>_<purpose>_idx`.
- Follow the conventions in DATABASE_DESIGN §1 and §5.1: UUIDv7 ids (`id()` helper, `uuid("id").primaryKey().$defaultFn(uuidv7)`), `timestamp(..., { withTimezone: true })`, `createdAt`/`updatedAt` helpers, enums for statuses, integer minor units for money.
- **Every user-owned table has a non-null `userId` (`user_id`) FK with `onDelete: "cascade"`** and an index starting with `user_id` for its main access path. Register it in the tenancy test registry.
- Global catalog tables (`jobs`, `companies`, `skills`, …) never get `userId` (except `jobs.ownerUserId` for private jobs).
- Every foreign key declares `onDelete` explicitly (`"cascade"` / `"set null"` / `"restrict"`) with a reason consistent with the §8 retention policy.
- JSON columns (`jsonb().$type<T>()`) only for read-whole payloads; anything filtered, sorted or joined becomes a column. Document the JSON shape with a Zod schema (`T = z.infer<...>`) and a JSDoc comment.
- Partial unique indexes, HNSW/GIN/trigram/expression indexes and CHECK constraints are declared **in the Drizzle table** (``uniqueIndex().on(...).where(sql`...`)``, `index().using("hnsw", t.embedding.op("halfvec_cosine_ops"))`, `check()`), referencing columns as `${t.col}`.
- Add an index for every new query pattern; check with `EXPLAIN ANALYZE` on realistic data before merging hot-path queries.

## Migrations
- Generate with `npm run db:generate -- --name <verb_noun>` (`drizzle-kit generate`) and **review the generated SQL** (renames, enum changes, index predicates, `ON DELETE`) against the reference DDL in DATABASE_DESIGN §6. Commit schema, SQL and `drizzle/meta/` snapshot together.
- Only things drizzle-kit cannot manage (`CREATE EXTENSION`, data backfills) go in custom migrations: `npx drizzle-kit generate --custom --name <verb_noun>`, with a header comment explaining the manual part.
- Apply with `drizzle-kit migrate` (`npm run db:migrate`): locally against your own dev DB, and on shared environments **only by the owner or the CI release step**. Never run `drizzle-kit push` against shared databases. Never edit or delete an applied migration or snapshot.
- Breaking changes use expand → backfill → contract across releases. Large backfills run as batched jobs, not inside the migration.
- Never run migrations against production or staging from an agent session.
- Destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`, dropping v1 `public` tables after M6) requires explicit human approval in the PR.

## Queries
- Tenant queries always include `eq(t.userId, ctx.userId)` in `where`. Single rows: `where(and(eq(t.id, id), eq(t.userId, ctx.userId)))`, never `eq(t.id, id)` alone.
- Pick columns explicitly (`select({ ... })` / `columns: {...}`) on list queries; never return `extractedText`, tokens, file bytes or `raw` in list queries.
- Keyset pagination for feeds (cursor on `(sortKey, id)`); `limit` ≤ 100.
- Avoid N+1: joins, `db.query.*` with `with`, or batched `inArray` queries.
- Raw SQL: Drizzle's `sql` tagged template only (``db.execute(sql`...`)``); values are bound parameters; reference tables via their objects (`${jobs}`) so they are schema-qualified. **`sql.raw()` with any non-constant input is banned**; dynamic identifiers come from allowlist maps of column objects.
- Vector similarity SQL lives only in `src/server/modules/matching/vector-repository.ts`.
- The `db` client is imported only in `src/server/db/**` and repository files (ESLint `no-restricted-imports`).

## Transactions & locking
- Use `db().transaction(async (tx) => ...)` for multi-step invariants; keep them short; no network calls inside. Enqueue `BackgroundJob` rows inside the transaction, and kick workers after commit.
- Optimistic concurrency: guarded `update ... where(..., eq(t.updatedAt, read.updatedAt))` + check `.returning()` length → `CONFLICT`.
- Work claiming: `FOR UPDATE SKIP LOCKED` with `LIMIT` (`.for("update", { skipLocked: true })` or the `sql` template); update status in the same statement or transaction.
- Handle unique violations (SQLSTATE `23505` on the driver error or its `cause`) explicitly → `AppError("CONFLICT")`, or use `onConflictDoNothing`/`onConflictDoUpdate`. Never rely on read-before-write for uniqueness.

## Connections
- Web tier uses the pooled Neon URL with `drizzle-orm/neon-serverless` (`Pool`, WebSocket); migrations and the local automation runner use the direct (unpooled) URL. One client per process (lazy module singleton in `src/server/db/client.ts`, guarded for dev hot reload). `neon-http` only for non-transactional single statements.

## Data protection
- No PII in seed data or fixtures (synthetic only).
- Retention jobs implement DATABASE_DESIGN §8; account deletion must delete storage objects before the `users` row.

## Legacy (v1, schema `public`)
- `lib/db/schema.ts` and the v1 migrations in `drizzle/` (`0000_init`, `0001_cv_in_db`) are v1. Do not add v2 tables there, and do not import `lib/db/**` from v2 code. The v1 tables are dropped (owner-approved migration) after the M6 import (`public.*` → `app.*`, ADR-024).
