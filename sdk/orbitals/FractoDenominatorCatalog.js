import { rational_angle } from "./FractoRayGeometry.js";

export const DENOMINATOR_CATALOG_VERSION = "fracto-denominator-catalog-v1";
export const COMPACT_CATALOG_VERSION = "fracto-denominator-catalog-v2";
export const DEFAULT_CATALOG_DENOMINATOR = 255;
export const DEFAULT_CATALOG_ANGLE_BUDGET = 1_000_000;
// Allocation/arithmetic guard, not an angle-period or orbital-period filter.
export const MAX_CATALOG_DENOMINATOR = 1_000_000;

const check_bound = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_CATALOG_DENOMINATOR)
    throw new RangeError(
      `Maximum denominator must be an integer from 1 to ${MAX_CATALOG_DENOMINATOR}`,
    );
};
const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a;
};
const divisors = (value) => {
  const result = [];
  for (let divisor = 1; divisor * divisor <= value; divisor++) {
    if (value % divisor) continue;
    result.push(divisor);
    if (divisor * divisor !== value) result.push(value / divisor);
  }
  return result.sort((a, b) => a - b);
};
const totients = (maximum) => {
  const phi = Uint32Array.from({ length: maximum + 1 }, (_, index) => index);
  for (let prime = 2; prime <= maximum; prime++) {
    if (phi[prime] !== prime) continue;
    for (let multiple = prime; multiple <= maximum; multiple += prime)
      phi[multiple] -= phi[multiple] / prime;
  }
  return phi;
};
const angle_period = (denominator, maximum = Infinity) => {
  if (denominator === 1) return 1;
  let value = 1,
    period = 0;
  do {
    value = (value * 2) % denominator;
    period++;
  } while (value !== 1 && period <= maximum);
  return period;
};
const denominator_entry = (denominator) => {
  if (denominator === 1)
    return {
      denominator: "1",
      angle_period: 1,
      candidate_orbital_periods: [1],
      families: [{ key: "0/1", numerators: ["0"] }],
    };
  const seen = new Uint8Array(denominator);
  const families = [];
  for (let start = 1; start < denominator; start++) {
    if (seen[start] || gcd(start, denominator) !== 1) continue;
    const numerators = [];
    let value = start;
    do {
      seen[value] = 1;
      numerators.push(String(value));
      value = (2 * value) % denominator;
    } while (value !== start);
    families.push({ key: `${start}/${denominator}`, numerators });
  }
  const period = families[0].numerators.length;
  return {
    denominator: String(denominator),
    angle_period: period,
    candidate_orbital_periods: divisors(period),
    families,
  };
};

/** Lossless family representatives; memory is bounded to one denominator. */
export const compact_denominator_entry = (denominator) => {
  check_bound(denominator);
  if (denominator % 2 !== 1) throw Error("Periodic denominators must be odd");
  if (denominator === 1)
    return {
      denominator: "1",
      angle_period: 1,
      candidate_orbital_periods: [1],
      angle_count: 1,
      families: [{ key: "0/1" }],
    };
  const seen = new Uint8Array(denominator);
  // Mark non-reduced numerators once per prime factor, rather than repeatedly
  // calculating a gcd for each non-unit as the denominator grows.
  let remaining = denominator;
  for (let prime = 3; prime * prime <= remaining; prime += 2) {
    if (remaining % prime) continue;
    for (let numerator = prime; numerator < denominator; numerator += prime)
      seen[numerator] = 1;
    do {
      remaining /= prime;
    } while (remaining % prime === 0);
  }
  if (remaining > 1)
    for (
      let numerator = remaining;
      numerator < denominator;
      numerator += remaining
    )
      seen[numerator] = 1;
  const families = [];
  let count = 0,
    period = 0;
  for (let start = 1; start < denominator; start++) {
    if (seen[start]) continue;
    const before = count;
    let value = start;
    do {
      seen[value] = 1;
      count++;
      value += value;
      if (value >= denominator) value -= denominator;
    } while (value !== start);
    if (!period) period = count - before;
    families.push({ key: `${start}/${denominator}` });
  }
  return {
    denominator: String(denominator),
    angle_period: period,
    candidate_orbital_periods: divisors(period),
    angle_count: count,
    families,
  };
};

export const compact_family_numerators = (family, entry) => {
  const denominator = Number(entry.denominator);
  let value = Number(family.key.split("/")[0]);
  return Array.from({ length: entry.angle_period }, () => {
    const numerator = String(value);
    value = (value * 2) % denominator;
    return numerator;
  });
};

const validate_compact_catalog = (catalog) => {
  check_bound(catalog.max_denominator);
  if (
    catalog.denominator_policy !== "reduced_odd" ||
    !Number.isSafeInteger(catalog.numerator_limit) ||
    catalog.numerator_limit < 1 ||
    (catalog.max_angle_period !== undefined &&
      (!Number.isSafeInteger(catalog.max_angle_period) ||
        catalog.max_angle_period < 1)) ||
    !Array.isArray(catalog.denominators)
  )
    throw Error("Invalid compact catalog coverage");
  let families = 0,
    angles = 0;
  let index = 0;
  for (
    let denominator = 1;
    denominator <= catalog.max_denominator;
    denominator += 2
  ) {
    if (
      catalog.max_angle_period !== undefined &&
      angle_period(denominator, catalog.max_angle_period) >
        catalog.max_angle_period
    )
      continue;
    const entry = catalog.denominators[index++];
    const expected = compact_denominator_entry(denominator);
    expected.families = expected.families.filter(
      (family) => Number(family.key.split("/")[0]) < catalog.numerator_limit,
    );
    delete expected.angle_count;
    if (
      entry?.denominator !== expected.denominator ||
      entry.angle_period !== expected.angle_period ||
      JSON.stringify(entry.candidate_orbital_periods) !==
        JSON.stringify(expected.candidate_orbital_periods) ||
      JSON.stringify(entry.families?.map((family) => family.key)) !==
        JSON.stringify(expected.families.map((family) => family.key))
    )
      throw Error(`Invalid compact catalog at denominator ${denominator}`);
    families += entry.families.length;
    angles += entry.families.length * entry.angle_period;
  }
  if (
    index !== catalog.denominators.length ||
    families !== catalog.family_count ||
    angles !== catalog.angle_count
  )
    throw Error("Invalid compact catalog totals");
  return catalog;
};

/** Validate coverage and exact cycles without regenerating the stored families. */
export const validate_denominator_catalog = (catalog) => {
  if (catalog?.version === COMPACT_CATALOG_VERSION)
    return validate_compact_catalog(catalog);
  if (catalog?.version !== DENOMINATOR_CATALOG_VERSION)
    throw Error("Unsupported denominator catalog version");
  check_bound(catalog.max_denominator);
  if (
    catalog.denominator_policy !== "reduced_odd" ||
    !Array.isArray(catalog.denominators) ||
    catalog.denominators.length !== Math.ceil(catalog.max_denominator / 2)
  )
    throw Error("Invalid denominator catalog coverage");
  const phi = totients(catalog.max_denominator);
  let angle_count = 0,
    family_count = 0;
  for (let index = 0; index < catalog.denominators.length; index++) {
    const denominator = index * 2 + 1;
    const entry = catalog.denominators[index];
    const period = angle_period(denominator);
    if (
      entry?.denominator !== String(denominator) ||
      entry.angle_period !== period ||
      JSON.stringify(entry.candidate_orbital_periods) !==
        JSON.stringify(divisors(period)) ||
      !Array.isArray(entry.families)
    )
      throw Error(`Invalid catalog metadata at denominator ${denominator}`);
    const seen = new Uint8Array(denominator);
    let count = 0,
      last_start = -1;
    for (const family of entry.families) {
      if (
        !Array.isArray(family?.numerators) ||
        family.numerators.length !== period
      )
        throw Error(`Invalid catalog family at denominator ${denominator}`);
      const start = Number(family.numerators[0]);
      if (family.key !== `${start}/${denominator}` || start <= last_start)
        throw Error(
          `Invalid catalog family identity at denominator ${denominator}`,
        );
      last_start = start;
      let value = start;
      for (const numerator of family.numerators) {
        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value >= denominator ||
          numerator !== String(value) ||
          value < start ||
          seen[value] ||
          (denominator > 1 && gcd(value, denominator) !== 1)
        )
          throw Error(
            `Invalid catalog doubling cycle at denominator ${denominator}`,
          );
        seen[value] = 1;
        count++;
        value = (value * 2) % denominator;
      }
      if (value !== start)
        throw Error(`Unclosed catalog family at denominator ${denominator}`);
    }
    if (count !== phi[denominator])
      throw Error(`Incomplete catalog families at denominator ${denominator}`);
    angle_count += count;
    family_count += entry.families.length;
  }
  if (
    catalog.angle_count !== angle_count ||
    catalog.family_count !== family_count
  )
    throw Error("Invalid denominator catalog totals");
  return catalog;
};

/**
 * Deterministic periodic-angle catalog. Even reduced denominators are excluded:
 * they are preperiodic under doubling. Divisors are candidates, not landing claims.
 * Existing entries are checked and reused; only new denominators are generated.
 */
export const build_denominator_catalog = ({
  max_denominator = DEFAULT_CATALOG_DENOMINATOR,
  previous = null,
  angle_budget = DEFAULT_CATALOG_ANGLE_BUDGET,
  on_denominator = () => {},
} = {}) => {
  check_bound(max_denominator);
  if (!Number.isSafeInteger(angle_budget) || angle_budget < 1)
    throw new RangeError("Angle budget must be a positive safe integer");
  const phi = totients(max_denominator);
  let required_angles = 0;
  for (let denominator = 1; denominator <= max_denominator; denominator += 2)
    required_angles += phi[denominator];
  if (required_angles > angle_budget)
    throw new RangeError(
      `Catalog requires ${required_angles} angles; budget is ${angle_budget}. Increase --angle-budget explicitly.`,
    );
  if (previous) {
    validate_denominator_catalog(previous);
    if (previous.version !== DENOMINATOR_CATALOG_VERSION)
      throw Error("Expand compact catalogs through the database builder");
    if (previous.max_denominator > max_denominator)
      throw new RangeError("Cannot shrink an existing denominator catalog");
    if (previous.max_denominator === max_denominator) return previous;
  }
  const denominators = [...(previous?.denominators || [])];
  let angle_count = previous?.angle_count || 0;
  let family_count = previous?.family_count || 0;
  for (
    let denominator = denominators.length * 2 + 1;
    denominator <= max_denominator;
    denominator += 2
  ) {
    const entry = denominator_entry(denominator);
    denominators.push(entry);
    angle_count += phi[denominator];
    family_count += entry.families.length;
    on_denominator({ denominator, angle_count, family_count });
  }
  return {
    version: DENOMINATOR_CATALOG_VERSION,
    denominator_policy: "reduced_odd",
    max_denominator,
    angle_count,
    family_count,
    denominators,
  };
};

/** Adapt catalog records to the existing ray-family shape without tracing rays. */
export const expand_catalog_family = (family) => ({
  ...family,
  angles:
    family.angles ||
    compact_family_numerators(family, family).map((numerator) =>
      rational_angle(numerator, family.denominator),
    ),
});

export function* catalog_doubling_families(
  catalog,
  { orbital_period, expand_angles = true } = {},
) {
  if (
    orbital_period !== undefined &&
    (!Number.isSafeInteger(orbital_period) || orbital_period < 1)
  )
    throw new RangeError("Candidate orbital period must be a positive integer");
  for (const entry of catalog.denominators) {
    if (
      orbital_period !== undefined &&
      !entry.candidate_orbital_periods.includes(orbital_period)
    )
      continue;
    for (const family of entry.families) {
      const record = {
        key: family.key,
        numerator: family.key.split("/")[0],
        denominator: entry.denominator,
        period: entry.angle_period,
        angle_period: entry.angle_period,
        candidate_orbital_periods: [...entry.candidate_orbital_periods],
      };
      yield expand_angles ? expand_catalog_family(record) : record;
    }
  }
}
