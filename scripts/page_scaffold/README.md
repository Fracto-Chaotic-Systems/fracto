# Admin page scaffolder

This folder implements the first section-specific page scaffold generator.
`preview.js` parses the shared page request, loads the admin configuration,
checks source anchors and generated-name collisions, then previews the component
and registry/documentation changes. Run commands from the repository root.

```powershell
npm run page:add -- --section admin --name server-health `
  --sidebar-label servers --title "server awareness" --scaffold title-only

npm run page:add -- --section admin --name server-health `
  --sidebar-label servers --title "server awareness" --scaffold title-only --apply
```

The first command only previews. This is also the default when neither mode
flag is given. `--dry-run` makes preview-only intent explicit; `--apply` is
required to write changes. Choose a page name that is not already used. Names
must match lowercase kebab-case (`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`); the sidebar
label and title must be nonempty, single-line text. The supported scaffold
types are `title-only` and `documentation`. `title-only` renders a registered
page title with `MainStyles.SectionTitle` and `AppText`. `documentation` adds a
two-panel tree and Markdown renderer; its tree and key-to-Markdown map start
empty so the content source can be defined later.

An apply updates five targets: it creates the page component; inserts the
section constant immediately before `ADMIN_OVERVIEW` in `AdminSettings.jsx`;
inserts text-key declarations before `KEY_ADMIN_OVERVIEW` and the AppText map
values at the end of `APP_ADMIN_TEXT` in `AdminText.jsx`; adds imports beside
`AdminOverview` and a `SIDEBAR_LIST` entry immediately after the Overview item
in `Admin.jsx`; and appends the component summary to the admin pages README.
The admin section configuration identifies the paths, naming rules, expected
insertion anchors, and component template. If an expected file or anchor is
missing, the generated name or file already exists, or the source layout is
otherwise unexpected, the command stops before writing.

Apply stages temporary files beside each target, backs up existing targets,
then installs the new files. If a caught write or rename error occurs, it
removes installed replacements and restores those backups. A process forcibly
terminated during installation may leave files named
`.page-scaffold-<id>.tmp` or `.page-scaffold-<id>.bak` beside targets; inspect
the affected files and Git status before removing leftovers or retrying.

`preview.test.js` exercises dry-run immutability, successful application to an
isolated fixture, Windows line endings, duplicate rejection, invalid
identifiers, and changed source anchors. Run it with
`npm run test:page-scaffold` or `node --test scripts/page_scaffold/preview.test.js`.

Section-specific paths, name rules, source anchors, and page templates are in
`sections/`. The shared request parser and file-update workflow stay here;
another section should add a separate configuration module rather than adding
section-specific file paths to the shared workflow.
