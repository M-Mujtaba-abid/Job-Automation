@AGENTS.md

# JobFinder AI: project instructions

AI job finder, assisted application engine and candidate-side application tracker (multi-tenant SaaS), evolving from a working single-user v1 tool in this same repository.

**Current phase:** architecture & foundation complete; application implementation starts at **Milestone 0**. Source of truth for status: `plan/IMPLEMENTATION_STATUS.md`. Do not claim features exist that the status file does not mark COMPLETED.

**Active profile: ZERO-COST (ADR-023 in `plan/TECHNICAL_DECISIONS.md`).** The stack:
- Hosting and database: Vercel Hobby and Neon Free.
- Background work: Postgres `BackgroundJob` queue drained by `/api/cron/drain` (cron-job.org) and `after()`.
- AI: Gemini free tier (primary) and Groq free tier (fallback), PII-redacted. Embeddings are Gemini `halfvec(768)`.
- Sign-in and email: Google sign-in only, Gmail API in Testing mode.
- Not used: Redis, worker containers, object storage, paid AI or billing. Never add a paid service without an ADR and owner approval.

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
- v1 (running today, moved in M0): routes in `src/app/`, UI in `src/components/`, v1 logic in `src/legacy/` (`@/legacy/*`). Next.js 16 + Drizzle + Neon + Apify + Nodemailer, single shared password. Documented in `README.md` and `PROJECT_PROMPT.md`.
- v2 target layout: `src/` (ADR-021), Drizzle ORM (ADR-004) with v2 tables in Postgres schema `app` (ADR-024; schema in `src/server/db/schema/`, migrations in `drizzle/`), Better Auth, Postgres job queue + drain endpoint (zero-cost, ADR-023). M0 moves v1 into `src/legacy/`.
- Until M6, do not add v2 features to v1 files, and do not import v1 code from v2 modules.

## Commands
```bash
npm ci                 # install exact locked dependencies
npm run dev            # Next.js dev server
npm run lint
npm run typecheck      # next typegen && tsc --noEmit
npm run typecheck:strict  # extra-strict check for v2 code (src/server, src/lib, src/features)
npm run db:check       # drizzle-kit snapshot consistency
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
