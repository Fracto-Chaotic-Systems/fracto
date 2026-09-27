# Page scaffold section configurations

This folder contains the per-section configuration consumed by the page
scaffolding generator. Each section declares its repository-relative file
paths, naming conventions, input validation, supported scaffold types, and
component templates. The generator owns shared request parsing and safe file
updates; section modules describe where and how that section is extended.

- `admin.js` defines admin file paths, naming rules, source anchors, page-name
  validation, and both React component templates. `title-only` is a page title
  scaffold; `documentation` adds the empty tree and Markdown browser shell. It
  also specifies the lowercase kebab-case page-name rule used by preflight.
  Paths are relative to the Fracto repository root, independent of the process
  working directory.

Add a separate module here when another section is supported. Keep that
section's paths, validation rules, and templates in its own module so its
requirements do not become admin-specific conditionals in the shared
generator.
