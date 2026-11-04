# API Design

> Internal UI mutations use **Server Actions**; reads use **Server Components** calling module services directly. **Route Handlers** exist only where HTTP semantics are required: webhooks, OAuth callbacks, file upload/download, polling endpoints, cron, health. A public REST API (`/api/v1/*`, API keys) is deferred.
> Patterns: `.claude/skills/server-actions`, `.claude/skills/api-design`.
>
> **Active profile: zero-cost (ADR-023). Contract differences:**
> - **Sign-in:** Google only at launch. Email/password, verification and reset endpoints in §2 are not enabled until a free email channel exists.
> - **Resume upload** (§4): file bytes go to `ResumeFile` (Postgres). Download streams the bytes from a Route Handler after the ownership check (no presigned URLs).
> - **Background work:** `GET /api/cron/drain` (Bearer `CRON_SECRET`, called by cron-job.org **every 30 min by default** (configurable) and once a day by Vercel cron) claims `BackgroundJob` rows and runs them for at most **`DRAIN_TIME_BUDGET_MS` = 20 000 ms**, then returns `{ processed, remaining, deferred }` with status 200 within ~20 s. cron-job.org times out after 30 s and disables a job after more than 25 consecutive failures. Remaining work may continue via `after()` within the Vercel function limit without delaying the response. User-triggered work is kicked by `after()` in the triggering action, not by the cron (Neon compute budget, ADR-023). `GET /api/cron/reconcile` (§5) is merged into drain + daily maintenance.
> - **Mail** (§11): Gmail only; Microsoft Graph and push webhooks are deferred. Reply tracking is out of scope in this profile.
> - **Automation** (§12): `automation.start` is available to the owner only (local runner). Other users get `automation.manualFallback`.
> - **Billing** (§14) and plan limits (§15): not implemented. Every user gets the "Free beta" limits, set from free AI quotas (config).

## 1. Conventions

### 1.1 Server Action shape
Every action is built with one wrapper (`src/server/lib/action.ts`):

```ts
export const saveJob = authedAction({
  name: "jobs.save",                 // used for logging, rate limits, audit
  input: z.object({ jobId: z.uuid(), note: z.string().max(500).optional() }),
  rateLimit: { points: 60, durationSec: 60 },
  handler: async ({ input, ctx }) => savedJobs.save(ctx, input),   // ctx: TenantContext
  revalidate: ({ input }) => [`user:${ctx.userId}:saved`],         // tags/paths
});
```

The wrapper: (1) resolves the session (`UNAUTHENTICATED` if missing); (2) checks rate limit; (3) parses `FormData`/object input with Zod (`VALIDATION_FAILED` + `fieldErrors`); (4) runs the handler; (5) maps `AppError` → `ActionResult`; (6) logs `{action, userId, durationMs, outcome}` without input values; (7) never throws to the client.

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; retryAfterSec?: number } };
```

### 1.2 Route Handler shape
`route({ auth: "session" | "cron" | "webhook:<provider>" | "none" }, handler)`: the v1 `lib/api.ts` pattern, extended. JSON responses:

```json
// success: 200/201/202 with resource body
// error:
{ "error": { "code": "VALIDATION_FAILED", "message": "Invalid input", "details": { "file": ["File must be a PDF or DOCX"] }, "requestId": "req_…" } }
```

### 1.3 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no/expired session |
| `FORBIDDEN` | 403 | authenticated but not allowed (role/plan) |
| `NOT_FOUND` | 404 | missing **or belongs to another tenant** (never reveal existence) |
| `VALIDATION_FAILED` | 400 | Zod failure; `fieldErrors` populated |
| `CONFLICT` | 409 | uniqueness / state-machine violation (e.g. already applied) |
| `PRECONDITION_FAILED` | 412 | prerequisite missing (no resume, mailbox not connected, approval expired) |
| `PAYLOAD_TOO_LARGE` | 413 | upload too big |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | wrong file type (magic bytes) |
| `RATE_LIMITED` | 429 | `retryAfterSec` set |
| `QUOTA_EXCEEDED` | 402 | plan limit reached; UI shows upgrade |
| `INTEGRATION_ERROR` | 502 | third party failed; safe message |
| `SERVICE_UNAVAILABLE` | 503 | queue/DB unavailable |
| `INTERNAL` | 500 | generic message only; details in logs/Sentry with `requestId` |

### 1.4 Cross-cutting rules
- **Authorization:** every service method receives `TenantContext`; repositories filter by `ctx.userId`. Admin methods require `ctx.role === "ADMIN"` and write `AuditLog`.
- **IDs** are UUIDs validated with `z.uuid()`; never accept `userId` from the client.
- **Pagination:** keyset (`cursor` = opaque base64 of sort key + id), `limit` ≤ 100, default 25.
- **Idempotency:** actions that create external side effects (send email, submit automation, checkout) accept/derive an idempotency key; repeat calls return the original result.
- **Dates:** ISO-8601 UTC strings over the wire; `z.iso.datetime()`.
- **Revalidation:** user-private pages are dynamic; after a mutation call `refresh()`/`revalidatePath()` for the affected route, or `updateTag()` for cached tags (verify names in installed Next docs).

## 2. Authentication (Better Auth)

Better Auth mounts its own handler at `app/api/auth/[...all]/route.ts`. We do not wrap these routes, but we configure them.

| Operation | Endpoint / action | Notes |
|---|---|---|
| Sign up (email/password) **[scale profile / not enabled in zero-cost]** | `POST /api/auth/sign-up/email` | password policy: ≥ 10 chars, breached-password check (HIBP k-anonymity) ; rate limit 5/min/IP |
| Sign in (email/password) **[scale profile / not enabled in zero-cost]** | `POST /api/auth/sign-in/email` | rate limit 10/min/IP + 5/min/email; generic error message |
| OAuth sign-in | `GET /api/auth/sign-in/social?provider=google|microsoft` → callback | PKCE + state. **Zero-cost: `provider=google` only; `microsoft` is scale profile / not enabled in zero-cost** |
| Sign out | `POST /api/auth/sign-out` | revokes session row |
| Verify email **[scale profile / not enabled in zero-cost]** | `GET /api/auth/verify-email?token=` | single-use, 24 h |
| Password reset **[scale profile / not enabled in zero-cost]** | `POST /api/auth/forget-password`, `POST /api/auth/reset-password` | always 200 (no enumeration); token 1 h; revokes all sessions |
| Sessions list / revoke | actions `account.listSessions`, `account.revokeSession({sessionId})` | |
| 2FA (TOTP) | Better Auth two-factor plugin endpoints | optional, M12 required for admins |
| Accept terms | action `account.acceptConsents({ kinds: ConsentKind[], versions })` | writes `UserConsent` |
| Delete account | action `account.requestDeletion({ confirmEmail })` | sets `deletionRequestedAt`, revokes sessions; 7-day undo via `account.cancelDeletion` |
| Export data | action `account.requestExport()` → job → email link (signed, 24 h) | GDPR Art. 20 |

## 3. Profile & onboarding

| Action | Input | Output | Errors |
|---|---|---|---|
| `profile.update` | `{ headline?, targetTitles?: string[≤10], targetLocations?: Location[≤10], workModes?, employmentTypes?, seniority?, salaryMin?, salaryCurrency?, salaryPeriod?, willingToRelocate?, workAuthorization?, dealbreakers? }` | `UserProfileDto` | VALIDATION_FAILED |
| `profile.completeOnboarding` | `{}` | `{ completedAt }` | PRECONDITION_FAILED (no resume parsed) |
| `profile.excludeCompany` / `includeCompany` | `{ companyId }` | `{ excludedCompanyIds }` | NOT_FOUND |

Side effect: changes to matching-relevant fields enqueue `match {userId, reason: PROFILE_UPDATED}` (debounced).

## 4. Resumes

| Operation | Contract | Auth / limits | Errors |
|---|---|---|---|
| **Upload** `POST /api/resumes` (Route Handler, multipart) | fields: `file` (PDF/DOCX ≤ 4 MB), `resumeId?` (new version of existing), `label?` → **202** `{ resumeId, versionId, status: "UPLOADED" }` | session; 10 uploads/day (Free 3); quota `RESUME_PARSE` | 413, 415, 402, 429 |
| Status `GET /api/resumes/versions/:id/status` | → `{ status, parsedAt?, error? }` | session, owner | 404 |
| Download `GET /api/resumes/versions/:id/file` | → 302 to presigned URL (≤ 5 min) | session, owner; audit `resume.downloaded` | 404 |
| `resume.reparse` | `{ versionId }` → `{ status: "PROCESSING" }` | quota | CONFLICT if processing |
| `resume.setPrimary` | `{ resumeId }` | | NOT_FOUND |
| `resume.rename` | `{ resumeId, label: string(1..60) }` | | |
| `resume.delete` | `{ resumeId }` → deletes versions + files (job) | | CONFLICT if referenced by submitted automation (versions kept, label hidden) |
| `skills.upsert` | `{ skillId? , name?, yearsExperience?, hidden? }` (name resolved via taxonomy) | | VALIDATION_FAILED |
| `skills.confirmAll` | `{ versionId }` | | |
| Read (RSC) | `resumeService.getReview(ctx, versionId)` → parsed data + unmapped skills + diff vs previous version | | |

## 5. Job discovery & catalog

| Operation | Contract |
|---|---|
| Read (RSC) `discover.list(ctx, filters)` | filters (URL params, Zod): `q?` (FTS), `minScore?` (0–100, default 55), `workMode?[]`, `employmentType?[]`, `countryCode?`, `postedWithinDays?` (1/3/7/30), `hasSalary?`, `applyChannel?` (EMAIL/ATS/ANY), `status?` (NEW/SEEN), `sort` (`score`|`posted`), `cursor?`, `limit?` → `{ items: MatchCardDto[], nextCursor }` |
| Read (RSC) `jobs.getDetail(ctx, jobId)` | → `JobDetailDto { job, company, applyChannels, match?: { score, breakdown, explanation, missingSkills }, saved, application? }`; private jobs only for owner |
| `jobs.markSeen` | `{ jobIds: uuid[≤100] }` → `{ updated }` (batched from viewport) |
| `jobs.dismiss` | `{ jobId, reason?: enum[TOO_JUNIOR, TOO_SENIOR, LOCATION, SALARY, COMPANY, NOT_RELEVANT, OTHER], note? }` |
| `jobs.undismiss` | `{ jobId }` |
| `jobs.submitPrivate` | `{ url?: url, title, companyName, description: string(50..50000), location? }` → `{ jobId }` (private job; parse + match enqueued). URL fetching is **not** done server-side in M5 (SSRF surface); paste text instead. |
| `jobs.reportListing` | `{ jobId, reason: SCAM|EXPIRED|DUPLICATE|OTHER }` → admin queue |
| Admin `sources.*` | `create/update/enable/disable/runNow` with `complianceStatus` gate: `runNow` → `PRECONDITION_FAILED` unless `APPROVED` |
| Webhook `POST /api/webhooks/apify` (legacy) | header `X-Webhook-Signature` HMAC (replaces v1 query-string secret); body ignored; run status re-read from Apify API (v1 behaviour kept) |
| Cron `GET /api/cron/reconcile` **[scale profile / not enabled in zero-cost]** | `Authorization: Bearer CRON_SECRET`; re-enqueues stale `*_PENDING` work (fallback if workers/Redis lost jobs). Zero-cost: merged into `/api/cron/drain` + the daily maintenance job |

## 6. Job matching

| Operation | Contract |
|---|---|
| `matching.recompute` | `{}` → `{ queued: true }`; rate limit 3/hour; otherwise automatic triggers (AI_MATCHING §8) |
| `matching.explain` | `{ jobId }` → `{ status: "QUEUED" | "READY" }`; quota `MATCH_EXPLANATION`; returns cached explanation if fresh for the current scoringVersion |
| `GET /api/matching/status` | → `{ lastMatchedAt, running: boolean, newMatches: number }` for the dashboard poller |
| Read (RSC) `matching.insights(ctx)` | → `{ topMissingSkills: {skill, appearsInTopN, scoreLiftAvg}[], scoreDistribution }` |

## 7. Saved jobs

| Action | Input | Output | Errors |
|---|---|---|---|
| `saved.save` | `{ jobId, note? }` | `{ savedAt }` | NOT_FOUND; idempotent |
| `saved.unsave` | `{ jobId }` | `{}` | idempotent |
| `saved.updateNote` | `{ jobId, note: string(≤500) }` | | NOT_FOUND |
| Read `saved.list(ctx, { cursor })` | | `{ items: SavedJobDto[], nextCursor }` | |

## 8. Application management

| Action | Input | Output | Errors / rules |
|---|---|---|---|
| `applications.create` | `{ jobId, stage?: DRAFT|APPLIED, channel?, appliedAt?, resumeVersionId? }` | `ApplicationDto` | CONFLICT if exists (returns existing id in details) |
| `applications.markApplied` | `{ applicationId, channel, appliedAt? }` (manual apply confirmation) | | state guard |
| `applications.moveStage` | `{ applicationId, toStage, note?, boardPosition?: string }` | `{ stage, boardPosition }` | invalid transition → CONFLICT; writes `ApplicationStageChange`; suggests follow-up reminder on APPLIED |
| `applications.reorder` | `{ applicationId, boardPosition }` | | fractional index validated |
| `applications.update` | `{ applicationId, notes?: string(≤10000), priority?: int(0..3) }` | | |
| `applications.archive` / `unarchive` | `{ applicationId }` | | |
| `applications.delete` | `{ applicationId, confirm: true }` | | CONFLICT if automation in flight |
| `documents.generateCoverLetter` | `{ applicationId, tone?: FORMAL|FRIENDLY|CONCISE, language? }` | `{ documentId, status: "QUEUED" }` | quota COVER_LETTER |
| `documents.update` / `approve` | `{ documentId, content? }` | `{ approvedAt }` | |
| `contacts.upsert` | `{ id?, name, email?, phone?, title?, companyId?, linkedinUrl?, notes? }` | `ContactDto` | |
| `contactLogs.add` | `{ applicationId, contactId?, type, summary, occurredAt }` | | |
| Read `applications.board(ctx)` | | `{ columns: Record<Stage, ApplicationCardDto[]> }` | |
| Read `applications.detail(ctx, id)` | | timeline (stage changes, emails, logs, interviews, reminders) | |

## 9. Interview management

| Action | Input | Notes |
|---|---|---|
| `interviews.create` | `{ applicationId, type, round?, scheduledAt?, durationMinutes?, location?, meetingUrl?: url(https), interviewers?: {name, title?}[] }` | auto-moves stage to INTERVIEWING (if earlier) with user-visible undo; creates reminder 24 h before |
| `interviews.update` | partial of above + `{ outcome?, notes? }` | |
| `interviews.delete` | `{ interviewId }` | cancels linked reminders |
| `interviews.generateQuestions` | `{ interviewId, count?: 5..20, focus?: TECHNICAL|BEHAVIORAL|MIXED }` | AI, quota `INTERVIEW_QUESTIONS`; questions stored with `source=AI` |
| `interviewQuestions.upsert` / `reorder` / `delete` | `{ id?, interviewId, question, category?, answerNotes?, sortOrder? }` | |
| `GET /api/interviews/:id/ics` | → `text/calendar` single event | session, owner |

## 10. Follow-up reminders

| Action | Input | Notes |
|---|---|---|
| `reminders.create` | `{ applicationId?, interviewId?, title, note?, dueAt }` | `dueAt` must be future |
| `reminders.snooze` | `{ reminderId, until }` | |
| `reminders.complete` / `cancel` | `{ reminderId }` | |
| Read `reminders.list(ctx, { status, range })` | | |
| Scheduler (maintenance queue, every 5 min) | claims due reminders with `SKIP LOCKED`, creates `Notification`, sends email per prefs, sets `NOTIFIED` | |
| Auto-suggestion | on stage APPLIED: suggest reminder at +7 days (user setting) | user accepts in UI; not silently created unless setting `autoReminders=true` |

## 11. Email integration

| Operation | Contract | Notes |
|---|---|---|
| Connect `GET /api/integrations/mail/:provider/connect` | 302 to provider consent (state + PKCE, incremental scopes) | session |
| Callback `GET /api/integrations/mail/:provider/callback` | exchanges code, encrypts tokens, creates `EmailAccount`, audit `mail.account.connected` → redirect to settings | validates `state` bound to session |
| `mail.disconnect` | `{ emailAccountId }` | revokes token at provider, deletes encrypted tokens |
| `mail.prepareDrafts` | `{ applicationIds: uuid[≤50], templateId?, emailAccountId }` | → `{ drafts: { applicationId, to, subject, body, attachments, warnings: ["RECENTLY_EMAILED"…] }[] }` (v1 `prepareEmail` evolved) |
| `mail.sendDrafts` | `{ emailAccountId, drafts: { applicationId, to: email, subject: 1..300, body: 1..20000, attachResumeVersionId? }[≤50], idempotencyKey: uuid }` | → `{ queued, skipped: {applicationId, reason}[] }`; per-account daily cap; unique index prevents double send |
| `GET /api/mail/batches/:idempotencyKey` | → progress `{ queued, sent, failed }` | polling |
| Push `POST /api/webhooks/gmail` (Pub/Sub push, OIDC-verified) / `POST /api/webhooks/msgraph` (validation token + clientState) | enqueue `mail-sync` | only if read scopes approved (ADR-012) |
| `templates.upsert` / `delete` / `setDefault` | `{ id?, name, subject, body }` | variables `{{job.title}}`, `{{company.name}}`, `{{me.fullName}}` (v1 renderer) |

## 12. Automation execution

| Action | Input | Output | Rules |
|---|---|---|---|
| `automation.checkSupport` (RSC read) | `jobId` | `{ supported, adapter?, reasonIfNot? }` | host allowlist + adapter health |
| `automation.start` | `{ jobId }` | `{ taskId, status: "PREPARING" }` | requires: plan with automation, primary resume parsed, consent `AUTOMATION_AUTHORIZATION` accepted, quota `AUTOMATION_RUN`; CONFLICT if active task exists |
| `GET /api/automation/tasks/:id` | | `{ status, preparedFields?, flags, screenshots: presignedUrl[], expiresAt }` | owner only |
| `automation.updateAnswers` | `{ taskId, answers: Record<fieldKey, string | string[] | boolean> }` | `{ preparedPayloadHash }` | only in AWAITING_APPROVAL; values validated against field types/options |
| `automation.approve` | `{ taskId, payloadHash: hex64, consentVersion }` | `{ status: "APPROVED" }` | hash must equal server-computed hash; not expired; enqueues submit; audit |
| `automation.cancel` | `{ taskId }` | | any non-terminal state |
| `automation.reprepare` | `{ taskId }` | | after FORM_CHANGED / EXPIRED |
| `automation.manualFallback` | `{ taskId }` | `{ applyUrl, answerSheet }` | always available |

## 13. Dashboard analytics

| Read (RSC) | Output |
|---|---|
| `analytics.overview(ctx, { range: 7d|30d|90d })` | `{ newMatches, applicationsSent, responseRate, interviewsScheduled, offers, avgTimeToFirstResponseDays }` |
| `analytics.funnel(ctx, range)` | counts per stage + conversion % between consecutive stages |
| `analytics.activity(ctx, range)` | daily series: applications, responses, interviews |
| `analytics.sourcesPerformance(ctx, range)` | response rate by channel (email vs ATS vs manual) |

All computed with SQL aggregates scoped by `userId`; cached per request only (private data).

## 14. Notifications, billing, misc

| Operation | Contract |
|---|---|
| `notifications.markRead` | `{ ids: uuid[≤100] }` or `{ all: true }` |
| `GET /api/notifications/unread-count` | `{ count }` (polled every 60 s, cheap index) |
| `notifications.updatePreferences` | `{ channels: Record<NotificationType, { inApp: boolean; email: boolean }>, digest: OFF|DAILY|WEEKLY }` |
| `billing.createCheckout` | `{ plan: PRO|PREMIUM, interval: MONTH|YEAR }` → `{ url }` (provider-hosted) |
| `billing.openPortal` | `{}` → `{ url }` |
| `POST /api/webhooks/billing/:provider` | signature verified; `WebhookEvent` idempotency; updates `Subscription`; 200 fast, heavy work queued |
| `GET /api/health` | `{ ok, version }` (no dependencies) ; `GET /api/health/ready` checks DB + Redis (auth: CRON_SECRET) |

## 15. Plan limits referenced above (initial proposal, finalised in M11)

| Limit | Free | Pro | Premium |
|---|---|---|---|
| Resume parses / month | 3 | 20 | 50 |
| Match explanations / day | 5 | 25 | 50 |
| Cover letters / month | 3 | 50 | 200 |
| Email sends / day (per account cap still applies) | 10 | 50 | 100 |
| Assisted ATS applications / month | 0 | 0 (prepare-only 20) | 100 |
| Interview question generations / month | 2 | 30 | 100 |
