---
name: nextjs-app-router
description: Next.js 16 App Router conventions for this project (pages, layouts, route groups, Server/Client Components, async request APIs, streaming with Suspense, Cache Components, proxy.ts, route handlers, parallel/intercepting routes). Use when creating or changing anything under src/app, src/components or src/features, or when unsure how a Next.js API behaves in this version.
---

# Next.js App Router (Next 16) for JobFinder AI

## When to activate
- Creating/modifying a page, layout, loading/error/not-found file, route group, or route handler.
- Deciding Server vs Client Component, caching, or data-fetching strategy.
- Editing `proxy.ts`, `next.config.ts`, or `instrumentation.ts`.
- Any time you are about to use a Next.js API from memory.

## Rule zero: verify against the installed docs
This Next.js version has breaking changes relative to most training data (see `AGENTS.md`). Before using an API, read the matching guide in `node_modules/next/dist/docs/`. If `node_modules/next` is missing, run `npm ci` first. When the docs disagree with this skill, **the docs win**: update this skill in the same PR.

Known Next 16 facts this codebase already relies on (v1):
- `proxy.ts` (root or `src/`) replaces `middleware.ts`; exported function is `proxy`.
- Request APIs are async: `await params`, `await searchParams`, `await cookies()`, `await headers()`.
- `next typegen` generates route types (`PageProps<'/route'>`, `LayoutProps`, `RouteContext`); `npm run typecheck` runs it.
- Turbopack is the default bundler.

Verify before use: Cache Components (`cacheComponents` flag, `"use cache"`, `cacheLife`, `cacheTag`), `updateTag` vs `revalidateTag(tag, profile)`, `refresh()`, `serverActions` config keys, React Compiler option.

## Project layout (ADR-021)
```
src/app/
  (marketing)/layout.tsx, page.tsx, pricing/page.tsx
  (auth)/layout.tsx, sign-in/page.tsx, sign-up/page.tsx …
  (app)/layout.tsx            ← AppShell, requires session
  (app)/dashboard/page.tsx
  (app)/discover/page.tsx
  (app)/jobs/[id]/page.tsx
  (app)/@modal/(.)jobs/[id]/page.tsx   ← intercepting route for split/modal view (verify pattern)
  api/…/route.ts              ← webhooks, OAuth, uploads, status polling, cron
```
Routing files stay thin: parse input → call `@/server/modules/*` → render feature components from `@/features/*`.

## Recommended patterns

### Page with async params, search params and streaming
```tsx
// src/app/(app)/jobs/[id]/page.tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { jobs } from "@/server/modules/catalog";
import { JobHeader, MatchPanel, MatchPanelSkeleton } from "@/features/jobs/components";

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();

  const ctx = await requireUser();                 // redirects to /sign-in if no session
  const job = await jobs.getDetail(ctx, parsed.data);
  if (!job) notFound();                            // also covers other tenants' private jobs

  return (
    <>
      <JobHeader job={job} />
      <Suspense fallback={<MatchPanelSkeleton />}>
        {/* async Server Component: fetches match + explanation, streams in */}
        <MatchPanel ctx={ctx} jobId={job.id} />
      </Suspense>
    </>
  );
}
```

### URL-driven filters (Discover)
```tsx
// Server: parse search params once with Zod, pass typed filters down.
const DiscoverFilters = z.object({
  q: z.string().max(200).optional(),
  minScore: z.coerce.number().int().min(0).max(100).default(55),
  workMode: z.enum(["REMOTE", "HYBRID", "ONSITE"]).array().optional()
    .or(z.enum(["REMOTE", "HYBRID", "ONSITE"]).transform((v) => [v])),
  cursor: z.string().max(200).optional(),
});

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const filters = DiscoverFilters.parse(await searchParams);
  const ctx = await requireUser();
  const page = await discover.list(ctx, filters);
  return <DiscoverView initial={page} filters={filters} />;
}
```
Client side, update filters with `useRouter().replace(\`?${params}\`, { scroll: false })` inside `startTransition`; never mirror them in `useState` as the source of truth.

### Client Component boundary
```tsx
"use client";
// Only the interactive leaf is a client component; it receives DTOs, never Drizzle rows.
export function SaveJobButton({ jobId, saved }: { jobId: string; saved: boolean }) { /* … */ }
```

### Caching global data only
```tsx
// Global, non-personal data (e.g., skill taxonomy for autocomplete). Verify directive semantics in docs.
import { cacheLife, cacheTag } from "next/cache";

export async function getSkillTaxonomy() {
  "use cache";
  cacheTag("taxonomy");
  cacheLife("days");
  return skills.listAll();
}
```
User-private data (matches, applications, resumes) is **never** cached with `"use cache"`; render it dynamically inside `<Suspense>`.

### Route Handler
```ts
// src/app/api/resumes/versions/[id]/status/route.ts
import { route } from "@/server/lib/route";
import { resumes } from "@/server/modules/resume";

export const GET = route({ auth: "session" }, async (_req, { params, ctx }) => {
  const { id } = await params;                      // validated by route() schema option in real code
  return resumes.getStatus(ctx, id);                // NOT_FOUND for foreign ids
});
```

### proxy.ts responsibilities
- Optimistic redirect when the session cookie is absent (not a security check).
- Request id header, security headers, CSP with per-request nonce.
- Matcher excludes static assets. Keep it fast: no DB calls.

### Error and loading boundaries
- `loading.tsx` per heavy route segment with skeletons matching final layout (avoid CLS).
- `error.tsx` must be a Client Component; show a friendly message + `requestId` digest, offer retry (`reset`), never the raw error.
- `not-found.tsx` for missing/foreign resources (we deliberately do not distinguish them).

## Anti-patterns
- ❌ `fetch("/api/...")` from a Server Component to our own backend → call the service directly.
- ❌ `"use client"` at page level "to make it work": move interactivity into leaves.
- ❌ Reading `cookies()`/`headers()` inside a `"use cache"` scope, or caching per-user data in shared caches.
- ❌ Synchronous `params.id` access (stale Next 14 pattern).
- ❌ Business logic or Drizzle/`db` calls inside `page.tsx`/`route.ts`.
- ❌ Putting filters in `useState` only (not shareable, lost on reload).
- ❌ Using `middleware.ts` (renamed to `proxy.ts` in this version).
- ❌ Treating `proxy.ts` as authorization.

## Error handling
- Services throw `AppError`; pages convert `NOT_FOUND` to `notFound()`, `UNAUTHENTICATED` to redirect (handled inside `requireUser()`), everything else bubbles to `error.tsx`.
- Do not wrap `redirect()`/`notFound()` in `try/catch` (they throw control-flow errors).

## Security considerations
- Every `(app)` page calls `requireUser()` (or a layout-level check *plus* per-page service authorization; services always authorize).
- Validate `params`/`searchParams` with Zod before use.
- Never pass secrets or full PII objects as props to Client Components; serialise minimal DTOs.
- Do not render untrusted HTML; job descriptions go through the sanitised renderer.

## Testing requirements
- Feature components: Vitest + Testing Library for client logic (score components, filter bar).
- Pages/journeys: Playwright E2E (TESTING_STRATEGY §5) with axe scan.
- `npm run typecheck` (includes `next typegen`) must pass. Route type errors are build failures.
