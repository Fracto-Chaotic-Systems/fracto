import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { open_orbital_database } from "../servers/fracto-data-server/handlers/orbital_data_database.js";
import {
  extend_database_catalog,
  export_database_catalog,
  check_catalog_bound,
} from "./orbital_denominator_catalog_store.js";
import { validate_denominator_catalog } from "../sdk/orbitals/FractoDenominatorCatalog.js";

const usage =
  "node scripts/build_database_orbital_catalog.js [--max-denominator N] [--numerator-limit 256] [--max-angle-period 32] [--out FILE] [--export-only]";
let db;
try {
  let maximum = 524287,
    numerator_limit = 256,
    max_angle_period = 32,
    export_only = false;
  let output = fileURLToPath(
    new URL(
      "../sdk/orbitals/data/denominator-catalog-small-numerators.json",
      import.meta.url,
    ),
  );
  const args = process.argv.slice(2),
    seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (seen.has(flag)) throw Error(`Duplicate option ${flag}`);
    seen.add(flag);
    if (flag === "--export-only") {
      export_only = true;
      continue;
    }
    if (
      ![
        "--max-denominator",
        "--numerator-limit",
        "--max-angle-period",
        "--out",
      ].includes(flag) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw Error(usage);
    const value = args[++index];
    if (flag === "--max-denominator") maximum = Number(value);
    if (flag === "--numerator-limit") numerator_limit = Number(value);
    if (flag === "--max-angle-period") max_angle_period = Number(value);
    if (flag === "--out") output = path.resolve(value);
  }
  check_catalog_bound(maximum);
  if (!Number.isSafeInteger(numerator_limit) || numerator_limit < 1)
    throw Error("Invalid numerator limit");
  if (!Number.isSafeInteger(max_angle_period) || max_angle_period < 1)
    throw Error("Invalid maximum angle period");
  db = await open_orbital_database();
  let progress_time = Date.now();
  const result = export_only
    ? {}
    : await extend_database_catalog(db, maximum, (progress) => {
        if (Date.now() - progress_time > 10000) {
          console.error(JSON.stringify(progress));
          progress_time = Date.now();
        }
      });
  const catalog = validate_denominator_catalog(
    await export_database_catalog(
      db,
      maximum,
      numerator_limit,
      max_angle_period,
    ),
  );
  const serialized = JSON.stringify(catalog) + "\n";
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, serialized, { flag: "wx" });
    await fs.rename(temporary, output);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  console.log(
    JSON.stringify({
      ...result,
      output,
      max_denominator: maximum,
      numerator_limit,
      max_angle_period,
      families: catalog.family_count,
      angles: catalog.angle_count,
      bytes: Buffer.byteLength(serialized),
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db?.end();
}
