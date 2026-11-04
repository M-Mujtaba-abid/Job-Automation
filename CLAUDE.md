@AGENTS.md

# JobFinder AI: project instructions

AI job finder, assisted application engine and candidate-side application tracker (multi-tenant SaaS), evolving from a working single-user v1 tool in this same repository.

**Current phase:** architecture & foundation complete; application implementation starts at **Milestone 0**. Source of truth for status: `plan/IMPLEMENTATION_STATUS.md`. Do not claim features exist that the status file does not mark COMPLETED.

## Read before working
| Need | File |
|---|---|
| Why things are the way they are (ADRs, open questions) | `plan/TECHNICAL_DECISIONS.md` |
| Components, queues, workflows | `plan/SYSTEM_ARCHITECTURE.md` |
| Data model | `plan/DATABASE_DESIGN.md` |
| Actions & routes contracts | `plan/API_DESIGN.md` |
| Matching algorithm | `plan/AI_MATCHING_DESIGN.md` |
| Automation & compliance | `plan/AUTOMATION_DESIGN.md` |
| Security & privacy | `plan/SECURITY_DESIGN.md` |
| Screens & components | `plan/UI_UX_DESIGN.md` |
| What to build next | `plan/DEVELOPMENT_ROADMAP.md` |
| Testing | `plan/TESTING_STRATEGY.md` |
| Agents, skills, workflow | `.claude/CLAUDE.md` |

## Repository state (v1 vs v2)
- v1 (running today): `app/`, `components/`, `lib/` at the repo root. Next.js 16 + Drizzle + Neon + Apify + Nodemailer, single shared password. Documented in `README.md` and `PROJECT_PROMPT.md`.
- v2 target layout: `src/` (ADR-021), Prisma (ADR-004, pending owner confirmation), Better Auth, BullMQ workers. M0 moves v1 into `src/legacy/`.
- Until M6, do not add v2 features to v1 files, and do not import v1 code from v2 modules.

## Commands (v1 today; v2 equivalents added in M0)
```bash
npm ci                 # node_modules is currently incomplete; run this first
npm run dev            # Next.js dev server
npm run lint
npm run typecheck      # next typegen && tsc --noEmit
npm test               # vitest run
npm run build
```

## Golden rules
1. Architecture first: read the relevant plan section; if your change contradicts it, update the ADR/plan in the same change or stop and ask.
2. This Next.js version differs from your training data: read `node_modules/next/dist/docs/` before using framework APIs (see `AGENTS.md`).
3. Strict TypeScript; Zod at every boundary; no duplicated business logic; modules talk through `index.ts`.
4. Tenant data is always scoped by `ctx.userId` from the session, never from input.
5. Secrets only via env; never read or print `.env*` files (except `.env.example`).
6. Never log or transmit resume text, contact details, tokens or form answers beyond what a task needs.
7. Automation never bypasses CAPTCHA/MFA/login/rate limits and never submits without explicit, hash-bound user approval.
8. LLMs never produce final scores or decisions; outputs are schema-validated and bounded.
9. Tests ship with code; never claim something works without running it, and report failures honestly.
10. Update `plan/IMPLEMENTATION_STATUS.md` when milestone tasks change state, with evidence for COMPLETED.
