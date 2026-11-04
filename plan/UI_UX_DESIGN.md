# UI / UX Design

> Stack: shadcn/ui (new-york style, `radix-ui`) on Tailwind v4 tokens (already configured in v1 `app/globals.css`, `components.json`), lucide icons, sonner toasts, TanStack Table, `@dnd-kit` for Kanban (ADR-020). Mobile-first, WCAG 2.2 AA.
>
> **Active profile: zero-cost (ADR-023). UI differences:**
> - **Authentication (§4.2):** "Continue with Google" only.
> - **Pricing:** `/pricing` and `/settings/billing` (§4.14) are hidden. Settings shows a "Free beta" usage card with today's AI budget instead.
> - **Discover and Job details:** may show "AI explanation pending (daily free quota reached)" with deterministic breakdowns.
> - **Automation (§4.12):** visible to the owner only; other users see "Apply manually" with the answer sheet.
> - **Notifications:** in-app only.

## 1. Experience principles
1. **Explain every number.** A score is always one click away from its breakdown.
2. **Never surprise the user with an irreversible action.** Sends and submissions show exactly what will go out, then ask.
3. **Progress over spinners.** Async work (parsing, matching, automation) shows status steps and keeps the page usable.
4. **Opinionated defaults, editable everything.** AI fills in; the user corrects; corrections are sticky.
5. **Calm density.** Dashboard-grade information density on desktop; one primary action per screen on mobile.

## 2. Information architecture & navigation

```
Public (marketing layout)
├── /                     Landing
├── /pricing              Plans
├── /privacy, /terms, /security
Auth (centered card layout)
├── /sign-in  /sign-up  /verify-email  /forgot-password  /reset-password
App (app shell: sidebar + topbar)
├── /onboarding           (stepper, full-screen variant of shell)
├── /dashboard            Overview
├── /discover             Job discovery feed            ?q&minScore&workMode&…  (URL state)
├── /jobs/[id]            Job details + match analysis
├── /saved                Saved jobs
├── /applications         Kanban (default) | list view toggle
├── /applications/[id]    Application detail (timeline)
├── /interviews           Upcoming + past interviews
├── /follow-ups           Reminders (due today / upcoming / done)
├── /resumes              Resume library
├── /resumes/[id]/review  Parsed resume review & corrections
├── /automation           Assisted applications queue (status board)
├── /automation/[taskId]  Review & approve prepared application
├── /settings             Profile & preferences | Account & security | Email accounts | Templates | Notifications | Data & privacy
├── /settings/billing     Subscription management
└── /notifications        Inbox
Admin (role-gated): /admin/sources, /admin/adapters, /admin/users, /admin/taxonomy
```

**Desktop sidebar** (collapsible to icons): Dashboard · Discover · Saved · Applications · Interviews · Follow-ups · Resumes · Automation · ─ · Settings. Badge counts: new matches, due follow-ups, automation awaiting approval.
**Topbar:** global search (⌘K command palette: jump to job/application, quick actions), notifications bell, theme toggle, user menu.
**Mobile (< 768 px):** bottom tab bar with 5 items (Dashboard, Discover, Applications, Follow-ups, More); sidebar becomes a `Sheet`.

## 3. Layouts
| Layout | Used by | Structure |
|---|---|---|
| `MarketingLayout` | public pages | header (logo, Pricing, Sign in, CTA), content, footer |
| `AuthLayout` | auth pages | centered `Card` max-w-sm, brand mark, legal links |
| `AppShell` | app pages | `Sidebar` + `Topbar` + `main` (max-w-screen-2xl, `PageHeader` per page) |
| `FocusLayout` | onboarding, automation review | minimal chrome, stepper/progress, sticky action bar |
| `SplitView` | discover (lg+) | list pane (40%) + detail pane (60%); single pane on mobile with route navigation |

## 4. Screens

### 4.1 Landing page
Hero ("Find jobs that actually fit, and apply with confidence"), three value props (Transparent AI matching, Application tracker, Assisted applying with your approval), animated product screenshot, "How it works" (Upload → Match → Apply → Track), trust section (privacy commitments: we never sell or share your resume; you approve every application), pricing teaser, FAQ, footer. Statically rendered + cached; Lighthouse ≥ 95.

### 4.2 Authentication
Email/password + "Continue with Google / Microsoft". Inline validation, password strength meter, generic error copy, verify-email interstitial with resend (rate-limited countdown). Terms/privacy consent checkbox on sign-up (stored as `UserConsent`).

### 4.3 Onboarding (stepper, 4 steps, skippable after step 2)
1. **Goals:** target titles (tag input with suggestions), seniority, employment types.
2. **Resume:** drag-and-drop upload (PDF/DOCX ≤ 4 MB); live parsing status ("Reading file → Extracting experience → Mapping skills"). Can continue to step 3 while parsing.
3. **Preferences:** locations (city autocomplete + radius), work modes, salary floor + currency + period, relocation, work authorisation, dealbreakers.
4. **Review:** parsed profile summary + top skills (confirm/remove), then "See my matches".

### 4.4 Resume upload & review (`/resumes`, `/resumes/[id]/review`)
- Library: cards per resume (label, primary badge, current version date, parse status), "Upload new version", "Set as primary".
- Review: two columns: left: original document preview (PDF rendered in a sandboxed `<iframe>` from a presigned URL, or extracted text for DOCX); right: editable sections (Contact, Experience timeline, Education, Skills chips with evidence tooltips, Unmapped skills to map/ignore). Version diff banner ("+3 skills, 1 new role since v2").

### 4.5 Candidate dashboard (`/dashboard`)
- KPI row (`StatCard` ×4): New matches (7d), Applications sent, Response rate, Interviews upcoming.
- "Top matches today" (5 `MatchCard`s, horizontal scroll on mobile).
- Pipeline mini-funnel (stage counts, click → Kanban filtered).
- "Due follow-ups" list (complete/snooze inline).
- "Upcoming interviews" (next 3 with prep link).
- "Skills to boost your matches" (top missing skills with lift estimate).
- Automation awaiting approval callout (if any).

### 4.6 Job discovery (`/discover`)
- Filter bar: search, score slider (default ≥ 55), work mode, employment type, location, posted within, has salary, apply channel; "Saved filters" (later). All filters in the URL.
- Results: `MatchCard` list: title, company logo/name, location + work mode badge, salary (or "Not stated"), posted age, **`ScoreBadge`** (band colour + number), 2 top strengths, top gap, apply-channel icons (email / ATS / external), actions: Save, Dismiss (reason menu), Open.
- Split view on desktop: selecting a card opens Job details in the right pane (URL updates to `/jobs/[id]` with intercepting route/parallel route; verify pattern in installed Next docs).
- Empty states: "No resume yet → upload", "Matching in progress" (skeletons + status), "No matches with current filters → relax score/location".
- Infinite scroll with keyset cursor + "Back to top"; marks cards seen when ≥ 50% visible for 1 s.

### 4.7 Job details & AI match results (`/jobs/[id]`)
- Header: title, company, location, salary, posted, source attribution (required by some sources), primary CTA **Apply** (channel-aware: "Apply by email" / "Fill application for me" / "Apply on company site"), Save, Dismiss.
- **Match panel:** large score ring + band label; component bars (Skills, Semantic fit, Experience, Title, Location, Salary) each with a one-line reason; LLM adjustment chip ("+4: strong product-team experience") with tooltip; "How is this calculated?" link → modal with the formula in plain language.
- **Strengths / Gaps** lists with evidence quotes; **Missing skills** chips (required in red outline, preferred in amber) with "appears in N of your top matches".
- Job description (sanitised, collapsible sections: responsibilities, requirements, benefits); company card; similar jobs.
- AI-generated content is labelled with a small "AI" marker and a feedback control (👍/👎 + reason).

### 4.8 Application Kanban (`/applications`)
- Columns: Draft · Applied · Screening · Interviewing · Offer · Closed (Accepted/Rejected/Withdrawn/Ghosted collapsed group with filter).
- `ApplicationCard`: company logo, title, applied date, channel icon, score, next action (follow-up due / interview date), stale indicator (no activity 14 d).
- Drag-and-drop between columns (keyboard accessible: space to lift, arrows to move, `@dnd-kit` sensors) → optimistic update with `useOptimistic`, rollback toast on failure; moving to Interviewing prompts "Add interview details?"; to Rejected prompts optional reason.
- List view toggle (TanStack Table): sortable columns, bulk archive, CSV export.
- Mobile: columns become a segmented control + vertical list; move via card menu.

### 4.9 Application detail (`/applications/[id]`)
Timeline (stage changes, emails sent/received, contact logs, interviews, reminders, automation events) + side panel (job summary, resume version used, cover letter, contacts, notes). Quick actions: log interaction, add interview, set follow-up, generate cover letter, email recruiter.

### 4.10 Interview tracking (`/interviews`)
Upcoming list grouped by day (calendar strip on desktop), each with type, round, time in user TZ, meeting link, prep status. Interview detail sheet: logistics, interviewers, AI prep questions (generate/regenerate, reorder, notes per question), outcome selector, add to calendar (.ics).

### 4.11 Follow-up management (`/follow-ups`)
Tabs: Due/Overdue · Upcoming · Done. Each reminder: title, linked application, due relative time, actions (Done, Snooze 1d/3d/1w/custom, Open application, Draft follow-up email). Settings toggle "Suggest a follow-up 7 days after applying".

### 4.12 Automation (`/automation`, `/automation/[taskId]`)
- Board of tasks by status: Preparing · Needs your review · Submitting · Submitted · Needs manual · Failed. Each with job, ATS, timestamps, reason.
- **Review screen (FocusLayout):** left: field list grouped (Personal, Links, Documents, Questions, Legal/EEO), each field shows label, answer (editable), badges (`AI draft`, `Needs input`, `From profile`); right: screenshot carousel of the filled form; bottom sticky bar: consent checkbox + "Approve & submit" (disabled until all required fields answered and checkbox ticked), "Cancel", "Apply manually instead". Expiry countdown ("Approval valid for 23 h").
- Result states with clear copy, e.g. "We couldn't confirm this submission. Check your inbox for a confirmation from Acme before trying again."

### 4.13 Settings
Sections as tabs (vertical on desktop): **Profile & preferences** (same fields as onboarding), **Account & security** (email, password, 2FA, active sessions, security log), **Email accounts** (connect Gmail/Outlook, status, daily limit, disconnect), **Templates**, **Notifications** (matrix of type × channel, digest frequency), **Data & privacy** (export, delete account with typed confirmation, consent history).

### 4.14 Subscription management (`/settings/billing`)
Current plan card, usage meters (`UsageMeter`: resume parses, explanations, cover letters, automation runs, with reset date), plan comparison table, Upgrade/Downgrade (provider checkout), Manage billing (provider portal), invoices list, cancellation flow with retention-neutral copy.

## 5. Reusable components

| Component | Location | Notes |
|---|---|---|
| shadcn primitives | `src/components/ui/*` | button, input, select, dialog, sheet, dropdown, tabs, tooltip, badge, card, table, skeleton, progress, switch, checkbox, popover, command, calendar, form, sonner (v1 already has 17 of these) |
| `AppShell`, `Sidebar`, `Topbar`, `MobileTabBar` | `components/shared/layout` | sidebar state persisted in cookie |
| `PageHeader` | shared | title, description, actions slot, breadcrumbs (exists in v1) |
| `DataTable` | shared | TanStack Table wrapper: server-driven sorting/pagination via URL |
| `FilterBar` | shared | URL-synced filters (`useSearchParams` + `router.replace`) |
| `EmptyState`, `ErrorState`, `LoadingSkeletons` | shared | consistent illustrations/copy |
| `StatCard`, `UsageMeter`, `MiniFunnel` | shared | dashboard |
| `ScoreBadge`, `ScoreRing`, `ScoreBreakdown` | features/matching | band colours, accessible labels ("Match score 81 of 100, strong match") |
| `MatchCard`, `JobHeader`, `SkillChips`, `MissingSkills` | features/jobs | |
| `KanbanBoard`, `KanbanColumn`, `ApplicationCard` | features/applications | `@dnd-kit` |
| `Timeline` | shared | application & automation history |
| `FileDropzone` | shared | drag/drop, client-side pre-checks (type/size) mirroring server rules |
| `StatusSteps` | shared | async progress (parsing, automation) |
| `AiLabel`, `AiFeedback` | shared | marks AI content, collects feedback |
| `ConfirmDialog`, `TypedConfirmDialog` | shared | destructive actions |
| `CommandPalette` | shared | ⌘K |

## 6. Responsive behaviour
| Breakpoint | Behaviour |
|---|---|
| < 640 (sm) | single column, bottom tab bar, filters in a `Sheet`, Kanban as segmented list, tables → card lists |
| 640–1023 | single column with wider cards; sidebar as sheet |
| ≥ 1024 (lg) | persistent sidebar, Discover split view, Kanban full board with horizontal scroll |
| ≥ 1536 (2xl) | max content width, dashboard 4-column grid |
Touch targets ≥ 44 px; no hover-only affordances; sticky action bars respect safe-area insets.

## 7. Accessibility
WCAG 2.2 AA: colour contrast (score bands never rely on colour alone: label + number), focus-visible rings, skip link, landmark regions, Radix primitives for dialogs/menus, keyboard DnD, `aria-live` for async status updates and toasts, reduced-motion support, form errors linked via `aria-describedby`. Automated checks with `@axe-core/playwright` in E2E (TESTING_STRATEGY §5).

## 8. Visual language
Neutral base (v1 `baseColor: neutral`), one brand accent, semantic tokens (`--success`, `--warning`, `--destructive`, `--info`), score band tokens (`--score-excellent|strong|possible|low`), Inter/Geist font, 4-px spacing grid, radius from v1 tokens, light/dark themes (`next-themes`). Copy tone: plain, encouraging, honest about uncertainty ("We estimate…", "Salary not stated").

## 9. Performance budgets
LCP < 2.5 s (p75, 4G), INP < 200 ms, CLS < 0.1; dashboard initial JS < 200 KB gz; images via `next/image`; heavy client components (Kanban, charts, PDF preview) lazy-loaded.
