---
name: prisma-postgresql
description: Prisma ORM + PostgreSQL (Neon, pgvector) patterns for this project - schema conventions, tenant-scoped repositories, migrations with hand-written SQL, transactions, SKIP LOCKED work claiming, raw/vector queries, error mapping and DB testing. Use when editing prisma/schema.prisma, migrations, repositories, or any database query.
---

# Prisma + PostgreSQL

## When to activate
- Adding/changing models, enums, relations, indexes, or migrations.
- Writing a repository function or any query (Prisma or raw SQL).
- Designing transactions, locking, pagination, or vector search.
- Debugging a slow query or a Prisma error code.

Design source of truth: `plan/DATABASE_DESIGN.md`. ORM choice: ADR-004 (Prisma; Drizzle exists only in v1 legacy code).

## Version note
Targets the Prisma 7 line: `prisma.config.ts` holds datasource configuration, the `prisma-client` generator writes to `src/generated/prisma` (git-ignored), and driver adapters are used for connections. **Verify exact APIs against the installed Prisma docs/changelog** before writing code, and update this skill if anything differs.

## Client setup (one per process)
```ts
// src/server/db/client.ts
import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";       // web tier (serverless, pooled URL)
// Workers: import { PrismaPg } from "@prisma/adapter-pg" with the direct URL.
import { env } from "@/server/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString: env().DATABASE_URL }),
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env().NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

## Tenant-scoped repository pattern
```ts
// src/server/modules/applications/repository.ts
import "server-only";
import { prisma } from "@/server/db/client";
import type { TenantContext } from "@/server/auth";

export const applicationRepo = {
  /** Returns null for missing OR foreign rows; callers map null → NOT_FOUND. */
  findById(ctx: TenantContext, id: string) {
    return prisma.jobApplication.findFirst({
      where: { id, userId: ctx.userId },
      select: { id: true, stage: true, boardPosition: true, jobId: true, updatedAt: true },
    });
  },

  listBoard(ctx: TenantContext) {
    return prisma.jobApplication.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      orderBy: [{ stage: "asc" }, { boardPosition: "asc" }],
      select: { id: true, stage: true, boardPosition: true, appliedAt: true,
                job: { select: { id: true, title: true, company: { select: { name: true, logoUrl: true } } } } },
    });
  },
};
```
Rules: every tenant query includes `userId: ctx.userId`; use `findFirst({ where: { id, userId } })` (not `findUnique({ where: { id } })`); always `select` on list queries; never select `extractedText`, tokens, or `raw` unless the use case needs them.

## Transactions with state guards
```ts
export async function moveStage(ctx: TenantContext, input: MoveStageInput) {
  return prisma.$transaction(async (tx) => {
    const app = await tx.jobApplication.findFirst({ where: { id: input.applicationId, userId: ctx.userId } });
    if (!app) throw new AppError("NOT_FOUND", "Application not found");
    assertTransition(app.stage, input.toStage);                       // pure, unit-tested state machine

    // Optimistic concurrency: only update if nobody changed it since we read it.
    const updated = await tx.jobApplication.updateMany({
      where: { id: app.id, userId: ctx.userId, updatedAt: app.updatedAt },
      data: { stage: input.toStage, boardPosition: input.boardPosition ?? app.boardPosition, lastActivityAt: new Date() },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", "Application was changed elsewhere, refresh and retry");

    await tx.applicationStageChange.create({
      data: { userId: ctx.userId, applicationId: app.id, fromStage: app.stage, toStage: input.toStage, actorType: "USER", note: input.note },
    });
    return { id: app.id, stage: input.toStage };
  });
}
```
No network calls (LLM, email, queues) inside transactions; enqueue after commit.

## Work claiming with SKIP LOCKED (raw SQL)
```ts
import { Prisma } from "@/generated/prisma/client";

export async function claimDueReminders(limit = 100) {
  return prisma.$queryRaw<{ id: string; userId: string }[]>`
    UPDATE "FollowUpReminder" SET status = 'NOTIFIED', "notifiedAt" = now()
    WHERE id IN (
      SELECT id FROM "FollowUpReminder"
      WHERE status = 'PENDING' AND "dueAt" <= now()
      ORDER BY "dueAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, "userId"`;
}
```

## Vector search (only in matching/vector-repository.ts)
```ts
export async function nearestActiveJobs(ctx: TenantContext, args: { since: Date; limit: number; countryCodes: string[] }) {
  // Profile vector read in SQL to avoid shipping 1024 floats through JS.
  return prisma.$queryRaw<{ id: string; distance: number }[]>`
    WITH me AS (SELECT embedding FROM "UserProfile" WHERE "userId" = ${ctx.userId}::uuid AND embedding IS NOT NULL)
    SELECT j.id, j.embedding <=> me.embedding AS distance
    FROM "Job" j, me
    WHERE j.status = 'ACTIVE' AND j.embedding IS NOT NULL
      AND j."firstSeenAt" > ${args.since}
      AND (cardinality(${args.countryCodes}::text[]) = 0 OR j."countryCode" = ANY(${args.countryCodes}::text[]) OR j."workMode" = 'REMOTE')
    ORDER BY j.embedding <=> me.embedding
    LIMIT ${args.limit}`;
}
```
Writing vectors: `` prisma.$executeRaw`UPDATE "Job" SET embedding = ${toPgVector(vec)}::vector WHERE id = ${id}::uuid` `` where `toPgVector` validates length and finiteness and returns `'[0.1,0.2,…]'`.

## Pagination (keyset)
```ts
// cursor = base64url(JSON.stringify([score, id])); validated with Zod on decode
where: { userId: ctx.userId, status: { in: ["NEW", "SEEN"] },
  ...(cursor && { OR: [{ score: { lt: cursor.score } }, { score: cursor.score, id: { lt: cursor.id } }] }) },
orderBy: [{ score: "desc" }, { id: "desc" }],
take: limit + 1,                // fetch one extra to know if there's a next page
```

## Migrations
1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name add_job_match --create-only`
3. Review SQL; append hand-written parts (partial unique indexes, HNSW/GIN indexes, CHECK constraints) with a header comment:
   ```sql
   -- MANUAL: partial unique index; Prisma cannot express WHERE clauses on unique indexes.
   CREATE UNIQUE INDEX automation_task_one_active ON "AutomationTask" ("userId", "jobId")
     WHERE status IN ('PREPARING','AWAITING_APPROVAL','APPROVED','SUBMITTING');
   ```
4. `npx prisma migrate dev` to apply locally; run tests.
5. Production applies via `prisma migrate deploy` in the release pipeline only.
Expand → backfill → contract for breaking changes. Never edit applied migrations; never `db push` or `migrate reset` outside local dev. Agents never run migrations against shared environments.

## Error mapping
```ts
import { Prisma } from "@/generated/prisma/client";

export function mapPrismaError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") throw new AppError("CONFLICT", "Already exists", { target: err.meta?.target });
    if (err.code === "P2025") throw new AppError("NOT_FOUND", "Not found");
    if (err.code === "P2003") throw new AppError("CONFLICT", "Related record constraint");
  }
  throw err;
}
```

## Anti-patterns
- ❌ `findUnique({ where: { id } })` on tenant tables (no ownership check).
- ❌ `$queryRawUnsafe` / string-built SQL; dynamic identifiers without allowlist.
- ❌ Read-then-insert for uniqueness (race): use unique constraints + `P2002` handling or `upsert`.
- ❌ Offset pagination on large feeds.
- ❌ `include` of whole relations on list pages (over-fetching PII).
- ❌ Long interactive transactions or external calls inside them.
- ❌ Business decisions in repositories.
- ❌ Storing filterable data inside JSON columns.
- ❌ Adding v2 tables to v1 `lib/db/schema.ts` (Drizzle legacy).

## Performance checklist
- Index supports the `where` + `orderBy` of every hot query (leading `userId` on tenant tables).
- `EXPLAIN (ANALYZE, BUFFERS)` on seeded perf data for new hot-path queries; record in `docs/architecture/query-plans.md`.
- HNSW: tune `hnsw.ef_search` per query (`SET LOCAL` inside a transaction) and filter before ordering where possible.
- Batch writes (`createMany`, `skipDuplicates`) for ingest; chunk to ≤ 1000 rows.

## Security considerations
- Tenant isolation is enforced here: tests in the tenancy registry must cover every new tenant model.
- PII columns (`extractedText`, `bodyText`, payloads) are excluded from default selects and never logged (`log: ["query"]` is dev-only and must not run with production data).
- Encrypted columns (`Bytes`) hold ciphertext from the crypto helper only.

## Testing requirements
- Integration tests run against real Postgres + pgvector (Testcontainers `pgvector/pgvector:pg16`), migrations applied, data isolated per test.
- Test raw SQL (claims, vectors, partial unique indexes) only against real Postgres. Never mock Prisma for these.
- Concurrency tests for claim functions: two concurrent claimers → disjoint results.
- Migration smoke test in CI: `prisma migrate deploy` on an empty DB + `prisma migrate diff` shows no drift.
