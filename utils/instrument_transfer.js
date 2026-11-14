import { createHash } from "node:crypto";

export const TRANSFER_LIMITS = Object.freeze({
  control_bytes: 64 * 1024,
  manifest_bytes: 32 * 1024 * 1024,
  preview_request_bytes: 96 * 1024 * 1024,
  manifest_files: 10000,
  file_bytes: 512 * 1024 * 1024,
  package_bytes: 32 * 1024 ** 3,
  concurrent_files: 2,
  preview_seconds: 1800,
  session_idle_seconds: 300,
  file_idle_seconds: 60,
  file_seconds: 1800,
  apply_seconds: 21600,
});
export const transfer_hash = (value) =>
  createHash("sha256").update(value).digest("hex");
export const json_hash = (value) => transfer_hash(JSON.stringify(value));
export const is_hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const transfer_error = (reason, status = 409) =>
  Object.assign(new Error(`instrument_transfer_${reason}`), {
    code: `instrument_transfer_${reason}`,
    status,
  });
export const public_transfer_error = (error) => ({
  code: /^instrument_transfer_[a-z_]+$/.test(error?.code || "")
    ? error.code
    : "instrument_transfer_validation_failed",
  retryable: ["busy", "peer_unavailable", "timeout", "interrupted"].some(
    (reason) => error?.code === `instrument_transfer_${reason}`,
  ),
});
export function exact_fields(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw transfer_error("invalid_request", 400);
}
export function version_body(value) {
  exact_fields(value, ["protocol_version"]);
  if (value.protocol_version !== 1) throw transfer_error("upgrade_required");
}
export function canonical_manifest(value) {
  exact_fields(value, ["protocol_version", "catalog_sha256", "files"]);
  if (value.protocol_version !== 1) throw transfer_error("upgrade_required");
  if (
    !is_hash(value.catalog_sha256) ||
    !Array.isArray(value.files) ||
    !value.files.length
  )
    throw transfer_error("invalid_manifest", 400);
  if (value.files.length > TRANSFER_LIMITS.manifest_files)
    throw transfer_error("limit_exceeded", 413);
  const seen = new Set();
  let bytes = 0;
  const files = value.files
    .map((file) => {
      exact_fields(file, [
        "file_id",
        "kind",
        "relative_path",
        "bytes",
        "sha256",
      ]);
      const relative = file.relative_path;
      if (
        typeof relative !== "string" ||
        relative.length > 240 ||
        !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(
          relative,
        ) ||
        relative
          .split("/")
          .some((part) =>
            /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
          )
      )
        throw transfer_error("invalid_path", 400);
      if (
        seen.has(relative.toLowerCase()) ||
        file.file_id !== transfer_hash(relative) ||
        !["catalog", "index", "original", "playback", "support"].includes(
          file.kind,
        ) ||
        !is_hash(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes <= 0
      )
        throw transfer_error("invalid_manifest", 400);
      if (file.bytes > TRANSFER_LIMITS.file_bytes)
        throw transfer_error("limit_exceeded", 413);
      seen.add(relative.toLowerCase());
      bytes += file.bytes;
      return {
        file_id: file.file_id,
        kind: file.kind,
        relative_path: relative,
        bytes: file.bytes,
        sha256: file.sha256,
      };
    })
    .sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));
  if (bytes > TRANSFER_LIMITS.package_bytes)
    throw transfer_error("limit_exceeded", 413);
  const catalogs = files.filter((file) => file.kind === "catalog");
  if (
    catalogs.length !== 1 ||
    catalogs[0].relative_path !== "catalog.json" ||
    catalogs[0].sha256 !== value.catalog_sha256
  )
    throw transfer_error("invalid_manifest", 400);
  const manifest = {
    protocol_version: 1,
    catalog_sha256: value.catalog_sha256,
    files,
  };
  if (
    Buffer.byteLength(JSON.stringify(manifest)) > TRANSFER_LIMITS.manifest_bytes
  )
    throw transfer_error("limit_exceeded", 413);
  return manifest;
}
