---
paths:
  - "prisma/**"
  - "src/server/db/**"
  - "src/server/modules/**/repository.ts"
  - "src/server/modules/**/*-repository.ts"
  - "lib/db/**"
  - "drizzle/**"
---

# Database Rules

Reference: `plan/DATABASE_DESIGN.md`. Skill: `.claude/skills/prisma-postgresql`. The `database-architect` agent reviews every schema change.

## Schema
- Follow the conventions in DATABASE_DESIGN §1: UUIDv7 ids (`@default(uuid(7)) @db.Uuid`), `@db.Timestamptz(6)`, `createdAt`/`updatedAt`, enums for statuses, integer minor units for money.
- **Every user-owned model has a non-null `userId` with `onDelete: Cascade`** and an index starting with `userId` for its main access path. Register it in the tenancy test registry.
- Global catalog models (`Job`, `Company`, `Skill`, …) never get `userId` (except `Job.ownerUserId` for private jobs).
- Every foreign key declares `onDelete` explicitly (Cascade / SetNull / Restrict) with a reason consistent with §8 retention policy.
- JSON columns only for read-whole payloads; anything filtered/sorted/joined becomes a column. Document the JSON shape with a Zod schema and a `///` comment.
- Add `@@index` for every new query pattern; check with `EXPLAIN ANALYZE` on realistic data before merging hot-path queries.

## Migrations
- Create with `prisma migrate dev --name <verb_noun>`; review the generated SQL. For things Prisma can't express (partial unique indexes, HNSW/GIN indexes, CHECK constraints, extensions), use `--create-only`, edit SQL, and add a header comment explaining the manual part.
- Production: `prisma migrate deploy` in the release step only. Never `migrate reset`, `db push`, or edit an applied migration.
- Breaking changes use expand → backfill → contract across releases. Large backfills run as batched jobs, not inside the migration.
- Never run migrations against production or staging from an agent session.
- Destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) requires explicit human approval in the PR.

## Queries
- Tenant queries always include `userId: ctx.userId` in `where`. Use `findFirst({ where: { id, userId } })` instead of `findUnique({ where: { id } })` for tenant rows.
- Select only needed columns (`select`) on list endpoints; never return `extractedText`, tokens or `raw` in list queries.
- Keyset pagination for feeds (`cursor` on `(sortKey, id)`); `take` ≤ 100.
- Avoid N+1: use `include`/`select` relations or batched `in` queries.
- Raw SQL: `$queryRaw` tagged templates or TypedSQL files only; `Prisma.sql`/`Prisma.join` for composition; dynamic identifiers from allowlists. `$queryRawUnsafe`/`$executeRawUnsafe` are banned.
- Vector similarity SQL lives only in `src/server/modules/matching/vector-repository.ts`.

## Transactions & locking
- Use interactive transactions for multi-step invariants; keep them short; no network calls inside.
- Work claiming: `FOR UPDATE SKIP LOCKED` with `LIMIT`; update status in the same statement or transaction.
- Handle unique violations (`P2002`) explicitly; never rely on read-before-write for uniqueness.

## Connections
- Web tier uses the pooled Neon URL with the serverless driver adapter; workers and migrations use the direct URL. One Prisma client per process (module singleton, guarded for dev hot reload).

## Data protection
- No PII in seed data or fixtures (synthetic only).
- Retention jobs implement DATABASE_DESIGN §8; account deletion must delete storage objects before the `User` row.

## Legacy (v1 Drizzle)
- `lib/db/schema.ts` and `drizzle/` are v1. Do not add v2 tables there. Drizzle is removed after the M6 import.
