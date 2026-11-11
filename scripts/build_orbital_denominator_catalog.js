import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  build_denominator_catalog,
  validate_denominator_catalog,
  DEFAULT_CATALOG_DENOMINATOR,
  DEFAULT_CATALOG_ANGLE_BUDGET,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";

const usage =
  "node scripts/build_orbital_denominator_catalog.js [--max-denominator N] [--out FILE] [--angle-budget N] [--check]";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const options = {
  max_denominator: DEFAULT_CATALOG_DENOMINATOR,
  angle_budget: DEFAULT_CATALOG_ANGLE_BUDGET,
  output: path.join(root, "sdk/orbitals/data/denominator-catalog.json"),
  check: false,
};

try {
  let explicit_bound = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (seen.has(flag)) throw Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--check") {
      options.check = true;
      continue;
    }
    if (
      !["--max-denominator", "--out", "--angle-budget"].includes(flag) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw Error(usage);
    const value = args[++index];
    if (flag === "--out") options.output = path.resolve(value);
    else if (flag === "--angle-budget") options.angle_budget = Number(value);
    else {
      options.max_denominator = Number(value);
      explicit_bound = true;
    }
  }
  const start = performance.now();
  let previous = null,
    existing_text = null;
  try {
    existing_text = await fs.readFile(options.output, "utf8");
    previous = JSON.parse(existing_text);
    validate_denominator_catalog(previous);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (options.check) {
    if (!previous) throw Error("Catalog does not exist");
    if (explicit_bound && previous.max_denominator !== options.max_denominator)
      throw Error("Catalog denominator bound does not match --max-denominator");
    console.log(
      JSON.stringify({
        status: "verified",
        max_denominator: previous.max_denominator,
        families: previous.family_count,
        angles: previous.angle_count,
      }),
    );
  } else {
    // With no bound argument, retain an already expanded catalog.
    if (previous && !explicit_bound)
      options.max_denominator = Math.max(
        options.max_denominator,
        previous.max_denominator,
      );
    const catalog = build_denominator_catalog({ ...options, previous });
    const serialized = JSON.stringify(catalog) + "\n";
    const changed = serialized !== existing_text;
    if (changed) {
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      const temporary = `${options.output}.${process.pid}.${randomUUID()}.tmp`;
      let created = false;
      try {
        await fs.writeFile(temporary, serialized, { flag: "wx" });
        created = true;
        await fs.rename(temporary, options.output);
      } finally {
        if (created)
          await fs.unlink(temporary).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
      }
    }
    console.log(
      JSON.stringify({
        status: changed ? "written" : "unchanged",
        output: options.output,
        max_denominator: catalog.max_denominator,
        families: catalog.family_count,
        angles: catalog.angle_count,
        added_families: catalog.family_count - (previous?.family_count || 0),
        bytes: Buffer.byteLength(serialized),
        elapsed_ms: Math.round((performance.now() - start) * 100) / 100,
      }),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
