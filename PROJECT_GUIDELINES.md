# Fracto project guidelines

This document records durable architectural principles and priorities for the
Fracto system. It is intentionally concise; feature-specific behavior belongs
in the README for that feature or service.

## Architecture and compatibility

- Preserve existing behavior and backward compatibility whenever practical.
- Prefer incremental, reversible changes over broad rewrites.
- Keep service boundaries clear and avoid introducing side effects into shared
  rendering or data paths without an explicit reason.
- Keep the persistent tile cache optional: it is valuable for lab/research
  installations, while network/CDN-backed operation may suit public use.

## Component and state ownership

- A page coordinates its tabs; each tab component owns its own independent
  state, timers, data loading, and feature-specific helpers.
- Pass props only for values genuinely controlled by the outer component, such
  as shared page dimensions.
- For tabbed interfaces, use an explicit dispatcher with a default branch that
  logs an error for an unimplemented tab.
- When a file grows beyond roughly 200 lines, consider extracting utilities or
  a cohesive child component so the file structure reveals the architecture.

## UI and text

- Follow established component and styling patterns unless there is a clear
  reason to introduce a new one.
- Register every user-visible string in the appropriate AppText catalog;
  internal codes and implementation details do not need registration.
- Keep styling centralized and theme-ready. Prefer shared semantic styles over
  scattered literals.
- Use Prettier for formatting and ESLint for correctness checks. Formatting
  must not change runtime behavior.
- Use monospace styling where values are compared or copied, and preserve
  complete values in the data model even when the UI displays abbreviations.

## Data, logging, and operations

- Treat the cloud tile source and database migration history as authoritative;
  local caches and packaged snapshots are operational conveniences.
- Keep logs structured enough to identify their source, preserve useful ANSI
  color semantics, and make anomalous data-layer conditions visible.
- Mark temporary fallback code with a clear TODO describing exactly when it
  should be removed, and summarize such cleanup work in the relevant README.
- Avoid destructive operations by default. Database changes should use
  versioned, idempotent migrations with explicit confirmation for resets or
  forced reapplication.

## Collaboration and maintenance

- Document new durable principles here when they are established.
- If a newer decision supersedes an older one, update this document rather than
  leaving contradictory guidance in place.
- Keep commits focused and describe behavior changes clearly so history can be
  used to investigate regressions.
