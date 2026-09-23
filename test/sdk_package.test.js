import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as sdk from "../sdk/index.js";
import FractoCanvasBuffer from "../sdk/FractoCanvasBuffer.js";

const repository_root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("SDK public entry point exposes framework-neutral APIs", () => {
  assert.equal(sdk.FractoCanvasBuffer, FractoCanvasBuffer);
  assert.equal(typeof sdk.FractoFastCalc.calc, "function");
  assert.equal(typeof sdk.FractoColors.pattern_hue, "function");
  assert.equal(typeof sdk.Complex, "function");
  assert.equal(typeof sdk.to_complex_point, "function");
});

test("SDK source has no UI or application-settings dependencies", () => {
  const sdk_files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entry_path = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entry_path);
      } else if (entry.name.endsWith(".js")) {
        sdk_files.push(entry_path);
      }
    }
  };
  visit(path.join(repository_root, "sdk"));

  const forbidden_imports =
    /from\s+["'][^"']*(?:AppSettings|TilesBackend|react)[^"']*["']/i;
  for (const sdk_file of sdk_files) {
    const source = fs.readFileSync(sdk_file, "utf8");
    assert.doesNotMatch(
      source,
      forbidden_imports,
      `${path.relative(repository_root, sdk_file)} imports UI application code`,
    );
  }
});
