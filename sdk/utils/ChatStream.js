/** Await downstream backpressure, disconnect or abort without accumulating text. */
export const write_chat_record = async (res, record, signal) => {
  signal?.throwIfAborted();
  if (res.destroyed || res.writableEnded) throw new Error("Stream closed");
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
  }
  if (res.write(`${JSON.stringify(record)}\n`)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", drain);
      res.off("close", closed);
      res.off("error", closed);
      signal?.removeEventListener("abort", closed);
    };
    const drain = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(new Error("Stream closed"));
    };
    res.once("drain", drain);
    res.once("close", closed);
    res.once("error", closed);
    signal?.addEventListener("abort", closed, { once: true });
    if (signal?.aborted || res.destroyed) closed();
  });
};
