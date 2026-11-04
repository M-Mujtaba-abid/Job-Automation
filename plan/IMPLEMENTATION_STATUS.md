# Implementation Status

> Statuses: **NOT STARTED** · **IN PROGRESS** · **BLOCKED** (reason required) · **COMPLETED** (verification evidence required)
> Rule: an item is COMPLETED only when its implementation and acceptance criteria have been verified, and the evidence column says how. Documentation/configuration completion (Part A) is tracked separately from application implementation (Part B). Completing Part A does **not** mean any application feature exists.
> Last updated: 2026-11-04 (initialization phase).

## Part A: Initialization phase (documentation & Claude Code configuration)

| # | Deliverable | Status | Evidence |
|---|---|---|---|
| A1 | Baseline analysis of existing repository (v1 inventory, broken `node_modules`, no git, secrets present in `.env.local`) | COMPLETED | Findings recorded in `TECHNICAL_DECISIONS.md` §0 and `SECURITY_DESIGN.md` §15 (v1 source files read during analysis; `.env.local` deliberately not read) |
| A2 | `.claude/settings.json` (permissions: allow read-only checks, ask for installs/migrations/git writes, deny secrets & destructive commands) | COMPLETED | Valid JSON, no deprecated keys, no permissive `defaultMode`, `.env.example` not blocked. Checked by verification script (A13) |
| A3 | Root `CLAUDE.md` (keeps `@AGENTS.md`) + `.claude/CLAUDE.md` (ecosystem guide) | COMPLETED | Both exist, each ≤ 200 lines, import preserved. Checked by script |
| A4 | 9 subagents in `.claude/agents/` | COMPLETED | Frontmatter parses; name = filename; valid tools/model; preloaded skills exist; all 9 required sections present. Checked by script |
| A5 | 7 skills in `.claude/skills/*/SKILL.md` | COMPLETED | Frontmatter parses; names valid and match dirs; descriptions 80–1024 chars; each covers activation, examples, anti-patterns, error handling, security, testing. Checked by script |
| A6 | 5 rules in `.claude/rules/` (2 global, 3 path-scoped) | COMPLETED | Scoped rules have only a `paths` frontmatter key. Checked by script |
| A7 | 12 plan documents in `plan/` | COMPLETED | All exist; content reviewed for consistency (A13) |
| A8 | Mermaid diagrams (system, application workflow, AI processing, job discovery, automation, deployment, ERD, roadmap dependencies, others) | COMPLETED (heuristic validation) | 11 diagrams: diagram type, quote balance, unquoted-paren labels and sequence participants checked by script. **Not rendered with the Mermaid parser** (no mermaid package installed); render-check recommended in M0 CI |
| A9 | Cross-document consistency (ADR references, Prisma model/enum/relation resolution, tenant models have `userId` + cascade, every model scheduled in migration plan, roadmap agents exist, all 14 milestones have the 9 required fields, scoring weights sum to 1) | COMPLETED | Checked by script; 3 contract mismatches found during review and fixed (usage metric for interview questions, `salaryExpectation` field, automation payload shape) |
| A10 | `docs/` structure (`setup/`, `architecture/`, `guides/` with indexes of planned docs), `src/` and `prisma/` placeholders, `public/` directory | COMPLETED | Files exist. Checked by script |
| A11 | `README.md` v2 pointer (v1 content preserved), `.env.example` planned-variable names appended (commented out, no values), `.gitignore` v2 entries | COMPLETED | Manual diff review: additions only, v1 content unchanged |
| A12 | Technology evaluation & ADRs (22 ADRs + necessity review + open questions) | COMPLETED | `TECHNICAL_DECISIONS.md` |
| A13 | Final verification run | COMPLETED | Verification script result recorded in the initialization report; all checks pass after fixes |
| A14 | Zero-cost profile (owner decision 2026-11-04): ADR-023 + substitutions across plan docs, schema additions (`BackgroundJob`, `RateLimitBucket`, `ResumeFile`, `halfvec(768)`), new `llm-integration` skill, updated rules/agents/CLAUDE.md/settings/`.env.example`/setup docs | COMPLETED | Verification script re-run after the changes (8 skills, schema checks incl. new models); see change log |

## Part B: Application milestones

| Milestone | Status | Notes |
|---|---|---|
| M0 Project Foundation | IN PROGRESS | Tasks 1–4, 6, 9, 10 completed; remaining: Docker run check (5), Sentry DSN (7), first GitHub CI run (8). Not blocking M1 |
| M1 Authentication & User Management | NOT STARTED | Depends on M0; auth provider confirmation (ADR-005) |
| M2 Resume Upload & AI Parsing | NOT STARTED | |
| M3 Job Aggregation | NOT STARTED | Source licences/terms review needed per source (ADR-011) |
| M4 AI Job Matching | NOT STARTED | Embeddings model selection eval |
| M5 Job Discovery Dashboard | NOT STARTED | |
| M6 Application Tracking System | NOT STARTED | Includes v1 data import + v1 UI removal |
| M7 Interview & Follow-up Management | NOT STARTED | |
| M8 Email Integration | NOT STARTED | Google/Microsoft OAuth app verification lead time |
| M9 Browser Automation | NOT STARTED | Staged rollout M9a/b/c |
| M10 Notifications & Background Jobs | NOT STARTED | |
| M11 Subscription & Billing | BLOCKED | Deferred by owner decision: zero-cost profile has no paid plans and Vercel Hobby is non-commercial (ADR-023). Unblock when an upgrade trigger is hit + ADR-016 resolved |
| M12 Testing, Security & Optimization | NOT STARTED | |
| M13 Production Deployment | NOT STARTED | |

### M0 task tracker
| # | Task (DEVELOPMENT_ROADMAP M0) | Status | Evidence / notes |
|---|---|---|---|
| 1 | Git repository + first commit + remote | COMPLETED | Repo already existed (commit `406ebb7`, remote `github.com/M-Mujtaba-abid/Job-Automation`). Verified 2026-11-04: `.env.local`/`.env` ignored, no env/secret files in any commit (`git log --all --name-only`) |
| 2 | `npm ci`, confirm v1 build/test/lint/typecheck, read bundled Next docs | COMPLETED | `npm ci` repaired node_modules; v1 baseline: 39/39 tests, lint, typecheck, build all passed; bundled docs read (src folder, proxy, `after()`) |
| 3 | Restructure to `src/` (v1 → `src/legacy/`) | COMPLETED | `app`→`src/app`, `components`→`src/components`, `lib`→`src/legacy` (`@/legacy/*`), `lib/utils`→`src/lib`, `proxy.ts`→`src/proxy.ts`; `@/*`→`./src/*`. After the move: tests, lint, typecheck, build pass; local smoke test (`next start`): login 200, unauthenticated /jobs → 307 /login |
| 4 | TS strictness + ESLint boundaries + Prettier | COMPLETED | `tsconfig.strict.json` + `npm run typecheck:strict` for v2 code (v1 excluded: 53 errors in code deleted in M6). ESLint boundary rules verified with a probe file. Prettier (`.prettierrc.json`, `npm run format:check`) for v2 code, in CI. v1 code is intentionally not reformatted |
| 5 | Drizzle toolchain + Docker Compose (Postgres + pgvector) | IN PROGRESS | Done: Drizzle config/client/schema, migration 0002 **applied to main Neon (owner-approved)**, `db:check` passes, `docker-compose.yml` (pgvector/pgvector:pg18, localhost-only) validated with `docker compose config`, integration tests prefer `TEST_DATABASE_URL`. **Not verified:** `docker compose up` (Docker Desktop not running on the dev machine; image tag unverified) |
| 6 | Env validation (web / drain) | COMPLETED | `src/server/lib/env.ts` (Zod, lazy, names-only errors). Local-runner env is added with M9 |
| 7 | Core libs (errors, wrappers, logger, Sentry free, headers/CSP report-only) | IN PROGRESS | Done + tested: errors/`ActionResult`, redacting logger, `uuidv7`, cron auth, security headers/CSP report-only, **Postgres rate limiter** (atomic upsert; 4 integration tests incl. concurrency). Moved to M1: `authedAction`/`route()` wrappers (need the session from Better Auth). **BLOCKED:** Sentry needs `SENTRY_DSN` from the owner |
| 8 | CI pipeline (GitHub Actions free minutes) | IN PROGRESS | Workflow pushed in `e18555d` (lint, format, typecheck ×2, unit tests, db:check, build, prod audit, gitleaks). First GitHub run not yet confirmed here (no `gh` CLI): owner checks the repo's Actions tab |
| 9 | `BackgroundJob` queue + `/api/cron/drain` + `after()` kick + cron-job.org + `free-tier-limits.md` | COMPLETED | Postgres `JobQueue` (SKIP LOCKED claim, retry/backoff, defer, dedupe, stale release, prune), time-boxed `drain()`, daily maintenance handler, `kickDrain()` via `after()`, `GET /api/cron/drain` (401 without/with wrong secret, smoke-tested), Vercel daily backstop cron, `docs/setup/free-tier-limits.md`. Verified: 7 unit tests + **5 integration tests against real Neon** (`npm run test:integration`: dedupe, priority, 4 concurrent claimers never share a job, retry→DEAD, defer, stale release). **Owner action:** create the cron-job.org job (every 30 min) per `docs/setup/third-party-accounts.md` |
| 10 | Provider seams with fakes (`LlmProvider` Gemini/Groq, `EmbeddingProvider`, `FileStore`, `RateLimiter`, `Mailer`) | COMPLETED | LLM + embeddings (live-verified with owner's keys, data-routing policy enforced), `RateLimiter` (Postgres, integration-tested), `FileStore` + `Mailer` interfaces with memory/no-op adapters and tests (real adapters: Postgres file store in M2, Gmail in M8) |
| — | Security: dependency vulnerabilities | COMPLETED | `npm audit` found **critical** Next.js 16.3.8 RCE (GHSA-2464-fhr4-w9xw etc.), high Zod, moderate Nodemailer. Upgraded to next 16.4.5, zod 4.6.7, nodemailer 10.3.1 (floors raised in package.json); prod audit now 0. **The live v1 deployment stays vulnerable until this is deployed.** 20 moderate dev-only advisories remain (esbuild via drizzle-kit, minimatch): not shipped, need breaking upgrades |

## Existing v1 functionality (legacy, not part of v2 status)
v1 features (Apify ingest, contact extraction, bulk email, WhatsApp/Form links, tracking) exist in code at the repo root. **Not re-verified in this session:** `node_modules` is incomplete, so `npm test`/`build` were not run. Verification is M0 task 2.

## Risk register
| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Job-source terms prohibit commercial use / scraping (LinkedIn, Facebook) | High | High | ADR-011: official/licensed sources first; legacy scrapers disabled for SaaS | architect |
| R2 | Gmail/Graph scope verification delays or security-assessment cost | Medium | High | Send-only scopes first; manual reply logging fallback; start verification early in M8 | backend-specialist |
| R3 | LLM cost overruns at catalog scale | Medium | Medium | Global parsing, Batches API, caching, per-task model config, quotas, cost dashboards | ai-engineer |
| R4 | ATS form changes break adapters | High | Medium | Versioned adapters, fixture tests, circuit breakers, manual fallback | automation-engineer |
| R5 | Prompt injection via job descriptions/resumes | Medium | Medium | Delimited data, bounded influence, evidence checks, injection eval set | ai-engineer / security-auditor |
| R6 | Cross-tenant data leak | Low | Critical | Scoped repositories, tenancy test registry, optional RLS | security-auditor |
| R7 | Billing provider unavailable for owner's jurisdiction | High (if PK entity) | High | ADR-016 abstraction; MoR or entity decision before M11 | owner |
| R8 | Drizzle API drift (written from 0.45 knowledge) | Low | Low | APIs verified against installed drizzle-orm 0.45.3; `db:check` in CI | database-architect |
| R9 | Next.js 16 API drift vs agent knowledge | Medium | Medium | Mandatory reading of bundled docs; skills updated when docs differ | all |
| R10 | Regulatory scrutiny of automated profiling/applications (GDPR Art. 22, local law) | Low | High | Human-in-the-loop, explanations, DPIA, legal review before launch | owner |
| R11 | Free-tier limits shrink or terms change (Vercel, Neon, Gemini, Groq, cron-job.org) | Medium | High | Limits in config, provider fallback chain, deterministic degradation, `free-tier-limits.md` reviewed monthly, scale-profile adapters as exit path | architect |
| R12 | Free-tier AI providers retain/review inputs (privacy) | High | Medium | Mandatory PII redaction, minimal fields, user disclosure + opt-out of AI parsing | security-auditor |
| R13 | Neon Free storage exhausted | Medium | High | ADR-023 storage budget, `halfvec`, no raw payloads, pruning jobs, 70% alert | database-architect |
| R14 | Background work delayed (cron pinger outage, time-boxed runs) | Medium | Low | `after()` kicks, daily Vercel cron backstop, idempotent chunked jobs | backend-specialist |

## Open questions (owner)
See `TECHNICAL_DECISIONS.md` → "Open questions". Resolved: hosting, database, AI providers, worker host, storage, billing (deferred) by ADR-023; ORM = Drizzle (ADR-004) with schema `app` (ADR-024); Groq confirmed; AI data routing decided (personal data → Groq only). Still open: launch markets, future of v1 scrapers.

## Change log
| Date | Change |
|---|---|
| 2026-11-04 | Initialization phase: Part A completed and verified; all application milestones NOT STARTED |
| 2026-11-04 | M0: pushed `e18555d`; fixed queue clock-skew bug (DB clock for all timing, found by integration tests); Postgres rate limiter; FileStore/Mailer seams; Prettier; docker-compose; local-development guide |
| 2026-11-04 | M0: migration 0002 applied to Neon (owner-approved), queue integration-tested on real Postgres, AI layer live-verified (Gemini + Groq + embeddings), data routing decided (personal → Groq) |
| 2026-11-04 | M0 started: tasks 1–3 and 6 completed, security upgrade of next/zod/nodemailer, v2 foundation (queue, drain, env, errors, logger, headers, CI) in progress (see tracker) |
| 2026-11-04 | Owner chose zero-cost operation (Vercel Hobby, Neon Free, Gemini/Groq free tiers): ADR-023 added and docs/config updated (A14); M11 deferred (BLOCKED) |
