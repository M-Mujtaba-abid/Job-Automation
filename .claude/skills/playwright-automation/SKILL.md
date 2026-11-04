---
name: playwright-automation
description: Playwright usage in this project - (1) the assisted-application automation worker (ATS adapters, blocker detection, field detection, two-phase prepare/approve/submit with payload hashing, artifacts, retries, compliance rules) and (2) Playwright Test E2E and fixture-form tests. Use when writing or changing automation adapters, the automation worker, or any Playwright test.
---

# Playwright Automation & E2E

## When to activate
- Anything under `src/workers/automation*`, `src/server/modules/automation/**`, `src/server/integrations/ats/**`.
- Writing Playwright Test specs in `tests/e2e/**` or adapter fixture tests in `tests/automation/**`.
Design: `plan/AUTOMATION_DESIGN.md` (read §1 compliance rules first, every time).

## Non-negotiable compliance rules
- Stop on CAPTCHA, MFA, login walls, bot challenges, 403/429 → `BLOCKED` → manual fallback. Never solve, evade or retry around them.
- No stealth plugins, fingerprint spoofing, proxies to evade limits, or credential storage for job sites.
- Never click submit in the PREPARE phase. SUBMIT only with a valid, unexpired approval whose hash equals the filled payload.
- Never auto-retry after a submit click.
- Only allowlisted hosts per adapter; everything else is manual.
- AI may draft open-ended answers only (flagged); never legal/eligibility/demographic answers.

## Adapter contract
```ts
export interface AtsAdapter {
  readonly id: AdapterId;
  readonly version: string;                         // bump on any selector/flow change
  readonly allowedHosts: readonly RegExp[];
  readonly rateLimit: { perHostPerMinute: number };
  matches(url: URL): boolean;
  openForm(page: Page, url: URL): Promise<FormSnapshot | Blocked>;
  fill(page: Page, form: FormSnapshot, answers: ResolvedAnswers, files: StagedFiles): Promise<FillReport>;
  submit(page: Page): Promise<SubmissionResult>;    // SUBMIT phase only
}
```

## Orchestrator pattern (worker)
```ts
// src/workers/automation/run.ts
export async function runPhase(taskId: string, phase: "PREPARE" | "SUBMIT") {
  const task = await automation.loadForWorker(taskId);                 // includes adapter id, applyUrl, payload, approval
  const adapter = registry.get(task.adapter);
  assertAllowedHost(adapter, new URL(task.applyUrl));
  if (phase === "SUBMIT") assertApproved(task);                         // status APPROVED, not expired, hash present, adapter version unchanged

  const execution = await automation.startExecution(task, phase);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: false,
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const log = stepLogger(execution.id);                                  // persists each step BEFORE acting on it

  try {
    const form = await adapter.openForm(page, new URL(task.applyUrl));
    if ("blocked" in form) return await automation.markBlocked(execution, form.reason, await shot(page, "blocked"));

    const answers = phase === "PREPARE" ? await resolveAnswers(task, form) : task.approvedAnswers;
    if (phase === "SUBMIT" && !sameFieldSet(form, task.preparedForm)) {
      return await automation.markNeedsManual(execution, "FORM_CHANGED");
    }

    const files = await stageResume(task);                               // presigned GET → per-run temp dir
    const report = await adapter.fill(page, form, answers, files);
    const hash = payloadHash(form, report.filled, files, adapter.version);

    if (phase === "PREPARE") {
      return await automation.markPrepared(execution, { form, filled: report.filled, hash, artifacts: [await shot(page, "filled")] });
    }

    if (hash !== task.approvedPayloadHash) return await automation.markNeedsManual(execution, "PAYLOAD_MISMATCH");
    await log("submit_click");                                           // written before clicking: crash-safe evidence
    const result = await adapter.submit(page);
    return await automation.markSubmitted(execution, result, await shot(page, "confirmation"));
  } catch (err) {
    return await automation.markFailed(execution, classify(err), { afterSubmitClick: log.has("submit_click") });
  } finally {
    await context.close();
    await browser.close();
    await cleanupStagedFiles(taskId);
  }
}
```

## Blocker detection (check after every navigation and before submit)
```ts
const BLOCKER_SELECTORS = [
  'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="challenges.cloudflare.com"]',
  '[class*="g-recaptcha"]', '[data-sitekey]', '#challenge-form',
];
export async function detectBlocker(page: Page, response: Response | null): Promise<Blocked | null> {
  if (response && [401, 403, 429].includes(response.status())) return { blocked: true, reason: "BOT_CHALLENGE" };
  for (const s of BLOCKER_SELECTORS) if (await page.locator(s).count()) return { blocked: true, reason: "CAPTCHA" };
  if (await page.getByLabel(/password/i).count()) return { blocked: true, reason: "LOGIN_REQUIRED" };
  if (await page.getByText(/verify (you are|you're) (a )?human|one-time (code|password)|verification code/i).count())
    return { blocked: true, reason: "MFA" };
  return null;
}
```

## Locator strategy
1. `getByLabel` / `getByRole` with accessible names (resilient, mirrors what users see).
2. Stable attributes documented for the ATS (`name="job_application[first_name]"`, `id`), kept in the adapter's field map with a comment and fixture test.
3. CSS structure selectors only as a last resort, with a fixture test proving them.
Never use `page.waitForTimeout` for synchronisation; use auto-waiting locators and `expect.poll`/`waitForURL`.

## Field filling helpers
- Text: `locator.fill(value)` then verify `inputValue()` equals the value (some forms reformat phones).
- Select/radio/checkbox: choose by visible label; if the approved option is missing → `FORM_CHANGED`.
- File: `setInputFiles(stagedPath)` only for the staged resume/cover letter; verify the filename appears.
- Never type into fields not in the snapshot (no hidden-field stuffing).

## Artifacts & logs
- Screenshots: full page, PNG, uploaded to `automation/{userId}/{taskId}/{executionId}/{n}.png`, 90-day retention.
- Step log entries: `{ at, step, outcome, detail }` without field values.
- Metrics per adapter: outcome counts, blocked reasons, durations → circuit breaker.

## Error handling
- `classify(err)` maps failures to a closed set: `NAVIGATION_TIMEOUT`, `HTTP_ERROR`, `SELECTOR_NOT_FOUND`, `FILL_MISMATCH`, `UPLOAD_FAILED`, `FORM_CHANGED`, `PAYLOAD_MISMATCH`, `UNVERIFIED_SUBMISSION`, `INTERRUPTED`, `INTERNAL`. Free-text messages go to `errorMessage` (no PII).
- Every terminal state writes: execution status, task status, user notification, metric, and (for SUBMIT) audit log.
- `afterSubmitClick = true` always results in `FAILED(UNVERIFIED_SUBMISSION)` or `SUBMITTED` (never a retryable state).
- Playwright `TimeoutError` is caught and classified; unknown errors are re-thrown after cleanup so BullMQ records them, with the task moved to `FAILED(INTERNAL)`.
- E2E tests: on failure Playwright keeps trace + screenshot (`trace: "retain-on-failure"`); traces from adapter tests use fixture data only.

## Retry rules
| Failure | Retry? |
|---|---|
| Navigation timeout / 5xx before any fill (PREPARE) | yes, ≤ 2, backoff |
| Rate-limit token unavailable | delay job |
| Blocker detected | never |
| Selector not found | never (adapter health −1) |
| Any failure after `submit_click` logged | never (UNVERIFIED) |

## E2E tests (Playwright Test)
```ts
// tests/e2e/discover.spec.ts
import { test, expect } from "./fixtures";            // provides authed storageState + seeded data + axe helper

test("filter Discover by remote and save a job", async ({ page, axe }) => {
  await page.goto("/discover?minScore=70");
  await page.getByRole("button", { name: "Work mode" }).click();
  await page.getByRole("checkbox", { name: "Remote" }).check();
  await expect(page).toHaveURL(/workMode=REMOTE/);
  const card = page.getByRole("article").filter({ hasText: "Senior Frontend Engineer" });
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("button", { name: "Saved" })).toBeVisible();
  await axe.check();                                   // fails on serious/critical violations
});
```
- Use role/label locators and web-first assertions (`toBeVisible`, `toHaveURL`); no sleeps.
- Each test creates its own data via API/seed helpers; no order dependence; parallel-safe.
- External services faked (fake AI/email/billing providers via env), Mailpit for emails.

## Adapter fixture tests
```ts
// tests/automation/greenhouse.spec.ts
test("prepare fills all known fields and never submits", async ({ page, fixtureServer }) => {
  const url = new URL(`${fixtureServer}/greenhouse/basic.html`);
  const form = await greenhouse.openForm(page, url);
  expect("blocked" in form).toBe(false);
  const report = await greenhouse.fill(page, form as FormSnapshot, sampleAnswers, sampleFiles);
  expect(report.missingRequired).toEqual([]);
  expect(fixtureServer.submissions()).toHaveLength(0);   // fixture server records POSTs
});

test("captcha fixture is blocked", async ({ page, fixtureServer }) => {
  const res = await greenhouse.openForm(page, new URL(`${fixtureServer}/greenhouse/with-recaptcha.html`));
  expect(res).toEqual({ blocked: true, reason: "CAPTCHA" });
});
```
Fixtures cover: basic form, custom questions, EEO section, optional/required cover letter, changed form (for FORM_CHANGED), CAPTCHA variants, login wall, 429.

## Anti-patterns
- ❌ Running adapters against real employer sites in CI or tests.
- ❌ Sharing browser contexts/cookies across runs or users.
- ❌ Logging filled values or screenshots to Sentry.
- ❌ `force: true` clicks to bypass overlays/consent dialogs on third-party sites (overlays may be blockers; route to manual).
- ❌ Generic "smart" auto-fill on unknown sites (only allowlisted adapters).
- ❌ Increasing timeouts to "fix" flakiness without understanding the cause.

## Security considerations
- Worker runs in its own container with minimal env (no mail tokens, no encryption keys, no Anthropic key unless AI drafting happens in the general worker before prepare: preferred).
- Egress allowlist where the host supports it; downloads disabled; temp files deleted in `finally`.
- Task loading verifies `task.userId` matches the execution and the resume version belongs to that user.

## Testing requirements
- Every adapter version: full fixture suite green; blocker fixtures 100% blocked.
- Orchestrator: unit tests for `payloadHash` (canonical JSON, order-independent), approval assertions, retry classification; chaos test (kill during SUBMIT → never auto-retried).
- E2E journeys 10 & 11 (TESTING_STRATEGY §5.2) pass.
