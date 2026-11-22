/** Explicit remote source configuration; the SDK never loads consumer files. */
export function remote_tile_base_url(environment = process.env) {
  const value = environment.FRACTO_TILE_REMOTE_BASE_URL;
  if (typeof value !== "string" || !value.trim())
    throw new Error(
      "FRACTO_TILE_REMOTE_BASE_URL is required for remote tile access",
    );
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid tile source URL");
  return value.trim().replace(/\/$/, "");
}
