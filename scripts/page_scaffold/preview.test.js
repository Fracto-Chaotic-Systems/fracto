import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { apply_page_preview, create_page_preview } from "./preview.js";
import ADMIN_PAGE_CONFIG from "./sections/admin.js";

const TEMP_PREFIX = "fracto-admin-page-scaffold-";
const REQUEST = {
  section: "admin",
  name: "server-tools",
  sidebar_label: "servers",
  title: "server awareness",
  scaffold: "title-only",
  dry_run: true,
};

const create_fixture = (newline = "\n") => {
  const repository_root = os.tmpdir();
  const fixture_root = mkdtempSync(path.join(repository_root, TEMP_PREFIX));
  const initial_files = {
    settings_registry: 'export const ADMIN_OVERVIEW = "admin_overview";\n',
    text_registry:
      'export const KEY_ADMIN_OVERVIEW = "admin/admin_overview";\nexport const APP_ADMIN_TEXT = {\n};\n',
    sidebar_registry:
      'import AdminOverview from "./admin/AdminOverview.jsx";\nconst SIDEBAR_LIST = [\n  {\n    title_key: KEY_SIDEBAR_OVERVIEW,\n    section_code: ADMIN_OVERVIEW,\n    right_pane: <AdminOverview />,\n  },\n];\n',
    page_readme: "# Admin pages\n",
  };

  mkdirSync(path.join(fixture_root, ADMIN_PAGE_CONFIG.paths.page_directory), {
    recursive: true,
  });
  for (const [registry_name, content] of Object.entries(initial_files)) {
    const file_path = path.join(
      fixture_root,
      ADMIN_PAGE_CONFIG.paths[registry_name],
    );
    mkdirSync(path.dirname(file_path), { recursive: true });
    writeFileSync(file_path, content.replace(/\n/g, newline));
  }

  return { fixture_root, initial_files };
};

const cleanup_fixture = (fixture_root) => {
  const temp_root = path.resolve(os.tmpdir());
  const resolved_fixture = path.resolve(fixture_root);
  const relative_fixture = path.relative(temp_root, resolved_fixture);
  if (
    path.basename(resolved_fixture).startsWith(TEMP_PREFIX) === false ||
    relative_fixture.startsWith("..") ||
    path.isAbsolute(relative_fixture)
  ) {
    throw new Error(
      `Refusing to remove unexpected test fixture: ${fixture_root}`,
    );
  }
  rmSync(resolved_fixture, { recursive: true, force: true });
};

const fixture_file = (fixture_root, registry_name) =>
  path.join(fixture_root, ADMIN_PAGE_CONFIG.paths[registry_name]);

test("renders an admin page preview without changing fixture files", (t) => {
  const { fixture_root, initial_files } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));

  const preview = create_page_preview(REQUEST, {
    repository_root: fixture_root,
  });

  assert.equal(preview.changes.length, 5);
  assert.equal(
    preview.changes[0].file,
    path.join(
      fixture_root,
      ADMIN_PAGE_CONFIG.paths.page_directory,
      "AdminServerTools.jsx",
    ),
  );
  assert.match(
    preview.changes[0].content,
    /AppText\.get\(KEY_ADMIN_SERVER_TOOLS_TITLE\)/,
  );
  assert.match(preview.changes[1].content, /ADMIN_SERVER_TOOLS/);
  assert.match(preview.changes[2].content, /"server awareness"/);
  assert.match(preview.changes[3].content, /AdminServerTools/);
  assert.match(preview.changes[4].content, /AdminServerTools\.jsx/);
  assert.equal(preview.request.dry_run, true);

  for (const [registry_name, content] of Object.entries(initial_files)) {
    assert.equal(
      readFileSync(fixture_file(fixture_root, registry_name), "utf8"),
      content,
    );
  }
  assert.equal(
    existsSync(
      path.join(
        fixture_root,
        ADMIN_PAGE_CONFIG.paths.page_directory,
        "AdminServerTools.jsx",
      ),
    ),
    false,
  );
});

test("renders a documentation scaffold with an initially empty tree", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));

  const preview = create_page_preview(
    { ...REQUEST, scaffold: "documentation" },
    { repository_root: fixture_root },
  );
  const component_source = preview.changes[0].content;

  assert.match(component_source, /const DOCUMENTATION_TREE = \[\];/);
  assert.match(component_source, /const DOCUMENTATION_MARKDOWN_BY_KEY = \{\};/);
  assert.match(component_source, /<CoolTree/);
  assert.match(component_source, /<ReactMarkdown/);
  assert.match(
    component_source,
    /DOCUMENTATION_MARKDOWN_BY_KEY\[selected_key\]/,
  );
  assert.match(component_source, /DOCUMENTATION_TREE\.length \?/);
});

test("applies a valid admin scaffold across its five target files", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));
  const request = { ...REQUEST, dry_run: false, apply: true };
  const preview = create_page_preview(request, {
    repository_root: fixture_root,
  });

  const written_files = apply_page_preview(request, preview, {
    repository_root: fixture_root,
  });

  assert.equal(written_files.length, 5);
  const settings = readFileSync(
    fixture_file(fixture_root, "settings_registry"),
    "utf8",
  );
  const text = readFileSync(
    fixture_file(fixture_root, "text_registry"),
    "utf8",
  );
  const sidebar = readFileSync(
    fixture_file(fixture_root, "sidebar_registry"),
    "utf8",
  );
  const readme = readFileSync(
    fixture_file(fixture_root, "page_readme"),
    "utf8",
  );
  const page = readFileSync(
    path.join(
      fixture_root,
      ADMIN_PAGE_CONFIG.paths.page_directory,
      "AdminServerTools.jsx",
    ),
    "utf8",
  );

  assert.match(settings, /ADMIN_SERVER_TOOLS = "admin_server_tools"/);
  assert.match(text, /KEY_ADMIN_SERVER_TOOLS_TITLE/);
  assert.match(text, /\[KEY_ADMIN_SERVER_TOOLS\]: "servers"/);
  assert.match(sidebar, /right_pane: <AdminServerTools \/>/);
  assert.match(page, /AppText\.get\(KEY_ADMIN_SERVER_TOOLS_TITLE\)/);
  assert.match(readme, /AdminServerTools\.jsx/);
  assert.throws(
    () => create_page_preview(request, { repository_root: fixture_root }),
    /Page file already exists/,
  );
});

test("preserves Windows line endings when applying registry changes", (t) => {
  const { fixture_root } = create_fixture("\r\n");
  t.after(() => cleanup_fixture(fixture_root));
  const request = { ...REQUEST, dry_run: false, apply: true };
  const preview = create_page_preview(request, {
    repository_root: fixture_root,
  });
  apply_page_preview(request, preview, { repository_root: fixture_root });

  const settings = readFileSync(
    fixture_file(fixture_root, "settings_registry"),
    "utf8",
  );
  assert.match(settings, /ADMIN_SERVER_TOOLS = "admin_server_tools";\r\n/);
  assert.doesNotMatch(settings, /(?<!\r)\n/);
});

test("rejects an existing generated page file", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));
  writeFileSync(
    path.join(
      fixture_root,
      ADMIN_PAGE_CONFIG.paths.page_directory,
      "AdminServerTools.jsx",
    ),
    "existing page",
  );

  assert.throws(
    () => create_page_preview(REQUEST, { repository_root: fixture_root }),
    /Page file already exists/,
  );
});

test("rejects identifiers already registered in admin settings", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));
  const settings_path = fixture_file(fixture_root, "settings_registry");
  writeFileSync(
    settings_path,
    `${readFileSync(settings_path, "utf8")}export const ADMIN_SERVER_TOOLS = "admin_server_tools";\n`,
  );

  assert.throws(
    () => create_page_preview(REQUEST, { repository_root: fixture_root }),
    /already exists.*AdminSettings\.jsx/,
  );
});

test("rejects admin source files whose expected anchors changed", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));
  const sidebar_path = fixture_file(fixture_root, "sidebar_registry");
  writeFileSync(sidebar_path, "const SIDEBAR_LIST = [];\n");

  assert.throws(
    () => create_page_preview(REQUEST, { repository_root: fixture_root }),
    /Expected one insertion anchor.*Admin\.jsx.*found 0/,
  );
});

test("rejects invalid page identifiers", (t) => {
  const { fixture_root } = create_fixture();
  t.after(() => cleanup_fixture(fixture_root));

  assert.throws(
    () =>
      create_page_preview(
        { ...REQUEST, name: "server_tools" },
        { repository_root: fixture_root },
      ),
    /lowercase kebab-case/,
  );
});
