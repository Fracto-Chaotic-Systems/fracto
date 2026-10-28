import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function durable_replace(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx");
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    let directory;
    try {
      directory = await fs.open(path.dirname(file), "r");
      await directory.sync();
    } catch (error) {
      if (
        !["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"].includes(error.code)
      )
        throw error;
    } finally {
      await directory?.close();
    }
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}
