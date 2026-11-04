# Job Automation

> **v2 in planning:** this repository is evolving into **JobFinder AI**, a multi-user SaaS for AI job matching, assisted applications and application tracking. Architecture, roadmap and status live in [`plan/`](plan/). Start with [`plan/PROJECT_OVERVIEW.md`](plan/PROJECT_OVERVIEW.md) and [`plan/IMPLEMENTATION_STATUS.md`](plan/IMPLEMENTATION_STATUS.md). Claude Code agents, skills and rules are in [`.claude/`](.claude/). Operational docs are in [`docs/`](docs/).
>
> Everything below documents **v1**, the single-user tool that runs today. It stays functional until v2 reaches parity (Milestone 6).

A single Next.js app that:

1. Fetches LinkedIn and Facebook hiring posts through Apify.
2. Extracts emails, WhatsApp numbers and Google Form links from each post.
3. Stores everything in Neon Postgres.
4. Lets you apply in bulk by email, or apply one job at a time via WhatsApp or a Google Form.

The stack is Next.js 16 (App Router), Drizzle and Neon, Tailwind v4 with shadcn-style components, Nodemailer and Vercel Blob.

---

## 1. Local setup

```bash
npm install
cp .env.example .env.local      # then fill it in (see below)
npm run db:migrate              # creates the tables in Neon
npm run db:seed                 # default email template + 2 starter Apify sources
npm run dev                     # http://localhost:3000
```

Sign in with the `APP_PASSWORD` from your env.

### Neon
1. Go to [console.neon.tech](https://console.neon.tech) and create a project.
2. Open **Connect** and copy two connection strings into `.env.local`:
   - the **pooled** string (its host contains `-pooler`) goes in `DATABASE_URL`
   - the **direct** string goes in `DATABASE_URL_UNPOOLED`. Migrations use this one.

### Secrets
Generate `AUTH_SECRET` and `CRON_SECRET` with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Gmail SMTP (sending emails)
1. Turn on 2-Step Verification for your Google account.
2. Go to **Google Account → Security → App passwords** and create an app password.
3. Set these vars:
   - `SMTP_USER=you@gmail.com`
   - `SMTP_PASS=<the 16-char app password>`
   - `MAIL_FROM="Your Name <you@gmail.com>"`
4. Gmail allows about 500 emails a day. The app also enforces `MAIL_DAILY_LIMIT` (default 150) and waits `MAIL_DELAY_MS` between sends.
5. Check it works with **Settings → Send test email to myself**.

### Apify
1. Create an account at [apify.com](https://apify.com) and copy your token from **Settings → API & Integrations** into `APIFY_TOKEN`.
2. In the [Apify Store](https://apify.com/store), pick:
   - a **LinkedIn posts search** actor
   - a **Facebook groups / posts scraper** actor
3. Copy each actor's id (`username~actor-name`) into `APIFY_LINKEDIN_ACTOR_ID` and `APIFY_FACEBOOK_ACTOR_ID`. This is only needed before you seed.
4. On the **Sources** page, paste each actor's input JSON. Copy it from the actor's *Input* tab on Apify, because field names differ between actors. For Facebook, add real job-group URLs and then enable the source.
5. **Costs:** the free plan gives monthly credits, and most scraping actors charge per result. Keep **Max results** modest (50–100). `FETCH_MIN_INTERVAL_HOURS` (default 6) stops extra cron calls from burning credits.

### CV upload
Upload a PDF (max 4 MB, kept under Vercel's 4.5 MB request limit) under **Settings**.
- It's stored in Neon itself (`cv_file` table, `bytea`), so no extra storage service or token is needed.
- It's private: only a logged-in session can view it, at `/api/settings/cv`.
- It's attached to application emails directly from the database.

---

## 2. How fetching works

```
cron / Run now ──► start Apify run (async, with webhook) ──► fetch_runs row = running
                                                                   │
Apify finishes ──► POST /api/webhooks/apify ──► page through dataset ──► map post → job
                                                                   │
                         extract emails / phones / forms ◄─────────┘
                         dedupe (hash) → upsert jobs + job_contacts
```

- **Why async?** Scrapers often run for 1–5 minutes, longer than a Vercel function is allowed to run.
- **Fallback collector:** every cron call also collects any finished runs whose webhook never arrived.

### Testing locally
Apify webhooks can't reach `localhost`. To test fetching:
1. Press **Run now** on the Sources page.
2. Wait for the run to finish (follow the Apify link on the Runs page).
3. Press **Collect** on the Runs page.

To trigger the cron itself:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fetch-jobs
```

---

## 3. Deploy to Vercel (Hobby / free)

1. Push to GitHub and import the repo in Vercel.
2. Add every variable from `.env.example`. Set `NEXT_PUBLIC_APP_URL` to the production URL (e.g. `https://your-app.vercel.app`), so Apify webhooks reach it.
3. Run `npm run db:migrate && npm run db:seed` once, locally, against the production database.
4. `vercel.json` sets a daily cron, `0 3 * * *`, which is **08:00 Pakistan time** (cron schedules are in UTC). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

### Fetching more often for free (cron-job.org)
The Hobby plan runs crons at most once a day. To fetch every 6 hours:
1. Sign up at [cron-job.org](https://cron-job.org) and click **Create cronjob**.
2. **URL:** `https://your-app.vercel.app/api/cron/fetch-jobs`
3. **Schedule:** every 6 hours.
4. **Advanced → Headers:** add `Authorization` with the value `Bearer <your CRON_SECRET>`.
5. Save. The job history should show `200` responses.

---

## 4. Using it

- **Jobs:** filter tabs (All / Email / WhatsApp / Google Form, each with counts), search, source, status, date range, and "Hide applied".
- **Apply via Email:**
  1. Open the **Email** tab.
  2. Tick jobs, or tick the header checkbox and then **Select all N matching**.
  3. Click **Apply via Email**. The compose window opens with every unique address filled in, the chosen template and your CV.
  4. Click **Send**. Each address gets its own personalized email. If several jobs share an address, they're combined into one email.
  5. **Open in Gmail** (BCC, split into groups of at most 20 recipients) and `mailto:` are available as fallbacks.
- **WhatsApp:** opens `wa.me/<number>` with your WhatsApp message pre-filled (edit it in Settings). The click is logged.
- **Google Form:** opens the form. The click is logged.
- **Double-apply protection:** a job can't be emailed twice at the same address. The compose window also warns you about any address you've emailed in the last 30 days.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest: contact extraction and post → job mapping, using Apify fixtures |
| `npm run typecheck` | `next typegen` then `tsc` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Create a migration after changing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed the template, settings and sources |
