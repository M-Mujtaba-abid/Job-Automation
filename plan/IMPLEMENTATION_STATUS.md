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

## Part B: Application milestones

| Milestone | Status | Notes |
|---|---|---|
| M0 Project Foundation | NOT STARTED | Next milestone. Task 5 (Prisma toolchain) is blocked on the ORM decision (ADR-004) |
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
| M11 Subscription & Billing | NOT STARTED | Billing provider decision (ADR-016) required first |
| M12 Testing, Security & Optimization | NOT STARTED | |
| M13 Production Deployment | NOT STARTED | |

### M0 task tracker
| # | Task (DEVELOPMENT_ROADMAP M0) | Status | Notes |
|---|---|---|---|
| 1 | `git init` + first commit + remote | NOT STARTED | Verify `.env.local` stays untracked |
| 2 | `npm ci`, confirm v1 build/test/lint/typecheck, read bundled Next docs | NOT STARTED | `node_modules` currently incomplete |
| 3 | Restructure to `src/` (v1 → `src/legacy/`) | NOT STARTED | |
| 4 | TS strictness + ESLint boundaries + Prettier | NOT STARTED | |
| 5 | Prisma toolchain + Docker Compose | BLOCKED | Awaiting owner confirmation of ADR-004 (Prisma vs Drizzle) |
| 6 | Env validation split (web/worker) | NOT STARTED | |
| 7 | Core libs (errors, wrappers, logger, Sentry, headers/CSP report-only) | NOT STARTED | |
| 8 | CI pipeline | NOT STARTED | Needs git remote |
| 9 | Worker skeleton + Dockerfile | NOT STARTED | Host choice (ADR-008) affects deploy config only |

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
| R8 | Prisma + pgvector friction (raw SQL) | Medium | Low | Isolated vector repository; Drizzle alternative documented | database-architect |
| R9 | Next.js 16 API drift vs agent knowledge | Medium | Medium | Mandatory reading of bundled docs; skills updated when docs differ | all |
| R10 | Regulatory scrutiny of automated profiling/applications (GDPR Art. 22, local law) | Low | High | Human-in-the-loop, explanations, DPIA, legal review before launch | owner |

## Open questions (owner)
See `TECHNICAL_DECISIONS.md` → "Open questions": ORM, auth provider, billing provider/legal entity, AI model routing for bulk parsing, worker host & storage, launch markets, future of v1 scrapers.

## Change log
| Date | Change |
|---|---|
| 2026-11-04 | Initialization phase: Part A completed and verified; all application milestones NOT STARTED |
