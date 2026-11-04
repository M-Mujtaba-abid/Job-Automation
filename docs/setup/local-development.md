# Local development

From a fresh clone to a running app, in the zero-cost profile (ADR-023). Account and key setup is in [`third-party-accounts.md`](third-party-accounts.md).

## 1. Install
```bash
npm ci
```
Node.js 24 is used in CI (`.github/workflows/ci.yml`).

## 2. Environment
Copy `.env.example` to `.env.local` and fill in the values (never commit `.env.local`). The v1 app needs the v1 block; v2 code currently needs `DATABASE_URL`, `CRON_SECRET`, `GEMINI_API_KEY`, `GROQ_API_KEY`.

## 3. Database
Pick one:
- **Neon dev branch (recommended):** put its direct URL in `DATABASE_URL_UNPOOLED`, then `npm run db:migrate`.
- **Local Docker** (needs Docker Desktop running): `docker compose up -d db`, set `TEST_DATABASE_URL=postgresql://jobfinder:jobfinder@localhost:5433/jobfinder`, and migrate it with `DATABASE_URL_UNPOOLED=$TEST_DATABASE_URL npm run db:migrate`.

v1 tables live in schema `public`, v2 tables in schema `app` (ADR-024).

## 4. Run
```bash
npm run dev                         # http://localhost:3000 (v1 UI until M6)
```
Background jobs: call the drain endpoint yourself (production uses cron-job.org + a daily Vercel cron):
```bash
node --env-file=.env.local -e "fetch('http://localhost:3000/api/cron/drain',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>r.text()).then(console.log)"
```

## 5. Checks (same as CI)
```bash
npm run lint
npm run format:check        # v2 code only (npm run format to fix)
npm run typecheck           # all code
npm run typecheck:strict    # extra-strict, v2 code
npm test                    # unit tests (no network, no DB)
npm run db:check            # migration snapshot consistency
npm run build
```
Optional, needs a database (prefers `TEST_DATABASE_URL`):
```bash
npm run test:integration
```
Optional, uses a few free-tier AI requests with synthetic data:
```bash
npm run ai:smoke
```
