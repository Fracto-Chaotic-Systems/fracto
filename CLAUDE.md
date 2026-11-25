# CLAUDE.md — Fracto (mediaplex)

Working notes for Claude sessions on this project. Durable engineering rules
live in [PROJECT_GUIDELINES.md](PROJECT_GUIDELINES.md); this file does not
restate them. Progress and session memory live in [memory/](memory/README.md).

@PROJECT_GUIDELINES.md
@memory/STATUS.md
@memory/BACKLOG.md

## What this is

Fracto is a fractal-exploration "mediaplex": a root supervisor/orchestrator
(`index.js`, port 3001) plus six independently versioned services under
`servers/`, sharing code only through the `@fracto/sdk` package in `sdk/`.

| Repo | Port | Owns |
| --- | ---: | --- |
| root (`.`) | 3001 | orchestration, deployment, auth, health, migration runner |
| `servers/fracto-data-server` | 3002 | application DB schema/SQL, orbitals, components/blueprints |
| `servers/fracto-asset-server` | 3003 | asset files, imports, conversion, provenance, component releases |
| `servers/fracto-tiles-server` | 3004 | tile index, lookup, coverage, heat maps, mesh |
| `servers/fracto-admin-server` | 3005 | port discovery (`GET /ports`), status, logs, sync |
| `servers/fracto-ui` | 3006 | Vite/React UI (flight, construction stage, inventory, play) |
| `servers/fracto-ai-server` | 3007 | AI/operations, knowledge bundle, construction planning |

Development ports are offset by 100 (e.g. admin 3105).

## Things that trip people up

- **Seven git repositories, not a monorepo.** Each `servers/*` folder has its
  own `.git`; the root ignores them. Run git from the repo that owns the file.
  A root commit cannot include service changes.
- **Boundaries are enforced.** No imports root↔server or server↔server; shared
  code goes through `@fracto/sdk` by package name. `npm run boundaries:audit`
  must report 0 violations (it did on 2026-11-24).
- New application migrations go in the data server's `database/migrations/`;
  root migrations `001`–`018` are historical and immutable.
- Every working folder needs a README; update the nearest README with any
  functional change.
- Never send personal information across any API (see guidelines).
- UI changes in the `fracto-dev` container: touch `vite.config.js` *inside* the
  container to trigger the watcher (command in the guidelines).
- Startup fast-forwards every repo and aborts on tracked/staged changes,
  detached heads or divergent branches.

## Common commands (root)

- `npm run check` — syntax, boundaries, SDK consumer checks (CI gate)
- `npm test` / `npm run test:<area>` — e.g. `test:flight`, `test:components`,
  `test:orbital-catalog`, `test:mesh-runtime`
- `npm run boundaries:audit` — report dependency-boundary findings
- `npm run db:migrate` / `db:validate` — migrations
- `npm run update:repos` — fetch/fast-forward all seven repos
- `npm run format` / `format:check` — Prettier
- `scripts/launch-development.bat|sh`, `scripts/cold_boot.bat` — run the stack

See `package.json` for the full list and `scripts/README.md` for details.

## Memory protocol (keep this up to date)

At the **start** of a session: read `memory/STATUS.md` and `memory/BACKLOG.md`
(imported above) and skim the top of `memory/LOG.md`.

At the **end** of any session that changed something:
1. Add a dated entry at the top of `memory/LOG.md` (what changed, which repo,
   commit hashes, anything left unfinished).
2. Update `memory/STATUS.md` if the state of an area changed.
3. Add/close items in `memory/BACKLOG.md`.
4. If a durable rule was decided, put it in `PROJECT_GUIDELINES.md`, not here.

Keep STATUS and BACKLOG short — they load into every session. History belongs
in LOG.
