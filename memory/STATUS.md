# Project status

_Last updated: 2026-11-24_

All seven repositories are on `main` with clean working trees.
Dependency-boundary audit: **0 violations**.

| Repo | Last commit | Recent focus |
| --- | --- | --- |
| root | 2026-11-24 `968895e` | Component runtime package contract, path motion, construction tests, cold-boot recovery |
| data-server | 2026-11-24 `ed76c98` | Component blueprints, variants and revision-safe restoration; model folders |
| asset-server | 2026-11-24 `834d8d8` | Immutable published component releases; environment model imports |
| ui | 2026-11-24 `af7ec22` | Construction stage walk mode; Play-page grass from a published component release |
| tiles-server | 2026-11-23 `f7538b8` | Indexed numerical tiles and batched availability for flight; bulk tile seeding |
| ai-server | 2026-11-23 `74b907a` | Collaborative component authoring, construction planning |
| admin-server | 2026-11-22 `a6297e8` | Database sync through data-service endpoints; instrument transfer |

## Active areas

- **Components and gameplay:** components are authored collaboratively and
  published as immutable packages that gameplay consumes. The grass strip
  (revision 17) is the worked example.
- **Flight:** renders over adaptive tiles with canvas modes, a dashboard, and a
  parchment map. The six-step plan in `codex.txt` (flight state → ray-to-plane
  renderer → tile access/caching → adaptive refinement → frame coloring →
  integration) looks mostly done based on commits, but this hasn't been checked.
- **Orbitals:** the catalog, survey, investigations, and lifecycle work is
  mature, and its verification logs are in `logs/`.
