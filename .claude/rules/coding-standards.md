# Coding Standards (all code)

These apply to every change in this repository. Area-specific rules live beside this file (frontend, backend, database, security) and load automatically for matching paths.

## Process
1. **Architecture first.** Before implementing, read the relevant `plan/*.md` section. If the change contradicts a plan or ADR, update `plan/TECHNICAL_DECISIONS.md` (new or amended ADR) in the same PR, or stop and ask.
2. **Next.js is newer than your training data.** Read `node_modules/next/dist/docs/` for the API you are using (see `AGENTS.md`). If `node_modules` is missing or incomplete, run `npm ci` first; do not guess framework APIs.
3. **Small, verifiable steps.** Each PR maps to roadmap tasks; it must build, lint, typecheck and test green.
4. **Never claim something works without running it.** Report test/build output honestly; if a step was skipped, say so.
5. **Update `plan/IMPLEMENTATION_STATUS.md`** when a roadmap task or milestone changes state. Mark COMPLETED only with verification evidence.

## TypeScript
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (from M0). No `any`; use `unknown` + narrowing. No non-null `!` except right after an explicit check the compiler can't see (add a comment).
- Types come from Zod schemas (`z.infer`) or Drizzle-inferred types (`$inferSelect`/`$inferInsert`, repositories only); do not hand-duplicate shapes.
- Prefer discriminated unions for states/results (`{ ok: true } | { ok: false }`), exhaustive `switch` with `assertNever`.
- Named exports only (except where Next.js requires default exports: `page.tsx`, `layout.tsx`, etc.).
- No enums in TS code: use Drizzle `app.enum(...)` values (`enumObj.enumValues`) or `as const` objects + union types.

## Structure & boundaries (ADR-021)
- Routing in `src/app/**` stays thin: parse params → call module service → render.
- Domain logic lives in `src/server/modules/<domain>/`; other code imports only from the module's `index.ts`.
- A module never imports another module's `repository.ts`. Cross-module async effects go through queues.
- `src/lib/**` must be isomorphic (no `server-only` imports). `src/server/**` files start with `import "server-only";` where they could be reached from a client bundle.
- **No duplicated business logic.** Search before writing a helper; if similar logic exists, extract and reuse it.
- `src/legacy/**` (v1) is read-only reference until deleted in M6; v2 code must not import it.

## Naming
- Files: `kebab-case.ts`; React components `PascalCase` exports in `kebab-case.tsx` files.
- Functions: verbs (`scoreSkills`, `claimDueReminders`); booleans `is/has/can/should`.
- Server Actions: `<domain>.<verb>` for the action `name` (`applications.moveStage`); exported function `moveApplicationStage`.
- Queues: kebab-case nouns (`resume-process`); job names `<queue>:<verb>`.
- Prompts: `<domain>.<task>` + `v<N>` (`resume.extract/v1.ts`).

## Errors & logging
- Throw `AppError(code, message, details?)` for expected failures; let unexpected errors bubble to the wrapper.
- Never swallow errors silently. `catch` must rethrow, convert to `AppError`, or log with context and a reason.
- Log with the pino logger (`logger.child({ module })`), structured fields, no string concatenation. Never log PII (resume text, emails, phones, cover letters, form answers) or secrets.
- User-facing messages are actionable and never include stack traces or internal ids other than `requestId`.

## Async & reliability
- Anything slow (> ~1 s) or calling an unreliable third party goes to a queue (SYSTEM_ARCHITECTURE §1).
- All job handlers are idempotent; document the idempotency key in the processor's header comment.
- External calls: explicit timeout, bounded retries with backoff, typed error mapping (pattern: v1 `lib/http.ts`).
- Inject time (`now`) and randomness where logic depends on them.

## Testing
- Tests ship with the code (TESTING_STRATEGY §11 Definition of Done). Bug fixes start with a failing test.
- Pure logic → unit tests; DB/queue logic → integration tests against real Postgres; journeys → Playwright.
- New tenant-owned Drizzle table (has a `userId` column) → add to the tenancy isolation registry.

## Dependencies
- Avoid new dependencies unless they remove meaningful complexity or risk. Justify each in the PR (size, maintenance, licence, alternatives). Security-sensitive libraries (auth, crypto, parsing) need `security-auditor` review.
- Pin exact versions for runtime-critical tooling images (Playwright, Postgres); use lockfile for npm.

## Documentation
- Public functions in modules get a one-line TSDoc explaining *why/contract*, not restating the name.
- Architecture changes → update `plan/`; operational changes → `docs/`.
- Comments explain non-obvious decisions (as v1 does: "Why async? Scrapers often run for 1–5 minutes…").

## Formatting
- Prettier defaults (2 spaces, double quotes, trailing commas, 100-char width), ESLint with Next.js config + project rules. Don't hand-format against the formatter.
