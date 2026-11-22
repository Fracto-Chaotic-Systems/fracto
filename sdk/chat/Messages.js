import { CHAT_FILE_COUNT } from "./Attachments.js";

export const chat_message_content = (message) => {
  const attachments = message.attachments || [];
  if (attachments.length > CHAT_FILE_COUNT) throw new Error("CHAT_FILE_COUNT");
  const parts = [...message.content];
  for (const attachment of attachments) {
    if (
      !attachment.content?.length ||
      attachment.status?.type === "running" ||
      attachment.status?.type === "incomplete"
    )
      throw new Error("CHAT_FILE_PENDING");
    parts.push(...attachment.content);
  }
  if (parts.some((part) => part.type !== "text"))
    throw new Error("CHAT_FILES_UNSUPPORTED");
  return parts.map((part) => part.text).join("\n\n");
};

/** Fit recent text history to the server contract without truncating a message. */
export const prepare_chat_messages = (messages, mode = "chat") => {
  if (mode === "app-reference") {
    const latest = messages
      .filter((message) => ["user", "assistant"].includes(message.role))
      .at(-1);
    if (!latest || latest.role !== "user")
      throw new Error("INVALID_CHAT_REQUEST");
    if (latest.attachments?.length) throw new Error("CHAT_REFERENCE_QUESTION");
    const content = chat_message_content(latest).trim().replace(/\s+/g, " ");
    if (
      !content ||
      content.length > 512 ||
      new TextEncoder().encode(content).length > 1024 ||
      Array.from(content).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("CHAT_REFERENCE_QUESTION");
    return [{ role: "user", content }];
  }
  const history = messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => {
      return {
        role: message.role,
        content: chat_message_content(message),
      };
    })
    .filter((message) => message.content.trim());
  const encoder = new TextEncoder();
  if (!history.length || history.at(-1).role !== "user")
    throw new Error("INVALID_CHAT_REQUEST");
  while (
    history.length > 16 ||
    encoder.encode(JSON.stringify(history)).length > 8192
  ) {
    if (history.length === 1) throw new Error("CHAT_REQUEST_TOO_LARGE");
    history.shift();
  }
  return history;
};
