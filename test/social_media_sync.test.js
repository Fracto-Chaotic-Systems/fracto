import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  add_new_media_entries,
  parse_media_document,
} from "../scripts/sync_bluesky_media.js";

describe("Bluesky media ledger sync", () => {
  it("reads stable media keys from an existing ledger", () => {
    const content = `# Bluesky media uploads

## Uploads

- **Media key:** \`post-cid/blob-cid\`
`;

    const parsed = parse_media_document(content);

    assert.equal(parsed.has_uploads_section, true);
    assert.deepEqual([...parsed.media_keys], ["post-cid/blob-cid"]);
  });

  it("adds only unseen records in newest-first order", () => {
    const content = `# Bluesky media uploads

## Uploads

No media upload records have been imported yet. Add new entries directly below this line, keeping the newest upload at the top.
`;
    const records = [
      {
        media_key: "older-post/older-blob",
        uploaded_at: "2026-09-19T12:00:00.000Z",
        media_type: "image",
        thumbnail_url: "https://example.test/older-thumb.jpg",
        full_size_url: "https://example.test/older.jpg",
        alt_text: "Older image",
      },
      {
        media_key: "newer-post/newer-blob",
        uploaded_at: "2026-09-20T12:00:00.000Z",
        media_type: "image",
        thumbnail_url: "https://example.test/newer-thumb.jpg",
        full_size_url: "https://example.test/newer.jpg",
        alt_text: "Newer image",
      },
    ];

    const result = add_new_media_entries(content, records);

    assert.equal(result.changed, true);
    assert.equal(result.added_records.length, 2);
    assert.ok(
      result.content.indexOf("newer-post/newer-blob") <
        result.content.indexOf("older-post/older-blob"),
    );
    assert.doesNotMatch(result.content, /No media upload records/);
  });

  it("does not rewrite a ledger when every record is already present", () => {
    const content = `# Bluesky media uploads

## Uploads

- **Media key:** \`post-cid/blob-cid\`
`;
    const result = add_new_media_entries(content, [
      {
        media_key: "post-cid/blob-cid",
        uploaded_at: "2026-09-20T12:00:00.000Z",
        media_type: "image",
      },
    ]);

    assert.equal(result.changed, false);
    assert.equal(result.content, content);
    assert.deepEqual(result.added_records, []);
  });
});
