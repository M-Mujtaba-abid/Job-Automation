# Free-tier limits, models and data-use terms

The project runs in the **zero-cost profile** (`plan/TECHNICAL_DECISIONS.md`, ADR-023). This page records the **current** free limits of each service, so the developers can put them in config, set budgets **below** them, and design around them. Code must read limits from config and never hard-code them.

- **Checked on: 2026-11-04** (all rows unless noted).
- **(unverified)** means the official source didn't state the value, or we couldn't confirm it. Don't treat it as fact. Check it in the provider's console.
- Providers change free tiers often. Re-check before each milestone that depends on a service, and update the "Checked on" date.
- How to create each account: [`third-party-accounts.md`](third-party-accounts.md).

---

## 1. Google Gemini API (AI Studio): free tier

Sources: [Rate limits](https://aistudio.google.com/docs/rate-limits) · [Models](https://aistudio.google.com/docs/models) · [Pricing](https://aistudio.google.com/docs/pricing) · [Embeddings](https://aistudio.google.com/docs/embeddings) · [Billing](https://aistudio.google.com/docs/billing) · [Terms](https://aistudio.google.com/docs/terms) · [Available regions](https://aistudio.google.com/docs/available-regions). The old `ai.google.dev/gemini-api/docs/*` URLs now redirect to `aistudio.google.com/docs/*`.

### 1.1 Limits
| Limit | Free tier value | Source / note |
|---|---|---|
| Requests per minute (RPM) per model | **(unverified)**: not published on the docs page | The rate-limits page says only "View your active rate limits in AI Studio". It also says limits "are not guaranteed and actual capacity may vary". Read the real numbers at [aistudio.google.com/usage](https://aistudio.google.com/usage) and record them here. |
| Tokens per minute (TPM) per model | **(unverified)**: shown only in AI Studio | same |
| Requests per day (RPD) per model | **(unverified)**: shown only in AI Studio | same. Set `LLM_DAILY_BUDGET_GEMINI` below the RPD shown for the chosen model. |
| Who gets the free tier | Projects with **no billing account** stay on Free | Billing page: "New accounts begin on the Free Tier". Unlinking billing returns a project to Free. |
| Charges on the free tier | None: failed requests aren't billed, but they count against quota | Billing page |
| $300 Google Cloud trial credit | **Can't** pay for Gemini API (excluded since March 2026) | Billing page |
| Error when over the limit | `429` expected **(unverified)**: the billing and rate-limit pages don't name the error code | Code must handle `429` and retry hints anyway (ADR-023). |
| Max embedding input | 8,192 tokens per input | Embeddings page |
| Region | **Pakistan is supported** | Available-regions page |
| Age | Users of the API must be **18+** | Terms |

### 1.2 Current free-tier models (from the Models and Pricing pages)
| Use | Model ID | Status on Models page | Free tier? | Note |
|---|---|---|---|---|
| LLM: high-volume extraction (job parsing) | `gemini-3.5-flash-lite` | Stable | Free of charge | "Fastest, most cost-effective 3.5 model". Good default for `LLM_MODEL_JOB_EXTRACT`. |
| LLM: resume extraction, match explanations | `gemini-3.6-flash` | Stable | Free of charge | Stable Flash model. Candidate for `LLM_MODEL_RESUME_EXTRACT` and `LLM_MODEL_MATCH_EXPLAIN`. |
| LLM: newest Flash | `gemini-3.8-flash` | "New" (not marked Stable) | Free of charge | Promising, but not yet labelled Stable. Evaluate before relying on it. |
| LLM: cheap multimodal | `gemini-3.1-flash-lite` | Stable | Free of charge | Alternative lite model |
| **Avoid** | `gemini-2.5-flash`, `gemini-2.5-pro` | Deprecated: routed to `gemini-3.5-flash-lite` and `gemini-3.8-flash` on **2026-12-01** | Free of charge (for now) | Don't build on these. |
| **Not free** | `gemini-4-argon`, `gemini-3.1-pro-preview` | Flagship / preview | Not available on Free | |
| **Embeddings (recommended)** | `gemini-embedding-2` | Recommended in the Embeddings guide | Free of charge | Default size 3072. Supports **`outputDimensionality`** (JS, inside `config`) from 128 to 3072, with **768 a recommended size**. It **normalizes shortened vectors automatically**. It has **no `taskType`**: put the task in the text instead, e.g. `task: search result \| query: {text}` for queries and `title: {title} \| text: {text}` for documents. |
| Embeddings (older) | `gemini-embedding-001` | Available (text only) | Free of charge | Supports `outputDimensionality` and `task_type` (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`). For sizes other than 3072 **you must normalize the vectors yourself**. |

> Vectors from `gemini-embedding-2` and `gemini-embedding-001` **can't be compared with each other**. Switching models later means re-embedding every job and profile. Pick one before M4 and keep `EMBEDDING_MODEL` and `EMBEDDING_DIM=768` fixed.

Other details from the docs: Batch API embeddings cost 50% of the normal price, but that applies only to paid use. The docs' sample request uses a new `POST /v1beta/interactions` address with an `Api-Revision` header. The `ai-engineer` should check which API surface the SDK version uses.

### 1.3 Data use and retention (Unpaid Services)
| Topic | Term (quoted from the Gemini API Additional Terms, effective 2026-03-23) |
|---|---|
| Use of your data | "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop" its products. The Pricing page marks "Used to improve our products" as **Yes** on Free and **No** on Paid for every free model. |
| Human review | "human reviewers may read, annotate, and process your API input and output." |
| Sensitive data | "Do not submit sensitive, confidential, or personal information to the Unpaid Services." |
| Retention period | **(unverified)**: the terms don't state a retention period for unpaid-tier prompts. |
| EEA / UK / Switzerland | "You may use only Paid Services when making API Clients available to users in the European Economic Area" (also Switzerland and the UK). |
| Our safeguard | PII redaction before every call, AI parsing can be turned off, no other users' data in prompts (ADR-023, `SECURITY_DESIGN.md` §17). |

---

## 2. Groq: Free plan

Sources: [Rate limits](https://console.groq.com/docs/rate-limits) · [Models](https://console.groq.com/docs/models) · [Structured outputs](https://console.groq.com/docs/structured-outputs) · [Your data](https://console.groq.com/docs/your-data) · [Privacy policy](https://groq.com/privacy-policy)

### 2.1 Limits
The official rate-limits page has "Free Plan Limits" and "Developer Plan Limits" tabs, but the fetched text showed **one table**, with the note "the limits shown below are the base limits for the Developer plan". So we **can't confirm** that the numbers below are Free-plan numbers. Treat them as **(unverified for Free)** and read the real values at [console.groq.com/settings/limits](https://console.groq.com/settings/limits). An unofficial tracker reports the same numbers for the free tier.

| Model ID | RPM | RPD | TPM | TPD | Status |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | 30 | 1K | 8K | 200K | **(unverified for Free)** |
| `openai/gpt-oss-20b` | 30 | 1K | 8K | 200K | **(unverified for Free)** |
| `qwen/qwen3.8-27b` (preview) | 30 | 1K | 8K | 200K | **(unverified for Free)** |
| `llama-3.3-70b-versatile` | n/a | n/a | n/a | n/a | **(unverified)**: production model, but not listed on the rate-limits page |
| `llama-3.1-8b-instant` | n/a | n/a | n/a | n/a | **(unverified)**: production model, but not listed on the rate-limits page |

| Other limit | Value | Source |
|---|---|---|
| Limits apply per | organization, per model **(unverified: from a third-party article)** | n/a |
| Over the limit | `429 Too Many Requests` with a `retry-after` header (in seconds) | Rate-limits page |
| Charges on Free | None stated. Paying needs an upgrade to the Developer plan. | Rate-limits page (upgrade text) |

### 2.2 Good JSON-capable models (for the fallback)
| Model ID | Models page | Structured outputs | Note |
|---|---|---|---|
| `openai/gpt-oss-120b` | **Production** | **Strict** `json_schema` (`strict: true`) | Best fallback choice for `LLM_MODEL_FALLBACK` |
| `openai/gpt-oss-20b` | **Production** | **Strict** `json_schema` | Smaller and faster alternative |
| `qwen/qwen3.8-27b` | Preview | Strict `json_schema` | Groq says preview models "should not be used in production" |
| `meta-models/muse-spark-open` | Preview | Strict `json_schema` | same |
| `llama-3.3-70b-versatile` | Production | JSON object mode only (valid JSON, no schema guarantee) | Validate with Zod (we do anyway) |

JSON object mode (`response_format: { "type": "json_object" }`) works on all models but doesn't enforce a schema.

### 2.3 Data use and retention
| Topic | Term |
|---|---|
| Retention (inference) | "By default, Groq does not retain customer data for inference requests." It may keep logs for troubleshooting or abuse checks for **up to 30 days**. |
| Zero Data Retention | "All customers may enable Zero Data Retention (ZDR)" in **Data Controls**. Recommended for us. It disables batch and fine-tuning, which we don't use. |
| Training on your data | **(unverified)**: neither the data page nor the privacy policy says. API data is covered by the Groq Services Agreement and DPA, which we didn't read. |
| Free vs paid difference | **(unverified)**: the data page says "All customers" and mentions no free-tier difference. |

---

## 3. Neon: Free plan

Sources: [Plans](https://neon.com/docs/introduction/plans) (page last updated 2026-10-23) · [Pricing](https://neon.com/pricing) · [pgvector](https://neon.com/docs/extensions/pgvector) · [Extensions](https://neon.com/docs/extensions/pg-extensions) · [Branches](https://neon.com/docs/manage/branches)

| Limit | Free value |
|---|---|
| Storage | **1 GB per project** (20 GB total across all projects) |
| Compute | **100 CU-hours per project per month**, enough for a 0.25 CU compute for about **400 hours** a month. **All branches' computes share this.** |
| Compute size | up to 2 CU (8 GB RAM), autoscaling. Smallest size listed is 0.25 CU. |
| Scale to zero | Sleeps after **5 minutes** idle. You can't turn this off on Free. |
| Branches | 10 per project. A new branch is **auto-deleted after 1 day by default** unless you untick the option. |
| Projects | 100 |
| Restore history | 6 hours (up to 1 GB of change history) |
| Network egress | 5 GB per project per month |
| Over a limit | Compute or egress runs out: **compute suspended until next month**. Storage full: **writes blocked**. No data is deleted, nothing is billed. |
| Credit card | **Not required** ("permanent (not a trial); no credit card required") |
| pgvector | 0.8.0 on Postgres 14–17, 0.8.6 on Postgres 18. `halfvec` is supported (needs ≥ 0.7). |
| Data use / retention | Your database. Neon encrypts it at rest (`SECURITY_DESIGN.md` §6). Neon's processing terms weren't reviewed **(unverified)**. |

> **Plan mismatch:** ADR-023 assumes "≈0.5 GB" of storage. The current Free limit is **1 GB per project**. The 70% storage alert should read the limit from config.
> **Compute risk:** a `/api/cron/drain` call every 10 minutes keeps the database awake about half the time (it sleeps only after 5 idle minutes). That is roughly 360–450 hours a month, near or over the ~400-hour allowance shared with v1 and the `dev` branch. See the report and `third-party-accounts.md` §6.

---

## 4. Vercel: Hobby plan

Sources: [Hobby plan](https://vercel.com/docs/plans/hobby) (last updated 2026-09-14) · [Function duration](https://vercel.com/docs/functions/configuring-functions/duration) (2026-08-24) · [Cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) (2026-07-15) · [Runtime logs](https://vercel.com/docs/logs/runtime) (2026-08-28) · [Env vars](https://vercel.com/docs/environment-variables) (2026-09-17)

| Limit | Hobby value |
|---|---|
| Use | **Personal, non-commercial only** (fair-use guidelines) |
| Function duration | default **300 s**, maximum **300 s** (fluid compute) |
| Function invocations | first 1,000,000 a month |
| Active CPU | 4 CPU-hours a month (counts only while code is running, not while waiting for network) |
| Provisioned memory | 360 GB-hours a month |
| Fast Data Transfer | first 100 GB a month |
| Fast Origin Transfer | first 10 GB a month |
| CDN requests | first 1,000,000 a month |
| Cron jobs | 100 per project, **at most once per day**, timing within the hour (±59 min). More frequent expressions **fail deployment**. |
| Deployments | 100 per day |
| Projects | 200 |
| Runtime logs | **1 hour** of retention |
| Env vars | 64 KB total per deployment |
| Over a limit | The feature pauses, usually until **30 days** have passed. There are no billing cycles on Hobby. |
| Data use / retention | Logs are kept 1 hour. Hosting data terms weren't reviewed **(unverified)**. |

---

## 5. cron-job.org

Source: [FAQ](https://cron-job.org/en/faq/)

| Limit | Value |
|---|---|
| Price | "Our service is entirely free of charge" |
| Minimum interval | once per minute ("up to 60 times an hour") |
| Request timeout | **30 seconds** |
| Response read | up to 64 KB; larger responses abort the job |
| Number of jobs | no fixed cap (fair use) |
| Custom headers | supported (`User-Agent` and `Connection` are ignored) |
| Auto-disable | after **more than 25 failures in a row** |
| Data use / retention | Job history is kept by cron-job.org. Its privacy terms weren't reviewed **(unverified)**. The request carries only `CRON_SECRET`, which is why it must be unique and changeable. |

> **Conflict:** the planned drain time budget is **45 s** (`DRAIN_TIME_BUDGET_MS=45000`, API_DESIGN), but cron-job.org stops waiting after **30 s**. Runs longer than 30 s will show as failed, and 25 failures in a row disable the job. See the report.

---

## 6. Google Cloud: OAuth (sign-in) and Gmail API

Sources: [Audience / publishing status](https://support.google.com/cloud/answer/15549945) · [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) · [Manage OAuth clients](https://support.google.com/cloud/answer/15549257) · [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Gmail API quota](https://developers.google.com/workspace/gmail/api/reference/quota) · [Gmail sending limits](https://support.google.com/mail/answer/22839)

| Limit | Value |
|---|---|
| Price | OAuth is free. "All standard use of the Gmail API is available at no additional cost." |
| Test users (Testing mode) | up to **100** per project. Only test users can authorize the app (sign-in **and** Gmail). |
| Refresh-token life in Testing mode | **7 days**, unless the only scopes are name, email and profile (`openid`, `userinfo.email`, `userinfo.profile`). So sign-in is exempt and **Gmail reconnects weekly**. |
| Refresh tokens per Google account per client | **100**. A new one silently invalidates the oldest. |
| `gmail.send` scope class | **Sensitive** (publishing the app with it may need Google verification) |
| Gmail API quota | 1,200,000 units/min per project; 6,000 units/min per user; `messages.send` costs 100 units, so about 60 sends per minute per user |
| Future Gmail API charges | Google plans charges for usage above quota "later in 2026". Usage under 80,000,000 units a day per project won't be charged, with at least 90 days' notice. |
| Gmail sending limit (normal Gmail account) | about **500 emails per day** and 500 recipients per message (Google may apply other limits to Workspace accounts) |
| Client secret | Shown **only once** when created; later only the last 4 characters |
| Settings changes | take 5 minutes to a few hours to apply |
| Data use / retention | Governed by the Google API Services User Data Policy (accepted on the consent screen). Tokens are stored encrypted by us (`ENCRYPTION_MASTER_KEY_V1`). |

---

## 7. Sentry: Developer (free) plan

Sources: [Pricing](https://sentry.io/pricing/) · [Quotas](https://docs.sentry.io/pricing/quotas/) · [DSN explainer](https://docs.sentry.io/concepts/key-terms/dsn-explainer/)

| Limit | Value |
|---|---|
| Errors | **5,000 a month** |
| Tracing spans | 5M a month |
| Session replays | 50 a month |
| Logs | 5 GB |
| Attachments | 1 GB |
| Users | **1** |
| Retention | **30-day** lookback |
| Over quota | "Events and attachments that exceed your quota will not be accepted" (dropped). Spend thresholds aren't available on Developer. |
| Credit card | Not stated for Developer ("Start free on the Developer plan forever") **(unverified: whether sign-up starts a paid trial first)** |
| Data use | Error events can contain personal data, so our code scrubs PII before sending (`SECURITY_DESIGN.md`). Sentry's data processing terms weren't reviewed **(unverified)**. |

---

## 8. GitHub Actions: GitHub Free

Source: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

| Limit | Value |
|---|---|
| Public repos | Standard GitHub-hosted runners are **free** and don't use the allowance |
| Private repos | **$12 of compute a month** included, about **2,000 Linux minutes** (our estimate at $0.006/min) |
| Per-minute rates | Linux 2-core $0.006 · Windows 2-core $0.010 · macOS $0.062 |
| Artifact storage | 500 MB (shared with GitHub Packages) |
| Cache | 10 GB per repository |
| Over the allowance | With no payment method, usage is **blocked** (no charge) |
| Data use | Repo and secrets are stored by GitHub. Repo secrets are write-only in the UI. |

---

## 9. Apify: Free plan (legacy, owner only)

Source: [Pricing](https://apify.com/pricing)

| Limit | Value |
|---|---|
| Monthly credit | **$5** of platform usage |
| When it runs out | "you'll be blocked until the next billing cycle". No charges. |
| Credit card | "No credit card is required" |
| Data retention | **(unverified)**: not stated on the pricing page |

---

## 10. Quick summary for config

| Config value | Suggested source of truth |
|---|---|
| `LLM_DAILY_BUDGET_GEMINI` | RPD shown in AI Studio for the chosen model, minus 10–20% (fill in once read) |
| `LLM_DAILY_BUDGET_GROQ` | RPD on console.groq.com/settings/limits (the docs table shows 1K for `openai/gpt-oss-120b`, unverified for Free), minus 10–20% |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `gemini-embedding-2` / `768` (decision for `ai-engineer` + owner) |
| `DRAIN_TIME_BUDGET_MS` | must be **below 30,000** while cron-job.org calls the drain and waits for the answer (see §5) |
| Neon storage alert | 70% of **1 GB** |
