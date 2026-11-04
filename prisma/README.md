# prisma/ (v2 database schema, not yet created)

`schema.prisma`, `migrations/` and `seed.ts` are created in **Milestone 0/1** after the ORM decision (ADR-004) is confirmed. The full proposed schema, hand-written SQL (partial unique indexes, HNSW/GIN indexes, CHECK constraints) and the per-milestone migration plan are in [`plan/DATABASE_DESIGN.md`](../plan/DATABASE_DESIGN.md).

v1's Drizzle schema remains in `lib/db/schema.ts` with migrations in `drizzle/` until the v1 → v2 data import in M6.

Rules: `.claude/rules/database-rules.md` · skill: `.claude/skills/prisma-postgresql`.
