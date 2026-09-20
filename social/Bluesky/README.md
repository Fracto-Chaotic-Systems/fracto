# Bluesky

This folder contains the Bluesky post archive, response log, and media-upload
references used to plan and document public communication.

The media ledger includes a hidden `media-ledger-format` marker. Increment that
version in the sync script when its layout changes and add a migration for the
prior format; the next refresh will rewrite the ledger once.

The public post archive uses hidden `post-archive-format` and `post-cid` markers
for idempotent updates. Run `npm run social:sync` (or the launch scripts that
invoke it) to fetch one author-feed snapshot and refresh both the post archive
and media ledger. Existing seeded posts without CIDs are matched by their UTC
date and normalized text during the first refresh.

Changed documents are published with an atomic same-directory replacement, so
an interrupted build leaves the previous complete ledger available rather than
an incomplete Markdown file.

Feed requests retry transient network, timeout, rate-limit, and server errors
with a short bounded exponential delay. Permanent responses still fail a
strict manual sync, while launch workflows may continue with the last valid
documents via `--allow-failure`.

The sync lock is reclaimed automatically only when its valid timestamp is more
than six hours old. Active or malformed locks are not removed automatically.

Post text and generated headings are HTML-escaped before being written. This
keeps externally supplied post content from becoming markup when the UI's
Markdown renderer processes the archive's trusted layout HTML.

The account archive intentionally excludes reposted material returned by the
author-feed endpoint. Only records whose author matches the configured actor
are written.

Posts that contain media include each asset's alt text and an internal link to
the corresponding anchored entry in `media/MEDIA_UPLOADS.md`. Existing seeded
post entries are enriched with those links when their matching feed records are
seen during synchronization.
