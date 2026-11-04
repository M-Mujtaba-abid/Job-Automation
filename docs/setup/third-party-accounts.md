# Third-party accounts: step-by-step setup (zero-cost profile)

This guide is for the project owner. It explains how to create each free account, which value to copy, and **which environment variable** (env var) it goes into. The project runs in the **zero-cost profile** (`plan/TECHNICAL_DECISIONS.md`, ADR-023): every service here stays on a **free plan**. You never need a credit card for anything in this guide.

- Checked on: **2026-11-04**. Websites change their buttons often. If a button has a different name, look for the closest match. Steps marked **(unverified)** could not be confirmed in the provider's official docs on that date.
- Free limits, model names and data-use terms are in [`free-tier-limits.md`](free-tier-limits.md).
- Env var names come from the v2 block of [`.env.example`](../../.env.example). In that file the v2 lines start with `#` because no code reads them yet. Each milestone turns them on.

> **Golden rules for secrets**
> 1. A secret is any key, password, client secret or connection string. Treat them like your bank PIN.
> 2. Put secrets **only** in `.env.local` (on your PC) and in **Vercel → Environment Variables** (production). Never put them in chat, email, screenshots, GitHub issues, or any committed file.
> 3. Keep a copy in a password manager (for example Bitwarden, which has a free plan). Some secrets, such as Google client secrets, are shown **only once**.
> 4. In `.env.local`, write each value on its own line like `NAME=value`. Don't add a `# comment` on the same line as a real value.
> 5. If a secret leaks, create a new one at the provider, update `.env.local` and Vercel, redeploy, then delete the old one.

---

## Setup checklist

Do these in order. The "Needed by" column shows the first milestone that needs each item (see `plan/DEVELOPMENT_ROADMAP.md`). You can set things up early. Unused env vars do no harm.

| ✔ | Step | Service | Needed by | Env vars |
|---|---|---|---|---|
| [ ] | 1. Create a Neon `dev` branch and copy its two connection strings | [Neon](#1-neon-free-database) | M0 | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| [ ] | 2. Turn on `vector` on the `dev` branch and check its version (≥ 0.7) | [Neon](#16-turn-on-the-vector-extension-and-check-its-version) | M0 (check), M4 (used) | n/a |
| [ ] | 3. Generate local secrets | [Local secrets](#5-secrets-you-generate-on-your-own-pc) | M0 / M1 / M8 | `CRON_SECRET`, `BETTER_AUTH_SECRET`, `ENCRYPTION_MASTER_KEY_V1` |
| [ ] | 4. Check the GitHub repo and Actions limits | [GitHub](#9-github-code-and-free-ci) | M0 | (repo secrets only if CI needs them) |
| [ ] | 5. Create a Sentry Next.js project and copy the DSN | [Sentry](#8-sentry-free-developer-plan) | M0 | `SENTRY_DSN` |
| [ ] | 6. Add v2 env vars in Vercel and redeploy | [Vercel](#7-vercel-hobby-hosting) | M0 | all of the above |
| [ ] | 7. Add a cron-job.org job for `/api/cron/drain` (keep the existing `fetch-jobs` job) | [cron-job.org](#6-cron-joborg-free-scheduler) | M0, once `/api/cron/drain` exists | uses `CRON_SECRET` |
| [ ] | 8. Create a Google Cloud project, consent screen (Testing), and test users | [Google Cloud](#4-google-cloud-project-and-oauth-sign-in--gmail) | M1 | n/a |
| [ ] | 9. Create the Google **sign-in** OAuth client | [Google Cloud](#43-oauth-client-1-google-sign-in) | M1 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_URL` |
| [ ] | 10. Create a Gemini API key | [Google AI Studio](#2-google-ai-studio-gemini-api-key) | M2 (embeddings in M4) | `GEMINI_API_KEY` |
| [ ] | 11. Create a Groq API key | [Groq](#3-groq-api-key) | M2 | `GROQ_API_KEY` |
| [ ] | 12. Check your Apify free credit (legacy, owner only) | [Apify](#10-apify-existing-legacy-owner-only) | already in use (v1); M3 legacy | `APIFY_TOKEN` (existing) |
| [ ] | 13. Turn on the Gmail API and create the **mailbox** OAuth client | [Google Cloud](#44-gmail-api-and-oauth-client-2-mailbox-connection) | M8 | `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` |

---

## 1. Neon (Free): database

**Used for:** the PostgreSQL database. It holds jobs, users, the background-job queue, resume files and AI vectors (`pgvector`).

You already have a Neon project for v1. It uses two connection strings:
- `DATABASE_URL`: the **pooled** string, used by the app. Its host name contains `-pooler`.
- `DATABASE_URL_UNPOOLED`: the **direct** string, used by migrations (database schema changes).

### 1.1 Why a separate `dev` branch?
A Neon **branch** is a full copy of your database that you can change freely. Changes on the copy never touch the original (Neon calls this copy-on-write). v2 development will run migrations and imports. On a `dev` branch, your **live v1 data on the main branch stays safe**.

### 1.2 Create the `dev` branch
Source: [Neon: Manage branches](https://neon.com/docs/manage/branches) (checked 2026-11-04)

1. Go to [console.neon.tech](https://console.neon.tech) and sign in.
2. Click your existing v1 project.
3. In the left sidebar, click **Branches**.
4. Click **New branch**.
5. **Parent branch:** leave it on your main branch (called `main` or `production`).
6. **Branch name:** type `dev`.
7. **What to include:** choose **Current data**. This copies v1's tables and data so we can test the v1 → v2 import. (Choose **Schema only** if you prefer an empty copy. Then tell the developers, because the import can't be tested.)
8. **Important:** find **Automatically delete branch after**. It is **ticked by default with 1 day**. **Untick it.** Otherwise Neon deletes your `dev` branch tomorrow.
9. Click **Create**.

### 1.3 Copy the `dev` branch connection strings
Source: [Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling) (checked 2026-11-04)

1. Click **Connect** at the top of the project page.
2. In the **Connect to your branch** window, set **Branch** to `dev`. Leave **Database** and **Role** on their defaults (the same ones v1 uses).
3. Turn **Connection pooling** **ON**. Copy the string. Its host contains `-pooler`. This is the **pooled** string → `DATABASE_URL`.
4. Turn **Connection pooling** **OFF**. Copy the string again. It has no `-pooler`. This is the **direct** string → `DATABASE_URL_UNPOOLED`.
5. Check that the part starting with `ep-` is **different** from the one in your v1 strings. A different `ep-` means you copied the `dev` branch. The same `ep-` means you copied the live database.

### 1.4 Where to put the strings
| Place | `DATABASE_URL` | `DATABASE_URL_UNPOOLED` |
|---|---|---|
| `.env.local` on your PC (v2 development) | `dev` branch, pooled | `dev` branch, direct |
| Vercel → **Production** | keep the **main** branch strings (live v1/v2 data) | keep the **main** branch strings |
| Vercel → **Preview** | `dev` branch, pooled (so test deployments never touch live data) | `dev` branch, direct |

> ⚠️ Before you run any database command (`npm run db:migrate`, `db:seed`, or any `drizzle-kit` command), check which strings are in `.env.local`. Migrations use `DATABASE_URL_UNPOOLED`. If that points at the main branch, you change live data.

### 1.5 How to check it works
1. In the Neon console left sidebar, open **SQL Editor**. At the top, pick the branch `dev` **(unverified: the exact position of the branch selector)**.
2. Run `SELECT current_database(), version();`. You should see one row.
3. Optional, from the project folder on your PC (Node 20.6+ reads `.env.local` with `--env-file`):
   ```bash
   node --env-file=.env.local -e "import('@neondatabase/serverless').then(async m=>{const sql=m.neon(process.env.DATABASE_URL_UNPOOLED);const r=await sql.query('select version()');console.log('Connected:',r[0].version)})"
   ```
   It should print `Connected: PostgreSQL ...`. (We wrote this command for this project. It was not run as part of this guide.)

### 1.6 Turn on the `vector` extension and check its version
Source: [Neon: pgvector](https://neon.com/docs/extensions/pgvector), [Neon: supported extensions](https://neon.com/docs/extensions/pg-extensions) (checked 2026-11-04)

We store AI vectors as `halfvec(768)`. `halfvec` needs **pgvector 0.7 or newer**.

1. Open **SQL Editor** and select the **`dev`** branch.
2. Run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Check the version:
   ```sql
   SELECT extversion FROM pg_extension WHERE extname = 'vector';
   ```
4. You need **0.7.0 or higher** (for example `0.8.0`). On 2026-11-04 Neon listed pgvector **0.8.0** for Postgres 14–17 and **0.8.6** for Postgres 18. You can see your Postgres version with `SHOW server_version;`.
5. If the version is below 0.7, **don't** fix it yourself. Tell the developers (`database-architect`). Neon's pgvector page doesn't document an upgrade command for an existing installation **(unverified: `ALTER EXTENSION vector UPDATE;`)**.

The extension is set up **per database and per branch**. Turning it on in `dev` doesn't change main. The v2 migrations will include the same `CREATE EXTENSION IF NOT EXISTS vector;` line, so running it now is harmless.

### 1.7 Common mistakes
- Leaving **Automatically delete branch after** ticked, so the branch disappears.
- Mixing up pooled and direct strings. Migrations through the pooler can fail because the pooler doesn't support some session features.
- Copying strings from the main branch instead of `dev`. Compare the `ep-` part.
- Forgetting `?sslmode=require` at the end. Copy the whole string exactly as Neon shows it.

### 1.8 Staying free
- The Free plan is permanent and needs no credit card. Going over a limit **pauses or blocks**; it doesn't bill you. If you run out of compute hours, the database stops until next month. If you go over storage, writes are blocked.
- **All branches share one project allowance** (100 compute-hours a month and 1 GB storage per project). The `dev` branch's compute uses the same pool as live v1. Neon puts a compute to sleep after 5 idle minutes. Close tools such as Drizzle Studio or the SQL Editor when you finish, so `dev` can sleep.
- Keep at most a few branches. The limit is 10 per project.

---

## 2. Google AI Studio: Gemini API key

**Used for:** the main AI provider. Gemini reads resumes and job ads (M2), writes match explanations, and creates the embeddings (number vectors) used for matching (M4).
Sources: [API key](https://aistudio.google.com/docs/api-key), [Billing](https://aistudio.google.com/docs/billing), [Terms](https://aistudio.google.com/docs/terms), [Available regions](https://aistudio.google.com/docs/available-regions) (checked 2026-11-04)

> ⚠️ **Free-tier data-use caveat (read this).** In the Gemini API terms for **Unpaid Services**, Google may use what you send, and what it returns, "to provide, improve, and develop" its products. **Human reviewers may read** API inputs and outputs. The terms also say: "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Our code therefore **removes names, emails, phone numbers, addresses and profile links from resumes before any AI call** (ADR-023), and users can switch AI parsing off. Never test the API with your own real resume or anyone's private data.
>
> Other conditions: you must be **18 or older**. **Pakistan is a supported region** (checked 2026-11-04). The terms allow **only paid services** for apps offered to users in the **EEA, UK or Switzerland**, so the free tier can't serve beta users there.

### Steps
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with your Google account.
2. Accept the Terms of Service if asked. New users get a default project and key automatically.
3. Open the **API Keys** page and click **Create API key**. Pick the default AI Studio project. (To use another Google Cloud project, first open **Dashboard → Projects → Import projects**. We suggest keeping AI Studio in its **own** project with **no billing account**.)
4. Copy the key and save it in your password manager.

### Value → env var
| Value | Env var | Local | Production |
|---|---|---|---|
| API key | `GEMINI_API_KEY` | `.env.local` | Vercel → Production (and Preview if you want AI on previews) |

Model names (`LLM_MODEL_*`, `EMBEDDING_MODEL`) are set later by the developers from [`free-tier-limits.md`](free-tier-limits.md). You don't need to choose them now.

### How to check it works
Run this from the project folder. It reads the key from `.env.local`, so the key never shows on screen:
```bash
node --env-file=.env.local -e "fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY}}).then(r=>console.log('Gemini status:',r.status))"
```
`200` means the key works. `400`, `401` or `403` means the key is wrong or blocked. **(unverified: this models-list address wasn't re-checked on 2026-11-04. Google's docs page shows a test on a newer `interactions` address instead.)** You can also open [aistudio.google.com/usage](https://aistudio.google.com/usage) and watch the request counter go up.

### Common mistakes
- Creating a generic Google Cloud API key instead of creating it in AI Studio. Google says keys must be restricted to the Gemini API, and **unrestricted standard keys are rejected**.
- Putting the key in browser code or a `NEXT_PUBLIC_` variable. It must stay on the server.
- Sending a real resume to "try it out" (see the caveat above).

### Staying free
- A project **without a billing account stays on the Free tier**. Don't click **Upgrade** or link billing. Hitting a free limit only causes temporary errors. It doesn't create charges.
- The Google Cloud $300 trial credit **can't** be used for Gemini API (excluded since March 2026), so it is no reason to add a card.
- You can see your live limits at **AI Studio → Dashboard → Usage** ([aistudio.google.com/usage](https://aistudio.google.com/usage)).

---

## 3. Groq: API key

**Used for:** the backup AI provider. Groq is used when Gemini hits its free limit or fails.
Sources: [Quickstart](https://console.groq.com/docs/quickstart), [API reference](https://console.groq.com/docs/api-reference), [Your data](https://console.groq.com/docs/your-data) (checked 2026-11-04)

### Steps
1. Go to [console.groq.com](https://console.groq.com) and sign up or sign in. A Google sign-in is fine.
2. Open **API Keys** ([console.groq.com/keys](https://console.groq.com/keys)).
3. Click **Create API Key** **(unverified: button label)**, give it a name such as `jobfinder-dev`, and confirm.
4. Copy the key now and save it in your password manager. It may be shown only once **(unverified)**.
5. Recommended: in the console settings, open **Data Controls** and turn on **Zero Data Retention (ZDR)**. Groq says all customers may turn this on. It stops Groq keeping your requests even for abuse checks. We don't use the features it turns off (batch jobs and fine-tuning).

### Value → env var
| Value | Env var | Local | Production |
|---|---|---|---|
| API key | `GROQ_API_KEY` | `.env.local` | Vercel → Production (and Preview if wanted) |

### How to check it works
```bash
node --env-file=.env.local -e "fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY}}).then(r=>console.log('Groq status:',r.status))"
```
`200` = OK. `401` = wrong key.

### Common mistakes
- Mixing up **Groq** (groq.com, this service) with **Grok** (xAI's model, a different company). The plan uses Groq. ADR-023 still lists "Grok vs Groq" as an open question.
- Using a "preview" model in production. Groq says preview models can be removed at short notice.

### Staying free
- Don't upgrade to the **Developer** (pay-as-you-go) plan and don't add a card. Free-plan requests over the limit get a `429 Too Many Requests` error. Our code waits and retries. You aren't charged.
- Check your actual limits at [console.groq.com/settings/limits](https://console.groq.com/settings/limits).

---

## 4. Google Cloud project and OAuth (sign-in + Gmail)

**Used for:** (a) **"Sign in with Google"** for app users (M1), and (b) **connecting a Gmail mailbox** so applications can be emailed from the user's own Gmail (M8). We use **one Google Cloud project** for both. It has one consent screen and two OAuth clients.

Words you'll see:
- **OAuth client:** the app's "ID card" at Google. It is a Client ID (public) plus a Client secret (private).
- **Consent screen:** the Google page that asks the user "Allow JobFinder AI to …?".
- **Redirect URI:** the exact address Google sends the user back to after they agree. It must match **exactly**, character for character.
- **Scope:** one permission, for example "send email".

Sources: [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [Audience / publishing status](https://support.google.com/cloud/answer/15549945), [Manage OAuth clients](https://support.google.com/cloud/answer/15549257), [OAuth 2.0 (refresh-token expiry)](https://developers.google.com/identity/protocols/oauth2), [Enable APIs](https://developers.google.com/workspace/guides/enable-apis), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Better Auth: Google](https://www.better-auth.com/docs/authentication/google), [Create projects](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects) (checked 2026-11-04)

### 4.1 Create the project
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account that will own the app.
2. Open the **Manage resources** page ([console.cloud.google.com/cloud-resource-manager](https://console.cloud.google.com/cloud-resource-manager)) and click **Create project**.
3. **Project name:** `JobFinder AI`. Leave **billing account** empty if it is offered. **Parent resource:** **No organization** is fine.
4. Click **Create**. Make sure the new project is selected in the project picker at the top.

### 4.2 Consent screen in **Testing** mode, plus test users
1. Open **Menu ☰ → Google Auth platform → Branding**.
2. If you see "Google Auth platform not configured yet", click **Get Started**.
3. **App Information:** App name `JobFinder AI`, **User support email** = your email → **Next**.
4. **Audience:** choose **External** → **Next**.
5. **Contact Information:** your email → **Next**.
6. **Finish:** tick **I agree to the Google API Services: User Data Policy** → **Continue** → **Create**.
7. Go to **Audience**. Check that **Publishing status** says **Testing**. **Don't** click **Publish app**.
8. Under **Test users**, click **Add users**. Add your own Gmail address and each beta tester's address, then click **Save**.

### 4.3 OAuth client 1: Google sign-in
1. Go to **Google Auth platform → Clients** → **Create client**.
2. **Application type:** **Web application**. **Name:** `JobFinder sign-in`.
3. **Authorized JavaScript origins:** add `http://localhost:3000` and `https://<your-app>.vercel.app`. These are optional for our server-side flow, but harmless.
4. **Authorized redirect URIs:** add both, exactly:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-app>.vercel.app/api/auth/callback/google`
   (Replace `<your-app>` with your real Vercel subdomain. No slash at the end.)
5. Click **Create**.
6. **Copy the Client secret now.** Google shows the full secret **only once**. Later it shows only the last 4 characters. If you lose it, use the client's secret rotation to make a new one.
7. Copy the **Client ID** too.

| Value | Env var | Local | Production |
|---|---|---|---|
| Client ID | `GOOGLE_CLIENT_ID` | `.env.local` | Vercel → Production |
| Client secret | `GOOGLE_CLIENT_SECRET` | `.env.local` | Vercel → Production |
| App base URL | `BETTER_AUTH_URL` | `http://localhost:3000` | `https://<your-app>.vercel.app` |

### 4.4 Gmail API and OAuth client 2: mailbox connection
1. Open **Menu ☰ → APIs & Services → Library → Google Workspace → Gmail API** → click **Enable**.
2. Go to **Google Auth platform → Data Access** → **Add or Remove Scopes**. Tick `https://www.googleapis.com/auth/gmail.send` ("Send email on your behalf"). Google classes it as a **sensitive** scope. Click **Save**. Add **no other Gmail scopes**: no read, modify or full access.
3. Go to **Clients** → **Create client** → **Web application**. Name it `JobFinder Gmail`.
4. **Authorized redirect URIs**, exactly:
   - `http://localhost:3000/api/integrations/mail/gmail/callback`
   - `https://<your-app>.vercel.app/api/integrations/mail/gmail/callback`
5. Click **Create**. Copy the **Client secret** (shown only once) and the **Client ID**.

| Value | Env var | Local | Production |
|---|---|---|---|
| Client ID | `GMAIL_OAUTH_CLIENT_ID` | `.env.local` | Vercel → Production |
| Client secret | `GMAIL_OAUTH_CLIENT_SECRET` | `.env.local` | Vercel → Production |

**Separate client or the same one?** We recommend **separate clients**, as above.

| | Separate clients (recommended) | One shared client |
|---|---|---|
| Matches the plan | Yes: `SECURITY_DESIGN.md` §7 keeps mailbox OAuth "separate from sign-in OAuth", and `.env.example` has separate variables | Needs both env pairs set to the same values |
| If a secret leaks or you rotate it | Only one feature is affected | Sign-in **and** Gmail break together |
| Google's limit of 100 refresh tokens per Google account per client | Counted separately | Shared by both features |
| Work | One more client to create and store | Slightly less setup |
| What stays shared anyway | The project, the consent screen, the app name and the **test-user list** are per project, so both clients use them | same |

### 4.5 Testing-mode limits (important)
- **Only listed test users can sign in or connect Gmail.** That includes beta users, so every beta tester must be added under **Audience → Test users**. The maximum is **100 test users** per project.
- Test users see a "Google hasn't verified this app" style warning before they agree. That is expected in Testing mode.
- **Gmail connections expire after about 7 days.** In Testing mode, Google issues refresh tokens that expire after 7 days. (A refresh token is the long-lived pass that lets the app keep sending without asking again.) The app will mark the mailbox "reconnect needed", and the user clicks **Reconnect**. Sign-in only asks for basic profile scopes (`openid`, email, profile), which Google exempts from the 7-day rule.
- Changes to clients and redirect URIs can take **5 minutes to a few hours** to start working.

### 4.6 How to check it works
- Before M1 code exists, check that your clients appear under **Google Auth platform → Clients** with the right redirect URIs, and that **Audience** shows **Testing** with your email as a test user.
- After M1: run `npm run dev`, open `http://localhost:3000`, click **Sign in with Google**, and sign in with a test-user account. A non-test account should be refused.
- After M8: in the app's settings, connect Gmail and send a test email to yourself.

### 4.7 Common mistakes
- `redirect_uri_mismatch` error: the URI in Google doesn't **exactly** match. Check `http` vs `https`, `localhost` vs `127.0.0.1`, the port `3000`, a slash at the end, or a typo in `<your-app>`.
- Vercel **preview** links (`…-git-branch-….vercel.app`) aren't in the list, so Google sign-in won't work on previews. Test sign-in on localhost or production.
- Clicking **Publish app**: with the sensitive `gmail.send` scope, Google may require app verification.
- Forgetting to add a beta tester as a test user. They get an "access blocked" style error.
- Losing the client secret (shown only once). Save it in your password manager straight away.

### 4.8 Staying free
OAuth and the Gmail API cost nothing for normal use, and no billing account is needed. The Gmail API quota is very large (see `free-tier-limits.md`). The real limit is **Gmail's own sending limit** for a normal Gmail account, about **500 emails per day**. The app also has its own daily cap.

---

## 5. Secrets you generate on your own PC

These aren't from any website. You make random values yourself. Run each command in a terminal (PowerShell, Command Prompt or Git Bash) from any folder. Each run prints a new random value. Copy it straight into `.env.local` and your password manager.

| Env var | Needed by | Command | Notes |
|---|---|---|---|
| `CRON_SECRET` | already used by v1; M0 for `/api/cron/drain` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | **v1 already has one** in `.env.local` and Vercel. Keep using it. Making a new one means also updating cron-job.org and Vercel. |
| `BETTER_AUTH_SECRET` | M1 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Signs login sessions. Changing it logs everyone out. Use a **different** value in production than locally. This is **not** v1's `AUTH_SECRET`; both exist for a while. |
| `ENCRYPTION_MASTER_KEY_V1` | M8 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | 32 random bytes in **base64**. It encrypts connected Gmail tokens. **Never change or lose it** after Gmail accounts are connected. If you do, every user must reconnect. A future key change will use a new name (`..._V2`). Use a different value in production than locally. |
| `WEBHOOK_SECRET_APIFY` | M3 (legacy Apify) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Only when the developers move the Apify webhook to the new signature check. |

**Where:** `.env.local` locally. Vercel → **Production** (and **Preview** if you use previews) with **separate** values.
**Check:** each value should be 64 characters (hex) or 44 characters ending in `=` (base64), with no spaces or quotes around it.
**Common mistake:** running the command once and pasting the same value into every variable. Each variable needs its own value.

---

## 6. cron-job.org: free scheduler

**Used for:** calling our app on a timer so background work runs. Vercel Hobby can only run its own cron **once per day**. cron-job.org is free and can call a URL as often as once per minute.
Source: [cron-job.org FAQ](https://cron-job.org/en/faq/) (checked 2026-11-04). The console button names below come from the v1 `README.md` and **weren't re-checked** against cron-job.org docs **(unverified)**.

You already have a job for v1 that calls `/api/cron/fetch-jobs`. **Keep it.** Add a second job for v2's `/api/cron/drain` once that endpoint is deployed (Milestone 0).

### Steps (new `drain` job)
1. Sign in at [cron-job.org](https://cron-job.org) and click **Create cronjob**.
2. **Title:** `JobFinder drain`.
3. **URL:** `https://<your-app>.vercel.app/api/cron/drain`
4. **Schedule:** **every 10 minutes** (custom: minutes `*/10`). Read the Neon warning below first.
5. **Advanced → Request method:** `GET`.
6. **Advanced → Headers:** add a header with key `Authorization` and value `Bearer <your CRON_SECRET>`. That is the word `Bearer`, one space, then the secret.
7. Turn on email notifications for failures, if offered **(unverified: option name)**.
8. Save. Use **Test run** if it is offered.

| Job | URL | Schedule | Header |
|---|---|---|---|
| v1 (existing) | `https://<your-app>.vercel.app/api/cron/fetch-jobs` | every 6 hours | `Authorization: Bearer <CRON_SECRET>` |
| v2 (new) | `https://<your-app>.vercel.app/api/cron/drain` | every 10 minutes | `Authorization: Bearer <CRON_SECRET>` |

> ⚠️ **Neon compute warning.** Each drain call wakes the Neon database, and Neon sleeps only after **5 idle minutes**. With a call every 10 minutes the database is awake roughly half of every hour, about 360–450 hours a month. Neon Free gives **100 compute-hours a month**, about **400 hours** at the smallest size, shared with v1 and the `dev` branch. Every 10 minutes may use up the month's allowance, and then the **database stops until next month**. Every **15 minutes** (`*/15`) is the safer choice. Watch **Neon → Billing/Usage** in the first week. This choice is yours (see the report).

### Value → env var
No new value. It uses `CRON_SECRET` (the same value as in Vercel).

### How to check it works
- The job's **history** should show `200` responses.
- `401` means the header is wrong: a missing `Bearer `, an extra space, or an old secret.
- `404` means the drain endpoint isn't deployed yet. This is normal before Milestone 0 is finished; pause the job until then.
- A **timeout** means the endpoint took longer than **30 seconds**. cron-job.org gives up after 30 seconds. Tell the developers (see below).

### Common mistakes
- Pasting the secret without the word `Bearer `.
- Using the localhost address. cron-job.org can only reach the public `vercel.app` address.
- Ignoring failures: cron-job.org **automatically disables a job after more than 25 failures in a row**.

### Staying free
cron-job.org says it is "entirely free of charge". Free jobs time out after 30 seconds, can run at most once per minute, and read at most 64 KB of the response.

---

## 7. Vercel (Hobby): hosting

**Used for:** running the website and its API routes. v1 is already deployed here.
Sources: [Hobby plan](https://vercel.com/docs/plans/hobby), [Managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), [Environment variables](https://vercel.com/docs/environment-variables), [Managing deployments](https://vercel.com/docs/deployments/managing-deployments), [Runtime logs](https://vercel.com/docs/logs/runtime), [Cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) (checked 2026-11-04)

> **Hobby is for personal, non-commercial use only.** You can't charge money or run ads on a Hobby project. That is why billing (Milestone 11) is deferred.

### 7.1 Add env vars (per environment)
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) and click your project.
2. Open **Settings → Environment Variables** in the sidebar.
3. **Name:** type the exact env var name, for example `GEMINI_API_KEY`.
4. **Value:** paste the value. For secrets, choose the **Secret** type. A Secret value can't be read back after saving; the other type is **Config**.
5. **Environments:** tick where it applies:
   - **Production:** the live site. Use main-branch Neon strings and production secrets.
   - **Preview:** test deployments from other git branches. Use the `dev` Neon strings and separate secrets.
   - **Development:** only for `vercel dev` / `vercel env pull`. We use `.env.local` instead, so leave it unticked.
6. Click **Save**. Repeat for each variable.

### 7.2 Redeploy (env changes don't apply until you do)
Vercel applies env var changes **only to new deployments**.
1. Open **Deployments** in the sidebar.
2. On the latest production deployment, click the **⋯** menu → **Redeploy**.
3. In **Redeploy to Production**, click **Redeploy**. Using the existing build cache is fine.

### 7.3 Where to see logs
- **Logs** in the project sidebar shows runtime logs (each request, errors, `console.log`). You can filter by status, route, and level (Warning, Error, Fatal), and turn on **Live mode**.
- **Hobby keeps only 1 hour of logs.** Check right after a problem, or use Sentry for lasting error records.
- Build logs open from the deployment itself (click the deployment).

### 7.4 How to check it works
After redeploying, open `https://<your-app>.vercel.app`. Under **Logs**, look for errors that mention a missing variable. Later milestones validate env vars at startup and name any that are missing.

### 7.5 Common mistakes
- Adding a variable but not redeploying.
- Ticking only **Preview**, or only **Production**, when both need the value.
- Quotes or spaces around pasted values.
- Setting `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL` to `localhost` in Production. Use the `https://<your-app>.vercel.app` address.
- Putting the Vercel daily cron schedule at more than once per day. Hobby rejects that deployment.

### 7.6 Staying free
- Never click **Upgrade** or start the **Pro trial**.
- If Hobby's monthly limits run out, Vercel **pauses** the feature, usually until 30 days have passed. It doesn't bill you.
- Hobby cron runs **once per day**, at some point within the chosen hour. That is why cron-job.org does the frequent calls.

---

## 8. Sentry (free Developer plan)

**Used for:** catching errors in production with stack traces, kept for longer than Vercel's 1-hour logs.
Sources: [Sentry pricing](https://sentry.io/pricing/), [DSN explainer](https://docs.sentry.io/concepts/key-terms/dsn-explainer/), [Next.js guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/) (checked 2026-11-04)

### Steps
1. Sign up at [sentry.io](https://sentry.io) and choose the **Developer** plan (free, one user). If Sentry starts a trial of a paid plan, **don't enter a card**. **(unverified: whether a new account starts a 14-day Business trial and then moves to Developer automatically.)**
2. Create an organization if asked. Any name works.
3. **Create project** → platform **Next.js** → name `jobfinder` → **Create project** **(unverified: exact labels)**.
4. Sentry shows setup instructions with a **DSN**, a URL like `https://<key>@o<number>.ingest.sentry.io/<number>`. Copy it. You can find it again under the project's **Settings → Client Keys (DSN)**.
5. **Don't run** the `npx @sentry/wizard` command yourself. It changes code; the developers (`backend-specialist`) will add Sentry in M0.

| Value | Env var | Local | Production |
|---|---|---|---|
| DSN | `SENTRY_DSN` | optional in `.env.local` (usually leave it empty locally so dev errors don't use the quota) | Vercel → Production |
| Log level | `LOG_LEVEL` | `info` | `info` |

The DSN isn't a real secret. Sentry says DSNs "are safe to keep public because they only allow submission of new events". Still keep it in env vars, not in code.

### How to check it works
After the developers add Sentry, they will provide a test-error route. Trigger it, then check that the error appears under **Issues** in Sentry within a minute.

### Common mistakes
- Picking the wrong platform. It must be **Next.js**, so both server and browser errors are captured.
- Sending local development errors to Sentry and using up the monthly quota.

### Staying free
The Developer plan is free "forever": 5,000 errors a month, 1 user, 30 days of history. Over the quota, extra events are **not accepted** (dropped), not billed. Our code samples and scrubs personal data before sending.

---

## 9. GitHub: code and free CI

**Used for:** storing the code (Vercel deploys from it) and running automatic checks (GitHub Actions CI: lint, type check, tests).
Sources: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) (checked 2026-11-04)

### Steps
1. If v1 is already in a GitHub repo connected to Vercel, **keep using that repo**. Skip to step 3.
2. Otherwise: on [github.com](https://github.com), click **+ → New repository**. Name it `jobfinder-ai`. Choose **Private**. Don't add a README, `.gitignore` or licence (the project has them). Click **Create repository**. Ask the developers to push the code, then import the repo in Vercel (**Add New → Project**).
3. Check that `.env.local` is **never** committed. The project's `.gitignore` already ignores `.env` and `.env*.local`.

### Repo secrets (only if CI needs them)
Our CI should run tests against a throwaway Postgres container, so it needs **no** real secrets. Add one only if a developer asks for a specific name:
1. Open the repo → **Settings** → **Secrets and variables** → **Actions**.
2. **Secrets** tab → **New repository secret**.
3. Enter the **Name** the developer gave you and paste the **Secret** → **Add secret**.

Never put production database strings, OAuth secrets or `ENCRYPTION_MASTER_KEY_V1` into CI.

### How to check it works
After the developers add the CI workflow, open the **Actions** tab. Each push shows a run with a green tick (pass) or red cross (fail).

### Staying free
- **Public** repos: standard GitHub runners are free and don't use your allowance.
- **Private** repos on GitHub Free: **$12 of compute a month** is included. That is about 2,000 minutes on Linux (our estimate from GitHub's $0.006/min price). It also includes 500 MB of artifact storage. Windows runners cost about 1.7× and macOS about 10× per minute, so CI uses Linux only.
- With **no payment method** on file, Actions simply **stops** when the allowance is used up. Don't add a card.
- The plan keeps slow end-to-end tests **nightly**, not on every push, to save minutes.

---

## 10. Apify (existing, legacy, owner only)

**Used for:** v1's LinkedIn and Facebook post search (`APIFY_TOKEN`). In v2 it is kept **only for your own legacy sources**. Other users get free public job APIs instead.
Source: [Apify pricing](https://apify.com/pricing) (checked 2026-11-04)

- Nothing new to create. Your existing `APIFY_TOKEN` stays in `.env.local` and Vercel (from **apify.com → Settings → API & Integrations**).
- **Free plan: $5 of platform usage per month**, no card needed. When it runs out, Apify **blocks runs until the next billing cycle**; free users aren't charged extra.
- Check your usage in the Apify console's billing or usage page **(unverified: exact menu label)**. If fetching stops mid-month, the credit is probably used up. Fetch less often (v1's `FETCH_MIN_INTERVAL_HOURS`) or use fewer keywords.
- Later (M3), the developers will ask for `WEBHOOK_SECRET_APIFY` (see [section 5](#5-secrets-you-generate-on-your-own-pc)).
