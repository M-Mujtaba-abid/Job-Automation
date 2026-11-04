# Architecture notes (as built)

Design lives in [`plan/`](../../plan/). This folder records what the implementation actually looks like where it adds detail the plans don't need:

| Planned document | Created in | Purpose |
|---|---|---|
| `query-plans.md` | M3–M5 | `EXPLAIN (ANALYZE, BUFFERS)` snapshots of the top hot-path queries with data volumes (TESTING_STRATEGY §8) |
| `queues.md` | M2, M10 | as-built queue list, payload schemas, retry settings, DLQ handling |
| `integrations.md` | M3, M8, M11 | per-integration specifics: scopes, rate limits, webhook formats, quirks |
| `scoring-versions.md` | M4 | changelog of `scoringVersion` (weights, calibration, eval results) |
| `prompt-versions.md` | M2+ | changelog of prompt versions with eval report links |

If an as-built detail contradicts a plan document, fix the plan (and ADR) rather than documenting the divergence here.
