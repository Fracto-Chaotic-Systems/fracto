import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serialize } from "node:v8";
import { spawnSync } from "node:child_process";

test("coverage startup counts the index without duplicate memberships; first query preserves classifications", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-coverage-lazy-"),
  );
  try {
    fs.mkdirSync(path.join(directory, "coverage"));
    for (const category of ["blank", "interior", "needs_update"]) {
      const levels = Array.from({ length: 30 }, () => []);
      if (category === "blank") levels[3] = ["121"];
      if (category === "interior") levels[3] = ["120", "122"];
      if (category === "needs_update") levels[2] = ["12"];
      fs.writeFileSync(
        path.join(directory, "coverage", `${category}.bin`),
        serialize(levels),
      );
    }
    const source = `
      import assert from 'node:assert/strict';
      import FractoIndexedTiles from '@fracto/sdk/FractoIndexedTiles.js';
      import {initialize_coverage,detect_coverage} from '@fracto/sdk/FractoCoverageUtils.js';
      let reads=0;
      for(const [level,code] of [[2,'12'],[3,'120']]) {
        const tile={bottom:0};Object.defineProperty(tile,'short_code',{get(){reads++;return code;}});
        FractoIndexedTiles.integrate_tile_packet('indexed',{level,columns:[{left:0,tiles:[tile]}]});
      }
      let summary;initialize_coverage(value=>summary=value);
      assert.equal(summary.indexed,2);assert.equal(reads,0);
      const scoped=[];scoped[2]=[{short_code:'12'}];
      const result=await detect_coverage({x:0,y:0},1,scoped);
      assert.equal(reads,2);
      const children=result.find(item=>item.level===3);
      assert.deepEqual(children.filtered_by_level.map(item=>item.short_code),['123']);
      assert.deepEqual(children.blanks_by_level.map(item=>item.short_code),['121']);
      assert.deepEqual(children.interiors_with_bounds.map(item=>item.short_code),['122']);
      assert.deepEqual(result.find(item=>item.level===2).needs_update_with_bounds.map(item=>item.short_code),['12']);
      await detect_coverage({x:0,y:0},1,scoped);assert.equal(reads,2);
      initialize_coverage();assert.equal(reads,2);
      await detect_coverage({x:0,y:0},1,scoped);assert.equal(reads,4);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, FRACTO_TILE_INDEX_GENERATION_DIR: directory },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
