# Technical Decisions (ADR Log)

> Status legend: **Accepted** (in force) · **Proposed** (recommended, needs owner confirmation) · **Superseded** · **Deferred**
> Last reviewed: 2026-11-04. Every architecture change must add or amend an ADR here (see `.claude/rules/coding-standards.md`).

This file is the single source of truth for *why* the system looks the way it does. Other plan documents reference ADRs by number (e.g. "see ADR-007").

> **ACTIVE PROFILE: ZERO-COST (ADR-023).** The owner requires $0 running cost. Wherever any plan document mentions Redis/BullMQ, worker containers, object storage (R2/S3), Claude, Voyage AI, Resend/Postmark, Stripe/Paddle or paid hosting, apply the substitution table in **ADR-023**. Those original choices remain documented as the **Scale profile**, the upgrade path once there is revenue.

---

## 0. Baseline: what already exists (v1)

The repository is not empty. It contains a working **single-user** job-hunting tool ("v1"), specified in `PROJECT_PROMPT.md` and documented in `README.md`:

| Area | v1 implementation | Reuse in v2? |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict, `proxy.ts` (Next 16 replacement for `middleware.ts`) | **Yes**: same framework |
| UI | Tailwind v4, shadcn/ui (new-york, `radix-ui`), lucide, sonner, TanStack Table | **Yes**: same design system |
| DB | Neon Postgres via `@neondatabase/serverless`, **Drizzle ORM** (`lib/db/schema.ts`, 2 migrations) | ORM kept (ADR-004); schema is replaced (single-tenant → multi-tenant) by new tables in Postgres schema `app` (ADR-024) |
| Auth | Single shared `APP_PASSWORD` → HS256 JWT cookie (`jose`), login rate limit table | **No**: replaced by real user accounts (ADR-005) |
| Job source | Apify actors scraping LinkedIn / Facebook hiring posts, async runs + webhook + cron fallback collector | Pipeline pattern **yes**; LinkedIn/Facebook scraping **no** for SaaS (ADR-011) |
| Extraction | `lib/extract/*`: email / phone (libphonenumber) / Google-Form extraction, hiring-post detection, dedupe hash. 34 Vitest tests with fixtures | **Yes**: ported as the deterministic layer of job parsing |
| Applying | Bulk email via Nodemailer + Gmail SMTP app password, `SKIP LOCKED` queue, double-apply partial unique index, WhatsApp `wa.me` + Google Form links | Patterns **yes**; SMTP app passwords **no** (ADR-012) |
| CV | One PDF stored as `bytea` in Postgres | **No**: object storage + versions (ADR-009) |
| Hosting | Vercel Hobby + daily cron, cron-job.org for 6-hourly | Web tier **yes**; add worker tier (ADR-008) |

**Baseline findings (2026-11-04):**
1. `node_modules/` is a partial/broken install: `next`, `react`, `zod`, `drizzle-orm`, `typescript` are missing. Run `npm ci` before any build. Consequently the bundled Next.js docs at `node_modules/next/dist/docs/` (required reading per `AGENTS.md`) are currently unavailable.
2. The directory is **not a git repository**. Initialising git (with the existing `.gitignore`, which correctly excludes `.env*.local`) is the first task of Milestone 0.
3. `.env.local` contains live secrets. It must never be read by agents or committed (enforced by `.claude/settings.json` deny rules).
4. v1 security observations are recorded in `SECURITY_DESIGN.md` §15.

**Strategy decision (ADR-001):** evolve this repository into v2 rather than starting a new one. v1 stays runnable until v2 reaches feature parity for its owner (end of Milestone 6), then v1-only code is deleted.

---

## ADR-001: Evolve the existing repository; strangler migration from v1
- **Status:** Accepted
- **Context:** v1 works and contains tested, valuable logic (contact extraction, ingest idempotency, queue claiming). v2 is a multi-tenant SaaS with a different data model.
- **Decision:** Keep one repo. In Milestone 0, move code under `src/` and introduce the v2 module layout. v1 modules are ported into v2 modules one at a time; v1 tables are not migrated in place (schema is new), but the owner's v1 data can be imported by a one-off script (M6).
- **Alternatives:** (a) Greenfield repo: loses tests and history, duplicates config. (b) In-place schema evolution of Drizzle tables: single-tenant assumptions (singleton `settings`, `cv_file id=1`) are everywhere; cost > benefit.
- **Consequences:** M0 includes a mechanical restructure. Until M6 the codebase contains both `legacy` (v1) and v2 modules; legacy code lives under `src/legacy/` and must not be imported by v2 modules.

## ADR-002: Next.js 16 App Router as the single web application
- **Status:** Accepted
- **Decision:** One Next.js app serves the marketing site, auth, and dashboard. Server Components for reads, Server Actions for UI mutations, Route Handlers for webhooks/OAuth/file streaming/cron. Use Next 16 conventions: `proxy.ts`, async request APIs (`await params`, `await cookies()`), Cache Components (`"use cache"`, `cacheTag`, `cacheLife`) for **global** data only, `next typegen` route types.
- **Alternatives:** Separate SPA + API server (NestJS/Fastify): more moving parts, duplicated validation and auth; not justified at this scale. Remix/React Router 7: viable, but v1 and team knowledge are Next.
- **Trade-offs:** Server Actions are public POST endpoints; every action must authenticate and validate (see `.claude/skills/server-actions`). Long-running work cannot run in request handlers on Vercel; it goes to workers (ADR-008).
- **Caveat:** `AGENTS.md` warns this Next version differs from training data. Agents must read `node_modules/next/dist/docs/` (after `npm ci`) before writing framework code.

## ADR-003: TypeScript strict + Zod at every boundary
- **Status:** Accepted
- **Decision:** `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (enabled in M0; fix fallout). Zod v4 schemas validate: env, Server Action inputs, Route Handler bodies/queries, webhook payloads, third-party API responses, **and LLM structured outputs**. Schemas are the source of truth for types (`z.infer`).
- **Alternatives:** Valibot (smaller bundle). Zod is already used in v1 and is supported by the Anthropic SDK's `zodOutputFormat` helper.

## ADR-004: Drizzle ORM on PostgreSQL (kept from v1)
- **Status:** Accepted (owner decision, 2026-11-04). Supersedes the earlier *Proposed: Prisma* version of this ADR.
- **Context:** v1 already uses Drizzle (`drizzle-orm ^0.45`, `drizzle-kit`, Neon serverless driver, `lib/db/`, migrations in `drizzle/`). The v2 schema is a full rewrite regardless of ORM (multi-tenant, ~30 tables), so the question was which toolchain to write it in. The original brief listed Prisma; the owner chose to keep Drizzle.
- **Decision:**
  - **Drizzle ORM + drizzle-kit** for all v2 data access, with the Neon serverless driver (`drizzle-orm/neon-serverless` + `Pool`, as v1 `lib/db/index.ts`; `drizzle-orm/neon-http` is acceptable for single-statement, non-transactional reads).
  - v2 tables live in the Postgres schema **`app`** (ADR-024).
  - **Layout:** schema files `src/server/db/schema/<domain>.ts` with barrel `src/server/db/schema/index.ts`; client `src/server/db/client.ts`; migrations stay in `drizzle/` (the v1 folder), generated with `drizzle-kit generate`. Migrations are applied with `drizzle-kit migrate` **only by the owner or CI**; `drizzle-kit push` is never used against shared databases.
  - **Naming:** snake_case plural table names and snake_case columns (v1 convention); TypeScript property names camelCase. Ids are UUIDv7 generated app-side (`uuid("id").primaryKey().$defaultFn(uuidv7)`); timestamps `timestamp(..., { withTimezone: true })`; Postgres enums declared with `app.enum(...)` so they also live in schema `app`.
  - **Expressed in schema code** (no hand-edited SQL needed): `halfvec`/`vector` columns, partial unique indexes (``uniqueIndex().on(...).where(sql`...`)``), `check()` constraints, HNSW indexes (`index().using("hnsw", t.embedding.op("halfvec_cosine_ops"))`), GIN indexes, expression indexes. `CREATE SCHEMA "app"` is emitted by drizzle-kit from `pgSchema("app")`. **Custom SQL migrations** (`drizzle-kit generate --custom`) remain only for `CREATE EXTENSION`, data backfills and anything drizzle-kit cannot diff. `DATABASE_DESIGN.md` §6 keeps the reference DDL.
  - **Raw SQL:** Drizzle's parameterised `sql` tagged template (``db.execute(sql`...`)``) for `SKIP LOCKED` claims, vector queries and aggregates. **`sql.raw()` with any non-constant input is banned**; dynamic identifiers come from allowlist maps.
  - **Errors:** unique violations are detected by Postgres SQLSTATE `23505` (on the driver error or its `cause`, since Drizzle wraps driver errors) and mapped to `AppError("CONFLICT")`.
  - **Better Auth** uses its Drizzle adapter (`drizzleAdapter(db, { provider: "pg", ... })`, ADR-005).
  - **Repositories unchanged:** every tenant query filters `and(eq(t.id, id), eq(t.userId, ctx.userId))`.
- **Why Drizzle:**
  - It is already installed, configured and in production use in v1. No new toolchain, and no Prisma binaries or generated-client step in the build.
  - Native `vector`/`halfvec` column types and query helpers (`cosineDistance`), plus partial/HNSW/GIN indexes and CHECK constraints in TypeScript. Most of the hand-written SQL Prisma would have needed goes away.
  - The SQL-like query builder makes the `SKIP LOCKED` claims, CTEs and keyset pagination clear, and the same builder covers CRUD and the complex queries. v1's double-apply partial index and claim queries are already written this way.
  - Small runtime and no query engine, which suits Vercel serverless cold starts on the zero-cost profile.
- **Costs, stated honestly:**
  - The schema is TypeScript, not a declarative DSL, so it is less readable at a glance for non-specialists. *Mitigation:* `DATABASE_DESIGN.md` §5 keeps a logical schema in readable notation plus a model → table mapping.
  - drizzle-kit is still pre-1.0 (0.x). Diffs can mis-detect renames, and enum or `pgSchema` changes sometimes need manual review. *Mitigation:* always review generated SQL, run a migration smoke test in CI, and use expand → contract for renames.
  - Relation queries (`db.query.*` with `relations()`) are less mature than Prisma's nested writes, so multi-table writes are explicit statements inside `db.transaction()`.
  - App-side UUIDv7 generation needs a small dependency (e.g. `uuid` v7) until Postgres-native `uuidv7()` is available on Neon.
- **Alternative considered: Prisma (v7 line, driver adapters).** It has a declarative schema that doubles as documentation, a mature `migrate dev`/`migrate deploy` workflow and nested relation writes. Rejected for this project because pgvector is not a first-class type there (`Unsupported(...)` columns and raw SQL for every vector read and write), partial unique, HNSW and GIN indexes need hand-edited migrations, it adds a second ORM and a generate step, and all v1 queries would have to be rewritten. Revisit only if the drizzle-kit migration workflow proves unreliable in practice.
- **Reversibility:** medium. The entity model (`DATABASE_DESIGN.md`) is ORM-independent and all queries sit behind module repositories, so switching later would mean rewriting the repositories but no services.

## ADR-005: Authentication with Better Auth (self-hosted, Drizzle adapter)
- **Status:** Proposed
- **Decision:** Better Auth with the Drizzle adapter (`drizzleAdapter(db, { provider: "pg", schema })`, mapping its `user`/`session`/`account`/`verification` models to the Drizzle tables `app.users`, `app.sessions`, `app.accounts`, `app.verifications`; UUIDv7 id generation configured in Better Auth's advanced database options; verify option names against the installed version): email + password (Argon2id/scrypt), email verification, Google & Microsoft OAuth sign-in, database sessions (revocable), optional TOTP 2FA plugin, rate-limited auth endpoints.
- **Alternatives:**
  - *Auth.js (NextAuth) v5:* long-running beta; the Auth.js project is now maintained by the Better Auth team, who recommend Better Auth for new projects.
  - *Clerk / WorkOS / Auth0:* fastest to ship and strong security posture, but per-MAU cost, user data outside our DB, and harder GDPR export/erasure joins. Revisit if B2B SSO becomes a requirement.
  - *Roll our own (v1 style):* rejected for multi-user (password reset, verification, session revocation, OAuth are all security-critical).
- **Consequences:** Auth tables (`app.users`, `app.sessions`, `app.accounts`, `app.verifications`) follow Better Auth's field set; our `User` model extends it with additional fields (`role`, `timezone`, `locale`, `deletionRequestedAt`) declared both in the Drizzle table and in Better Auth's `user.additionalFields`.

## ADR-006: Tenancy model: per-user tenancy, global job catalog
- **Status:** Accepted
- **Decision:** The tenant is the **User** (B2C). Every user-owned row carries `userId` and is accessed only through repository functions that take a `userId` from the authenticated session. Job catalog tables (`Company`, `Job`, `JobSource`, `JobSkill`, `JobApplyChannel`) are **global and shared**: a job is ingested, parsed and embedded once, then matched per user. This is the single biggest cost lever for AI spend.
- **Isolation enforcement:** (1) scoped repository API (no unscoped `select`/`update`/`delete` on tenant tables; `db` importable only from repositories, lint rule in M0); (2) integration tests that assert cross-tenant access returns NOT_FOUND; (3) **Deferred:** Postgres Row-Level Security as defense in depth (M12), set via `set_config('app.user_id', …)` inside a transaction.
- **Not now:** `Organization`/workspace entity (career coaches, agencies). Kept as a future seam: tenant scoping goes through one `TenantContext` type so it can be widened later.

## ADR-007: Background processing with BullMQ on Redis
- **Status:** Scale profile only. In the active zero-cost profile, replaced by a Postgres job table drained by serverless invocations (ADR-023)
- **Context:** Resume parsing, job ingestion, embedding, matching, email sending and browser automation are slow, retryable, rate-limited work that cannot run inside Vercel request lifetimes.
- **Decision:** BullMQ queues on a **standard, persistent Redis** (e.g. Railway/Render/Redis Cloud/Upstash fixed-price plan; *not* per-request-billed serverless Redis, since BullMQ keeps blocking connections and issues many commands). Producers run in the Next.js app; consumers run in worker processes (ADR-008).
- **Why BullMQ:** retries with exponential backoff, delayed & repeatable jobs (reminders, schedules), per-queue rate limiters (email providers, ATS sites), concurrency control, job progress events, flows (parent/child) for the resume → embed → match chain, Bull Board UI.
- **Alternative considered: pg-boss (Postgres-backed queue).** No extra infrastructure, transactional enqueue. Rejected because we need Redis anyway for rate limiting, and BullMQ's rate limiting/flows fit the automation workload better. *If the owner wants minimum infra for an early launch, pg-boss is the fallback; the queue is hidden behind `src/server/jobs/queue.ts`.*
- **Transactional outbox:** to avoid "DB committed but job not enqueued", critical producers write an `OutboxEvent` row in the same transaction; a relay enqueues it (introduced in M10; earlier milestones enqueue after commit and rely on idempotent reconciliation crons).

## ADR-008: Deployment topology: Vercel (web) + container workers + managed data services
- **Status:** Scale profile only. Zero-cost profile: Vercel Hobby + Neon Free + free cron pinger, no worker host; browser automation via local runner (ADR-023)
- **Decision:**
  - **Web:** Vercel (as v1). Region pinned close to the database.
  - **Workers:** Docker containers on Railway / Fly.io / Render (owner's choice): `worker-general` (Node, all non-browser queues) and `worker-automation` (Playwright official image with Chromium, low concurrency, isolated).
  - **Database:** Neon Postgres (as v1) with `pgvector`; pooled URL for the app, direct URL for migrations.
  - **Redis:** managed Redis co-located with workers.
  - **Object storage:** S3-compatible bucket (Cloudflare R2 default; AWS S3 alternative) (ADR-009).
- **Alternatives:** Everything on one VPS (cheaper, more ops burden); everything on AWS (ECS + RDS): stronger enterprise story, slower to set up. The topology is portable: only env vars change.

## ADR-009: Resume storage in private object storage
- **Status:** Scale profile only. Zero-cost profile stores files in Postgres (`ResumeFile.data bytea`, the v1 approach) behind the same `FileStore` interface (ADR-023)
- **Decision:** Resume files go to a private bucket under `resumes/{userId}/{resumeVersionId}`, encrypted at rest (provider SSE). Uploads pass through a Route Handler (size + magic-byte validation **before** storage; 4 MB cap kept from v1 due to Vercel request limits). Downloads use short-lived (≤ 5 min) presigned GET URLs issued after authorization. The DB stores only metadata + storage key + SHA-256.
- **Why not `bytea` (v1):** bloats DB backups and pooled connections, no CDN/presign, couples DB size to user count.

## ADR-010: AI: Claude via the official Anthropic TypeScript SDK; structured outputs; embeddings from a dedicated provider
- **Status:** Scale profile only (optional paid `LlmProvider` adapter). Zero-cost profile uses Gemini API free tier (primary) and Groq free tier (fallback) for LLM calls and Gemini embeddings (ADR-023). Principles in this ADR (structured outputs, versioned prompts, metering, deterministic-first, LLM never owns the score) apply to every provider.
- **Decision:**
  - All LLM calls go through `src/server/ai/client.ts` using `@anthropic-ai/sdk`. No direct `fetch` to the API, no OpenAI-compatible shims.
  - **Structured outputs:** `client.messages.parse()` with `output_config.format = zodOutputFormat(schema)`; results are re-validated, and failures are typed errors, never silently coerced.
  - **Default model:** `claude-opus-5-5` (effort set explicitly; thinking cannot be disabled on this model, so lower `effort` for simple extraction). Refusal handling: check `stop_reason === "refusal"`; server-side `fallbacks: "default"` (beta header `server-side-fallback-2026-07-01`) on interactive calls.
  - **Model per task is configuration** (`AI_MODEL_<TASK>` env), recorded on every `UsageRecord` together with `promptVersion`.
  - **Bulk/offline work** (re-parsing the global job catalog, nightly re-explanations) uses the **Message Batches API** (50% cost, async).
  - **Prompt caching** for stable system prompts and the candidate profile block reused across many job evaluations.
  - **PDF input:** native `document` blocks are used as a fallback for resumes whose text layer is missing or garbled; DOCX is converted to text locally (Claude does not accept DOCX directly).
  - **Embeddings:** Anthropic does not offer an embeddings API. Use **Voyage AI** (Anthropic's recommended embeddings partner); exact model and dimension are fixed by an eval at M4 and recorded here. Stored in pgvector with HNSW (cosine).
- **Cost model (illustrative, verify current pricing before launch):** parsing one job description ≈ 1.5K input + 0.5K output tokens. On `claude-opus-5-5` ($4 / $20 per MTok) ≈ $0.016/job; 10K new jobs/day ≈ $160/day (≈ $80 with Batches). On `claude-haiku-5-5` ($0.10 / $0.50) ≈ $0.0004/job ≈ $4/day. **Owner decision (open):** whether bulk job-description parsing runs on a cheaper model. The design keeps it configurable and the eval suite (`TESTING_STRATEGY.md` §6) must show extraction quality holds before switching.
- **Rule:** an LLM never produces the match score on its own (ADR-013).

## ADR-011: Job sources: official/permitted feeds first; scraping only where terms allow
- **Status:** Accepted
- **Context:** v1 scrapes LinkedIn and Facebook posts through Apify. LinkedIn's User Agreement prohibits scraping and automated access; Meta's terms restrict automated collection. Acceptable risk for a personal tool is not acceptable for a commercial SaaS.
- **Decision:** a `JobSourceAdapter` interface (generalising v1's `JobSource`), with adapters prioritised:
  1. **Public ATS job-board APIs** published for exactly this purpose: Greenhouse Job Board API, Lever Postings API, Ashby public job postings API, SmartRecruiters / Workable public endpoints (company-by-company).
  2. **Licensed aggregator APIs:** e.g. Adzuna, Jooble, USAJOBS, Remotive/Arbeitnow (check each licence for commercial use and attribution).
  3. **User-supplied jobs:** paste a URL or description; browser-extension clip (later).
  4. **Apify / scraping actors:** only for sources whose terms permit it, behind a per-source `complianceStatus = APPROVED` flag. LinkedIn/Facebook adapters are kept as `legacy`, disabled by default, owner-only.
- Every adapter declares: auth method, rate limits, robots/terms review date, attribution requirements, retention rules.

## ADR-012: Email: transactional provider + user mailbox via OAuth
- **Status:** Proposed. Zero-cost profile: no transactional provider at launch (Google sign-in + in-app notifications); Gmail API OAuth app in Testing mode; Microsoft Graph deferred (ADR-023)
- **Decision:** Two separate channels:
  - **System email** (verification, password reset, digests, reminders): Resend or Postmark via one `EmailProvider` interface.
  - **Application email sent as the user:** Gmail API (`gmail.send`) and Microsoft Graph (`Mail.Send`) via OAuth. Refresh tokens encrypted with envelope encryption (ADR-015). Reply detection uses provider push (Gmail `watch` / Graph subscriptions) **only if** the required scopes pass review.
- **Rejected for SaaS:** storing users' SMTP app passwords (v1 approach): credential custody risk and providers are retiring app passwords.
- **Risk:** Google classifies Gmail scopes as *sensitive* or *restricted*; restricted scopes (reading mail) require an annual third-party security assessment. M8 must confirm the classification of every scope requested and budget for verification. Fallback: send-only + manual reply logging.

## ADR-013: Hybrid, transparent match scoring
- **Status:** Accepted
- **Decision:** Hard filters → vector retrieval → deterministic weighted score (skills, semantic similarity, experience, title, location, salary) → bounded LLM adjustment (±10 points, top-K only) with evidence-cited explanation. Weights and formula are versioned (`scoringVersion`). Full spec: `AI_MATCHING_DESIGN.md`.
- **Why:** explainable to users, reproducible, testable with fixtures, cheap (LLM only on the shortlist), resistant to prompt injection in job descriptions (the LLM cannot move a score by more than its bound).

## ADR-014: Browser automation: Playwright workers, explicit approval, no evasion
- **Status:** Accepted
- **Decision:** Per-ATS Playwright adapters (Greenhouse, Lever, Ashby, Workable first) run in an isolated worker. Two-phase flow: **prepare** (fill, screenshot, stop before submit) → **user approves the exact payload** → **submit** (re-fill deterministically, submit, verify confirmation). CAPTCHA, MFA, bot challenges or unknown fields → stop and hand off to manual apply with copy-ready answers. No stealth plugins, no CAPTCHA solvers, no fingerprint spoofing, no credential storage for job sites. Full spec: `AUTOMATION_DESIGN.md`.
- **Rejected:** LinkedIn Easy Apply / Indeed automation (prohibited by their terms).

## ADR-015: Secrets & sensitive-data encryption
- **Status:** Accepted
- **Decision:** Platform secrets in the host's secret manager (Vercel/Railway env), validated at boot with Zod (pattern from v1 `lib/env.ts`). Per-user secrets (OAuth tokens) use **envelope encryption**: AES-256-GCM data key per record, data key wrapped by a KMS key (AWS KMS / GCP KMS) or, initially, by versioned env keys `ENCRYPTION_MASTER_KEY_V1`, `_V2`, … (key-version id stored with each ciphertext) to support rotation. Plaintext tokens never logged, never sent to the client, never sent to LLMs.

## ADR-016: Billing through a provider abstraction; provider choice depends on legal entity
- **Status:** Deferred. No paid plans in the zero-cost profile (Vercel Hobby is non-commercial); Milestone 11 deferred (ADR-023)
- **Context:** v1 targets Pakistan (default location, `+92` phone normalisation). Stripe does not onboard merchants domiciled in Pakistan.
- **Decision:** `BillingProvider` interface with webhook-driven `Subscription` state. Provider options: **Stripe** (if a US/UK/EU entity exists, e.g. via Stripe Atlas), **Paddle** or **Lemon Squeezy** (merchant of record: handles global VAT/sales tax; verify payout support for the owner's country), local gateways (Safepay, PayFast, JazzCash/Easypaisa) for PKR plans. Decision required before M11.

## ADR-017: Rate limiting & quotas
- **Status:** Accepted (store differs by profile: Postgres in zero-cost, Redis in scale)
- **Decision:** `rate-limiter-flexible` limits (Postgres store `RateLimiterPostgres` in the zero-cost profile, Redis store in the scale profile) at three levels: (1) per-IP on auth & public endpoints, (2) per-user per-action (uploads, AI calls, sends), (3) per-external-target (each ATS domain, each email account) inside workers. Plan quotas (matches/day, AI parses/month, automation runs/month) are enforced from `UsageRecord` aggregates before work is enqueued.

## ADR-018: Observability: Sentry + structured logs + OpenTelemetry
- **Status:** Accepted
- **Decision:** Sentry for errors/performance in web and workers (PII scrubbing on: no resume text, no emails in events). `pino` JSON logs with `requestId`/`jobId` correlation; OpenTelemetry via Next.js `instrumentation.ts` for traces across web → queue → worker. Product analytics (PostHog) deferred to M12 and consent-gated.

## ADR-019: Testing stack
- **Status:** Accepted
- **Decision:** Vitest (unit + integration, already in v1), Testcontainers or ephemeral Neon branches for DB integration tests, MSW for HTTP mocking, Playwright Test for E2E and for automation-adapter tests against **locally served fixture forms** (never real employer sites in CI), an AI eval harness with golden datasets. Details: `TESTING_STRATEGY.md`.

## ADR-020: UI component system
- **Status:** Accepted
- **Decision:** shadcn/ui (copied components, `radix-ui` primitives) + Tailwind v4 tokens, TanStack Table for data grids, `@dnd-kit` for the Kanban board, React Hook Form + Zod resolver for complex forms (simple forms use `useActionState` without RHF), `next-themes` for dark mode. No second component library.

## ADR-021: Directory layout & module boundaries
- **Status:** Accepted
- **Decision:**
```
src/
  app/                    # routing only: pages, layouts, loading/error, route handlers (thin)
    (marketing)/ (auth)/ (app)/ api/
  components/ui/          # shadcn primitives
  components/shared/      # app-wide composites (DataTable, EmptyState, PageHeader…)
  features/<feature>/     # feature UI: components/, hooks/, actions.ts ("use server", thin)
  server/                 # server-only code (import "server-only")
    db/                   # Drizzle client (client.ts), schema/<domain>.ts + schema/index.ts (ADR-004/024), tx helpers
    auth/                 # Better Auth config, session + authorization helpers
    modules/<domain>/     # domain logic: service.ts, repository.ts, schemas.ts, types.ts, index.ts
    ai/                   # Claude client, prompts/ (versioned), output schemas, embeddings
    jobs/                 # queue names, producers, job payload schemas
    integrations/         # storage, email providers, gmail/graph, billing, job-source adapters
    lib/                  # env, logger, errors, crypto, rate-limit
  lib/                    # isomorphic utilities (no server imports)
  workers/                # worker entry points: general.ts, automation.ts, processors/
  legacy/                 # v1 code until M6 (no new imports from v2)
drizzle/                  # drizzle-kit migrations (v1 history + v2 `app` schema migrations), meta/
tests/                    # unit/, integration/, e2e/, evals/, fixtures/
```
- **Boundary rules:** `app/` and `features/` call `server/modules/*/index.ts` only; modules never import another module's repository; cross-module async effects go through queues; `server/` is never imported by client components (enforced with `server-only` + ESLint `no-restricted-imports`). The Drizzle `db` client is importable only from `src/server/db/**` and `**/repository.ts` / `**/*-repository.ts` (ESLint `no-restricted-imports`); schema table objects may be imported by repositories and by `src/server/db/**`.

## ADR-022: Domain modules
- **Status:** Accepted
- `identity` (users, sessions, authz) · `profile` (preferences) · `resume` (files, versions, parsing) · `skills` (taxonomy, candidate skills) · `catalog` (companies, jobs, dedupe) · `sources` (adapters, runs) · `matching` (scoring, explanations) · `applications` (tracker, stages, documents) · `interviews` · `reminders` · `mail` (accounts, messages, templates) · `automation` · `notifications` · `billing` (plans, subscriptions, usage) · `analytics` (dashboard aggregates) · `audit`.

## ADR-023: Zero-cost operating profile (ACTIVE)
- **Status:** Accepted (owner decision, 2026-11-04)
- **Context:** The owner requires $0 running cost and chose Vercel's free plan, Neon's free plan, and Gemini or Groq free AI tiers. The product therefore runs as a **personal tool + small free beta** (no paid plans) until there is revenue.
- **Decision:** Two deployment profiles. The **zero-cost profile is active**. The **scale profile** (ADR-007/008/009/010/012/016/018 as originally written) is the documented upgrade path. Every swappable concern sits behind an interface (`JobQueue`, `RateLimiter`, `FileStore`, `LlmProvider`, `EmbeddingProvider`, `Mailer`) so switching a component is an adapter + config change, not a rewrite.

### Substitution table
| Concern | Scale profile (original) | **Zero-cost profile (active)** | Free-tier constraints to design around |
|---|---|---|---|
| Web hosting | Vercel Pro | **Vercel Hobby** | personal/non-commercial use only; cron jobs at most once/day; per-function duration and monthly usage limits |
| Database | Neon paid | **Neon Free** | storage **1 GB per project** (writes blocked when full); **100 CU-hours/month per project, shared by all branches** (≈ 400 h at 0.25 CU; v1, v2 and the dev branch all draw from it; when it runs out, compute is suspended until next month); compute auto-suspends only after **5 idle minutes** and every query wakes it → keep data small, never poll the DB continuously, keep scheduled pings sparse (see *Neon compute budget*) |
| Background jobs | BullMQ + Redis + worker containers | **Postgres `BackgroundJob` table** claimed with `FOR UPDATE SKIP LOCKED` (v1's queue pattern), drained by time-boxed serverless runs: (1) `after()` kick right after the triggering request (the main path for user-triggered work), (2) **cron-job.org** (free) calling `/api/cron/drain` **every 30 min by default** (configurable in the cron-job.org job settings) with `CRON_SECRET` (v1 already uses cron-job.org), (3) Vercel daily cron as backstop | cron-job.org **times out after 30 s** and **disables a job after more than 25 consecutive failures**, so the synchronous drain budget is **`DRAIN_TIME_BUDGET_MS = 20000`**: the endpoint returns its summary within ~20 s and may continue via `after()` within the Vercel function duration limit; handlers idempotent; `notBefore` for delays/retries |
| Rate limiting | Redis | **`rate-limiter-flexible` with Postgres store** (`RateLimitBucket` table) | small write overhead; acceptable at beta scale |
| Worker host | Railway / Fly / Render | **none** | heavy work must fit in serverless time limits (chunked jobs) |
| Browser automation | `worker-automation` container | **local runner on the owner's PC** (`npm run automation:runner`), polling Neon for approved tasks only while running | assisted apply available to the owner only; other beta users get the manual-apply answer sheet |
| Resume files | R2 / S3 | **Postgres `ResumeFile.data bytea`** (v1 approach), 4 MB cap, max 3 versions kept per resume | counts toward DB storage budget |
| LLM | Claude (Anthropic API) | **`LlmProvider` interface: Gemini API free tier (primary), Groq free tier (fallback)**; Claude adapter optional later | per-model requests/minute and requests/day limits; **free-tier inputs may be used by the provider** (Gemini's unpaid-service terms allow use for product improvement and human review) → PII redaction mandatory; Gemini's unpaid terms also say **not to submit sensitive, confidential or personal information** and **require paid services for users in the EEA/UK/Switzerland** → see *Provider data-routing* below (decided: personal data → Groq only) |
| Embeddings | Voyage AI, `vector(1024)` | **Gemini embedding model (free tier), 768 dimensions, stored as `halfvec(768)`** | daily request limits → embed each job once, batch requests; keyword-only fallback |
| Sign-in | Better Auth: email/password + Google + Microsoft | **Better Auth with Google sign-in only** at launch (no system email needed) | email/password added when a free email channel exists |
| System email | Resend / Postmark | **none at launch**: in-app notifications; optional free tier (Brevo, or Resend with an owned domain) later | Resend requires an owned domain to email other people |
| Application email | Gmail + Microsoft Graph, verified OAuth app | **Gmail API with the OAuth app in Testing mode**; Microsoft deferred | Testing mode: limited, explicitly added test users; refresh tokens expire after ~7 days → periodic reconnect |
| Monitoring | Sentry + OpenTelemetry | **Sentry free developer plan** + Vercel runtime logs | event quota → sample, scrub PII |
| CI | GitHub Actions | **GitHub Actions free minutes** | private repos have a monthly minute allowance; keep E2E nightly, not per push |
| Job sources | ATS APIs + licensed aggregators | **free public ATS board APIs** (Greenhouse, Lever, Ashby) + free aggregator APIs (e.g. Remotive, Arbeitnow); Apify free monthly credit for the owner's legacy sources only | attribution/licence per source |
| Billing | Stripe / Paddle / local gateway | **none**: Milestone 11 deferred | Vercel Hobby forbids commercial use anyway |
| Domain | custom domain | **`<project>.vercel.app`** | |

> Free-tier quotas and model names change frequently. M0 records the **current** limits (with source links and date) in `docs/setup/free-tier-limits.md`; code reads limits from config, never hard-codes them.

### Storage budget (Neon Free, 1 GB per project)
The current limit is **1 GB per project** (`docs/setup/free-tier-limits.md`, checked 2026-11-04). This ADR earlier assumed ≈0.5 GB. The budget below is deliberately kept as conservative as before, aiming to stay under ~0.5 GB. The limit is read from config, not hard-coded.

| Data | Estimate | Rule |
|---|---|---|
| Active jobs | ~6 KB text + 1.5 KB `halfvec(768)` ≈ 8 KB/job | cap ~15–20K active jobs; `EXPIRED` after 30 days unseen, hard-deleted after 60 days unless referenced; **no `raw` payload storage** (or ≤ 7 days) |
| Resume files | ≤ 4 MB each, typically 100–300 KB | max 3 versions per resume; older versions' bytes deleted (metadata kept) |
| Matches | ~1 KB/row | keep top 200 NEW/SEEN matches per user; prune the rest |
| Logs/runs | small | `JobSourceRun` & `BackgroundJob` (done) pruned after 14 days |
A daily maintenance job reads `pg_database_size()` and raises an admin notification at **70% of the configured limit** (≈ 700 MB of 1 GB). Neon blocks writes when storage is full, so the alert must fire well before that.

### Neon compute budget
- Compute suspends only after 5 idle minutes, and every request wakes it. A drain call every 10 min would keep the database awake about half the time (≈ 360–450 h/month). That is near or over the ≈ 400 h allowance shared by v1, v2 and the dev branch.
- Therefore the cron-job.org drain runs **every 30 min by default** (configurable). User-triggered work (resume parsing, re-matching after profile edits, sends) relies on the `after()` kick, not on the cron. The Vercel daily cron runs maintenance.
- When no job is due, the drain exits after one indexed query. Nothing else polls the database; the local automation runner polls only while the owner has started it.
- During the beta, check the month's CU-hours in the Neon console weekly. If usage passes 70% of the allowance, lengthen the cron interval first.

### AI budget & degradation
- Daily request budgets per provider/model come from config (set just below the free limits). Every call is metered in `UsageRecord` (`provider`, `model`, tokens).
- Priority when budget is tight: (1) user-triggered resume parsing, (2) explanations for top matches, (3) bulk job parsing. Exhausted budget → job deferred to the next day (`notBefore`), UI shows deterministic data.
- **Deterministic-first is stricter here:** job descriptions go to the LLM only when deterministic extraction (v1 `lib/extract/*` + skill taxonomy) finds fewer than 3 skills or no seniority.
- Fallback order per call: Gemini → Groq → deterministic-only. Provider 429 responses honour retry hints and trip a short circuit breaker. Per the owner's data-routing decision below, this order applies only to public/non-personal tasks; personal tasks use Groq only, then deterministic-only.

### Provider data-routing (DECIDED by the owner, 2026-11-04)
The Gemini API unpaid-service terms (checked 2026-11-04, quoted in `docs/setup/free-tier-limits.md`) say: *"Do not submit sensitive, confidential, or personal information to the Unpaid Services."* They also allow only Paid Services for API clients made available to users in the **EEA, UK or Switzerland**. PII redaction lowers the risk, but a redacted resume is still personal data.

**Decision (owner, 2026-11-04): the recommended routing below is accepted.** It is enforced in code: each task declares `dataClass: "public" | "personal"`, providers declare `allowsPersonalData`, and `src/server/ai/router.ts` never sends personal data to a provider that disallows it (unit-tested).
1. **Gemini free tier only for public/non-personal data:** job-description parsing, job embeddings, and embeddings of title/skill lists.
2. **Resume parsing** (and any task whose input comes from a user's resume or answers) goes either to **Groq with Zero Data Retention enabled** (Groq console → Data Controls), still PII-redacted, or stays **deterministic-only** (v1 extractors + skill taxonomy, user reviews the result).
3. **No beta users in the EEA/UK/Switzerland** while the Gemini free tier is in use (sign-up country gating + terms).

Implemented chains (`src/server/ai/index.ts`, defaults verified live 2026-11-04): **public** → Gemini `gemini-3.5-flash-lite`, fallback Groq `openai/gpt-oss-20b`; **personal** → Groq `openai/gpt-oss-120b` only (no Gemini fallback; deterministic-only if Groq fails); **embeddings** (public text only: job documents, target titles, skill lists) → `gemini-embedding-2` at 768 dims. **Owner action:** enable Zero Data Retention in the Groq console (Settings → Data Controls). Point 3 (no EEA/UK/CH beta users) is enforced at sign-up in M1.

### Privacy safeguards specific to free tiers
1. **Redact before sending:** resume text is stripped of names, emails, phone numbers, street addresses and profile URLs (deterministic extraction from v1 `extractContacts` + placeholders) before any LLM call; contact fields are filled locally, never by the LLM.
2. **Disclosure & choice:** privacy notice states that AI features use third-party free-tier services that may retain inputs; users can switch AI parsing off and fill their profile manually.
3. **No other users' data** ever in a prompt; job descriptions are public data.

### Consequences
- Capacity: comfortable for the owner and roughly a few dozen beta users; background work is best-effort (minutes, not seconds).
- Features limited in this profile: assisted ATS submission (owner only via local runner), Outlook, system emails, paid plans.
- **Upgrade triggers** (move a component to the scale profile): sustained > 50 active users, wanting to charge money, free quotas hit on most days, or Neon storage > 70%.
- LLM fallback provider is **Groq** (groq.com, free tier), confirmed by the owner on 2026-11-04. It is not xAI's Grok. Any further provider is just another `LlmProvider` adapter and needs an ADR amendment.

## ADR-024: v2 tables in a dedicated Postgres schema `app`
- **Status:** Accepted (2026-11-04, follows from ADR-004)
- **Context:** v1 and v2 share one Neon database: the M6 import needs both datasets side by side, and one project means a single storage quota and compute allowance to watch (Neon Free limits are per project, ADR-023). v1 owns these tables in `public`: `jobs`, `applications`, `sources`, `settings`, `job_contacts`, `fetch_runs`, `email_templates`, `cv_file` and others. With the snake_case plural naming from ADR-004, v2 would want several of the same names (`jobs`, `applications`). Both schemas are managed by the same drizzle-kit setup until v1 is removed after M6.
- **Decision:**
  - All v2 tables, enums and indexes are declared with `export const app = pgSchema("app")`, using `app.table(...)` and `app.enum(...)`, in `src/server/db/schema/*.ts`. The v1 tables stay in `public` (`lib/db/schema.ts`), unchanged.
  - drizzle-kit config covers both: `schema: ["./lib/db/schema.ts", "./src/server/db/schema/index.ts"]`, `schemaFilter: ["public", "app"]`, `out: "./drizzle"`. drizzle-kit emits `CREATE SCHEMA "app"` itself (so no custom migration may create it). The first v2 migration is a custom migration that creates only the extensions (`vector`, `pg_trgm`, `citext`) in `public`, so that types such as `public.halfvec` and `public.citext` are visible from both schemas.
  - Connections keep the default `search_path` (`"$user", public`). Drizzle always schema-qualifies `app.*` tables, so v2 code never depends on `search_path`. Raw SQL in repositories uses the table objects (`${jobs}`) or explicit `app.` qualification, never bare v2 table names.
  - The **M6 import** is plain SQL between schemas (`INSERT INTO app.jobs (...) SELECT ... FROM public.jobs ...`), run as a reviewed, idempotent script in a transaction. No dump/restore and no cross-database link.
  - After the M6 cut-over, v1 `public` tables are dropped in a separate, owner-approved migration (destructive). `app` stays the v2 home, so no rename is needed later.
- **Alternatives considered:**
  - *Prefix v2 tables (`v2_jobs`) in `public`:* ugly names that would have to be renamed again after v1 is gone, and it is easy to query the wrong table by mistake.
  - *Separate Neon database, branch or project for v2:* clean isolation, but the M6 import then needs dump/restore or a foreign data wrapper. A branch also shares the project's compute allowance, and a second project means two quotas to monitor.
  - *Reuse v1 tables in place:* already rejected in ADR-001 (single-tenant assumptions).
- **Consequences:** Postgres RLS policies (M12, ADR-006) and grants are set on schema `app`. Tests and the tenancy meta-test enumerate tables of schema `app` only. Any SQL tool or console session must qualify `app.` (or `SET search_path = app, public`). The decision is reversible, since `ALTER TABLE ... SET SCHEMA` is cheap at our data size.

---

## Technology necessity review

| Technology | Verdict | Reason / when it becomes necessary |
|---|---|---|
| Next.js App Router, React, TS, Tailwind, shadcn/ui | **Keep** | Already in v1; fits SSR dashboard + marketing |
| Server Actions + Route Handlers | **Keep** | Actions for UI mutations; handlers for webhooks/OAuth/files |
| PostgreSQL (Neon) | **Keep** | Relational core, `SKIP LOCKED`, full-text, pgvector |
| Drizzle ORM + drizzle-kit | **Keep** (already in v1) | ADR-004; v2 tables in schema `app` (ADR-024) |
| `uuid` (v7 generator) | **Adopt in M0** | App-side UUIDv7 ids (ADR-004); tiny, no runtime services |
| pgvector | **Adopt in M4** | Avoids a separate vector DB until > ~10M vectors; HNSW is sufficient |
| Dedicated vector DB (Pinecone, Qdrant) | **Reject for now** | Extra infra and data-sync; revisit only on measured pgvector limits |
| Anthropic Claude API | **Adopt in M2** | Parsing, explanations, cover letters |
| Embeddings provider (Voyage AI) | **Adopt in M4** | Needed for semantic retrieval; Anthropic has none |
| Redis + BullMQ | **Adopt in M2** (first async workload) | Retries, scheduling, rate limiting |
| Object storage (R2/S3) | **Adopt in M2** | Resume files |
| Playwright | **Adopt in M9** | Automation only; also E2E tests from M1 |
| Transactional email (Resend/Postmark) | **Adopt in M1** | Verification + reset emails |
| Sentry | **Adopt in M0** | Cheap, immediate value |
| Kafka / event bus, microservices, Kubernetes | **Reject** | Overkill; modular monolith + workers suffices |
| GraphQL / tRPC | **Reject** | Server Components + Actions cover internal needs; REST for external |
| Separate search engine (Elastic, Typesense) | **Defer** | Postgres FTS + trigram + pgvector first; revisit at scale |
| Feature flags service | **Defer** | Env/DB flags until M12 |

> Zero-cost profile (ADR-023) overrides this table: Redis, BullMQ, object storage, Voyage AI, Claude, transactional email and billing are **not used** until an upgrade trigger is hit. pgvector is still used (`halfvec`), embeddings come from Gemini's free tier.

---

## Open questions (need owner input)

Resolved on 2026-11-04 by ADR-023 (zero-cost profile): hosting (Vercel Hobby), database (Neon Free), AI providers (Gemini/Groq free tiers), worker host and object storage (none), billing (deferred), auth provider (Better Auth, free, Google sign-in first).

Resolved on 2026-11-04 by the owner: **ORM** is Drizzle, kept from v1 (ADR-004), with v2 in schema `app` (ADR-024). **LLM fallback** is Groq (groq.com), not xAI Grok (ADR-023).

Resolved on 2026-11-04 by the owner: **free-tier AI data routing**: personal data → Groq (ZDR) only; Gemini free tier for public data only (ADR-023 *Provider data-routing*).

Still open:
1. **Launch markets:** Pakistan-first (as v1) or global? Affects job sources, salary currency handling, and data-protection law.
2. **Fate of v1 LinkedIn/Facebook scraping** for the owner's personal use (ADR-011).
