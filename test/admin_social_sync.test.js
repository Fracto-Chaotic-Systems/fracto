import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { get_social_snapshot_status } from "../servers/fracto-admin-server/handlers/social_sync_service.js";

describe("social snapshot refresh service", () => {
  test("reports a stable freshness contract without contacting Bluesky", () => {
    const status = get_social_snapshot_status();
    assert.equal(typeof status.complete, "boolean");
    assert.equal(typeof status.stale, "boolean");
    assert.equal(typeof status.refresh_ttl_ms, "number");
    if (status.complete) {
      assert.equal(typeof status.updated_at, "string");
      assert.equal(typeof status.age_ms, "number");
    } else {
      assert.equal(status.updated_at, null);
      assert.equal(status.age_ms, null);
    }
  });
});

