---
paths:
  - "src/server/**/*.ts"
  - "src/workers/**/*.ts"
  - "src/app/api/**/*.ts"
  - "src/features/**/actions.ts"
  - "src/legacy/**/*.ts"
---

# Backend Rules

References: `plan/SYSTEM_ARCHITECTURE.md`, `plan/API_DESIGN.md`. Skills: `server-actions`, `api-design`, `claude-ai-integration`.

## Layers
| Layer | File | Responsibilities | Must not |
|---|---|---|---|
| Action / Route Handler | `features/<f>/actions.ts`, `app/api/**/route.ts` | auth (via wrapper), input parsing, call service, revalidate, map result | contain business rules or database (Drizzle) calls |
| Service | `server/modules/<d>/service.ts` | use cases, authorization, state transitions, transactions, enqueue jobs | parse HTTP/FormData, know about Next.js |
| Repository | `server/modules/<d>/repository.ts` | Drizzle queries (builder or `sql` template), always scoped by `eq(t.userId, ctx.userId)` for tenant data | contain business decisions |
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

## Background jobs (active: Postgres `BackgroundJob` queue, ADR-023)
- Always go through the `JobQueue` interface (`src/server/jobs/`); never touch `BackgroundJob` rows directly from modules. Queue names and payload Zod schemas are declared once there. Payloads contain ids and small enums only (no PII, no tokens).
- Enqueue **inside** the same DB transaction as the state change (the table is our outbox). Use `dedupeKey` when duplicates should collapse.
- Handlers must finish within the drain time-box. `DRAIN_TIME_BUDGET_MS` is **20 000 ms**: cron-job.org times out after 30 s and disables the job after more than 25 consecutive failures. Aim for each job to take ≤ 10 s. Chunk big work (one source page, ≤ 200 match candidates, one embedding batch per job) and enqueue the continuation. The drain endpoint always returns its summary (200) within ~20 s; any extra work continues via `after()` within the Vercel function limit.
- User-triggered work is started with an `after()` kick from the action. Do not rely on the cron, which runs every 30 min by default to save Neon compute (ADR-023).
- Processors: validate payload, load state, check it is still applicable (state-machine guard), perform work, persist, enqueue follow-ups. Safe to run twice.
- Retries via `attempts`/`notBefore` backoff; throw `NonRetryableError` for permanent failures; AI-quota exhaustion **defers** (not a failure).
- No long-running processes, no polling loops on Neon (it must be able to auto-suspend). The only long-running process is the owner's local automation runner.
- Scale profile (later): the same `JobQueue` interface gets a BullMQ adapter; handler code does not change.

## External integrations
- Every integration sits behind an interface in `src/server/integrations/<name>/` with a fake implementation for tests/dev.
- Timeouts on every call; retries only on 429/5xx/network errors with backoff honouring `Retry-After` (v1 `fetchWithRetry` pattern).
- Validate responses with Zod; map provider errors to `AppError("INTEGRATION_ERROR")` with safe messages.

## AI calls
- Only through `src/server/ai` (`runTask` router → `LlmProvider`: Gemini primary, Groq fallback); prompts are versioned files with their Zod output schema. See the `llm-integration` skill.
- PII redaction runs before every call. Record usage (`UsageRecord` with provider/model) for every call; check free-tier budgets before enqueueing user-triggered AI work.

## Zero-cost guardrail
- Do not add any dependency on a paid service, or on a service whose free tier needs an always-on process, without an ADR. Prefer Postgres-backed solutions for queues, rate limits, caching and small files.

## Transactions & concurrency
- Multi-row invariants inside `db().transaction(async (tx) => ...)` with short duration; no external calls inside transactions.
- Claim work with `FOR UPDATE SKIP LOCKED` (v1 `processQueue` pattern) or BullMQ locks, never by read-then-update without a guard.
- Enforce uniqueness with DB constraints, and handle unique violations (Postgres SQLSTATE `23505`, on the driver error or its `cause`) as `AppError("CONFLICT")`.

## Configuration
- Read env only through `env()` (web) or `workerEnv()` (workers); never `process.env.X` in modules.
- Feature flags via config/DB, not commented-out code.

## Observability
- Each action/handler/processor logs one structured completion line `{ name, userId?, durationMs, outcome, requestId|jobId }`.
- Add Sentry breadcrumbs/spans for external calls; scrub PII.
