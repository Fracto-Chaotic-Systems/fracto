# memory/

Persistent progress tracking for AI-assisted work on Fracto. `CLAUDE.md` at the
repository root imports `STATUS.md` and `BACKLOG.md`, so they are loaded at the
start of every Claude session; keep them concise.

| File | Purpose |
| --- | --- |
| `STATUS.md` | Current state of each area/repository — a snapshot, rewritten as things change. |
| `BACKLOG.md` | Open work, known issues, and items needing verification. Close items by moving them to `LOG.md`. |
| `LOG.md` | Append-only session log, newest entry first. Dated, with repo and commit references. |

Durable engineering principles do not belong here; they go in
`../PROJECT_GUIDELINES.md`. Feature behavior belongs in the README nearest the
code. This folder records *where the project is*, not *how it must be built*.
