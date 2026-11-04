# Setup

## Today (v1 app)
The v1 single-user app is documented in the root [`README.md`](../../README.md) (Neon, Gmail SMTP, Apify, Vercel). Before anything else:

```bash
npm ci        # the current node_modules is a partial install (next, react, zod… missing)
npm run dev
```

## v2 zero-cost environment (ADR-023, delivered in Milestone 0)
Every service below has a free tier; nothing requires a paid plan.

| Service | Use | Free-tier notes (verify current limits in M0) |
|---|---|---|
| Vercel Hobby | web app + `/api/cron/drain` | personal/non-commercial; cron max once/day (cron-job.org fills the gap) |
| Neon Free | Postgres + pgvector (`halfvec`), job queue, files | small storage quota (≈0.5 GB) → storage budget in ADR-023 |
| cron-job.org | calls `/api/cron/drain` every 5–15 min | v1 already uses it |
| Google AI Studio (Gemini API) | LLM (primary) + embeddings | free-tier inputs may be used by Google → PII redaction is mandatory |
| Groq | LLM fallback | per-model rate limits |
| Google Cloud OAuth (Testing mode) | Google sign-in + Gmail API | explicit test users; weekly re-consent for Gmail |
| Sentry (Developer plan) | error monitoring | event quota |
| GitHub Actions | CI | free minutes (unlimited for public repos) |

Local development needs only **Docker (Postgres + pgvector)** and Node.js. The local automation runner additionally needs `npx playwright install chromium`.

Written (checked 2026-11-04):
- [`third-party-accounts.md`](third-party-accounts.md): setup checklist plus click-by-click account setup for every service above.
- [`free-tier-limits.md`](free-tier-limits.md): current limits, model names and data-use terms, with source links and the date checked. Code reads limits from config. Note: Neon Free is currently 1 GB per project, not ≈0.5 GB.

Documents still to write in M0–M2:
- `local-development.md`: from a fresh clone to a running app and drain runner.
- `environment-variables.md`: every variable, which process needs it, how to generate secrets.