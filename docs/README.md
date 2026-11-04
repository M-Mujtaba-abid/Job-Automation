# Documentation

`plan/` holds **design** (what we will build and why). `docs/` holds **operational** documentation for people working on or running the system: how to set it up, how parts work in practice, and runbooks.

| Folder | Contents | Owner |
|---|---|---|
| [`setup/`](setup/README.md) | local development, environment variables, third-party account setup | backend-specialist |
| [`architecture/`](architecture/README.md) | as-built notes that complement `plan/`: query plans, sequence details, integration specifics | architect, database-architect |
| [`guides/`](guides/README.md) | how-tos and runbooks: adding a job source, adding an ATS adapter, prompt changes, incident response, key rotation | each owning agent |

Rules:
- When code changes how something is set up or operated, update `docs/` in the same PR.
- When code changes *design*, update `plan/` (and an ADR) instead.
- Never put secret values in documentation; reference env var **names** only.
