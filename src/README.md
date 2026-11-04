# src/ (v2 application code, not yet populated)

Intentionally contains no code yet. In **Milestone 0** the v1 code at the repository root (`app/`, `components/`, `lib/`) moves here and the v2 layout from ADR-021 (`plan/TECHNICAL_DECISIONS.md`) is created:

```
src/app/          routes only (thin)
src/components/   ui/ (shadcn) + shared/
src/features/     feature UI + thin "use server" actions
src/server/       server-only: db, auth, modules/<domain>, ai, jobs, integrations, lib
src/lib/          isomorphic utilities
src/workers/      BullMQ worker entry points + processors
src/legacy/       v1 code until removed in M6
```

Note: while root `app/` exists, Next.js serves it and ignores `src/app`. The move must happen in one change (M0 task 3).
