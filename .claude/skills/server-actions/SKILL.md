---
name: server-actions
description: How to write secure, typed Next.js Server Actions in this project using the authedAction wrapper, Zod validation, ActionResult return type, rate limits, revalidation and optimistic UI. Use when adding or changing any "use server" function or a form/button that mutates data.
---

# Server Actions

## When to activate
- Creating or editing a file with `"use server"` (convention: `src/features/<feature>/actions.ts`).
- Wiring a form, button, or drag-and-drop interaction to a mutation.
- Reviewing an action for security (every action is a public HTTP endpoint).

## Core contract
```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; retryAfterSec?: number } };
```
Actions **never throw to the client** and **never trust input**. Business logic lives in services; actions are adapters.

## The wrapper (reference implementation, built in M0)
```ts
// src/server/lib/action.ts
import "server-only";
import { z } from "zod";
import { getTenantContext, type TenantContext } from "@/server/auth";
import { AppError, toActionError } from "@/server/lib/errors";
import { consumeRateLimit } from "@/server/lib/rate-limit";
import { logger } from "@/server/lib/logger";

type Options<S extends z.ZodType, T> = {
  name: string;                                   // "applications.moveStage"
  input: S;
  rateLimit?: { points: number; durationSec: number };
  handler: (args: { input: z.infer<S>; ctx: TenantContext }) => Promise<T>;
};

export function authedAction<S extends z.ZodType, T>(opts: Options<S, T>) {
  return async (raw: z.input<S> | FormData): Promise<ActionResult<T>> => {
    const started = performance.now();
    let userId: string | undefined;
    try {
      const ctx = await getTenantContext();                         // throws UNAUTHENTICATED
      userId = ctx.userId;
      if (opts.rateLimit) await consumeRateLimit(`${opts.name}:${ctx.userId}`, opts.rateLimit); // throws RATE_LIMITED
      const data = raw instanceof FormData ? formDataToObject(raw) : raw;
      const input = opts.input.parse(data);                         // throws ZodError
      const result = await opts.handler({ input, ctx });
      log("ok");
      return { ok: true, data: result };
    } catch (err) {
      const error = toActionError(err);                             // ZodError → VALIDATION_FAILED, AppError → code, else INTERNAL
      log(error.code);
      return { ok: false, error };
    }
    function log(outcome: string) {
      logger.info({ action: opts.name, userId, outcome, durationMs: Math.round(performance.now() - started) }, "action");
    }
  };
}
```
`toActionError` must return a generic message for unknown errors and report them to Sentry with the request id. It never echoes `err.message` for INTERNAL.

## Writing an action
```ts
// src/features/applications/actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/lib/action";
import { applications } from "@/server/modules/applications";

const MoveStageInput = z.object({
  applicationId: z.uuid(),
  toStage: z.enum(["DRAFT", "APPLIED", "SCREENING", "INTERVIEWING", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "GHOSTED"]),
  boardPosition: z.string().regex(/^[0-9a-zA-Z]{1,32}$/).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const moveApplicationStage = authedAction({
  name: "applications.moveStage",
  input: MoveStageInput,
  rateLimit: { points: 120, durationSec: 60 },
  handler: async ({ input, ctx }) => {
    const result = await applications.moveStage(ctx, input);   // authorizes, validates transition, records history
    revalidatePath("/applications");                            // verify preferred API (updateTag/refresh) in installed docs
    return result;
  },
});
```

## Using actions in the UI

### Form with `useActionState`
```tsx
"use client";
import { useActionState } from "react";
import { updateProfile } from "@/features/profile/actions";

export function ProfileForm({ initial }: { initial: ProfileDto }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult<ProfileDto> | null, formData: FormData) => updateProfile(formData),
    null,
  );
  const fieldError = (k: string) => (state && !state.ok ? state.error.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form action={formAction} noValidate>
      <Input name="headline" defaultValue={initial.headline ?? ""} aria-invalid={!!fieldError("headline")}
             aria-describedby="headline-error" />
      {fieldError("headline") && <p id="headline-error" role="alert">{fieldError("headline")}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
```

### Optimistic update (Kanban)
```tsx
const [optimisticBoard, applyMove] = useOptimistic(board, reduceMove);
function onDrop(move: Move) {
  startTransition(async () => {
    applyMove(move);
    const res = await moveApplicationStage(move);
    if (!res.ok) toast.error(res.error.message);   // optimistic state rolls back automatically when the transition ends
  });
}
```

## Patterns
- **Thin action, fat service.** ≤ ~20 lines; one service call; revalidation; return DTO.
- **Idempotent side effects.** For sends/submissions accept an `idempotencyKey: z.uuid()` generated client-side once per intent.
- **Quota checks in the service**, before enqueueing (`QUOTA_EXCEEDED`).
- **Long work → enqueue + return `{ status: "QUEUED", id }`**; UI polls a status Route Handler.
- **DTOs out.** Return plain serialisable objects (ISO date strings, numbers not `Decimal`).

## Anti-patterns
- ❌ Reading `userId` (or any tenant id) from input.
- ❌ Skipping Zod because "the form already validates".
- ❌ Throwing errors to the client or returning `err.message` for unexpected errors.
- ❌ Calling Prisma directly in the action.
- ❌ Doing slow external calls (LLM, email, ATS) inside the action: enqueue instead.
- ❌ Using actions for data fetching in Server Components (call services directly).
- ❌ Relying on closure-captured or `.bind()` arguments as trusted: bound args arrive from the client; validate them like any input.
- ❌ `redirect()` inside `try/catch` (it throws by design; call it after the try block).
- ❌ Exporting non-action helpers from a `"use server"` file (every export becomes an endpoint).

## Error handling
| Situation | Result |
|---|---|
| No session | `UNAUTHENTICATED` (UI redirects to sign-in) |
| Zod failure | `VALIDATION_FAILED` + `fieldErrors` (`z.flattenError(err).fieldErrors`) |
| Foreign/missing resource | `NOT_FOUND` |
| Invalid state transition / unique violation | `CONFLICT` |
| Rate limit | `RATE_LIMITED` + `retryAfterSec` |
| Plan limit | `QUOTA_EXCEEDED` (UI shows upgrade dialog) |
| Anything else | `INTERNAL` with generic message; Sentry event with request id |

## Security considerations
- Actions are reachable by direct POST from any client: authentication, authorization, validation and rate limiting happen inside the wrapper/service every time.
- CSRF: Next compares Origin/Host for actions; keep `serverActions.allowedOrigins` explicit (verify config key) and session cookies `SameSite=Lax`.
- Body size: keep the default small limit; file uploads go through the upload Route Handler, not actions.
- Never log input values (may contain PII); the wrapper logs name/outcome/duration only.

## Testing requirements
- Each action has tests for: success, `UNAUTHENTICATED`, `VALIDATION_FAILED`, cross-tenant `NOT_FOUND`, and its main `CONFLICT`/`QUOTA_EXCEEDED` path.
- Test by calling the exported action with a mocked session provider (`getTenantContext` injectable) against a real test DB.
- E2E covers the main UI flows using the action (TESTING_STRATEGY §5.2).
