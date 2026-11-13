import {
  compact_denominator_entry,
  COMPACT_CATALOG_VERSION,
  MAX_CATALOG_DENOMINATOR,
} from "../sdk/orbitals/FractoDenominatorCatalog.js";

export const check_catalog_bound = (maximum) => {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > MAX_CATALOG_DENOMINATOR
  )
    throw new RangeError(
      `Maximum denominator must be from 1 to ${MAX_CATALOG_DENOMINATOR}`,
    );
};
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);

/** One atomic denominator per commit; restart skips only committed entries. */
export const extend_database_catalog = async (
  db,
  maximum,
  on_progress = () => {},
) => {
  check_catalog_bound(maximum);
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('fracto_orbital_catalog_build', 0) AS acquired",
  );
  if (Number(lock.acquired) !== 1)
    throw Error("Another catalog builder is running");
  let added = 0;
  try {
    const [existing] = await db.query(
      "SELECT denominator, catalog_version FROM orbital_catalog_denominators WHERE denominator <= ? ORDER BY denominator",
      [maximum],
    );
    const known = new Map(
      existing.map((row) => [row.denominator, row.catalog_version]),
    );
    for (let denominator = 1; denominator <= maximum; denominator += 2) {
      if (known.has(denominator)) {
        if (known.get(denominator) !== COMPACT_CATALOG_VERSION)
          throw Error("Unsupported stored catalog version");
        continue;
      }
      const entry = compact_denominator_entry(denominator);
      await db.beginTransaction();
      try {
        await db.execute(
          `INSERT INTO orbital_catalog_denominators
           (denominator,catalog_version,angle_period,candidate_orbital_periods,angle_count,family_count)
           VALUES (?,?,?,?,?,?)`,
          [
            denominator,
            COMPACT_CATALOG_VERSION,
            entry.angle_period,
            JSON.stringify(entry.candidate_orbital_periods),
            entry.angle_count,
            entry.families.length,
          ],
        );
        for (let offset = 0; offset < entry.families.length; offset += 500) {
          const batch = entry.families.slice(offset, offset + 500);
          await db.query(
            `INSERT INTO orbital_catalog_families (denominator,numerator) VALUES ${batch.map(() => "(?,?)").join(",")}`,
            batch.flatMap((family) => [
              denominator,
              Number(family.key.split("/")[0]),
            ]),
          );
        }
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
      added++;
      on_progress({ denominator, added_denominators: added });
    }
    return { added_denominators: added };
  } finally {
    await db.query("SELECT RELEASE_LOCK('fracto_orbital_catalog_build')");
  }
};

/** Export canonical numerators below the exclusive limit, with full cycles implicit. */
export const export_database_catalog = async (
  db,
  maximum,
  numerator_limit = 256,
  max_angle_period = 32,
) => {
  check_catalog_bound(maximum);
  if (!Number.isSafeInteger(numerator_limit) || numerator_limit < 1)
    throw new RangeError("Numerator limit must be a positive safe integer");
  if (!Number.isSafeInteger(max_angle_period) || max_angle_period < 1)
    throw new RangeError(
      "Maximum angle period must be a positive safe integer",
    );
  await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      `SELECT d.*, COUNT(f.numerator) AS stored_families FROM orbital_catalog_denominators d
       LEFT JOIN orbital_catalog_families f ON f.denominator=d.denominator
       WHERE d.denominator <= ? GROUP BY d.denominator ORDER BY d.denominator`,
      [maximum],
    );
    if (rows.length !== Math.ceil(maximum / 2))
      throw Error("Database catalog has missing denominators");
    const [families] = await db.query(
      `SELECT f.denominator,f.numerator FROM orbital_catalog_families f
       JOIN orbital_catalog_denominators d ON d.denominator=f.denominator
       WHERE f.denominator <= ? AND f.numerator < ? AND d.angle_period <= ?
       ORDER BY f.denominator,f.numerator`,
      [maximum, numerator_limit, max_angle_period],
    );
    const by_denominator = new Map();
    for (const row of families) {
      if (!by_denominator.has(row.denominator))
        by_denominator.set(row.denominator, []);
      by_denominator
        .get(row.denominator)
        .push({ key: `${row.numerator}/${row.denominator}` });
    }
    let angle_count = 0;
    const denominators = rows
      .map((row, index) => {
        if (
          row.denominator !== index * 2 + 1 ||
          row.catalog_version !== COMPACT_CATALOG_VERSION ||
          Number(row.stored_families) !== row.family_count
        )
          throw Error(`Incomplete database denominator ${row.denominator}`);
        if (row.angle_period > max_angle_period) return null;
        const selected = by_denominator.get(row.denominator) || [];
        angle_count += selected.length * row.angle_period;
        return {
          denominator: String(row.denominator),
          angle_period: row.angle_period,
          candidate_orbital_periods: json(row.candidate_orbital_periods),
          families: selected,
        };
      })
      .filter(Boolean);
    await db.commit();
    return {
      version: COMPACT_CATALOG_VERSION,
      denominator_policy: "reduced_odd",
      max_denominator: maximum,
      numerator_limit,
      max_angle_period,
      angle_count,
      family_count: families.length,
      denominators,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  }
};
