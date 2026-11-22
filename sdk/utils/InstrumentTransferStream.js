import { TRANSFER_LIMITS, transfer_error } from "./InstrumentTransfer.js";

export function binary_length(headers) {
  const get = (name) => (headers.get ? headers.get(name) : headers[name]);
  const length = get("content-length");
  if (
    !/^[1-9][0-9]*$/.test(length || "") ||
    !Number.isSafeInteger(Number(length)) ||
    Number(length) > TRANSFER_LIMITS.file_bytes ||
    get("content-encoding") ||
    get("content-type") !== "application/octet-stream"
  )
    throw transfer_error("invalid_request", 400);
  return Number(length);
}
export function transfer_deadline(
  signal,
  {
    idle_ms = TRANSFER_LIMITS.file_idle_seconds * 1000,
    absolute_ms = TRANSFER_LIMITS.file_seconds * 1000,
  } = {},
) {
  const controller = new AbortController();
  let idle;
  const expire = () => controller.abort(transfer_error("timeout", 503));
  const absolute = setTimeout(expire, absolute_ms);
  absolute.unref?.();
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(expire, idle_ms);
    idle.unref?.();
  };
  touch();
  return {
    signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
    touch,
    close: () => {
      clearTimeout(idle);
      clearTimeout(absolute);
    },
  };
}
