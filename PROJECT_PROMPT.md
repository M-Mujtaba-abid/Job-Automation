# Build Prompt: Job Hunt Automation (Next.js + Neon)

You are building a complete, production-ready web app in a **single Next.js project** (frontend + backend together). Read this whole document before writing code. Build it in the phases listed at the end, and run `npm run build` successfully after each phase.

---

## 1. What the app does

1. A **cron job** periodically fetches **LinkedIn and Facebook hiring posts** using **Apify** scrapers. Pakistani hiring posts usually say "send CV to …", "WhatsApp 03xx…" or "apply here: forms.gle/…".
2. Each job is **normalized, de-duplicated and stored** in a Neon Postgres database.
3. While saving, the app **extracts contact methods** from the job text:
   - **Email addresses** → apply by email
   - **Phone numbers** → apply via WhatsApp
   - **Google Form links** → apply via form
4. A dashboard lists jobs with **filters**: All / Has Email / Has WhatsApp / Has Google Form.
5. In the **Email** filter the user can tick jobs (or **Select All**) and click **"Apply via Email"**. A compose window opens, ready to send, with every selected email address already filled in, a template subject and body, and a CV attachment.
6. Jobs with a phone number show a **WhatsApp** button (opens `wa.me` with a prefilled message).
7. Jobs with a Google Form link show an **Apply on Form** button (opens the form in a new tab).
8. Every application is **tracked**, so the user never emails the same job or address twice by mistake.

Single user (the owner). No public signup.

---

## 2. Tech stack (use exactly this)

| Concern | Choice |
|---|---|
| Framework | Latest stable **Next.js, App Router, TypeScript (strict)** |
| Styling/UI | **Tailwind CSS + shadcn/ui**, `lucide-react` icons, `sonner` toasts |
| DB | **Neon Postgres** via `@neondatabase/serverless` |
| ORM / migrations | **Drizzle ORM + drizzle-kit** |
| Validation | **Zod** for every API input and every external API response |
| Tables (UI) | `@tanstack/react-table` for the jobs table with row selection |
| Email sending | **Nodemailer** over SMTP (Gmail App Password works) |
| CV storage | **Vercel Blob** (`@vercel/blob`) |
| Auth | Simple single-user password login: `APP_PASSWORD` env, session stored in an HTTP-only signed JWT cookie (`jose`), checked in `middleware.ts` |
| Hosting | **Vercel** (Vercel Cron) |

Backend logic lives in **Route Handlers** (`app/api/**/route.ts`). Shared logic lives in `lib/`. Don't call the DB from client components.

---

## 3. Folder structure

```
app/
  (auth)/login/page.tsx
  (dashboard)/layout.tsx            # sidebar + topbar
  (dashboard)/jobs/page.tsx         # main jobs table + filters
  (dashboard)/jobs/[id]/page.tsx    # job detail
  (dashboard)/applications/page.tsx # sent history
  (dashboard)/templates/page.tsx    # email templates CRUD
  (dashboard)/sources/page.tsx      # job sources CRUD + "Run now"
  (dashboard)/runs/page.tsx         # fetch run logs
  (dashboard)/settings/page.tsx     # profile, CV upload, WhatsApp message
  api/...                           # see section 6
components/
  jobs/JobsTable.tsx, JobFilters.tsx, BulkActionBar.tsx,
  ComposeEmailDialog.tsx, ContactButtons.tsx
lib/
  db/index.ts, db/schema.ts
  sources/index.ts                  # registry (pluggable, more sources can be added later)
  sources/apify.ts                  # LinkedIn + Facebook actors
  extract/contacts.ts               # email/phone/form extraction
  extract/normalize.ts              # text cleanup, hashing
  ingest.ts                         # fetch → normalize → extract → upsert
  mail/transport.ts, mail/render.ts # nodemailer + template placeholders
  auth.ts                           # jose sign/verify
  env.ts                            # zod-validated env
drizzle/                            # generated migrations
middleware.ts
vercel.json
.env.example
```

---

## 4. Environment variables (`.env.example`)

Validate all of them in `lib/env.ts` with Zod. `BLOB_READ_WRITE_TOKEN` is optional (CV upload is disabled without it). Everything else is required.

```bash
# --- Database (Neon) ---
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require   # pooled, used by app
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require # direct, used by drizzle-kit

# --- App / Auth ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_PASSWORD=choose-a-strong-password
AUTH_SECRET=32+-char-random-string          # signs the session JWT
CRON_SECRET=32+-char-random-string          # protects /api/cron/*

# --- Job source: Apify (required) ---
APIFY_TOKEN=                                # apify.com → Settings → API & Integrations
APIFY_LINKEDIN_ACTOR_ID=                    # e.g. a "LinkedIn posts search" actor id (username~actor-name)
APIFY_FACEBOOK_ACTOR_ID=                    # e.g. a "Facebook groups/posts scraper" actor id
# The two actor ids are only seed defaults; each source row in the DB stores its own actorId + input.

# --- Default search config (overridable per source in DB) ---
DEFAULT_KEYWORDS=react developer,next.js developer,frontend developer
DEFAULT_LOCATION=Pakistan
DEFAULT_COUNTRY_CODE=92                     # used to normalize local phone numbers

# --- Email sending (SMTP) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=gmail-app-password                # Google Account → Security → App passwords
MAIL_FROM="Your Name <you@gmail.com>"
MAIL_DELAY_MS=4000                          # gap between sends to avoid spam flags
MAIL_DAILY_LIMIT=150

# --- Fetch tuning ---
FETCH_MIN_INTERVAL_HOURS=6                  # don't re-run a source more often than this

# --- File storage (CV) ---
BLOB_READ_WRITE_TOKEN=
```

---

## 5. Database tables (Drizzle schema in `lib/db/schema.ts`)

Use `uuid` primary keys (`defaultRandom()`), `timestamp with time zone` with `defaultNow()`, and pgEnums where shown.

### Enums
- `source_type`: `apify_linkedin | apify_facebook | manual` (`manual` is reserved for a future paste-import feature)
- `contact_type`: `email | phone | google_form | other_link`
- `job_status`: `new | saved | applied | hidden`
- `application_channel`: `email | whatsapp | google_form`
- `application_status`: `queued | sending | sent | failed | opened` (`opened` = user clicked the WhatsApp or Form button)
- `run_status`: `running | success | partial | failed`

### `sources`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text not null | e.g. "LinkedIn – React hiring PK" |
| type | source_type | |
| config | jsonb not null | `{ actorId: string, input: Record<string, unknown>, keywords: string[], maxResults?: number }` (`input` is passed to the Apify actor as-is) |
| enabled | boolean default true | |
| last_fetched_at | timestamptz | |
| created_at | timestamptz | |

### `jobs`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| source_id | uuid fk → sources (set null) | |
| external_id | text | id from the provider |
| dedupe_hash | text **unique** not null | sha256 of `lower(title)+lower(company)+canonical url`, or of normalized description when no url |
| title | text not null | |
| company | text | |
| location | text | |
| employment_type | text | |
| is_remote | boolean default false | |
| description | text | plain text (strip HTML) |
| apply_url | text | original post / apply link |
| posted_at | timestamptz | |
| has_email | boolean default false | **indexed**, so filters stay cheap |
| has_phone | boolean default false | indexed |
| has_form | boolean default false | indexed |
| status | job_status default `new` | indexed |
| raw | jsonb | original payload for debugging |
| created_at / updated_at | timestamptz | |

Indexes: `(status, created_at desc)`, `(has_email)`, `(has_phone)`, `(has_form)`, plus a GIN full-text index on `to_tsvector('english', title || ' ' || coalesce(company,'') || ' ' || coalesce(description,''))` for search.

### `job_contacts`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| job_id | uuid fk → jobs (cascade) | |
| type | contact_type | |
| value | text | as found in the text |
| normalized | text | lowercased email / E.164 phone digits / canonical URL |
| created_at | timestamptz | |

Unique: `(job_id, type, normalized)`.

### `applications`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| job_id | uuid fk → jobs (cascade) | |
| contact_id | uuid fk → job_contacts (set null) | |
| channel | application_channel | |
| to_address | text | email / phone / form url |
| subject | text | email only |
| body | text | final rendered body |
| template_id | uuid fk → email_templates (set null) | |
| batch_id | uuid | groups one bulk "Apply" click |
| status | application_status default `queued` | indexed |
| error | text | |
| message_id | text | SMTP message id |
| sent_at | timestamptz | |
| created_at | timestamptz | |

Unique partial index: `(job_id, channel, to_address) WHERE status IN ('queued','sending','sent')`. This blocks double-applying.

### `email_templates`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| subject | text | supports placeholders |
| body | text | supports placeholders |
| is_default | boolean default false | |
| attach_cv | boolean default true | |
| created_at / updated_at | timestamptz | |

Placeholders: `{{job_title}} {{company}} {{location}} {{my_name}} {{my_phone}} {{my_email}} {{portfolio_url}}`. If `company` is empty, `{{company}}` falls back to "your team".

### `fetch_runs`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| source_id | uuid fk → sources (set null) | |
| trigger | text | `cron` or `manual` |
| status | run_status | |
| apify_run_id | text | Apify run id (unique) |
| dataset_id | text | Apify default dataset id |
| fetched_count / inserted_count / duplicate_count | integer default 0 | |
| error | text | |
| started_at / finished_at | timestamptz | |

### `settings` (single row, id = 1)
`full_name, email, phone, portfolio_url, linkedin_url, cv_blob_url, cv_file_name, whatsapp_message_template (text with the same placeholders), updated_at`

Seed script (`npm run db:seed`): one default email template, one default WhatsApp message, and two sources built from `DEFAULT_KEYWORDS`:
- an `apify_linkedin` source using `APIFY_LINKEDIN_ACTOR_ID`, with queries like `"hiring <keyword> send CV"` and `"<keyword> job Pakistan email"`
- an `apify_facebook` source using `APIFY_FACEBOOK_ACTOR_ID`, with job-group URLs left as an editable placeholder

---

## 6. API routes (all in this Next.js app)

Every route except `/api/auth/login`, `/api/cron/*` and `/api/webhooks/*` (these use their own secret) requires a valid session (enforced in `middleware.ts`). Validate all inputs with Zod and return `{ error }` with the right status code.

### Auth
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{ password }` → compare with `APP_PASSWORD` (constant-time) → set cookie |
| POST | `/api/auth/logout` | clear cookie |

### Cron / fetching
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/cron/fetch-jobs` | Called by Vercel Cron and cron-job.org. Require `Authorization: Bearer ${CRON_SECRET}`, otherwise 401. Collects finished runs, starts due Apify runs, cleans up (section 9). `export const maxDuration = 300; export const dynamic = 'force-dynamic'`. |
| POST | `/api/webhooks/apify` | Apify run-finished webhook. Checks `?secret=` against `CRON_SECRET`, then ingests the dataset for `?runId=`. `maxDuration = 300`. |
| POST | `/api/sources/[id]/run` | Manual "Run now" for one source (session auth). Starts the Apify run asynchronously. |
| POST | `/api/runs/[id]/collect` | Manual "Collect" (session auth): if the Apify run has succeeded, ingest its dataset. |

### Jobs
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/jobs` | Query: `filter=all\|email\|phone\|form`, `status`, `q` (full-text), `sourceId`, `from`, `to`, `page`, `pageSize` (max 100), `hideApplied=true`. Returns jobs with their contacts and counts per filter: `{ items, total, counts: { all, email, phone, form } }`. |
| GET | `/api/jobs/ids` | Same filters, returns **only ids + emails** for "select all matching" (across pages). |
| GET | `/api/jobs/[id]` | Job detail with contacts and application history |
| PATCH | `/api/jobs/[id]` | `{ status }` (save / hide / mark applied) |
| POST | `/api/jobs/bulk` | `{ ids, status }` bulk hide/save |

### Applications
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/applications/email/prepare` | `{ jobIds, templateId? }` → returns the compose payload: unique recipients (one entry per email, with the jobs it belongs to), rendered subject/body preview per job, warnings for addresses already emailed in the last 30 days, and the CV filename. |
| POST | `/api/applications/email` | `{ jobIds, subject, body, templateId?, attachCv, mode: 'individual' }` → creates one `queued` application per (job, email) and returns `{ batchId, queued }`. Duplicates are skipped and reported. |
| POST | `/api/applications/email/process` | `{ batchId, limit = 5 }` → sends up to `limit` queued emails, with `MAIL_DELAY_MS` between them, and updates status. The client calls this in a loop until nothing is left, so no single request hits the function timeout. Enforce `MAIL_DAILY_LIMIT`. |
| POST | `/api/applications/track` | `{ jobId, channel: 'whatsapp'\|'google_form', to }` → logs an `opened` application when the user clicks a WhatsApp or Form button. |
| GET | `/api/applications` | Paginated history, filter by channel/status/batch |

### Templates, sources, settings, runs
| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/templates` | list / create |
| PATCH/DELETE | `/api/templates/[id]` | update / delete |
| GET/POST | `/api/sources` | list / create |
| PATCH/DELETE | `/api/sources/[id]` | update / enable-disable / delete |
| GET/PUT | `/api/settings` | profile + WhatsApp template |
| POST | `/api/settings/cv` | multipart upload → Vercel Blob → save URL (PDF only, max 5 MB) |
| GET | `/api/runs` | fetch run logs |
| GET | `/api/stats` | dashboard numbers: new today, with email, with phone, with form, applied this week |

---

## 7. Job source: Apify (`lib/sources/*`)

Apify is the **only** source in v1. Keep the adapter interface and registry so other sources (job board APIs, RSS, manual paste) can be added later without touching the ingest code. Every source implements one interface:

```ts
export interface RawJob {
  externalId?: string; title: string; company?: string; location?: string;
  employmentType?: string; isRemote?: boolean; descriptionHtmlOrText: string;
  applyUrl?: string; postedAt?: Date; raw: unknown;
}
export interface JobSource {
  type: SourceType;
  isConfigured(): boolean;                          // APIFY_TOKEN present
  start(source: Source, runId: string): Promise<{ apifyRunId: string; datasetId: string }>;
  mapItem(item: unknown): RawJob | null;            // null = not a hiring post, skip it
}
```

### Why async (important on Vercel Hobby)
Scraping actors often take 1–5 minutes, and a Vercel function is capped at about 300 s, so **don't** use `run-sync-get-dataset-items` from the cron. Use this flow:

1. **Start**: the cron (or "Run now") creates a `fetch_runs` row (`running`), then calls
   `POST https://api.apify.com/v2/acts/{actorId}/runs?token=APIFY_TOKEN` with `config.input` as the body and an **ad-hoc webhook** (the `webhooks` query param, base64 JSON) for the events `ACTOR.RUN.SUCCEEDED`, `ACTOR.RUN.FAILED` and `ACTOR.RUN.TIMED_OUT`, pointing to
   `${NEXT_PUBLIC_APP_URL}/api/webhooks/apify?secret=${CRON_SECRET}&runId=<fetch_runs.id>`.
   Save `apify_run_id` and `dataset_id` on the `fetch_runs` row. The cron returns immediately.
2. **Ingest**: `POST /api/webhooks/apify` checks the secret, then pages through
   `GET /v2/datasets/{datasetId}/items?clean=true&format=json&offset=&limit=500`, maps each item with `mapItem`, and runs the ingest pipeline (section 8). On a failure event, it marks the run `failed` with the Apify status message.
3. **Fallback collector** (for local dev, where webhooks can't reach localhost, and for missed webhooks): each cron call, and a **"Collect"** button on the Runs page, check `fetch_runs` rows that are still `running`. They call `GET /v2/actor-runs/{apifyRunId}` and ingest any that have `SUCCEEDED`. Ingest must be idempotent (dedupe hash), so double-collecting is harmless.

This uses `fetch_runs.apify_run_id` / `dataset_id` (section 5) and the routes `POST /api/webhooks/apify` and `POST /api/runs/[id]/collect` (section 6).

### Actors
- **LinkedIn** (`apify_linkedin`): a "LinkedIn posts search" actor. Input: search queries built from keywords (`"hiring react developer" "send cv"`, `"react developer" job lahore email`), sorted by date, last 24–72 h, `maxResults` ≈ 50–100.
- **Facebook** (`apify_facebook`): a "Facebook groups / posts scraper" actor. Input: a list of public job-group URLs (Pakistani dev job groups) and the posts-per-group limit.
- Actor ids and input schemas differ between actors. **Don't hard-code an input shape.** The Sources page edits `config.input` as a JSON editor (with a prettified, validated textarea), and `mapItem` reads common field names defensively with Zod `.passthrough()`: text (`text | postText | content | message`), url (`url | postUrl | link`), author (`authorName | author.name | user.name | groupName`), date (`postedAt | date | time | timestamp`), id (`id | postId | urn`).
- **`mapItem` turns a post into a job**:
  - `title` = first non-empty line of the post, truncated to 120 chars. If the post contains a role phrase (`hiring|looking for|required|vacancy` + next ~6 words), use that phrase instead.
  - `company` = author or page name.
  - `description` = full post text.
  - `applyUrl` = post URL.
  - `externalId` = post id.
- **Hiring filter**: skip posts that don't match `/(hiring|vacanc|job|position|opening|required|looking for|join our team|apply|send (your )?cv|resume)/i`. Also skip posts with no contact method *and* no apply-intent keywords, so the DB isn't filled with noise.

Rules:
- Before writing the adapter, check Apify's current API docs (runs, webhooks, datasets) and the chosen actors' input/output docs. Validate responses with Zod.
- A source that fails must not stop the other: start the sources with `Promise.allSettled`, and log any error to that source's `fetch_runs.error`.
- Use a 15 s timeout (`AbortSignal.timeout`) on Apify API calls and one retry with backoff on 429/5xx.
- Show the user the Apify cost and usage note in the README: the free plan gives monthly credits, and scraping actors charge per result, so keep `maxResults` modest.

---

## 8. Ingest pipeline (`lib/ingest.ts`)

For each `RawJob`:

1. **Clean**: strip HTML to plain text (`html-to-text`), collapse whitespace, decode entities.
2. **Hash**: compute `dedupe_hash` (section 5).
3. **Extract contacts** from `title + description + applyUrl` (`lib/extract/contacts.ts`):
   - **Email**: `/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi`, also de-obfuscated forms such as `name [at] domain [dot] com` and `name(at)domain.com`. Lowercase the result. Drop junk like `example.com`, `noreply@`, `no-reply@`, image filenames (`@2x.png`) and the provider's own domains.
   - **Phone**: match Pakistani and international formats, e.g. `03XX-XXXXXXX`, `03XX XXXXXXX`, `+92 3XX XXXXXXX`, `0092...`, `92...`, plus generic `+<country><8-12 digits>`. Normalize to digits-only international form (`03001234567` → `923001234567`) using `DEFAULT_COUNTRY_CODE`. Keep only mobile-looking numbers (PK: `923` + 9 digits). Use `libphonenumber-js` for validation.
   - **Google Form**: `/https?:\/\/(?:docs\.google\.com\/forms\/[^\s"'<>)\]]+|forms\.gle\/[A-Za-z0-9_-]+)/gi`. Canonicalize by stripping trailing punctuation.
   - Deduplicate contacts per job.
4. **Upsert** in a transaction:
   - `insert into jobs ... on conflict (dedupe_hash) do update set updated_at = now()` (don't overwrite `status`), returning id and whether the row was inserted.
   - Insert contacts with `on conflict do nothing`.
   - Set `has_email / has_phone / has_form` from the contacts.
5. Update `fetch_runs` counts and `sources.last_fetched_at`.
6. Optionally skip jobs older than 14 days. A cleanup step during cron sets `hidden` on `new` jobs older than 45 days.

Write unit tests (Vitest) for `contacts.ts` covering at least 15 real-world strings: obfuscated emails, PK numbers with dashes and spaces, `forms.gle` links with trailing `)` or `.`, and false positives.

---

## 9. Cron setup

The target is **Vercel Hobby (free)**, where Vercel Cron runs **at most once per day**.

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/fetch-jobs", "schedule": "0 3 * * *" }
  ]
}
```
- Cron schedules are in **UTC**. `0 3 * * *` = 08:00 Pakistan time.
- Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when the `CRON_SECRET` env var is set in the project. Verify it in the route and return 401 otherwise.
- **More frequent fetching (free)**: on **cron-job.org**, create a job → URL `https://<app>.vercel.app/api/cron/fetch-jobs`, schedule every 6 hours, add the request header `Authorization: Bearer <CRON_SECRET>`. Document this step by step in the README.
- What `/api/cron/fetch-jobs` does on each call:
  1. Collect any finished-but-not-ingested Apify runs (fallback collector, section 7).
  2. Start new Apify runs for enabled sources whose `last_fetched_at` is older than `FETCH_MIN_INTERVAL_HOURS` (env, default 6). This keeps an extra trigger from burning Apify credits.
  3. Clean up old `new` jobs (section 8, step 6).
- No email-queue cron: sending is driven by the compose dialog's `/process` loop (section 6). Leftover `queued` rows show a **Resume sending** button on the Applications page.
- Locally, test it with `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fetch-jobs`, then press **Collect** on the Runs page once the Apify run has finished.
- Prevent overlapping runs: don't start a source if it has a `fetch_runs` row that is `running` and was started less than 30 minutes ago.

---

## 10. UI requirements

### Jobs page (`/jobs`) – the main screen
- **Top stat cards**: New today · With Email · With WhatsApp · With Form · Applied this week.
- **Filter tabs with counts**: `All (n)` · `📧 Email (n)` · `💬 WhatsApp (n)` · `📝 Google Form (n)`. Plus a search box, a source dropdown, a date range, and a "Hide applied" toggle (on by default). Keep filter state in URL search params.
- **Table columns**: checkbox · title + company · location · source · posted (relative time) · contact badges · actions.
- **Per-row action buttons** (`ContactButtons.tsx`, shown only when the contact exists):
  - **Email**: opens the compose dialog for just that job.
  - **WhatsApp** (green): `https://wa.me/<normalized>?text=<encodeURIComponent(rendered whatsapp template)>`, opens in a new tab, and calls `/api/applications/track`. If a job has several numbers, show a small dropdown.
  - **Apply on Form**: opens the Google Form URL in a new tab and calls track.
  - **View post**: opens `apply_url`.
  - Kebab menu: Save, Hide, Mark applied.
- **Selection**:
  - The header checkbox selects every row on the current page. When all are selected, a banner offers *"Select all N matching jobs"*, which uses `/api/jobs/ids`.
  - Checkboxes are enabled only on rows that have an email when the Email filter is active. On other filters, a selected row without an email is ignored for email apply, with a note.
- **Sticky bottom `BulkActionBar`** when the selection is not empty: `"N jobs selected · M unique emails"` → **[Apply via Email]** · [Save] · [Hide] · [Clear].

### Compose dialog (`ComposeEmailDialog.tsx`)
- Opened from **Apply via Email**. It calls `/prepare` and shows:
  - **To**: chips for every unique email (removable). Warnings appear on addresses already contacted.
  - **Template** dropdown → fills Subject and Body. Both are editable, and placeholders are shown as hints.
  - **Attach CV** toggle showing the filename. Send is disabled if a CV is required but not uploaded.
  - **Preview** tab: rendered email for each job (prev/next).
  - **Send**: each recipient gets **their own personalized email** (no CC/BCC exposure). On click: POST `/api/applications/email`, then loop `/process` with a progress bar (`sent / total`, failures listed with errors, cancel button).
  - Secondary **"Open in Gmail instead"** button: builds `https://mail.google.com/mail/?view=cm&fs=1&bcc=<emails>&su=<subject>&body=<body>`, warns if the URL gets longer than about 1,800 chars, and in that case splits it into multiple Gmail windows of ≤ 20 recipients each. Also offer a `mailto:` fallback.
- After sending, the jobs become `applied` and disappear from the list while "Hide applied" is on.

### Other pages
- **Job detail**: full description with extracted contacts highlighted, all contact buttons, application history.
- **Applications**: table of everything sent or opened, filters, retry button for `failed`, **Resume sending** for leftover `queued`.
- **Templates**: CRUD, live preview with sample job data, set default.
- **Sources**: CRUD with fields name, type (LinkedIn/Facebook), actor id, keywords, and the actor `input` as a validated JSON editor. Also an enable toggle, a **Run now** button and last run status.
- **Runs**: log table (status, Apify run link, fetched/inserted/duplicate counts, error) with a **Collect** button on `running` rows.
- **Settings**: profile fields, CV upload (PDF), WhatsApp message template, "Send test email to myself" button.
- Responsive (works on mobile, since the WhatsApp buttons matter there), dark mode, loading skeletons, empty states, and toasts for every action.

---

## 11. Non-functional requirements

- **Security**: secrets are never sent to the client. Escape user content when rendering descriptions (render as text, not HTML). Rate-limit `/api/auth/login` (5 tries per 15 min per IP, stored in DB or in memory). Cookie flags: `httpOnly`, `secure` in prod, `sameSite=lax`.
- **Email deliverability**: send individually, plain text plus a simple HTML version, `MAIL_DELAY_MS` between sends, respect `MAIL_DAILY_LIMIT`, set `replyTo` to the user's email, and never send to the same address for the same job twice.
- **DB**: use the Neon **pooled** URL in the app and the **unpooled** URL in `drizzle.config.ts`. Use the `drizzle-orm/neon-serverless` (WebSocket Pool) driver where transactions are needed and `neon-http` for simple reads, or the Pool everywhere for simplicity.
- **Types**: no `any`. Infer DB types from the Drizzle schema (`$inferSelect`).
- **Errors**: one `lib/api.ts` helper for JSON responses and error handling. Log server errors with context.

---

## 12. Scripts (`package.json`)

```
dev, build, start, lint, test,
db:generate  -> drizzle-kit generate
db:migrate   -> drizzle-kit migrate
db:studio    -> drizzle-kit studio
db:seed      -> tsx lib/db/seed.ts
```

---

## 13. Build phases (do them in order, and keep `npm run build` passing after each)

1. **Setup**: Next.js + Tailwind + shadcn/ui, `lib/env.ts`, Drizzle schema, migrations against Neon, seed script, `.env.example`.
2. **Auth**: login page, JWT cookie, middleware protection.
3. **Extraction + ingest**: `contacts.ts` with Vitest tests, `ingest.ts`. Test it with fixture JSON files holding sample Apify LinkedIn and Facebook items (`tests/fixtures/`).
4. **Apify source**: `lib/sources/apify.ts` (start run + webhook, dataset paging, `mapItem` + hiring filter) for the LinkedIn and Facebook actors, the webhook route, the collect route, the sources page and "Run now".
5. **Cron**: `/api/cron/fetch-jobs` (collect → start due sources → cleanup), overlap lock, `vercel.json`, runs page.
6. **Jobs UI**: table, filter tabs with counts, search, selection, select-all-matching, per-row contact buttons (WhatsApp / Form / Email).
7. **Email apply**: templates CRUD, settings + CV upload, compose dialog, queue + process loop, Gmail/mailto fallback, applications page.
8. **Polish**: stats cards, empty and loading states, mobile layout, README.

## 14. README must include
- Neon setup: create project → copy pooled and direct connection strings → `npm run db:migrate && npm run db:seed`.
- Gmail App Password setup (2FA required) for SMTP.
- Apify: create an account, get the API token, and pick a LinkedIn posts actor and a Facebook groups actor from the Apify Store. Copy each actor's id and example input into the source config. Includes notes on free-plan credits and per-result cost.
- Vercel deploy (Hobby): env vars (set `NEXT_PUBLIC_APP_URL` to the production URL so the Apify webhooks reach it), Blob store, daily cron.
- cron-job.org setup, step by step (URL, every 6 h, `Authorization: Bearer <CRON_SECRET>` header).
- How to test locally: curl the cron, wait for the Apify run, then press **Collect** on the Runs page (webhooks can't reach localhost).

## 15. Done when
- [ ] Cron (or "Run now") starts Apify runs for the LinkedIn and Facebook sources. The webhook (or **Collect**) ingests the results, and collecting the same run again inserts 0 new jobs.
- [ ] A fixture post such as *"Hiring React dev, send CV to hr@acme.pk or WhatsApp 0300-1234567, apply: https://forms.gle/abc123"* is ingested as one job with an email, a phone (`923001234567`) and a form contact (Vitest).
- [ ] Non-hiring posts in the fixtures are skipped.
- [ ] The Email filter shows only jobs that have emails. Select all → Apply via Email opens the compose dialog with every unique address pre-filled, and sending creates `sent` applications and marks the jobs applied.
- [ ] The WhatsApp button opens `wa.me/923001234567?text=...` and the Form button opens the form. Both are logged.
- [ ] Re-applying to the same job and address is blocked with a clear message.
- [ ] All routes except login, cron and webhooks require the session. Cron and webhook calls without the secret return 401.
