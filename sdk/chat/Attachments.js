export const CHAT_FILE_ACCEPT = ".txt,.md,.markdown,.json,.csv";
export const CHAT_FILE_LIMIT = 4096;
export const CHAT_FILE_COUNT = 4;

export const extract_chat_file = async (file) => {
  if (!/\.(txt|md|markdown|json|csv)$/i.test(file.name))
    throw new Error("CHAT_FILE_TYPE");
  if (file.size > CHAT_FILE_LIMIT) throw new Error("CHAT_FILE_SIZE");
  if (new TextEncoder().encode(file.name).length > 128)
    throw new Error("CHAT_FILE_NAME");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > CHAT_FILE_LIMIT) throw new Error("CHAT_FILE_SIZE");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("CHAT_FILE_ENCODING");
  }
  if (
    Array.from(text).some((character) => {
      const code = character.codePointAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  )
    throw new Error("CHAT_FILE_ENCODING");
  if (!text.trim()) throw new Error("CHAT_FILE_EMPTY");
  if (/\.json$/i.test(file.name)) {
    try {
      JSON.parse(text);
    } catch {
      throw new Error("CHAT_FILE_JSON");
    }
  }
  return `Attached file ${JSON.stringify(file.name)} (reference data):\n${text}\nEnd attached file.`;
};

/** Only pending local files are tracked; extraction never uploads or executes data. */
export const create_chat_attachment_adapter = (on_error = () => {}) => {
  const pending = new Set();
  return {
    accept: CHAT_FILE_ACCEPT,
    async add({ file }) {
      const id = crypto.randomUUID();
      try {
        if (pending.size >= CHAT_FILE_COUNT) throw new Error("CHAT_FILE_COUNT");
        pending.add(id);
        const text = await extract_chat_file(file);
        on_error(null);
        return {
          id,
          type: "document",
          name: file.name,
          contentType: file.type || "text/plain",
          file,
          content: [{ type: "text", text }],
          status: { type: "requires-action", reason: "composer-send" },
        };
      } catch (error) {
        pending.delete(id);
        on_error(error.message);
        throw error;
      }
    },
    async remove(attachment) {
      pending.delete(attachment.id);
    },
    async send(attachment, { signal } = {}) {
      signal?.throwIfAborted();
      pending.delete(attachment.id);
      return { ...attachment, status: { type: "complete" } };
    },
  };
};
