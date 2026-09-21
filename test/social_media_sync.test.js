import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  add_new_media_entries,
  add_new_post_entries,
  extract_post_record,
  parse_media_document,
  parse_post_archive,
  synchronize_feed_snapshot,
} from "../scripts/sync_bluesky_media.js";

describe("Bluesky media ledger sync", () => {
  it("normalizes a public post and its engagement metadata", () => {
    const record = extract_post_record(
      {
        post: {
          uri: "at://did:plc:test/app.bsky.feed.post/abc",
          cid: "bafy-post",
          author: { did: "did:plc:test", handle: "fracto.test" },
          record: {
            createdAt: "2026-09-20T12:00:00.000Z",
            text: "A public post",
          },
          replyCount: 2,
          repostCount: 3,
          likeCount: 4,
          quoteCount: 5,
        },
      },
      "fracto.test",
    );

    assert.equal(record.post_cid, "bafy-post");
    assert.equal(record.text, "A public post");
    assert.deepEqual(record.author, {
      did: "did:plc:test",
      handle: "fracto.test",
      display_name: null,
    });
    assert.deepEqual(
      [
        record.reply_count,
        record.repost_count,
        record.like_count,
        record.quote_count,
      ],
      [2, 3, 4, 5],
    );
    assert.equal(record.media_count, 0);
  });

  it("reads stable media keys from an existing ledger", () => {
    const content = `# Bluesky media uploads

<!-- media-ledger-format: 3 -->

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

<!-- media-ledger-format: 3 -->

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

  it("parses post CIDs and legacy date/text fingerprints", () => {
    const content = `# Public post archive

## 2026-09-20 — marked post

<!-- post-cid: marked-cid -->

> Marked post text

## 2026-09-19 — legacy post

> Legacy post text
`;
    const parsed = parse_post_archive(content);

    assert.deepEqual([...parsed.post_cids], ["marked-cid"]);
    assert.equal(parsed.legacy_keys.has("2026-09-19|legacy post text"), true);
  });

  it("adds unseen posts newest first and preserves legacy entries", () => {
    const content = `# Public post archive

## 2026-09-19 — legacy post

> Legacy post text
`;
    const result = add_new_post_entries(content, [
      {
        post_cid: "new-cid",
        post_url: "https://bsky.app/profile/test/post/new",
        created_at: "2026-09-20T12:00:00.000Z",
        text: "New post text",
        like_count: 2,
        reply_count: 1,
        repost_count: 0,
      },
      {
        post_cid: "legacy-cid",
        created_at: "2026-09-19T12:00:00.000Z",
        text: "Legacy post text",
      },
    ]);

    assert.equal(result.changed, true);
    assert.deepEqual(
      result.added_records.map((record) => record.post_cid),
      ["new-cid"],
    );
    assert.ok(
      result.content.indexOf("new-cid") <
        result.content.toLowerCase().indexOf("legacy post text"),
    );
    assert.match(result.content, /post-archive-format: 1/);
  });

  it("does not rewrite an archive when all CIDs are present", () => {
    const content = `# Public post archive

<!-- post-archive-format: 1 -->

## 2026-09-20 — marked post

<!-- post-cid: marked-cid -->

<p><strong>Post content:</strong> <button data-copy-post-content="Marked post text"></button></p>

> Marked post text
`;
    const result = add_new_post_entries(content, [
      {
        post_cid: "marked-cid",
        created_at: "2026-09-20T12:00:00.000Z",
        text: "Marked post text",
      },
    ]);

    assert.equal(result.changed, false);
    assert.equal(result.content, content);
  });

  it("updates both ledgers from one feed snapshot", () => {
    const feed_items = [
      {
        post: {
          uri: "at://did:plc:test/app.bsky.feed.post/shared",
          cid: "shared-cid",
          author: { did: "did:plc:test", handle: "fracto.test" },
          record: {
            createdAt: "2026-09-20T12:00:00.000Z",
            text: "A post with <script>media</script>",
          },
          replyCount: 1,
          repostCount: 2,
          likeCount: 3,
          embed: {
            $type: "app.bsky.embed.images#view",
            images: [
              {
                thumb: "https://example.test/thumb.jpg",
                fullsize: "https://example.test/full.jpg",
                alt: "A test image",
                image: { ref: { $link: "blob-cid" } },
              },
            ],
          },
        },
      },
    ];
    const result = synchronize_feed_snapshot({
      media_content: "# Media ledger\n",
      post_content: "# Public post archive\n",
      feed_items,
      actor: "fracto.test",
    });

    assert.equal(result.post_records.length, 1);
    assert.equal(result.media_records.length, 1);
    assert.equal(result.post_result.added_records.length, 1);
    assert.equal(result.media_result.added_records.length, 1);
    assert.match(result.post_result.content, /shared-cid/);
    assert.match(result.post_result.content, /Post content:/);
    assert.match(result.post_result.content, /data-copy-post-content=/);
    assert.match(result.media_result.content, /shared-cid\/blob-cid/);
    assert.match(
      result.post_result.content,
      /media\/MEDIA_UPLOADS\.md#media-shared-cid-blob-cid/,
    );
    assert.match(result.media_result.content, /id="media-shared-cid-blob-cid"/);
    assert.match(
      result.media_result.content,
      /class="media-ledger-index"[\s\S]*#media-shared-cid-blob-cid/,
    );
    assert.doesNotMatch(result.post_result.content, /<script>/);
    assert.match(result.post_result.content, /&lt;script&gt;/);
  });

  it("excludes reposted posts from the account archive", () => {
    const repost = {
      post: {
        uri: "at://did:plc:other/app.bsky.feed.post/repost",
        cid: "repost-cid",
        author: { did: "did:plc:other", handle: "other.example" },
        record: {
          createdAt: "2026-09-20T12:00:00.000Z",
          text: "A post from another account",
        },
      },
    };
    const result = synchronize_feed_snapshot({
      media_content: "# Media ledger\n\n<!-- media-ledger-format: 3 -->\n",
      post_content: "# Public post archive\n",
      feed_items: [repost],
      actor: "fracto.test",
    });

    assert.deepEqual(result.post_records, []);
    assert.deepEqual(result.media_records, []);
    assert.equal(result.post_result.changed, false);
    assert.equal(result.media_result.changed, false);
  });

  it("removes obsolete numbered media alt-text duplicates", () => {
    const content = `# Public post archive

## 2026-09-20 — post

> Post text

Media alt text: Existing description

Media alt text 1: Duplicate description

Media details: [media 1 details](media/MEDIA_UPLOADS.md#media-example-0)
`;
    const result = add_new_post_entries(content, []);

    assert.equal(result.changed, true);
    assert.match(
      result.content,
      /<strong>Media alt text:<\/strong> Existing description/,
    );
    assert.doesNotMatch(result.content, /Media alt text 1:/);
  });
});
