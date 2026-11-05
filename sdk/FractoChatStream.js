/** Incremental UTF-8 NDJSON reader with bounded wire size and framing. */
export async function* read_json_lines(
  body,
  { signal, max_bytes = 2 * 1024 * 1024, max_records = 4096 } = {},
) {
  const reader = body?.getReader();
  if (!reader) throw new Error("INVALID_STREAM");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    bytes = 0,
    records = 0;
  const parse = (line) => {
    if (++records > max_records) throw new Error("INVALID_STREAM");
    const value = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("INVALID_STREAM");
    return value;
  };
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        pending += decoder.decode();
        break;
      }
      bytes += value.byteLength;
      if (bytes > max_bytes) throw new Error("INVALID_STREAM");
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) yield parse(line);
      }
      if (pending.length > 128 * 1024) throw new Error("INVALID_STREAM");
    }
    if (pending.trim()) yield parse(pending);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Public text-only stream. Missing terminal markers are failures, never success. */
export async function* read_chat_stream(body, options) {
  let done = false,
    bytes = 0;
  const encoder = new TextEncoder();
  const errors = [
    "CHAT_UNAVAILABLE",
    "CHAT_TIMEOUT",
    "CHAT_BUSY",
    "INVALID_CHAT_REQUEST",
    "CHAT_REQUEST_TOO_LARGE",
  ];
  for await (const record of read_json_lines(body, options)) {
    if (done || record.contract_version !== 1)
      throw new Error("INVALID_STREAM");
    if (
      record.type === "delta" &&
      typeof record.text === "string" &&
      record.text.length
    ) {
      bytes += encoder.encode(record.text).length;
      if (bytes > 65536) throw new Error("INVALID_STREAM");
      yield { contract_version: 1, type: "delta", text: record.text };
    } else if (record.type === "done" && bytes > 0) {
      done = true;
      yield { contract_version: 1, type: "done" };
    } else if (record.type === "error" && errors.includes(record.error)) {
      throw new Error(record.error);
    } else throw new Error("INVALID_STREAM");
  }
  if (!done) throw new Error("INVALID_STREAM");
}
