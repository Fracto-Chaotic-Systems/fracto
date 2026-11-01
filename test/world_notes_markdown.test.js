import assert from "node:assert/strict";
import test from "node:test";
import {
  editorial_content,
  format_world_notes,
} from "../scripts/world_notes_markdown.js";

test("editorial formatting preserves Unicode, candidate order, references and prose", () => {
  const source =
    "2 x 7: relation x value.\n\nWorld name suggestions (unapproved):\n- Café: Favored first.\n  Source attribution: An author's work.\n  Reference: https://example.org/a_(b)\n- Other: Second choice.\n  Usage review: Pending.";
  const result = format_world_notes(source);
  assert.match(result, /### World name suggestions/);
  assert.match(result, /- \*\*Café:\*\* Favored first\./);
  assert.match(result, /  - \*\*Reference:\*\* https:\/\/example.org\/a_\(b\)/);
  assert.equal(editorial_content(result), editorial_content(source));
  assert.equal(format_world_notes(result), result);
});

test("unstructured and previously curated Markdown are not rewritten", () => {
  for (const source of [
    "",
    "An **existing** note.",
    "### World name suggestions (unapproved):\n\n- **Name:** Custom text.",
  ]) {
    assert.equal(format_world_notes(source), source);
  }
});
