export const transfer_active = (job) =>
  [
    "previewing",
    "transferring",
    "validating",
    "publishing",
    "verifying",
  ].includes(job?.state);
export const transfer_expired = (job, now = Date.now()) =>
  job?.state === "ready" &&
  (!Number.isFinite(Date.parse(job.expires_at)) ||
    Date.parse(job.expires_at) <= now);
export const transfer_can_apply = (job, now = Date.now()) =>
  job?.protocol_version === 1 &&
  job.state === "ready" &&
  job.publication_supported === true &&
  job.preview_only === false &&
  !transfer_expired(job, now) &&
  /^[a-f0-9]{64}$/.test(job.plan_sha256 || "") &&
  !!job.summary &&
  (job.summary.conflict_files === 0 || job.replacement_policy === "source");
export function transfer_receipt_verified(job) {
  const receipt = job?.receipt,
    summary = job?.summary;
  return (
    job?.protocol_version === 1 &&
    job.state === "completed" &&
    receipt?.protocol_version === 1 &&
    /^[a-f0-9]{64}$/.test(job.manifest_sha256 || "") &&
    receipt.manifest_sha256 === job.manifest_sha256 &&
    /^[a-f0-9]{64}$/.test(summary?.source_catalog_sha256 || "") &&
    receipt.catalog_sha256 === summary.source_catalog_sha256 &&
    Number.isSafeInteger(receipt.files_verified) &&
    receipt.files_verified > 0 &&
    receipt.files_verified === summary.package_files &&
    Number.isSafeInteger(receipt.bytes_verified) &&
    receipt.bytes_verified > 0 &&
    receipt.bytes_verified === summary.package_bytes &&
    Number.isFinite(Date.parse(receipt.completed_at)) &&
    summary.publication_state === "published"
  );
}
const reasons = new Set([
  "upgrade_required",
  "catalog_conflict",
  "file_conflict",
  "snapshot_changed",
  "insufficient_space",
  "storage_not_ready",
  "source_incomplete",
  "unauthorized",
  "busy",
  "expired",
  "checksum_mismatch",
  "validation_failed",
  "verification_failed",
  "peer_unavailable",
  "timeout",
  "interrupted",
  "limit_exceeded",
  "invalid_state",
  "invalid_request",
  "invalid_manifest",
  "invalid_path",
]);
export function transfer_error_key(error) {
  const code = error?.code || (typeof error === "string" ? error : "");
  if (String(error).includes("Untrusted request origin")) return "error_origin";
  if (code === "invalid_sync_peer_configuration") return "error_configuration";
  if (code === "sync_peer_unauthorized") return "error_unauthorized";
  const reason = String(code).replace(/^instrument_transfer_/, "");
  if (["job_not_found", "session_not_found", "file_not_found"].includes(reason))
    return "error_missing";
  if (reason === "cancelled") return "state_cancelled";
  if (reasons.has(reason)) return `error_${reason}`;
  if ([401, 403].includes(error?.status)) return "error_login";
  if (error?.status === 404) return "error_upgrade_required";
  return "error_default";
}
export const transfer_missing_job = (error) =>
  [
    "instrument_transfer_job_not_found",
    "instrument_transfer_session_not_found",
  ].includes(error?.code) || error?.status === 404;
export function transfer_bytes(value, text) {
  if (!Number.isSafeInteger(value) || value < 0) return text("unavailable");
  const units = ["unit_bytes", "unit_kib", "unit_mib", "unit_gib", "unit_tib"];
  const unit = value
    ? Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
    : 0;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value / 1024 ** unit)} ${text(units[unit])}`;
}
