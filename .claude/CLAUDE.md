# Claude Code ecosystem for this project

Root `CLAUDE.md` covers the project, the document map and the golden rules. This file explains **how to work here with agents, skills and rules**.

## Subagents (`.claude/agents/`)
| Agent | Owns | Edits code? | Invoke when |
|---|---|---|---|
| `architect` | plan/ docs, ADRs, module boundaries, milestone task breakdowns | plan/docs/.claude only | milestone start; new module/queue/integration/store; cross-module changes; doc–code conflicts |
| `frontend-specialist` | pages, layouts, components, UX, a11y | yes | any UI work |
| `backend-specialist` | services, actions, route handlers, auth, queues, integrations | yes | business logic, APIs, workers (non-automation) |
| `database-architect` | Prisma schema, migrations, indexes, pgvector, retention, imports | yes | any schema/migration/hot-query change |
| `ai-engineer` | Claude integration, prompts, extraction, embeddings, scoring, evals | yes | any LLM/embedding/scoring change |
| `automation-engineer` | Playwright worker, ATS adapters, submission verification | yes | automation engine work |
| `security-auditor` | security review & sign-off | **no** (read-only) | auth, tokens, uploads, webhooks, SSRF, CSP, logging PII, automation, billing, admin |
| `qa-engineer` | test plans, test infra, verification, status evidence | tests only | milestone test plans; flaky tests; before marking COMPLETED |
| `code-reviewer` | correctness, maintainability, performance, consistency | **no** (read-only) | after every non-trivial change, before merge |

Boundaries are deliberate: implementers don't approve their own security or completion; reviewers don't write the fixes.

## Skills (`.claude/skills/`)
| Skill | Use for |
|---|---|
| `nextjs-app-router` | routes, RSC/Client boundaries, caching, proxy.ts, route handlers |
| `server-actions` | `authedAction`, `ActionResult`, forms, optimistic UI |
| `prisma-postgresql` | schema, migrations, tenant repositories, SKIP LOCKED, vector SQL |
| `playwright-automation` | ATS adapters, blocker detection, E2E and fixture tests |
| `claude-ai-integration` | AI client, versioned prompts, structured outputs, evals (also use built-in `claude-api`) |
| `api-design` | contracts, error codes, webhooks, pagination, idempotency |
| `security-best-practices` | encryption, uploads, SSRF, CSP, redaction, rate limits, review checklist |

## Rules (`.claude/rules/`)
- Always loaded: `coding-standards.md`, `security-rules.md`.
- Path-scoped (load when touching matching files): `frontend-rules.md`, `backend-rules.md`, `database-rules.md`.

## Standard workflow per milestone
1. **Kickoff:** `architect` reads the milestone in `plan/DEVELOPMENT_ROADMAP.md`, confirms dependencies and open questions, writes the task breakdown (responsible agent per task). Owner answers business questions.
2. **Test plan:** `qa-engineer` maps acceptance criteria → tests.
3. **Implement:** specialists work their tasks; schema changes go through `database-architect`; AI pieces through `ai-engineer`.
4. **Review:** `code-reviewer` on every change; `security-auditor` where required (roadmap "Cross-milestone rules" §2).
5. **Verify:** `qa-engineer` runs suites, records evidence, recommends status.
6. **Close:** update `plan/IMPLEMENTATION_STATUS.md` (evidence), ADRs/plan docs if reality diverged, `docs/` for setup/guides.

## Definition of Done (feature)
Code + tests (unit/integration/contract, E2E when part of a journey) · lint/typecheck/tests green · tenancy registry updated for new models · axe clean for new pages · eval report for AI changes · security checklist ticked · docs/status updated. Full list: `plan/TESTING_STRATEGY.md` §11.

## Status vocabulary (`plan/IMPLEMENTATION_STATUS.md`)
`NOT STARTED` · `IN PROGRESS` · `BLOCKED` (with reason) · `COMPLETED` (only with verification evidence). Documentation/config completion is tracked separately from application implementation.

## Permissions (`.claude/settings.json`)
Read-only checks (lint, typecheck, tests, git status/diff/log) are pre-approved. Installs, migrations, commits/pushes, docker, curl and evals ask first. Secret files, destructive git/filesystem commands, `prisma migrate reset/deploy`, `db push` and production deploys are denied. Do not work around denials; ask the owner.
