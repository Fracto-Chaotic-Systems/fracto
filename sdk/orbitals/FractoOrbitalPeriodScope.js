/** Positive divisors of the source's exact core-point period, including 1. */
export const pattern_orbital_periods = (pattern) => {
  if (!Number.isSafeInteger(pattern) || pattern < 1 || pattern > 4294967295)
    throw Error("invalid_source_pattern");
  const periods = [];
  for (let divisor = 1; divisor * divisor <= pattern; divisor++) {
    if (pattern % divisor) continue;
    periods.push(divisor);
    if (divisor * divisor !== pattern) periods.push(pattern / divisor);
  }
  return periods.sort((a, b) => a - b);
};

/** Optional scope is part of the numerical profile and durable cache identity. */
export const orbital_period_profile = (options) => {
  const periods = options.allowed_orbital_periods;
  if (periods === undefined) return {};
  if (
    !Array.isArray(periods) ||
    periods.length === 0 ||
    periods.some(
      (period) =>
        !Number.isSafeInteger(period) || period < 1 || period > 4294967295,
    )
  )
    throw Error("invalid_orbital_period_scope");
  return {
    allowed_orbital_periods: [...new Set(periods)].sort((a, b) => a - b),
  };
};

export const orbital_period_allowed = (profile, period) =>
  !profile.allowed_orbital_periods ||
  profile.allowed_orbital_periods.includes(period);

/** Multiples are of the core pattern itself, not of every divisor (including 1). */
export const pattern_angle_period_allowed = (
  pattern,
  angle_period,
  include_multiples = true,
) =>
  pattern % angle_period === 0 ||
  (include_multiples && angle_period % pattern === 0);
