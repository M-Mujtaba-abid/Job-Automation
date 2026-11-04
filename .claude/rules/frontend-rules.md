---
paths:
  - "src/app/**/*.{ts,tsx,css}"
  - "src/components/**/*.{ts,tsx}"
  - "src/features/**/*.{ts,tsx}"
  - "src/legacy/**/*.{ts,tsx}"
---

# Frontend Rules

Design reference: `plan/UI_UX_DESIGN.md`. Skill: `.claude/skills/nextjs-app-router`.

## Server vs Client Components
- Default to Server Components. Add `"use client"` only for interactivity (state, effects, event handlers, browser APIs), and push it to the smallest leaf component.
- Server Components fetch data by calling module services (`@/server/modules/<domain>`). Never call our own Route Handlers from Server Components.
- Client Components never import from `@/server/**` (ESLint enforced). Pass serialisable props only, never Drizzle rows (`Date` objects, `numeric` as strings, internal columns). Map to DTOs.
- Request APIs are async in this Next version: `await params`, `await searchParams`, `await cookies()`, `await headers()`. Verify in `node_modules/next/dist/docs/` when unsure.

## Data, caching, and state
- User-private data is dynamic: render inside `<Suspense>` with a skeleton fallback. Never put user-private data in a shared cache (`"use cache"` only for global data such as marketing content, taxonomy, public company info) and include every input in the cache key.
- Filters, sorting, pagination and selected tabs live in URL search params (shareable, server-readable). No global client store.
- Mutations use Server Actions via `useActionState` (forms) or `startTransition` calls; optimistic UI with `useOptimistic` and rollback on `{ ok: false }`.
- Show action errors from `ActionResult.error` (field errors inline with `aria-describedby`; others as toast via sonner).

## Components
- Use shadcn/ui primitives from `@/components/ui`; extend via composition and `cn()` + CVA variants, not by forking primitives. Add new primitives with the shadcn CLI.
- Shared composites go in `@/components/shared`; feature-specific in `@/features/<feature>/components`.
- Every list/page has explicit empty, loading (skeleton), and error states.
- Mark AI-generated content with `<AiLabel>`; scores always render with number + label, never colour alone.

## Styling
- Tailwind v4 utility classes with design tokens from `globals.css` (`bg-background`, `text-muted-foreground`, semantic + score-band tokens). No hard-coded hex colours, no inline styles except dynamic values.
- Mobile-first responsive classes; verify at 375 px, 768 px, 1280 px.
- Support dark mode through tokens (no `dark:` overrides with raw colours).

## Accessibility (WCAG 2.2 AA)
- Semantic HTML first; Radix primitives for dialogs, menus, popovers. Every interactive element is keyboard reachable with visible focus.
- Labels for all inputs; icons-only buttons have `aria-label`.
- Async status updates announced via `aria-live="polite"`. Respect `prefers-reduced-motion`.
- Drag-and-drop must have a keyboard alternative.

## Forms
- Zod schema shared between client hints and server validation (server is authoritative). Simple forms: native form + `useActionState`. Complex forms: React Hook Form + Zod resolver, submitting to a Server Action.
- Disable submit while pending; prevent double submission.

## Performance
- Lazy-load heavy client components (Kanban DnD, charts, PDF preview) with `next/dynamic`.
- `next/image` for images with explicit sizes; `next/font` for fonts.
- Avoid client-side waterfalls; fetch in parallel on the server (`Promise.all`) and stream with Suspense.

## Security in UI
- No `dangerouslySetInnerHTML` (except sanitised job HTML component). External links: `rel="noopener noreferrer"` and `target="_blank"` only when needed.
- Never render secrets/tokens; never put PII in URLs (use ids).
