---
name: api-design
description: API contract conventions for this project - when to use Server Actions vs Route Handlers, request/response and error shapes, error codes, Zod schemas, authorization, pagination, idempotency, webhooks (signature + replay protection), polling endpoints, and API documentation. Use when designing a new endpoint or action, changing a contract, or adding a webhook/OAuth/cron/upload route.
---

# API Design

## When to activate
- Adding an action or Route Handler, or changing an existing contract.
- Adding a webhook receiver, OAuth callback, cron endpoint, upload/download endpoint, or polling/status endpoint.
- Updating `plan/API_DESIGN.md`.

## Choosing the surface
| Need | Use |
|---|---|
| Read data for a page | Server Component → module service (no API) |
| Mutation triggered from our UI | Server Action (`server-actions` skill) |
| Third party calls us (billing, mail push, Apify) | Route Handler + signature verification |
| Browser redirects (OAuth) | Route Handler (`GET` callback) |
| Large file upload / streamed download | Route Handler |
| Progress polling from client | Route Handler `GET` (cheap, indexed) |
| Scheduled triggers | Route Handler with `CRON_SECRET` (or worker repeatable jobs: preferred for most) |
| External/public API | Deferred: `/api/v1/*` with API keys, OpenAPI generated from Zod |

## Contract rules
1. **Every contract has a Zod schema** for input and output in the module's `schemas.ts`; types derive from them.
2. **Inputs:** ids `z.uuid()`; strings trimmed + max length; enums for categories; dates `z.iso.datetime()`; arrays capped (`.max(100)`); numbers bounded.
3. **Outputs:** DTOs, never raw Drizzle rows; dates as ISO strings; no internal fields (`raw`, `extractedText`, tokens, other users' ids).
4. **Errors:** codes from the shared catalogue (`API_DESIGN.md` §1.3). Actions return `{ ok:false, error }`; handlers respond `{ error: { code, message, details?, requestId } }` with the mapped status.
5. **Authorization in the service**, not only in the route: services receive `TenantContext`.
6. **Foreign resources → 404/NOT_FOUND**, never 403 (no existence oracle).
7. **Idempotency** for side effects: client-generated `idempotencyKey` (uuid) or natural keys; repeated calls return the first result.
8. **Pagination:** keyset with opaque cursor; `limit` default 25, max 100; response `{ items, nextCursor }`.
9. **Rate limits** declared per action/handler; 429 includes `Retry-After` header (handlers) / `retryAfterSec` (actions).
10. **Backward compatibility:** additive changes only for anything external (webhooks we expose later, public API). Internal action contracts can change with their callers in one PR.

## Route Handler template
```ts
// src/app/api/automation/tasks/[id]/route.ts
import { z } from "zod";
import { route } from "@/server/lib/route";
import { automation } from "@/server/modules/automation";

const Params = z.object({ id: z.uuid() });

export const GET = route(
  { auth: "session", params: Params, rateLimit: { points: 120, durationSec: 60 } },
  async ({ params, ctx }) => automation.getTaskForReview(ctx, params.id),   // returns DTO or throws AppError
);
```
`route()` responsibilities: auth mode (`session` | `cron` | `webhook:<provider>` | `none`), params/query/body parsing with Zod, rate limiting, `AppError`/`ZodError` → JSON error, generic 500 with `requestId`, structured completion log, `Cache-Control: no-store` for authenticated responses.

## Webhook receiver template
```ts
// src/app/api/webhooks/billing/[provider]/route.ts
export const POST = route({ auth: "none" }, async ({ req, params }) => {
  const raw = await req.text();                                   // verify over the exact raw body
  const provider = billingProviders.get(params.provider);         // allowlisted map → NOT_FOUND otherwise
  const event = provider.verifyAndParse(raw, req.headers);        // signature + timestamp tolerance (≤ 5 min); throws UNAUTHENTICATED
  const fresh = await webhookEvents.recordOnce(provider.id, event.id, event.type);   // unique (provider, eventId)
  if (fresh) await queue.add("billing-sync", { provider: provider.id, eventId: event.id });
  return new Response(null, { status: 200 });                     // ack fast; process async
});
```
Rules: verify signature on the raw body with constant-time compare; reject stale timestamps; idempotency table; ack quickly and process in a worker; handlers tolerate out-of-order delivery by re-reading state from the provider when ordering matters (v1 Apify webhook already re-reads run status instead of trusting the body: keep that pattern).

## OAuth callback rules
- `state` = HMAC(sessionId + nonce + provider), verified and single-use; PKCE verifier stored server-side (short TTL).
- Exact redirect URI allowlist; errors redirect to a settings page with a generic message (no token/codes in URLs or logs).

## Polling endpoint rules
- `GET`, cheap indexed lookup, returns small status DTO, `Cache-Control: no-store`, rate-limited, owner-scoped.
- Clients poll with backoff (1 s → 5 s, stop after terminal status or 5 min).

## Documentation
- Every new or changed action/handler is listed in `plan/API_DESIGN.md` (input, output, auth, errors) in the same PR.
- Public API (future): OpenAPI generated from Zod schemas, versioned under `/api/v1`.

## Anti-patterns
- ❌ REST endpoints for our own UI reads/mutations (use RSC + actions).
- ❌ Returning different error shapes per endpoint; returning stack traces/raw messages on 500.
- ❌ Accepting `userId` from clients; 403 for foreign ids.
- ❌ Webhooks authenticated by secrets in query strings (v1 finding F1) or unverified bodies.
- ❌ Offset pagination on large lists; unbounded arrays in inputs.
- ❌ Doing heavy work synchronously in webhooks (provider retries → duplicates).
- ❌ GET requests with side effects.

## Security considerations
- Mutating handlers: non-GET, Origin check, JSON-only content type, auth wrapper.
- Upload handlers: streaming size limit + magic bytes before storage (`security-best-practices` skill).
- All responses with private data: `Cache-Control: no-store`.

## Testing requirements
- Contract tests per action/handler: happy path, auth failure, validation failure, cross-tenant 404, rate limit.
- Webhooks: valid/invalid signature, stale timestamp, replay (same event id), out-of-order sequence.
- Schemas: unit tests for tricky validations (cursor decode, URL allowlists).
