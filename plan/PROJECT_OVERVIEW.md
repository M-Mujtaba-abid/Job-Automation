# Project Overview: AI Job Finder, Assisted Application & ATS Platform

> Working name: **JobFinder AI** (repository: `job automation`). Status: architecture & foundation phase. See `IMPLEMENTATION_STATUS.md`.

## 1. Vision
Give every job seeker a personal, honest job-search co-pilot: one that finds roles that genuinely fit, explains *why* in plain language, helps them apply quickly through legitimate channels with their explicit approval, and keeps the whole search organised until they sign an offer.

## 2. Problem statement
- **Discovery is noisy.** Candidates scan hundreds of listings across boards, group posts and ATS pages; keyword search misses good fits and surfaces poor ones.
- **Matching is opaque.** Existing "AI match %" features rarely explain themselves, so candidates can't trust or act on them.
- **Applying is repetitive.** Each application repeats the same personal details, documents and questions; tailored cover letters take time.
- **Tracking is ad hoc.** Spreadsheets and inboxes lose follow-ups; candidates forget who they spoke to and when to follow up.
- **Automation tools cut corners.** Many "auto-apply" bots spray applications, violate platform terms, bypass CAPTCHAs, and damage candidates' reputations.

The owner's v1 tool (single-user, see `README.md`) validated the core loop for one person: aggregate hiring posts → extract contact channels → bulk-apply by email → track. v2 turns that into a trustworthy multi-user product.

## 3. Target audience
| Segment | Needs | Priority |
|---|---|---|
| Early/mid-career software & tech professionals (initial focus; v1 heritage in Pakistan's tech market, plus remote-global roles) | volume of relevant roles, remote opportunities, fast applying, tracking | **Primary** |
| Active job seekers in other professional fields | same, with broader taxonomy | Secondary (post-launch) |
| Career switchers / graduates | gap analysis, learning direction, cover letters | Secondary |
| Career coaches / bootcamps managing cohorts | multi-candidate view | Future (B2B, requires Organization model, ADR-006) |

Personas:
- **Ayesha, mid-level frontend developer (Lahore):** wants remote roles paying in USD, applies to 20+ jobs/week, loses track of follow-ups.
- **Daniel, senior backend engineer (Berlin):** selective; wants high-signal matches with clear reasoning and salary transparency.
- **Sara, bootcamp graduate:** needs to know which skills block her from interviews and how to phrase transferable experience.

## 4. Core features
1. **Accounts & onboarding:** email/OAuth sign-up, preferences wizard.
2. **Resume intelligence:** PDF/DOCX upload, AI extraction with evidence, editable profile, versions.
3. **Job aggregation:** permitted sources (ATS board APIs, licensed aggregators, user-submitted), dedupe, enrichment.
4. **Transparent AI matching:** hybrid deterministic + AI scoring with breakdown, strengths, gaps, missing skills.
5. **Discovery dashboard:** ranked feed, filters, save/dismiss, job details with match analysis.
6. **Application tracker (ATS for candidates):** Kanban + list, stage history, notes, contacts, documents.
7. **Interviews & follow-ups:** scheduling, AI prep questions, reminders.
8. **Email integration:** send applications from the user's own Gmail/Outlook with approval; optional reply tracking.
9. **Assisted applications:** prepare → approve → submit on supported ATS forms; manual fallback everywhere.
10. **Notifications:** in-app inbox, email digests.
11. **Subscriptions:** Free / Pro / Premium with usage metering.
12. **Privacy controls:** export, deletion, consent history, security log.

## 5. User journeys
1. **First session (≤ 5 minutes to first matches):** sign up → verify → onboarding goals → upload resume → set preferences → review parsed skills → see ranked matches with explanations.
2. **Daily discovery:** open dashboard → "12 new matches" → scan Discover (score, strengths, gaps) → save 3, dismiss 4 with reasons → open one job → read breakdown → apply.
3. **Apply by email:** choose "Apply by email" → AI drafts cover letter from match strengths → edit → preview email with resume attached → approve → sent from own Gmail → application card appears in Applied with follow-up suggested for +7 days.
4. **Assisted ATS apply:** "Fill application for me" → wait ~1 min → review every field + screenshots → answer 2 flagged questions → tick consent → submit → confirmation evidence stored → card moves to Applied.
5. **Blocked automation:** form shows CAPTCHA → task becomes "Needs manual" → user opens the employer site and copies prepared answers from the answer sheet → clicks "I applied".
6. **Pipeline management:** recruiter replies → (with reply tracking) timeline shows the email, card suggests "Move to Screening" → user schedules interview → AI prep questions → reminder the day before → logs outcome.
7. **Upgrade:** hits monthly cover-letter limit → upgrade modal shows usage → checkout → limits refresh immediately via webhook.
8. **Leave:** exports data (JSON + files) → deletes account → 7-day undo → full purge.

## 6. Functional requirements
| ID | Requirement | Milestone |
|---|---|---|
| FR-01 | Users can register with email/password or Google/Microsoft, verify email, reset password, manage sessions | M1 |
| FR-02 | Users can set job preferences (titles, seniority, locations + radius, work modes, employment types, salary floor, authorisation, dealbreakers, excluded companies) | M1 |
| FR-03 | Users can upload PDF/DOCX resumes (≤ 4 MB), keep multiple resumes and versions, choose a primary | M2 |
| FR-04 | System extracts contact, positions, education, skills (with evidence), certifications; user can correct everything | M2 |
| FR-05 | System ingests jobs from approved sources on schedules, deduplicates, and enriches them (skills, seniority, salary, location, apply channels) | M3 |
| FR-06 | System computes per-user match scores with stored component breakdown and versioned formula | M4 |
| FR-07 | System generates evidence-backed explanations and gap analysis for top matches | M4 |
| FR-08 | Users can browse, filter, search, save, dismiss (with reason) and view job details with match analysis | M5 |
| FR-09 | Users can submit private jobs by pasting a description | M5 |
| FR-10 | Users can track applications on a Kanban board with stage history, notes, contacts, documents; list view + CSV export | M6 |
| FR-11 | v1 owner data can be imported (jobs, applications, templates) | M6 |
| FR-12 | Users can record interviews, generate prep questions, and get reminders; follow-up reminders with snooze | M7 |
| FR-13 | Users can connect Gmail/Outlook and send approved application emails with resume attached; no double sends | M8 |
| FR-14 | Users can generate and edit AI cover letters | M8 |
| FR-15 | Users can run assisted applications on supported ATS forms with per-application approval and verified submission | M9 |
| FR-16 | Users receive in-app and email notifications per preferences, including digests | M10 |
| FR-17 | Users can subscribe/upgrade/cancel; limits enforced from usage records | M11 |
| FR-18 | Users can export their data and delete their account | M1 (deletion) / M12 (export) |
| FR-19 | Admins can manage job sources (with compliance status), adapters' health, skill taxonomy | M3 / M9 |

## 7. Non-functional requirements
| Category | Requirement |
|---|---|
| Security | OWASP ASVS L2; tenant isolation tests; encrypted tokens; see `SECURITY_DESIGN.md` |
| Privacy | GDPR-ready data rights; resumes never used across users or for training; PII-free logs |
| Performance | p75 LCP < 2.5 s; Server Action p95 < 500 ms (excluding async work); Discover query p95 < 300 ms at 100K jobs / 1M matches |
| Availability | 99.5% monthly for web tier at launch; workers tolerate restarts with no lost jobs |
| Scalability | 10K users / 200K active jobs on single Postgres + horizontally scaled workers (SYSTEM_ARCHITECTURE §6) |
| Reliability | idempotent workers; automation never double-submits; email never double-sends |
| Observability | Sentry errors + traces; structured logs with correlation ids; queue/adapters dashboards |
| Accessibility | WCAG 2.2 AA |
| Maintainability | strict TS, module boundaries, ADRs, ≥ 80% coverage on domain modules, documented prompts & scoring versions |
| Cost | AI cost per active user per month tracked from `UsageRecord`; target < 25% of plan price |
| Compliance | job-source and ATS terms respected (ADR-011, ADR-014); auditable consent |
| i18n | English UI at launch; Unicode-safe data; currency/locale-aware formatting; structure ready for Urdu (RTL) later |

## 8. SaaS business model considerations

> **Current phase: zero-cost free beta (ADR-023).** No paid plans, no billing, and no commercial use while on Vercel Hobby. The points below describe the *future* model once an upgrade trigger is hit (ADR-023 "Consequences").

- **Freemium:** Free tier proves value (matching + tracker, limited AI); Pro adds volume AI (explanations, cover letters, email sends); Premium adds assisted ATS applications and higher limits. Draft limits in `API_DESIGN.md` §15.
- **Unit economics:** global job parsing amortised across users (ADR-006); per-user AI costs metered (`UsageRecord.costMicros`); model routing per task is an explicit cost lever (ADR-010).
- **Pricing localisation:** PPP-adjusted pricing for markets like Pakistan (PKR plans) vs USD/EUR; requires billing provider support (ADR-016).
- **Trust as differentiator:** no spray-and-pray; approval-first automation; transparent scores. Marketing must not promise guaranteed interviews.
- **Growth loops:** shareable (opt-in) public profile later; referral credits; weekly "your market" digest emails.
- **Risks:** platform terms changes for job sources; Google OAuth verification cost/time for Gmail scopes; LLM cost spikes; regulatory (automated decision-making) scrutiny. Tracked in `IMPLEMENTATION_STATUS.md` risk register.
- **Out of scope (v2.0):** employer-side ATS, recruiter marketplace, resume builder/designer, mobile native apps, Chrome extension (candidate for v2.1).

## 9. Success metrics
| Metric | Target (90 days post-launch) |
|---|---|
| Activation (resume parsed + ≥ 1 match viewed within 24 h) | ≥ 60% of sign-ups |
| Match usefulness (👍 rate on explanations) | ≥ 70% |
| Applications tracked per active user / week | ≥ 5 |
| Response rate on applications sent through the platform | ≥ baseline user-reported rate (measured) |
| Automation verified-submission rate | ≥ 95%, duplicate submissions = 0 |
| Free → paid conversion | 3–5% |
| AI cost / paying user / month | < 25% of ARPU |
