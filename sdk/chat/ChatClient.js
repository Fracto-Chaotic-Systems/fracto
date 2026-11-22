import { read_chat_stream } from "@fracto/sdk/FractoChatStream.js";

export async function* stream_chat(
  url,
  messages,
  signal,
  fetch_impl = fetch,
  mode = "chat",
) {
  const response = await fetch_impl(url, {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      contract_version: 1,
      messages,
      ...(mode === "chat" ? {} : { mode }),
    }),
  });
  if (!response.ok) {
    let server_error;
    try {
      server_error = (await response.json()).error;
    } catch {
      server_error = null;
    }
    const errors = {
      401: "CHAT_AUTH_REQUIRED",
      403: "CHAT_FORBIDDEN",
      429: "CHAT_BUSY",
      504: "CHAT_TIMEOUT",
      413: "CHAT_REQUEST_TOO_LARGE",
    };
    const admission_errors = [
      "CHAT_MEMORY_PRESSURE",
      "CHAT_DISK_PRESSURE",
      "CHAT_MODEL_MISSING",
      "CHAT_REFERENCE_UNAVAILABLE",
    ];
    throw new Error(
      (response.status === 400 && server_error === "CHAT_REFERENCE_QUESTION") ||
        (response.status === 503 && admission_errors.includes(server_error))
        ? server_error
        : errors[response.status] || "CHAT_UNAVAILABLE",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    await response.body?.cancel();
    throw new Error("INVALID_STREAM");
  }
  let text = "";
  for await (const record of read_chat_stream(response.body, { signal })) {
    if (record.type === "delta") {
      text += record.text;
      yield text;
    }
  }
}
