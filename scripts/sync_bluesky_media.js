import fetch from "node-fetch";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
const POST_ARCHIVE_DOCUMENT_PATH = path.join(
  ROOT_DIR,
  "social",
  "Bluesky",
  "POST_ARCHIVE.md",
);
const SYNC_LOCK_PATH = `${MEDIA_DOCUMENT_PATH}.sync.lock`;
const BLUESKY_FEED_ENDPOINT =
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const DEFAULT_ACTOR = "fracto-studio.bsky.social";
const DEFAULT_POST_LIMIT = 100;
const MAX_PAGE_SIZE = 100;
const BLUESKY_MAX_ATTEMPTS = 3;
const BLUESKY_RETRY_DELAY_MS = 500;
const SYNC_LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MEDIA_LEDGER_FORMAT_VERSION = 3;
const MEDIA_LEDGER_FORMAT_MARKER = /<!--\s*media-ledger-format:\s*(\d+)\s*-->/i;
const POST_ARCHIVE_FORMAT_VERSION = 1;
const POST_ARCHIVE_FORMAT_MARKER = /<!--\s*post-archive-format:\s*(\d+)\s*-->/i;
const MEDIA_KEY_PATTERNS = [
  /^\s*-\s*\*\*Media key:\*\*\s*`([^`]+)`\s*$/gim,
  /<strong>Media key:<\/strong>\s*<code>([^<]+)<\/code>/gim,
];

const usage = () => {
  console.log("Usage: node scripts/sync_bluesky_media.js [options]");
  console.log("Synchronizes the Bluesky media ledger and public post archive.");
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
  const endpoint = `${BLUESKY_FEED_ENDPOINT}?${params}`;
  for (let attempt = 1; attempt <= BLUESKY_MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      if (attempt === BLUESKY_MAX_ATTEMPTS) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, BLUESKY_RETRY_DELAY_MS * 2 ** (attempt - 1)),
      );
      continue;
    }
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    if (response.ok) return response.json();
    if (!retryable || attempt === BLUESKY_MAX_ATTEMPTS) {
      throw new Error(
        `Bluesky author feed failed with HTTP ${response.status}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, BLUESKY_RETRY_DELAY_MS * 2 ** (attempt - 1)),
    );
  }
  throw new Error("Bluesky author feed failed without a response");
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
  for (const pattern of MEDIA_KEY_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      media_keys.add(match[1].trim());
    }
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
    .trim();
  const words = description.split(/\s+/).filter(Boolean);
  if (!words.length) return `${record.media_type} upload`;
  const word_limit = Math.min(8, Math.max(1, Math.ceil(words.length / 2)));
  const shortened = words.slice(0, word_limit).join(" ");
  return words.length > word_limit ? `${shortened}…` : shortened;
};

const shorten_existing_media_titles = (content) =>
  content
    .split(/(?=^##\s+\d{4}-\d{2}-\d{2}\s+—)/m)
    .map((chunk) => {
      const heading = chunk.match(/^(##\s+\d{4}-\d{2}-\d{2}\s+—\s+)([^\n]+)/);
      if (!heading) return chunk;
      const alt_text = chunk.match(/<blockquote>([^<]*)<\/blockquote>/)?.[1];
      if (!alt_text) return chunk;
      const decoded_alt_text = alt_text
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"');
      return chunk.replace(
        heading[0],
        `${heading[1]}${format_heading_text({
          alt_text: decoded_alt_text,
          media_type: "media",
        })}`,
      );
    })
    .join("");

const escape_html = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const format_copy_alt_button = (alt_text) =>
  `<button type="button" class="media-copy-alt" data-copy-alt-text="${escape_html(alt_text)}" title="copy alt text to clipboard" aria-label="copy alt text to clipboard"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V5.5C8 4.67 8.67 4 9.5 4h9C19.33 4 20 4.67 20 5.5v9c0 .83-.67 1.5-1.5 1.5H16v2.5c0 .83-.67 1.5-1.5 1.5h-9C4.67 20 4 19.33 4 18.5v-9C4 8.67 4.67 8 5.5 8H8Zm-2.5 2c-.28 0-.5.22-.5.5v8c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V10.5c0-.28-.22-.5-.5-.5h-9ZM10 6v2h4.5c.83 0 1.5.67 1.5 1.5V14h2V6.5c0-.28-.22-.5-.5-.5h-7.5Z"/></svg></button>`;

const format_technical_details = (record) => {
  const technical_values = [
    ["Uploaded", record.uploaded_at || "unknown"],
    ["Media key", record.media_key],
    ["Post URI", record.post_uri || "unknown"],
    ["Post CID", record.post_cid || "unknown"],
    ["Blob CID", record.blob_cid || "unknown"],
    ["Media type", record.media_type],
  ];
  if (record.aspect_ratio) {
    technical_values.push([
      "Aspect ratio",
      JSON.stringify(record.aspect_ratio),
    ]);
  }
  technical_values.push(["Notes", record.notes || "(none provided)"]);
  const items = technical_values
    .map(
      ([label, value]) =>
        `  <li><strong>${label}:</strong> <code>${escape_html(value)}</code></li>`,
    )
    .join("\n");
  return `<details>\n<summary>technical details</summary>\n<ul>\n${items}\n</ul>\n</details>`;
};

const format_media_properties = (record, full_size, post_url) => `
<div class="media-entry-properties">
<p><strong>Full-size media:</strong> <a href="${escape_html(full_size)}">open original</a></p>
<p><strong>Source post:</strong> <a href="${escape_html(post_url || "#")}">view post</a></p>
<p><strong>Alt text:</strong> ${format_copy_alt_button(record.alt_text || "(none provided)")}</p>
<blockquote>${escape_html(record.alt_text || "(none provided)")}</blockquote>
${format_technical_details(record)}
</div>`;

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
    ? `<a href="${escape_html(full_size)}"><img src="${escape_html(thumbnail)}" alt="Thumbnail" /></a>`
    : "<p>No preview URL available.</p>";
  return `## ${uploaded_date} — ${format_heading_text(record)}

<div class="media-entry">
<div class="media-entry-visual">${thumbnail_line}</div>
${format_media_properties(record, full_size, record.post_url)}
</div>
`;
};

const NO_UPLOADS_PLACEHOLDER =
  /\n*No media upload records have been imported yet\. Add new entries directly below\s*this line, keeping the newest upload at the top\.\s*/i;
const GENERATED_DATE_PATTERN =
  /<p class="ledger-generated"><strong>Ledger generated:<\/strong>[^<]+<\/p>/;

const format_ledger_date = (date = new Date()) =>
  date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });

const ensure_layout_marker = (content) => {
  const marker = `<!-- media-ledger-format: ${MEDIA_LEDGER_FORMAT_VERSION} -->`;
  if (MEDIA_LEDGER_FORMAT_MARKER.test(content)) {
    return content.replace(MEDIA_LEDGER_FORMAT_MARKER, marker);
  }
  return content.replace(/^(#\s+[^\n]+\n)/, `$1\n${marker}\n`);
};

const update_ledger_generated_date = (content) => {
  const generated_line = `<p class="ledger-generated"><strong>Ledger generated:</strong> ${format_ledger_date()}</p>`;
  if (GENERATED_DATE_PATTERN.test(content)) {
    return content.replace(GENERATED_DATE_PATTERN, generated_line);
  }
  return content.replace(
    /(<p class="subtitle">[\s\S]*?<\/p>)/,
    `$1\n${generated_line}`,
  );
};

const LEGACY_TECHNICAL_FIELDS =
  /(?:- \*\*Uploaded:\*\*[^\n]*\n)(?:- \*\*Media key:\*\*[^\n]*\n)(?:- \*\*Post URI:\*\*[^\n]*\n)(?:- \*\*Post CID:\*\*[^\n]*\n)(?:- \*\*Blob CID:\*\*[^\n]*\n)(?:- \*\*Media type:\*\*[^\n]*\n)/g;

const collapse_legacy_technical_fields = (content) => {
  const uploads_heading = /^##\s+Uploads\s*$/im.exec(content);
  if (!uploads_heading) return content;
  const heading_end = uploads_heading.index + uploads_heading[0].length;
  const before_uploads = content.slice(0, heading_end);
  const uploads = content
    .slice(heading_end)
    .replace(LEGACY_TECHNICAL_FIELDS, (block) => {
      const values = Object.fromEntries(
        [...block.matchAll(/- \*\*([^:]+):\*\*\s*(.*)/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
      return `${format_technical_details({
        uploaded_at: values.Uploaded,
        media_key: values["Media key"]?.replaceAll("`", ""),
        post_uri: values["Post URI"]?.replaceAll("`", ""),
        post_cid: values["Post CID"]?.replaceAll("`", ""),
        blob_cid: values["Blob CID"]?.replaceAll("`", ""),
        media_type: values["Media type"],
      })}\n`;
    });
  return `${before_uploads}${uploads}`;
};

const normalize_media_entry_layout = (content) => {
  const chunks = content.split(/(?=^###\s)/m);
  const normalized = chunks
    .map((chunk) => {
      if (
        !chunk.includes("[![Thumbnail]") ||
        chunk.includes('class="media-entry"')
      ) {
        return chunk;
      }
      const thumbnail_match = chunk.match(
        /\[!\[Thumbnail\]\(([^)]+)\)\]\(([^)]+)\)/,
      );
      const details_match = chunk.match(/<details>[\s\S]*?<\/details>/);
      const full_size_match = chunk.match(
        /- \*\*Full-size media:\*\* \[open original\]\(([^)]+)\)/,
      );
      const post_match = chunk.match(
        /- \*\*Source post:\*\* \[view post\]\(([^)]+)\)/,
      );
      const alt_match = chunk.match(/- \*\*Alt text:\*\* ([^\n]*)/);
      if (!thumbnail_match || !details_match) return chunk;
      const properties = `
<div class="media-entry-properties">
${details_match[0]}
<p><strong>Full-size media:</strong> <a href="${escape_html(full_size_match?.[1] || thumbnail_match[2])}">open original</a></p>
<p><strong>Source post:</strong> <a href="${escape_html(post_match?.[1] || "#")}">view post</a></p>
<p><strong>Alt text:</strong> ${escape_html(alt_match?.[1] || "(none provided)")}</p>
</div>`;
      const heading_match = chunk.match(/^###[^\n]+/m);
      const heading = heading_match?.[0] || "";
      const prefix = heading_match ? chunk.slice(0, heading_match.index) : "";
      return `${prefix}${heading}

<div class="media-entry">
<div class="media-entry-visual"><a href="${escape_html(thumbnail_match[2])}"><img src="${escape_html(thumbnail_match[1])}" alt="Thumbnail" /></a></div>
${properties}
</div>
`;
    })
    .join("");
  const with_notes = normalized.replace(
    /(<details>[\s\S]*?<\/details>)\n<p><strong>Notes:<\/strong>\s*([^<]*)<\/p>/g,
    (_match, details, notes) => {
      const note_value = notes.trim() || "(none provided)";
      const note_item = `  <li><strong>Notes:</strong> <code>${escape_html(note_value)}</code></li>\n`;
      return details.replace("</ul>", `${note_item}</ul>`);
    },
  );
  return with_notes
    .replace(/<details>[\s\S]*?<\/details>/g, (details) => {
      if (details.includes("<strong>Notes:</strong>")) return details;
      const note_item =
        "  <li><strong>Notes:</strong> <code>(none provided)</code></li>\n";
      return details.replace("</ul>", `${note_item}</ul>`);
    })
    .replace(/\n<p><strong>Notes:<\/strong>[^<]*<\/p>/g, "")
    .replace(
      /<p><strong>Alt text:<\/strong><\/p>\n<blockquote>([^<]*)<\/blockquote>/g,
      (_match, alt_text) =>
        `<p><strong>Alt text:</strong> ${format_copy_alt_button(alt_text)}</p>\n<blockquote>${alt_text}</blockquote>`,
    )
    .replace(
      /<p><strong>Alt text:<\/strong>\s*([^<]*)<\/p>/g,
      (_match, alt_text) =>
        `<p><strong>Alt text:</strong> ${format_copy_alt_button(alt_text)}</p>\n<blockquote>${alt_text}</blockquote>`,
    )
    .replace(
      /<blockquote><strong>Alt text:<\/strong>\s*([^<]*)<\/blockquote>/g,
      (_match, alt_text) =>
        `<p><strong>Alt text:</strong> ${format_copy_alt_button(alt_text)}</p>\n<blockquote>${alt_text}</blockquote>`,
    )
    .replace(
      /(<div class="media-entry-properties">\n)(<details>[\s\S]*?<\/details>\n)([\s\S]*?)(<\/div>)/g,
      (_match, opening, details, properties, closing) =>
        `${opening}${properties}${details}${closing}`,
    )
    .replace(/<\/div>\n(?=###\s)/g, "</div>\n\n");
};

const add_aspect_ratios_to_details = (content, records) => {
  let updated = content;
  records.forEach((record) => {
    if (!record.media_key || !record.aspect_ratio) return;
    const aspect_ratio = escape_html(JSON.stringify(record.aspect_ratio));
    const media_key = escape_html(record.media_key);
    const media_block_pattern = new RegExp(
      `(<details>[\\s\\S]*?<strong>Media key:<\\/strong>\\s*<code>${media_key.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}<\\/code>[\\s\\S]*?<\\/details>)`,
      "i",
    );
    updated = updated.replace(media_block_pattern, (details) => {
      if (details.includes("<strong>Aspect ratio:</strong>")) return details;
      const item = `  <li><strong>Aspect ratio:</strong> <code>${aspect_ratio}</code></li>\n`;
      return details.replace("</ul>", `${item}</ul>`);
    });
  });
  return updated;
};

/**
 * Insert new records while preserving existing entries and editorial notes.
 * @param {string} existing_content Existing Markdown ledger.
 * @param {object[]} records Normalized media records.
 * @returns {{content: string, added_records: object[], changed: boolean}}
 * Updated document state.
 */
export const add_new_media_entries = (existing_content, records) => {
  const normalized_content = ensure_layout_marker(
    add_aspect_ratios_to_details(
      shorten_existing_media_titles(
        normalize_media_entry_layout(
          collapse_legacy_technical_fields(existing_content),
        ),
      ),
      records,
    ).replace(/^###\s+/gm, "## "),
  );
  const parsed = parse_media_document(normalized_content);
  const seen_keys = new Set(parsed.media_keys);
  const added_records = records
    .filter((record) => record.media_key && !seen_keys.has(record.media_key))
    .sort(
      (left, right) =>
        new Date(right.uploaded_at || 0) - new Date(left.uploaded_at || 0),
    );
  if (!added_records.length) {
    const content =
      normalized_content !== existing_content
        ? update_ledger_generated_date(normalized_content)
        : normalized_content;
    return {
      content,
      added_records,
      changed: content !== existing_content,
    };
  }
  const entries = added_records.map(format_media_entry).join("\n\n");
  const uploads_heading = /^##\s+Uploads\s*$/im.exec(normalized_content);
  if (!uploads_heading) {
    const first_media_heading = /^##\s+\d{4}-\d{2}-\d{2}[^\n]*$/m.exec(
      normalized_content,
    );
    const content_before_first_media = first_media_heading
      ? normalized_content.slice(0, first_media_heading.index).trimEnd()
      : normalized_content.trimEnd();
    const content_after_first_media = first_media_heading
      ? normalized_content.slice(first_media_heading.index)
      : "";
    const content = update_ledger_generated_date(
      `${content_before_first_media}\n\n${entries}\n${content_after_first_media}`,
    );
    return {
      content,
      added_records,
      changed: true,
    };
  }
  const heading_end = uploads_heading.index + uploads_heading[0].length;
  const before_uploads = normalized_content.slice(0, heading_end);
  const after_uploads = normalized_content
    .slice(heading_end)
    .replace(NO_UPLOADS_PLACEHOLDER, "\n");
  const content = update_ledger_generated_date(
    `${before_uploads}\n\n${entries}\n${after_uploads.trimStart()}`,
  );
  return {
    content,
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
 * Convert one author-feed view into a normalized public-post record.
 * @param {object} feed_item Bluesky author-feed item.
 * @param {string} actor Actor handle used for web post links.
 * @returns {object|null} Normalized post record, or null for an incomplete item.
 */
export const extract_post_record = (feed_item, actor) => {
  const post = feed_item?.post;
  const record = post?.record;
  if (!post?.cid || !record) return null;
  const media = media_from_embed(post.embed);
  return {
    post_uri: post.uri || null,
    post_cid: post.cid,
    post_url: get_post_url(actor, post.uri),
    created_at: record.createdAt || null,
    text: record.text || "",
    author: {
      did: post.author?.did || null,
      handle: post.author?.handle || actor,
      display_name: post.author?.displayName || null,
    },
    reply: record.reply
      ? {
          parent_uri: record.reply.parent?.uri || null,
          root_uri: record.reply.root?.uri || null,
        }
      : null,
    reply_count: post.replyCount || 0,
    repost_count: post.repostCount || 0,
    like_count: post.likeCount || 0,
    quote_count: post.quoteCount || 0,
    media_count: media.length,
    media,
    feed_reason: feed_item.reason?.$type || null,
  };
};

const belongs_to_actor = (feed_item, actor) => {
  const author = feed_item?.post?.author;
  if (!author) return false;
  return [author.handle, author.did]
    .filter(Boolean)
    .some(
      (value) => String(value).toLowerCase() === String(actor).toLowerCase(),
    );
};

const owned_feed_items = (feed_items, actor) =>
  feed_items.filter((feed_item) => belongs_to_actor(feed_item, actor));

const normalize_post_text = (text = "") =>
  String(text).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

const post_date = (record) =>
  record.created_at
    ? new Date(record.created_at).toISOString().slice(0, 10)
    : "unknown-date";

const post_legacy_key = (date, text) =>
  `${date}|${normalize_post_text(text).toLowerCase()}`;

const POST_CID_PATTERN = /<!--\s*post-cid:\s*([^\s]+)\s*-->/gi;
const POST_HEADING_PATTERN = /^##\s+(\d{4}-\d{2}-\d{2})\s+[^\n]+$/gm;
const POST_SUBHEADING_PATTERN = /^###\s+[^\n]+$/gm;

const parse_post_section = (section, date) => {
  const cids = [...section.matchAll(POST_CID_PATTERN)].map((match) =>
    match[1].trim(),
  );
  const quoted_text = [...section.matchAll(/^>\s?(.*)$/gm)]
    .map((match) => match[1])
    .join(" ");
  return {
    cids,
    legacy_key: quoted_text ? post_legacy_key(date, quoted_text) : null,
  };
};

/**
 * Read stable post identifiers from the existing public archive. Entries
 * created before CID markers were introduced are represented by a date/text
 * fingerprint so the first refresh does not duplicate the seeded archive.
 * @param {string} content Existing POST_ARCHIVE.md content.
 * @returns {{content: string, post_cids: Set<string>, legacy_keys: Set<string>}}
 * Parsed archive state.
 */
export const parse_post_archive = (content = "") => {
  const post_cids = new Set();
  const legacy_keys = new Set();
  const headings = [...content.matchAll(POST_HEADING_PATTERN)];
  headings.forEach((heading, index) => {
    const section_start = heading.index + heading[0].length;
    const section_end = headings[index + 1]?.index ?? content.length;
    const section = content.slice(section_start, section_end);
    const subheadings = [...section.matchAll(POST_SUBHEADING_PATTERN)];
    const sections = subheadings.length
      ? subheadings.map((subheading, sub_index) => {
          const start = subheading.index + subheading[0].length;
          const end = subheadings[sub_index + 1]?.index ?? section.length;
          return section.slice(start, end);
        })
      : [section];
    sections.forEach((post_section) => {
      const parsed = parse_post_section(post_section, heading[1]);
      parsed.cids.forEach((cid) => post_cids.add(cid));
      if (parsed.legacy_key) legacy_keys.add(parsed.legacy_key);
    });
  });
  return { content, post_cids, legacy_keys };
};

const format_post_heading_text = (text) => {
  const words = normalize_post_text(text).split(" ").filter(Boolean);
  if (!words.length) return "untitled post";
  const shortened = words.slice(0, 8).join(" ");
  return escape_html(words.length > 8 ? `${shortened}…` : shortened);
};

const format_post_text = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .map((line) => `> ${escape_html(line.trim())}`)
    .join("\n");

const format_snapshot = (record) => {
  const likes = Number(record.like_count || 0);
  const replies = Number(record.reply_count || 0);
  const reposts = Number(record.repost_count || 0);
  return `Snapshot: ${likes} ${likes === 1 ? "like" : "likes"}, ${replies} ${replies === 1 ? "reply" : "replies"}, ${reposts} ${reposts === 1 ? "repost" : "reposts"}.`;
};

/**
 * Render one normalized public-post record in the archive's Markdown style.
 * The hidden CID marker makes subsequent refreshes idempotent without
 * exposing implementation identifiers in the visible post listing.
 * @param {object} record Normalized public-post record.
 * @returns {string} Markdown archive entry.
 */
export const format_post_entry = (record) => {
  const date = post_date(record);
  const post_url = record.post_url || "#";
  return `## ${date} — ${format_post_heading_text(record.text)}\n\n<!-- post-cid: ${record.post_cid} -->\n\n${format_post_text(record.text)}\n\n<p><strong>Source post:</strong> <a href="${escape_html(post_url)}">view post</a></p>\n\n${format_snapshot(record)}\n`;
};

const ensure_post_archive_marker = (content) => {
  const marker = `<!-- post-archive-format: ${POST_ARCHIVE_FORMAT_VERSION} -->`;
  if (POST_ARCHIVE_FORMAT_MARKER.test(content)) {
    return content.replace(POST_ARCHIVE_FORMAT_MARKER, marker);
  }
  return content.replace(/^(#\s+[^\n]+\n)/, `$1\n${marker}\n`);
};

/**
 * Add unseen posts to the public archive, newest first, while preserving
 * existing editorial content. Records are deduplicated by CID; legacy entries
 * without a marker use their date/text fingerprint during migration.
 * @param {string} existing_content Existing POST_ARCHIVE.md content.
 * @param {object[]} records Normalized public-post records.
 * @returns {{content: string, added_records: object[], changed: boolean}}
 * Updated archive state.
 */
export const add_new_post_entries = (existing_content, records) => {
  const parsed = parse_post_archive(existing_content);
  const added_records = records
    .filter((record) => {
      if (!record?.post_cid) return false;
      if (parsed.post_cids.has(record.post_cid)) return false;
      return !parsed.legacy_keys.has(
        post_legacy_key(post_date(record), record.text),
      );
    })
    .sort(
      (left, right) =>
        new Date(right.created_at || 0) - new Date(left.created_at || 0),
    );
  if (!added_records.length) {
    return { content: existing_content, added_records, changed: false };
  }
  const entries = added_records.map(format_post_entry).join("\n\n");
  const marked_content = ensure_post_archive_marker(existing_content);
  const first_post_heading = /^##\s+\d{4}-\d{2}-\d{2}\s+[^\n]*$/m.exec(
    marked_content,
  );
  const insertion_index = first_post_heading?.index ?? marked_content.length;
  const before = marked_content.slice(0, insertion_index).trimEnd();
  const after = marked_content.slice(insertion_index).trimStart();
  const content = `${before}\n\n${entries}\n\n${after}`.replace(
    /\n{4,}/g,
    "\n\n\n",
  );
  return { content, added_records, changed: true };
};

const collect_feed_items = async ({
  actor = DEFAULT_ACTOR,
  limit = DEFAULT_POST_LIMIT,
  pages = 1,
} = {}) => {
  const items = [];
  let cursor;
  for (let page = 0; page < pages && items.length < limit; page += 1) {
    const feed_page = await fetch_author_feed({
      actor,
      limit: Math.min(MAX_PAGE_SIZE, limit - items.length),
      cursor,
    });
    items.push(...(feed_page.feed || []));
    cursor = feed_page.cursor;
    if (!cursor || !feed_page.feed?.length) break;
  }
  return items.slice(0, limit);
};

/**
 * Fetch and normalize public posts from the requested author-feed pages.
 * @param {{actor?: string, limit?: number, pages?: number}} options Feed options.
 * @returns {Promise<object[]>} Newest-first normalized post records.
 */
export const collect_post_records = async (options = {}) => {
  const { actor = DEFAULT_ACTOR } = options;
  return owned_feed_items(await collect_feed_items(options), actor)
    .map((feed_item) => extract_post_record(feed_item, actor))
    .filter(Boolean);
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
  const feed_items = owned_feed_items(
    await collect_feed_items({ actor, limit, pages }),
    actor,
  );
  return feed_items.flatMap((feed_item) =>
    extract_media_records(feed_item, actor),
  );
};

/**
 * Apply one already-fetched feed snapshot to both social documents.
 * Keeping this transformation separate from filesystem access makes the
 * two-ledger consistency rule testable without network or build state.
 * @param {{media_content: string, post_content: string, feed_items: object[], actor: string}}
 * options Snapshot and existing document contents.
 * @returns {{media_result: object, post_result: object, media_records: object[], post_records: object[]}}
 * Results for both document updates.
 */
export const synchronize_feed_snapshot = ({
  media_content,
  post_content,
  feed_items,
  actor = DEFAULT_ACTOR,
}) => {
  const owned_items = owned_feed_items(feed_items, actor);
  const media_records = owned_items.flatMap((feed_item) =>
    extract_media_records(feed_item, actor),
  );
  const post_records = owned_items
    .map((feed_item) => extract_post_record(feed_item, actor))
    .filter(Boolean);
  return {
    media_result: add_new_media_entries(media_content, media_records),
    post_result: add_new_post_entries(post_content, post_records),
    media_records,
    post_records,
  };
};

/**
 * Replace a Markdown document atomically within its containing directory.
 * A same-directory rename keeps readers from observing a partial write if a
 * build or process is interrupted while the generated content is being saved.
 * @param {string} file_path Destination document path.
 * @param {string} content Complete replacement content.
 * @returns {Promise<void>} Resolves after the replacement is published.
 */
const write_document_atomically = async (file_path, content) => {
  const temporary_path = `${file_path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary_path, content, "utf8");
    await rename(temporary_path, file_path);
  } finally {
    await unlink(temporary_path).catch(() => {});
  }
};

/**
 * Acquire the synchronization lock, reclaiming only a clearly stale lock.
 * @returns {Promise<import("node:fs/promises").FileHandle>} Open lock handle.
 */
const acquire_sync_lock = async () => {
  try {
    return await open(SYNC_LOCK_PATH, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock_metadata;
    try {
      lock_metadata = JSON.parse(await readFile(SYNC_LOCK_PATH, "utf8"));
    } catch {
      throw error;
    }
    const started_at = Date.parse(lock_metadata.started_at || "");
    if (!Number.isFinite(started_at)) throw error;
    if (Date.now() - started_at < SYNC_LOCK_MAX_AGE_MS) throw error;
    console.warn(
      `Removing stale Bluesky sync lock from ${lock_metadata.started_at}`,
    );
    await unlink(SYNC_LOCK_PATH);
    return open(SYNC_LOCK_PATH, "wx");
  }
};

const main = async () => {
  const options = parse_args(process.argv.slice(2));
  let lock_handle;
  try {
    lock_handle = await acquire_sync_lock();
    await lock_handle.writeFile(
      `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
    );
    // Fetch the feed once and derive both documents from the same snapshot.
    // This keeps media and post records internally consistent and avoids
    // consuming two API pages during each build.
    const feed_items = await collect_feed_items(options);
    const existing_media = await readFile(MEDIA_DOCUMENT_PATH, "utf8");
    const existing_posts = await readFile(POST_ARCHIVE_DOCUMENT_PATH, "utf8");
    const { media_result, post_result, media_records, post_records } =
      synchronize_feed_snapshot({
        media_content: existing_media,
        post_content: existing_posts,
        feed_items,
        actor: options.actor,
      });
    if (media_result.changed) {
      await write_document_atomically(
        MEDIA_DOCUMENT_PATH,
        media_result.content,
      );
    }
    if (post_result.changed) {
      await write_document_atomically(
        POST_ARCHIVE_DOCUMENT_PATH,
        post_result.content,
      );
    }
    console.log(
      JSON.stringify(
        {
          actor: options.actor,
          fetched_posts: post_records.length,
          fetched_media: media_records.length,
          added_posts: post_result.added_records.length,
          added_media: media_result.added_records.length,
          changed: media_result.changed || post_result.changed,
          documents: [
            path.relative(ROOT_DIR, MEDIA_DOCUMENT_PATH),
            path.relative(ROOT_DIR, POST_ARCHIVE_DOCUMENT_PATH),
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (options.allow_failure) {
      console.warn(`Bluesky social sync skipped: ${error.message}`);
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
    console.error(`Bluesky social sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
