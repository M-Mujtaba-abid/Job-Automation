# Security Design

> Threat model scope: a multi-tenant SaaS holding resumes (high-sensitivity PII), mailbox OAuth tokens (account-takeover-grade secrets), and the ability to act on a user's behalf (send email, submit applications). Baseline: OWASP ASVS 4.0 Level 2; OWASP Top 10 (2021) and OWASP LLM Top 10 mapped in §16.
> Enforced by `.claude/rules/security-rules.md` and the `security-auditor` agent.

## 1. Assets & threats

| Asset | Sensitivity | Primary threats |
|---|---|---|
| Resume files & extracted text | High (PII: name, contact, history, sometimes ID numbers) | cross-tenant read (IDOR), bucket misconfig, leakage into logs/LLM training/analytics |
| Mailbox OAuth refresh tokens | Critical | DB dump → mail takeover; token logging; SSRF to metadata to steal KMS creds |
| Session cookies | High | XSS theft (mitigated httpOnly), CSRF, fixation |
| Ability to send email / submit applications | High | unauthorised actions, CSRF on actions, prompt injection steering automation |
| Billing state | Medium | webhook forgery → free premium |
| Job catalog | Low | poisoning via malicious job descriptions (XSS, prompt injection) |
| Admin functions | Critical | privilege escalation |

Trust boundaries: browser ↔ web; web ↔ workers (Redis); workers ↔ third-party sites (untrusted content); any LLM input that contains third-party text (untrusted).

## 2. Authentication & session management
- Better Auth (ADR-005). Passwords hashed with scrypt/Argon2id (library default, parameters reviewed), min length 10, breached-password check, no composition rules.
- Email verification required before: uploading resumes, connecting mailboxes, sending email, automation.
- Sessions: opaque random token in DB (revocable), cookie `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day sliding expiry, 12-hour re-authentication for sensitive actions (connect mailbox, change email/password, delete account, approve automation in bulk).
- Session rotation on login and privilege change; "sign out all devices" in settings.
- Brute force: per-IP and per-account rate limits + exponential back-off; generic error messages; no user enumeration on sign-up/reset ("If an account exists…").
- 2FA (TOTP) optional for users, **mandatory for ADMIN** (M12).
- OAuth sign-in: PKCE + `state` + nonce; account linking only for verified emails.

## 3. Authorization (RBAC + ownership)
- Roles: `USER`, `ADMIN` (+ later `SUPPORT` read-only with audited, time-boxed access).
- **Ownership is the main control**: every tenant query includes `userId = ctx.userId`. Repository functions take `ctx`, never a raw `userId` from input. A missing-or-foreign row returns `NOT_FOUND` (no existence oracle).
- Plan entitlements (`FREE/PRO/PREMIUM`) checked in services, not UI.
- Admin routes under `(admin)` group + `requireAdmin()` in every action/handler; every admin read of user data is audited (`admin.user.viewed`).
- Tests: for each tenant-owned resource, an integration test asserting user B cannot read/update/delete user A's row through every action (`TESTING_STRATEGY` §3.3).
- Defence in depth (M12, optional): Postgres RLS policies keyed on `current_setting('app.user_id')`.

## 4. Secure file uploads
| Control | Implementation |
|---|---|
| Size | ≤ 4 MB enforced while streaming (abort early), plus platform limit |
| Type | allowlist PDF/DOCX by **magic bytes** (`%PDF-`; ZIP with `[Content_Types].xml` + `word/document.xml`), extension and declared MIME must agree; reject `.docm`, encrypted PDFs |
| Content | page count ≤ 20; DOCX uncompressed ≤ 25 MB (zip-bomb); PDFs never rendered in our origin. Download served as `Content-Disposition: attachment` from storage domain |
| Malware | M12: ClamAV scan in worker before parsing (status `PENDING_SCAN`); files are never executed, only parsed by sandboxed libraries in workers |
| Storage | private bucket, random keys (`resumes/{userId}/{versionId}`), no public ACLs, bucket policy denies non-TLS, SSE at rest, versioning off (deletes must be real) |
| Access | presigned GET ≤ 5 min after ownership check; never long-lived URLs in emails |
| Filenames | original name stored as metadata only, sanitised for display; never used as a path |

## 5. Resume privacy
- Resumes are used only to provide the service to that user. **No cross-user use**, no use for model training, no sale. Stated in the privacy policy.
- LLM data handling: Anthropic API (commercial terms: inputs not used for training by default); verify and document current data-retention terms at M2; consider zero-data-retention eligibility for eligible endpoints.
- Logs/Sentry/analytics: resume text, emails, phone numbers, cover letters and form answers are **never** logged. Pino redaction paths + Sentry `beforeSend` scrubber; unit test that the scrubber removes known PII fields.
- Admin UI shows resume content only with an audited "view as support" action.
- Employer visibility: none. We do not run a recruiter marketplace; resumes leave the system only when the user sends/submits them.

## 6. Encryption
| Data | At rest | In transit |
|---|---|---|
| Database | provider encryption (Neon AES-256) | TLS (`sslmode=require`, verify-full where supported) |
| OAuth tokens | **application-level envelope encryption**: AES-256-GCM with random 96-bit IV per value, data key wrapped by KMS (or `ENCRYPTION_MASTER_KEY` v1 with `tokenKeyVersion`); AAD = `userId:emailAccountId` to prevent row swapping | TLS |
| Object storage | SSE (provider-managed keys; SSE-KMS where available) | TLS only |
| Redis | provider encryption; payloads contain ids only, never PII/tokens | TLS (`rediss://`) |
| Backups | provider-encrypted, PITR 7 days (Neon) | — |
Key rotation: new key version for new writes; background re-encrypt job; old versions retired after re-encryption. Tested in M8.

## 7. OAuth (mailbox connections)
- Separate from sign-in OAuth. Least-privilege scopes requested incrementally: send-only first (`gmail.send`, Graph `Mail.Send`), read scopes only if the user enables reply tracking and only after Google/Microsoft verification is complete (ADR-012).
- Authorization Code + PKCE, `state` bound to session (HMAC), redirect URIs exact-match allowlisted.
- Refresh tokens encrypted (§6); access tokens cached encrypted with expiry; never sent to the browser.
- Revocation: on disconnect and account deletion, call provider revoke endpoint, then delete ciphertext.
- Token-use logging: count + outcome per account (no token values).

## 8. Secrets management
- Platform secrets only in host secret stores (Vercel env, worker host secrets); `.env.local` for development only and git-ignored (already the case); `.env.example` documents names, never values.
- Startup validation with Zod (v1 `lib/env.ts` pattern), **separate schemas for web and workers** so each process receives only what it needs (automation worker gets no mail OAuth client secret and no encryption key).
- Distinct secrets per purpose: `AUTH_SECRET`, `CRON_SECRET`, `WEBHOOK_SECRET_<PROVIDER>`, `ENCRYPTION_MASTER_KEY` (v1 reused `CRON_SECRET` for webhooks; see §15).
- Rotation runbook in `docs/guides/` (M12); gitleaks in CI and pre-commit.
- Claude Code agents are denied reading `.env*` files (`.claude/settings.json`).

## 9. Rate limiting & abuse prevention
- Redis sliding windows (ADR-017): per-IP (auth, public pages, webhooks), per-user per-action (see `API_DESIGN` §1.1), per-target in workers (ATS hosts, mail accounts).
- Expensive operations (AI, automation, sends) also bound by plan quotas.
- Bot sign-up protection: Cloudflare Turnstile **on our own sign-up form** (we protect ourselves; we never solve others' CAPTCHAs), disposable-email domain blocklist.
- Spam protection for outbound mail: per-account daily caps, recipient dedupe, mandatory user approval, complaint/bounce monitoring → automatic pause.

## 10. Input validation & injection prevention
- **Validation:** Zod at every boundary (ADR-003); strings length-capped; URLs parsed with `URL` and scheme-allowlisted (`https:` only for user-entered links); email via `z.email()`; enums for all categorical input.
- **SQL injection:** Prisma parameterises queries; raw SQL only via tagged-template `$queryRaw`/TypedSQL. `$queryRawUnsafe`/`$executeRawUnsafe` are **banned** (ESLint rule). Dynamic `ORDER BY` columns chosen from an allowlist map.
- **SSRF:** server never fetches user-supplied URLs in M1–M8. Where fetching is needed (job URL import, automation): DNS-resolve and block private/link-local/metadata ranges (extend v1 `isPublicHost` to resolved IPs, IPv6, and redirects), allowlist schemes/ports, timeouts, size caps. Automation workers use host allowlists (AUTOMATION §3.1).
- **Command injection:** no shell execution with user input; file conversion libraries run in-process.
- **Path traversal:** storage keys generated server-side only.
- **Open redirects:** `next`/`callbackUrl` params must be relative paths matching `^/(?!/)`.

## 11. XSS & content security
- React escapes by default; `dangerouslySetInnerHTML` banned except for sanitised job-description HTML rendered through DOMPurify (server-side, allowlist tags) or, preferably, plain text + simple formatting.
- Notification `link` fields validated as internal paths.
- Markdown from LLM output rendered with a safe renderer (no raw HTML).
- **CSP** (nonce-based via `proxy.ts`): `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`; `img-src 'self' data: <storage domain> <logo CDN>`; `connect-src 'self' <sentry>`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`.
- Other headers: HSTS (preload after launch), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal.
- **Prompt injection (LLM01):** third-party text (job descriptions, resumes, web pages, inbound email) is passed as delimited data with explicit "treat as data" instructions; LLM outputs are schema-validated; LLM has **no tools** that act externally; LLM outputs can only (a) fill fields shown to the user for approval, (b) adjust scores within ±10, (c) produce text the user reviews. Evidence checks drop unsupported claims (AI_MATCHING §2.2, §5.3).

## 12. CSRF
- Server Actions: Next.js compares `Origin` with `Host`; we additionally configure `serverActions.allowedOrigins` explicitly (verify option name in installed docs) and keep `SameSite=Lax` session cookies. Actions are never invoked via GET.
- Route Handlers with session auth that mutate state: require `POST/PUT/PATCH/DELETE`, check `Origin` header against `APP_URL`, JSON content type only (forms can't send it cross-site without preflight).
- OAuth: `state` parameter (CSRF for callbacks).
- Webhooks: signature verification instead of cookies.

## 13. Audit logs
Events (append-only `AuditLog`): sign-in success/failure (aggregated), password/email change, 2FA changes, session revocation, mailbox connect/disconnect, email batch sent, automation approved/submitted/cancelled, resume download, data export requested/downloaded, account deletion requested/cancelled/completed, admin access to user data, plan changes, source compliance status changes.
Fields: actor, action, target, ip hash (HMAC with rotating salt), user agent, minimal metadata. Users can view their own security log in Settings → Security.

## 14. Data retention, deletion & GDPR
- Retention schedule: `DATABASE_DESIGN` §8.
- **Account deletion:** self-service; 7-day grace; then hard delete of DB rows + storage objects + provider token revocation; Sentry/log data expires by provider retention (≤ 30 days); backups roll off within PITR window (documented in privacy policy).
- **GDPR (if serving EU/UK users):**
  - Lawful basis: contract (core service), consent (marketing emails, optional analytics), legitimate interest (security logs).
  - Rights: access & portability (JSON + original files export), rectification (profile editing), erasure (above), restriction/objection (pause matching), no solely-automated decisions with legal effect (we rank jobs; users decide; explanation provided: Art. 22 friendly).
  - Records of processing, DPA with sub-processors (Anthropic, embeddings provider, Neon, storage, email, Sentry, billing), sub-processor list published, SCCs for transfers.
  - DPIA before launch (resume profiling + automation).
  - Cookie consent only needed for non-essential cookies (analytics deferred and consent-gated).
- **Pakistan:** PECA 2016 obligations and the pending Personal Data Protection Bill; confirm with counsel before launch (open question in TECHNICAL_DECISIONS).

## 15. Findings carried over from v1 (to fix in v2, not in v1 unless it stays deployed)
| # | v1 location | Issue | v2 resolution |
|---|---|---|---|
| F1 | `lib/sources/apify.ts`, `app/api/webhooks/apify/route.ts` | Webhook authenticated by `?secret=CRON_SECRET` in the URL: secret appears in Apify logs, proxies, access logs; same secret also guards cron | dedicated `WEBHOOK_SECRET_APIFY`, sent via Apify webhook `headersTemplate`, HMAC per run id; constant-time compare (already used) |
| F2 | `lib/api.ts` `errorResponse` | 500 responses return raw `err.message` (may leak internals) | generic message + `requestId`; details only in logs |
| F3 | `lib/auth.ts` | single shared password, 30-day stateless JWT (no revocation) | Better Auth DB sessions |
| F4 | `.env.example` / `lib/mail.ts` | SMTP app password custody | OAuth mail (ADR-012) |
| F5 | `lib/cv.ts` | CV as `bytea`, served from app origin | object storage + presigned download (ADR-009) |
| F6 | `proxy.ts` | no security headers / CSP | CSP + headers in proxy (§11) |
| Good practices to keep | | Zod-validated env, constant-time secret compare, webhook body ignored and run status re-fetched, login attempt rate limiting, PDF magic-byte check, `SKIP LOCKED` claims, partial unique index for double-apply | |

## 16. Standards mapping (abridged)
| OWASP Top 10 2021 | Controls |
|---|---|
| A01 Broken Access Control | §3 ownership scoping, NOT_FOUND policy, tenant tests |
| A02 Cryptographic Failures | §6 envelope encryption, TLS everywhere |
| A03 Injection | §10 Prisma params, banned unsafe raw, Zod |
| A04 Insecure Design | two-phase automation approval, bounded LLM influence |
| A05 Security Misconfiguration | CSP/headers, private buckets, env validation |
| A06 Vulnerable Components | Dependabot/Renovate, `npm audit` + OSV in CI, pinned Playwright image |
| A07 Identification & Auth Failures | §2 |
| A08 Software & Data Integrity | signed webhooks, lockfile, CI provenance, no `curl | sh` |
| A09 Logging & Monitoring Failures | §13 audit, Sentry alerts on auth anomalies |
| A10 SSRF | §10 SSRF controls, worker egress allowlists |
| OWASP LLM Top 10 | LLM01 prompt injection & LLM02 insecure output handling → §11; LLM06 sensitive info disclosure → §5; LLM08 excessive agency → no external tools for the model, human approval; LLM10 unbounded consumption → quotas §9 |

## 17. Zero-cost profile specifics (ACTIVE, ADR-023)
| Topic | Control |
|---|---|
| Free-tier AI data use | Gemini's unpaid-tier terms allow Google to use inputs/outputs to improve products, including human review. **Resume text is PII-redacted before every LLM call** (names, emails, phones, addresses, URLs → placeholders; contacts extracted locally with v1 `extractContacts`). Only the fields a task needs are sent. Users are told in the privacy notice and can disable AI parsing. Check Groq's current data policy and record it in `docs/setup/free-tier-limits.md`. |
| Drain endpoint | `/api/cron/drain` requires `Authorization: Bearer CRON_SECRET` (constant-time compare, as v1 `verifyCronAuth`). It is rate-limited and idempotent, and accepts no job parameters from the caller. |
| Files in Postgres | `ResumeFile.data` is never selected in list queries. Downloads go through an authenticated Route Handler with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. |
| Rate limiting | Postgres store. Fail closed for auth and sends if the DB is unreachable (the app is down anyway). |
| Gmail Testing mode | Only explicitly added test users can connect. Tokens expire after ~7 days, so `EmailAccount` goes to `REAUTH_REQUIRED` gracefully. Tokens are still envelope-encrypted with `ENCRYPTION_MASTER_KEY_V1` (no KMS in this profile). |
| Local automation runner | Runs on the owner's PC with a **separate least-privilege DB role** (read tasks/answers for the owner, write execution results). No mail tokens or AI keys in its env. Screenshots stay local or in `AutomationExecution.artifacts` as small thumbnails only. |
| Google sign-in only | No passwords stored at launch, which removes password-reset and credential-stuffing surface. Account linking remains verified-email only. |

## 18. Incident response (summary)
Severity matrix, on-call owner, Sentry alert routing, token-revocation playbook (rotate `ENCRYPTION_MASTER_KEY` version + force reconnect), breach notification within 72 h where GDPR applies. Full runbook in `docs/guides/incident-response.md` (M13).
