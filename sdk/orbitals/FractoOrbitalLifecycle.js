export const ORBITAL_LIFECYCLE_VERSION = "orbital-lifecycle-v1";
export const ORBITAL_DISCOVERY_STRATEGIES = Object.freeze({
  SURVEY: "survey-period-rays-v1",
  SURVEY_CATALOG: "survey-catalog-full-rays-v1",
  CATALOG_ONLY: "catalog-representative-rays-v1",
});
export const catalog_only_strategy = Object.freeze({
  id: ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY,
  solver_version: "catalog-representative-discovery-v1",
  path_policy: "on_selection",
});

/** Missing catalog settings identify jobs created before catalog integration. */
export const stored_discovery_strategy = (settings = {}) =>
  settings.discovery_strategy ??
  (settings.catalog_max_denominator > 0
    ? ORBITAL_DISCOVERY_STRATEGIES.SURVEY_CATALOG
    : ORBITAL_DISCOVERY_STRATEGIES.SURVEY);

const member = (value, values) => values.includes(value);
const invalid = () => {
  throw Error("invalid_orbital_lifecycle");
};

/** State records describe evidence; they never substitute for numerical checks. */
export const normalize_orbital_lifecycle = (
  value,
  { stored = false, ray_status } = {},
) => {
  if (value == null)
    value = {
      version: ORBITAL_LIFECYCLE_VERSION,
      orbital: stored ? "validated" : "pending",
      assignments:
        ray_status === "rays_found"
          ? "verified"
          : ray_status === "attracting"
            ? "not_applicable"
            : [
                  "unresolved",
                  "period_limit",
                  "closure_failed",
                  "branch_changed",
                  "family_limit",
                  "no_rays",
                ].includes(ray_status)
              ? "unresolved"
              : "pending",
      paths: {
        status: stored ? "unknown" : "missing",
        cached_rays: 0,
        required_rays: 0,
        identity_key: null,
        profile: null,
      },
    };
  if (
    !value ||
    value.version !== ORBITAL_LIFECYCLE_VERSION ||
    !member(value.orbital, ["pending", "validated", "unresolved"]) ||
    !member(value.assignments, [
      "pending",
      "partial",
      "verified",
      "unresolved",
      "not_applicable",
    ])
  )
    invalid();
  const paths = value.paths;
  if (
    !paths ||
    !member(paths.status, [
      "unknown",
      "missing",
      "tracing",
      "partial",
      "cached",
      "stale",
      "failed",
      "cancelled",
    ]) ||
    !Number.isSafeInteger(paths.cached_rays) ||
    !Number.isSafeInteger(paths.required_rays) ||
    paths.cached_rays < 0 ||
    paths.required_rays < paths.cached_rays ||
    (paths.identity_key !== null &&
      (typeof paths.identity_key !== "string" ||
        !/^[a-f0-9]{64}$/.test(paths.identity_key)))
  )
    invalid();
  if (
    ["partial", "verified", "not_applicable"].includes(value.assignments) &&
    value.orbital !== "validated"
  )
    invalid();
  if (
    ["cached", "partial"].includes(paths.status) &&
    (value.orbital !== "validated" ||
      !["partial", "verified"].includes(value.assignments) ||
      !paths.identity_key ||
      paths.cached_rays < 1 ||
      !paths.profile)
  )
    invalid();
  if (paths.status === "cached" && paths.cached_rays !== paths.required_rays)
    invalid();
  if (paths.status === "partial" && paths.cached_rays >= paths.required_rays)
    invalid();
  if (["unknown", "missing"].includes(paths.status) && paths.cached_rays !== 0)
    invalid();
  if (
    paths.profile !== null &&
    (!Number.isFinite(paths.profile?.tolerance) ||
      paths.profile.tolerance <= 0 ||
      paths.profile.tolerance > 0.01 ||
      !Number.isInteger(paths.profile.precision_digits) ||
      paths.profile.precision_digits < 64 ||
      paths.profile.precision_digits > 512 ||
      !Number.isInteger(paths.profile.minimum_depth) ||
      paths.profile.minimum_depth < 1 ||
      paths.profile.minimum_depth > 2048)
  )
    invalid();
  return {
    version: value.version,
    orbital: value.orbital,
    assignments: value.assignments,
    paths: {
      status: paths.status,
      cached_rays: paths.cached_rays,
      required_rays: paths.required_rays,
      identity_key: paths.identity_key,
      profile: paths.profile ? { ...paths.profile } : null,
    },
  };
};

export const orbital_is_selectable = (state) =>
  normalize_orbital_lifecycle(state).orbital === "validated";
