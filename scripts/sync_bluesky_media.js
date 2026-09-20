import fetch from "node-fetch";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MEDIA_DOCUMENT_PATH = path.join(
  ROOT_DIR,
  "social",
  "Bluesky",
  "media",
  "MEDIA_UPLOADS.md",
);
const SYNC_LOCK_PATH = `${MEDIA_DOCUMENT_PATH}.sync.lock`;
const BLUESKY_FEED_ENDPOINT =
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const DEFAULT_ACTOR = "fracto-studio.bsky.social";
const DEFAULT_POST_LIMIT = 100;
const MAX_PAGE_SIZE = 100;
const MEDIA_KEY_PATTERN = /^\s*-\s*\*\*Media key:\*\*\s*`([^`]+)`\s*$/gim;

const usage = () => {
  console.log("Usage: node scripts/sync_bluesky_media.js [options]");
  console.log("Options: --actor HANDLE --limit N --pages N [--allow-failure]");
};

const parse_args = (args) => {
  const options = {
    actor: process.env.FRACTO_BLUESKY_ACTOR || DEFAULT_ACTOR,
    limit: Number(process.env.FRACTO_BLUESKY_POST_LIMIT || DEFAULT_POST_LIMIT),
    pages: Number(process.env.FRACTO_BLUESKY_MAX_PAGES || 1),
    allow_failure: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const [key, inline_value] = args[index].split("=", 2);
    const value_for = () => inline_value ?? args[++index];
    if (key === "--help" || key === "-h") {
      usage();
      process.exit(0);
    } else if (key === "--allow-failure") options.allow_failure = true;
    else if (key === "--actor") options.actor = value_for();
    else if (key === "--limit") options.limit = Number(value_for());
    else if (key === "--pages") options.pages = Number(value_for());
    else throw new Error(`Unknown argument "${args[index]}"`);
  }
  if (!options.actor) throw new Error("An actor handle is required");
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(options.pages) || options.pages < 1) {
    throw new Error("--pages must be a positive integer");
  }
  return options;
};

/**
 * Fetch one cursor page from Bluesky's public author-feed endpoint.
 * @param {{actor: string, limit: number, cursor?: string}} options Request options.
 * @returns {Promise<{feed: object[], cursor?: string}>} Feed page.
 */
export const fetch_author_feed = async ({ actor, limit, cursor }) => {
  const params = new URLSearchParams({
    actor,
    limit: String(Math.min(MAX_PAGE_SIZE, limit)),
  });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${BLUESKY_FEED_ENDPOINT}?${params}`);
  if (!response.ok) {
    throw new Error(`Bluesky author feed failed with HTTP ${response.status}`);
  }
  return response.json();
};

const get_blob_cid = (blob) => {
  if (!blob) return null;
  if (typeof blob.ref === "string") return blob.ref;
  return blob.ref?.$link || blob.cid || null;
};

const get_post_url = (actor, uri) => {
  const record_key = uri?.split("/").pop();
  return record_key
    ? `https://bsky.app/profile/${actor}/post/${record_key}`
    : null;
};

/**
 * Read stable media identifiers from the existing Markdown ledger without
 * changing its content. The original document is returned so later writers
 * can preserve all editorial notes and formatting verbatim.
 * @param {string} content Existing MEDIA_UPLOADS.md content.
 * @returns {{content: string, media_keys: Set<string>, has_uploads_section: boolean}}
 * Parsed ledger state.
 */
export const parse_media_document = (content = "") => {
  const media_keys = new Set();
  for (const match of content.matchAll(MEDIA_KEY_PATTERN)) {
    media_keys.add(match[1].trim());
  }
  return {
    content,
    media_keys,
    has_uploads_section: /^##\s+Uploads\s*$/im.test(content),
  };
};

const media_from_embed = (embed) => {
  if (!embed) return [];
  if (embed.$type === "app.bsky.embed.recordWithMedia#view") {
    return media_from_embed(embed.media);
  }
  if (embed.$type === "app.bsky.embed.images#view") {
    return (embed.images || []).map((image, index) => ({
      media_type: "image",
      media_index: index,
      thumbnail_url: image.thumb || null,
      full_size_url: image.fullsize || null,
      alt_text: image.alt || "",
      blob_cid: get_blob_cid(image.image),
      aspect_ratio: image.aspectRatio || null,
    }));
  }
  if (embed.$type === "app.bsky.embed.video#view") {
    return [
      {
        media_type: "video",
        media_index: 0,
        thumbnail_url: embed.thumbnail || null,
        full_size_url: embed.playlist || null,
        alt_text: embed.alt || "",
        blob_cid: get_blob_cid(embed.video),
        aspect_ratio: embed.aspectRatio || null,
      },
    ];
  }
  return [];
};

const format_heading_text = (record) => {
  const description = (record.alt_text || `${record.media_type} upload`)
    .split(/\r?\n/)[0]
    .trim()
    .slice(0, 80);
  return description || `${record.media_type} upload`;
};

/**
 * Render one normalized media record as a Markdown ledger entry.
 * @param {object} record Normalized media record.
 * @returns {string} Markdown entry.
 */
export const format_media_entry = (record) => {
  const uploaded_date = record.uploaded_at
    ? new Date(record.uploaded_at).toISOString().slice(0, 10)
    : "unknown-date";
  const thumbnail = record.thumbnail_url || record.full_size_url || "";
  const full_size = record.full_size_url || record.thumbnail_url || "";
  const thumbnail_line = thumbnail
    ? `[![Thumbnail](${thumbnail})](${full_size})`
    : "No preview URL available.";
  return `### ${uploaded_date} — ${format_heading_text(record)}

${thumbnail_line}

- **Uploaded:** ${record.uploaded_at || "unknown"}
- **Media key:** \`${record.media_key}\`
- **Post URI:** \`${record.post_uri || "unknown"}\`
- **Post CID:** \`${record.post_cid || "unknown"}\`
- **Blob CID:** \`${record.blob_cid || "unknown"}\`
- **Media type:** ${record.media_type}
- **Full-size media:** [open original](${full_size})
- **Source post:** [view post](${record.post_url || "#"})
- **Alt text:** ${record.alt_text || "(none provided)"}
- **Notes:**
`;
};

const NO_UPLOADS_PLACEHOLDER =
  /\n*No media upload records have been imported yet\. Add new entries directly below\s*this line, keeping the newest upload at the top\.\s*/i;

/**
 * Insert new records while preserving existing entries and editorial notes.
 * @param {string} existing_content Existing Markdown ledger.
 * @param {object[]} records Normalized media records.
 * @returns {{content: string, added_records: object[], changed: boolean}}
 * Updated document state.
 */
export const add_new_media_entries = (existing_content, records) => {
  const parsed = parse_media_document(existing_content);
  const seen_keys = new Set(parsed.media_keys);
  const added_records = records
    .filter((record) => record.media_key && !seen_keys.has(record.media_key))
    .sort(
      (left, right) =>
        new Date(right.uploaded_at || 0) - new Date(left.uploaded_at || 0),
    );
  if (!added_records.length) {
    return { content: existing_content, added_records, changed: false };
  }
  const entries = added_records.map(format_media_entry).join("\n\n");
  const uploads_heading = /^##\s+Uploads\s*$/im.exec(existing_content);
  if (!uploads_heading) {
    return {
      content: `${existing_content.trimEnd()}\n\n## Uploads\n\n${entries}\n`,
      added_records,
      changed: true,
    };
  }
  const heading_end = uploads_heading.index + uploads_heading[0].length;
  const before_uploads = existing_content.slice(0, heading_end);
  const after_uploads = existing_content
    .slice(heading_end)
    .replace(NO_UPLOADS_PLACEHOLDER, "\n");
  return {
    content: `${before_uploads}\n\n${entries}\n${after_uploads.trimStart()}`,
    added_records,
    changed: true,
  };
};

/**
 * Convert one author-feed view into normalized media records.
 * @param {object} feed_item Bluesky author-feed item.
 * @param {string} actor Actor handle used for web post links.
 * @returns {object[]} Media records found in the post.
 */
export const extract_media_records = (feed_item, actor) => {
  const post = feed_item?.post;
  const record = post?.record;
  const media = media_from_embed(post?.embed);
  return media.map((asset) => ({
    media_key: `${post.cid}/${asset.blob_cid || asset.media_index}`,
    post_uri: post.uri,
    post_cid: post.cid,
    blob_cid: asset.blob_cid,
    post_url: get_post_url(actor, post.uri),
    uploaded_at: record?.createdAt || null,
    ...asset,
  }));
};

/**
 * Fetch and normalize media from the requested number of author-feed pages.
 * @param {{actor?: string, limit?: number, pages?: number}} options Sync options.
 * @returns {Promise<object[]>} Newest-first normalized media records.
 */
export const collect_media_records = async ({
  actor = DEFAULT_ACTOR,
  limit = DEFAULT_POST_LIMIT,
  pages = 1,
} = {}) => {
  const records = [];
  let cursor;
  for (let page = 0; page < pages && records.length < limit; page += 1) {
    const feed_page = await fetch_author_feed({
      actor,
      limit: Math.min(MAX_PAGE_SIZE, limit - records.length),
      cursor,
    });
    feed_page.feed?.forEach((feed_item) => {
      records.push(...extract_media_records(feed_item, actor));
    });
    cursor = feed_page.cursor;
    if (!cursor || !feed_page.feed?.length) break;
  }
  return records;
};

const main = async () => {
  const options = parse_args(process.argv.slice(2));
  let lock_handle;
  try {
    lock_handle = await open(SYNC_LOCK_PATH, "wx");
    await lock_handle.writeFile(
      `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
    );
    const records = await collect_media_records(options);
    const existing_content = await readFile(MEDIA_DOCUMENT_PATH, "utf8");
    const result = add_new_media_entries(existing_content, records);
    if (result.changed) {
      await writeFile(MEDIA_DOCUMENT_PATH, result.content, "utf8");
    }
    console.log(
      JSON.stringify(
        {
          actor: options.actor,
          fetched_records: records.length,
          added_records: result.added_records.length,
          changed: result.changed,
          document: path.relative(ROOT_DIR, MEDIA_DOCUMENT_PATH),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (options.allow_failure) {
      console.warn(`Bluesky media sync skipped: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    if (lock_handle) {
      await lock_handle.close().catch(() => {});
      await unlink(SYNC_LOCK_PATH).catch(() => {});
    }
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Bluesky media sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
