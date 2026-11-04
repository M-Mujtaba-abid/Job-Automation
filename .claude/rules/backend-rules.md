---
paths:
  - "src/server/**/*.ts"
  - "src/workers/**/*.ts"
  - "src/app/api/**/*.ts"
  - "src/features/**/actions.ts"
  - "lib/**/*.ts"
  - "app/api/**/*.ts"
---

# Backend Rules

References: `plan/SYSTEM_ARCHITECTURE.md`, `plan/API_DESIGN.md`. Skills: `server-actions`, `api-design`, `claude-ai-integration`.

## Layers
| Layer | File | Responsibilities | Must not |
|---|---|---|---|
| Action / Route Handler | `features/<f>/actions.ts`, `app/api/**/route.ts` | auth (via wrapper), input parsing, call service, revalidate, map result | contain business rules or Prisma calls |
| Service | `server/modules/<d>/service.ts` | use cases, authorization, state transitions, transactions, enqueue jobs | parse HTTP/FormData, know about Next.js |
| Repository | `server/modules/<d>/repository.ts` | Prisma/SQL queries, always scoped by `ctx.userId` for tenant data | contain business decisions |
| Processor | `workers/processors/<queue>.ts` | load by id, call services, idempotent side effects | import Next.js modules |

Services are framework-agnostic so workers can reuse them.

## Server Actions
- Defined with `authedAction({ name, input, rateLimit?, handler })`; return `ActionResult<T>`; never throw to the client.
- Actions are public POST endpoints: treat every input as hostile; validate with Zod, including ids (`z.uuid()`).
- Revalidate after mutations (`updateTag` / `revalidatePath` / `refresh` per installed Next docs).
- Keep actions thin (≤ ~20 lines). No `redirect()` inside `try/catch` (it throws by design).

## Route Handlers
- Only for webhooks, OAuth callbacks, uploads/downloads, polling/status, cron, health (`API_DESIGN.md` §1).
- Wrapped with `route({ auth })`. Error JSON shape `{ error: { code, message, details?, requestId } }`. 500s return a generic message.
- Set `export const maxDuration` only when needed; long work goes to queues instead.

## Background jobs (BullMQ)
- Queue names and payload Zod schemas are declared once in `src/server/jobs/`. Payloads contain ids and small enums only (no PII, no tokens).
- Producers enqueue **after** the DB transaction commits (or via the outbox from M10). Use deterministic `jobId` when duplicates should collapse.
- Processors: validate payload, load state, check it is still applicable (state machine guard), perform work, persist, enqueue follow-ups. Safe to run twice.
- Configure retries/backoff per queue (`SYSTEM_ARCHITECTURE.md` §3.9). Mark non-retryable failures with `UnrecoverableError`.
- Workers handle `SIGTERM`: stop taking jobs, finish or release in-flight jobs within the grace period.

## External integrations
- Every integration sits behind an interface in `src/server/integrations/<name>/` with a fake implementation for tests/dev.
- Timeouts on every call; retries only on 429/5xx/network errors with backoff honouring `Retry-After` (v1 `fetchWithRetry` pattern).
- Validate responses with Zod; map provider errors to `AppError("INTEGRATION_ERROR")` with safe messages.

## AI calls
- Only through `src/server/ai/client.ts`; prompts are versioned files with their Zod output schema and model/effort config. See the `claude-ai-integration` skill.
- Record usage (`UsageRecord`) for every call; check quotas before enqueueing user-triggered AI work.

## Transactions & concurrency
- Multi-row invariants inside `prisma.$transaction` (interactive) with short duration; no external calls inside transactions.
- Claim work with `FOR UPDATE SKIP LOCKED` (v1 `processQueue` pattern) or BullMQ locks, never by read-then-update without a guard.
- Enforce uniqueness with DB constraints, and handle the `P2002` conflict as `AppError("CONFLICT")`.

## Configuration
- Read env only through `env()` (web) or `workerEnv()` (workers); never `process.env.X` in modules.
- Feature flags via config/DB, not commented-out code.

## Observability
- Each action/handler/processor logs one structured completion line `{ name, userId?, durationMs, outcome, requestId|jobId }`.
- Add Sentry breadcrumbs/spans for external calls; scrub PII.
