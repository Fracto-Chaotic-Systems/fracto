import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { create_skill_runtime } from "../servers/fracto-ai-server/skills/runtime.js";
import { run_active } from "../servers/fracto-ai-server/skills/executor.js";
import { select_correction_request } from "../servers/fracto-ai-server/data_quality/request.js";
import { duplicate_fixture } from "../servers/fracto-ai-server/data_quality/builtin.js";
import { CorrectionStore } from "../servers/fracto-data-server/corrections/storage.js";

test("AI read-only proposal passes independent owner preview/approval/apply/rollback without live tables", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-correction-integration-"),
  );
  const registry = create_skill_runtime({
    FRACTO_AI_SKILL_DIR: path.join(directory, "skills"),
  });
  const owner = new CorrectionStore(path.join(directory, "owner"));
  t.after(() => {
    registry?.close();
    owner.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.ok(registry);
  const input = duplicate_fixture();
  owner.register("world", input);
  const report = run_active(
    registry,
    "environment-asset-quality",
    owner.read("world"),
  );
  assert.equal(report.apply_supported, false);
  const request = select_correction_request(
    report,
    report.proposals[0].proposal_digest,
  );
  const plan = owner.preview("world", request);
  assert.equal(plan.state, "prepared");
  assert.throws(() => owner.apply(plan.plan_digest), /CORRECTION_NOT_APPROVED/);
  owner.approve(plan.plan_digest, request.snapshot_digest);
  const applied = owner.apply(plan.plan_digest);
  assert.equal(
    run_active(registry, "environment-asset-quality", owner.read("world"))
      .state,
    "clean",
  );
  owner.approve_rollback(plan.plan_digest, applied.after_digest);
  owner.rollback(plan.plan_digest);
  assert.deepEqual(owner.read("world").environments[0].asset_ids, [1, 1]);
  assert.equal(owner.read("world").dataset_revision, 3);
  assert.equal(
    registry.get("environment-asset-quality", "1.0.0").definition
      .permissions[0],
    "snapshot:read",
  );
});
