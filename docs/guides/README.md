# Guides & runbooks

Planned guides (each created in the milestone that introduces the capability):

| Guide | Milestone | Summary |
|---|---|---|
| `adding-a-job-source.md` | M3 | implement `JobSourceAdapter`, fixtures, compliance review (terms, robots, rate limits, attribution), enable with `complianceStatus = APPROVED` |
| `automation-adapter-review.md` | M9 | compliance & quality checklist template every ATS adapter version must pass before enablement |
| `changing-prompts-or-models.md` | M2 | create a new prompt version, run evals with a budget, attach report, roll out |
| `changing-scoring.md` | M4 | new `scoringVersion`, calibration, ranking eval, re-score rollout |
| `key-rotation.md` | M8 | rotate `ENCRYPTION_MASTER_KEY` / KMS key versions and re-encrypt tokens |
| `incident-response.md` | M13 | severity matrix, contacts, token revocation, breach notification |
| `disable-a-source-or-adapter.md` | M9 | emergency kill switches and user communication |
| `release-process.md` | M13 | migrations (expand/contract), deploy order web/workers, rollback |
