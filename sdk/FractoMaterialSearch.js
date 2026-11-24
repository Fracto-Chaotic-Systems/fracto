const fail = (code = "invalid_material_query", status = 400) => {
  throw Object.assign(new Error(code), { status });
};
const words = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
const singular = (word) =>
  /(?:sses|shes|ches|xes|zes)$/.test(word)
    ? word.slice(0, -2)
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;
export function validate_material_query(query = {}) {
  if (
    !query ||
    Array.isArray(query) ||
    Object.keys(query).some(
      (key) =>
        !["q", "category", "placement", "limit", "offset", "snapshot"].includes(
          key,
        ),
    )
  )
    fail();
  const q = query.q ?? "",
    category = query.category ?? "",
    placement = query.placement ?? "";
  if (
    typeof q !== "string" ||
    q.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(q) ||
    words(q).length > 12 ||
    typeof category !== "string" ||
    category.length > 64 ||
    (category && !/^[\p{L}\p{N}_ /-]+$/u.test(category)) ||
    typeof placement !== "string" ||
    !["", "ground", "floor", "wall", "ceiling", "free", "unknown"].includes(
      placement,
    )
  )
    fail();
  const integer = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (
      !/^(0|[1-9][0-9]*)$/.test(String(value)) ||
      (typeof value !== "string" && typeof value !== "number")
    )
      fail();
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n > max) fail();
    return n;
  };
  const limit = integer(query.limit, 10, 50),
    offset = integer(query.offset, 0, 2000);
  if (
    !limit ||
    (query.snapshot !== undefined &&
      (typeof query.snapshot !== "string" ||
        !/^[a-f0-9]{64}$/.test(query.snapshot))) ||
    (offset > 0 && !query.snapshot)
  )
    fail();
  return {
    q: q.trim(),
    category: category.trim().toLowerCase(),
    placement,
    limit,
    offset,
    snapshot: query.snapshot ?? null,
  };
}

export function search_materials(materials, query, snapshot) {
  query = validate_material_query(
    Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== null),
    ),
  );
  if (query.snapshot && query.snapshot !== snapshot)
    fail("material_search_changed", 409);
  const terms = [...new Set(words(query.q).map(singular))];
  const matched = new Set();
  const results = [];
  for (const material of materials) {
    if (
      query.category &&
      material.category.toLowerCase() !== query.category &&
      !material.category.toLowerCase().startsWith(query.category + "/")
    )
      continue;
    if (query.placement && material.construction.placement !== query.placement)
      continue;
    const fields = [
      [material.name, 8],
      [material.tags.join(" "), 6],
      [material.category, 4],
      [material.description, 1],
    ].map(([value, weight]) => [words(value).map(singular), weight]);
    let score = 0,
      count = 0;
    for (const term of terms) {
      const weights = fields.map(([tokens, weight]) =>
        tokens.some(
          (word) =>
            word === term || (term.length >= 3 && word.startsWith(term)),
        )
          ? weight
          : 0,
      );
      if (weights.some(Boolean)) {
        matched.add(term);
        count++;
        score += weights.reduce((a, b) => a + b, 0);
      }
    }
    if (count === terms.length) results.push({ ...material, score });
  }
  results.sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const page = results.slice(query.offset, query.offset + query.limit);
  return {
    contract_version: 1,
    query: query.q,
    snapshot,
    materials: page,
    total: results.length,
    unmatched_terms: terms.filter((term) => !matched.has(term)),
    next_offset:
      query.offset + page.length < results.length
        ? query.offset + page.length
        : null,
  };
}
