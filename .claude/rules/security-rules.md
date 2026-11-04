# Security Rules (all code)

Full design: `plan/SECURITY_DESIGN.md`. These are the rules every change must satisfy; the `security-auditor` agent checks them.

## Secrets
- Never read, print, copy or commit `.env`, `.env.local` or any `.env.*` file except `.env.example`. Never paste secret values into code, tests, docs, logs or chat.
- New secrets: add the **name** to `.env.example` and the Zod env schema (web or worker, only where needed). Each secret has one purpose (no reusing `CRON_SECRET` for webhooks).
- Compare secrets/signatures with constant-time comparison (`safeEqual` / `crypto.timingSafeEqual`).

## Authentication & authorization
- Every Server Action and session-authenticated Route Handler goes through `authedAction` / `route({ auth })`. No hand-rolled auth checks.
- `proxy.ts` is not an authorization boundary. Always re-verify in the action/handler.
- Never accept `userId` (or tenant id) from client input. Derive it from the session (`TenantContext`).
- Tenant data access only via repository functions that take `ctx` and filter by `ctx.userId`. A foreign row returns `NOT_FOUND`.
- Admin-only operations call `requireAdmin(ctx)` and write an `AuditLog` entry.

## Input & output
- Validate all external input with Zod: action inputs, route params/query/body, webhook payloads, third-party API responses, LLM outputs, queue payloads.
- Raw SQL only via tagged-template `$queryRaw`/TypedSQL. `$queryRawUnsafe` and `$executeRawUnsafe` are forbidden.
- No `dangerouslySetInnerHTML` except through the approved sanitiser for job descriptions.
- Redirect targets from input must be relative paths (`^/(?!/)`).
- Server-side fetching of user-provided URLs requires the SSRF guard (resolve DNS, block private/link-local/metadata ranges, follow redirects manually, timeouts, size caps).

## Files
- Uploads: validate size while streaming, magic bytes, allowlisted types (PDF/DOCX), reject encrypted/macro files; storage keys are server-generated; downloads via short-lived presigned URLs after ownership checks.

## Sensitive data
- Treat resume content, contact details, cover letters, form answers, email bodies and OAuth tokens as sensitive: never log them, never send them to analytics/Sentry, never include them in queue payloads (pass ids).
- OAuth tokens: encrypt with the envelope-encryption helper (AES-256-GCM, AAD bound to owner); never return them to the client.
- LLM calls: send only the data the task needs; untrusted text (resumes, job descriptions, web pages, inbound email) is wrapped as data, never instructions. LLMs get no tools that act externally.

## Automation & email (product-safety rules)
- No CAPTCHA solving, stealth plugins, fingerprint spoofing, or bypassing MFA/login/rate limits. Detection → stop and route to manual.
- No submission or email send without an explicit user approval bound to the exact payload.
- Respect per-domain/per-account rate limits and source terms (`JobSource.complianceStatus = APPROVED` before enabling).

## Web security
- Mutating Route Handlers: non-GET methods, Origin check, JSON only. Webhooks: verify signatures + idempotency by event id.
- Keep security headers/CSP in `proxy.ts` intact; changes need `security-auditor` review.
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax` (or stricter).

## Dependencies & supply chain
- No packages from untrusted sources, no `postinstall` scripts from new deps without review, no `curl | sh` in scripts or Dockerfiles.

## PR checklist (copy into PR description)
- [ ] Inputs validated with Zod; outputs typed
- [ ] Auth wrapper used; tenant scoping via `ctx`
- [ ] No secrets/PII in code, logs, errors, queue payloads
- [ ] Cross-tenant tests for new resources
- [ ] Rate limits/quotas for expensive or abusable actions
- [ ] Security-sensitive area? → `security-auditor` reviewed
