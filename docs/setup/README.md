# Setup

## Today (v1 app)
The v1 single-user app is documented in the root [`README.md`](../../README.md) (Neon, Gmail SMTP, Apify, Vercel). Before anything else:

```bash
npm ci        # the current node_modules is a partial install (next, react, zod… missing)
npm run dev
```

## Planned v2 local environment (delivered in Milestone 0)
| Service | Local | Notes |
|---|---|---|
| PostgreSQL 16 + pgvector | Docker Compose `pgvector/pgvector:pg16` | extensions: vector, pg_trgm, citext |
| Redis 7 | Docker Compose | BullMQ + rate limiting |
| Object storage | MinIO (S3-compatible) | bucket `resumes-dev` |
| Mail catcher | Mailpit | verification/reset emails in dev |
| Web | `npm run dev` | Next.js |
| Worker | `npm run worker:dev` | `tsx watch src/workers/general.ts` |
| Automation worker | `npm run worker:automation:dev` | needs Playwright browsers (`npx playwright install chromium`) |

Documents to be written in M0–M2 (placeholders tracked in `plan/IMPLEMENTATION_STATUS.md`):
- `local-development.md`: step-by-step from fresh clone to running app + workers.
- `environment-variables.md`: every variable, which process needs it, how to generate secrets.
- `third-party-accounts.md`: Anthropic, Voyage AI, storage, transactional email, Google/Microsoft OAuth apps, billing provider sandbox.
