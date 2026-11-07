import FractoFastCalc from "../FractoFastCalc.js";
import { newton_big_complex } from "./FractoNewtonBigComplex.js";
import {
  find_dynamic_rays,
  SEED_SURVEY_RAY_OPTIONS,
} from "./FractoDynamicRays.js";
import { trace_dynamic_ray } from "./FractoDynamicRayTrace.js";
import { enumerate_doubling_families } from "./FractoRayFamilies.js";
import { connectedness_evidence } from "./FractoRayEligibility.js";
import { rational_angle, doubled_angle } from "./FractoRayGeometry.js";
import {
  canonical_orbital,
  same_orbital_cycle,
} from "./FractoOrbitalIdentity.js";

const numeric = (c) => ({ x: Number(c.x), y: Number(c.y) });
const add_candidate = (found, candidate) => {
  if (
    candidate &&
    !found.some((other) => same_orbital_cycle(candidate.points, other.points))
  )
    found.push(candidate);
};

const refine = (parameter, period, seed, settings) => {
  for (const precision_digits of [
    settings.precision_digits,
    Math.min(256, settings.precision_digits * 2),
  ]) {
    try {
      const result = newton_big_complex(
        parameter,
        settings.newton_iterations,
        period,
        { seed, precision_digits },
      );
      if (result.closure_reached !== true) continue;
      const orbital = canonical_orbital(
        parameter,
        result.point_list,
        precision_digits,
      );
      if (orbital) return orbital;
    } catch {
      // Singular derivatives and divergent seeds are rejected attempts, not cycles.
    }
  }
  return null;
};

/** Bounded, browser-independent seed/period orchestration over existing SDK solvers. */
export const discover_orbital_batch = ({
  parameter,
  period,
  seeds,
  settings,
}) => {
  const candidates = [];
  let attempts = 0;
  for (const seed of seeds) {
    const periods = new Set([period]);
    if (period === 1) {
      const c = numeric(parameter);
      const hint = FractoFastCalc.calc_from_seed(
        c.x,
        c.y,
        seed.x,
        seed.y,
        0.00625,
        settings.iteration_limit,
      );
      if (
        !hint?.estimated &&
        Number.isInteger(hint?.pattern) &&
        hint.pattern > 0 &&
        hint.pattern <= settings.max_period
      )
        periods.add(hint.pattern);
    }
    for (const p of periods) {
      attempts++;
      const candidate = refine(parameter, p, seed, settings);
      if (candidate)
        add_candidate(candidates, {
          ...candidate,
          discovery_method: "seeded_newton",
        });
    }
  }
  return { candidates, attempts };
};

/** Ray endpoints supply additional Newton seeds; the whole family is checked later. */
export const discover_orbital_ray_batch = ({ parameter, period, settings }) => {
  const c = numeric(parameter),
    candidates = [];
  const connectedness = connectedness_evidence(c);
  if (connectedness.status !== "connected")
    return { candidates, attempts: 0, outcome: connectedness.status };
  let attempts = 0,
    exhausted = true;
  for (const family of enumerate_doubling_families(period)) {
    if (attempts >= settings.max_families) {
      exhausted = false;
      break;
    }
    attempts++;
    const ray = trace_dynamic_ray(c, family, {
      tolerance: 1e-4,
      minimum_potential: 2 ** -96,
      max_points: 6000,
      verify_precision: true,
    });
    if (
      ray.reason !== "potential_limit" ||
      !ray.endpoint ||
      !Number.isFinite(ray.precision_error) ||
      ray.precision_error > 1e-6
    )
      continue;
    const candidate = refine(parameter, period, ray.endpoint, settings);
    if (
      !candidate ||
      !candidate.points.some(
        (z) =>
          Math.hypot(
            Number(z.re) - ray.endpoint.x,
            Number(z.im) - ray.endpoint.y,
          ) <= 1e-6,
      )
    )
      continue;
    add_candidate(candidates, {
      ...candidate,
      discovery_method: "ray_endpoint_newton",
    });
  }
  return {
    candidates,
    attempts,
    outcome: exhausted ? "bounded_search_finished" : "family_limit",
  };
};

const angle_family = (angle, max_period) => {
  const angles = [];
  let current = rational_angle(angle.numerator, angle.denominator);
  const first = current.key;
  do {
    angles.push(current);
    current = doubled_angle(current);
  } while (current.key !== first && angles.length <= max_period);
  if (current.key !== first) throw Error("invalid_ray_family");
  return { key: angles.map((a) => a.key).sort()[0], angles };
};

/** Check that only complete, exact doubling families can enter persistent storage. */
export const validate_landing_families = (ratios, period) => {
  const groups = new Map();
  for (const ratio of ratios) {
    if (
      !/^\d{1,40}$/.test(ratio.numerator) ||
      !/^\d{1,40}$/.test(ratio.denominator)
    )
      throw Error("invalid_landing_ratio");
    const angle = rational_angle(ratio.numerator, ratio.denominator);
    if (
      angle.numerator !== ratio.numerator ||
      angle.denominator !== ratio.denominator ||
      !Number.isInteger(ratio.point_index) ||
      ratio.point_index < 0 ||
      ratio.point_index >= period ||
      !Number.isFinite(ratio.landing_error) ||
      ratio.landing_error < 0 ||
      ratio.landing_error > 1e-6
    )
      throw Error("invalid_landing_ratio");
    const family = angle_family(angle, 24);
    if (
      family.key !== ratio.family_key ||
      family.angles.length !== ratio.angle_period
    )
      throw Error("invalid_ray_family");
    const group = groups.get(family.key) || new Map();
    if (group.has(angle.key)) throw Error("duplicate_landing_ratio");
    group.set(angle.key, ratio);
    groups.set(family.key, group);
  }
  for (const group of groups.values()) {
    const first = group.values().next().value;
    if (group.size !== first.angle_period || group.size % period)
      throw Error("incomplete_ray_family");
    for (const [key, ratio] of group) {
      const next = group.get(doubled_angle(ratio).key);
      if (!next || next.point_index !== (ratio.point_index + 1) % period)
        throw Error("ray_progression_mismatch");
    }
  }
  return ratios;
};

/** Return compact ratios, not renderer polylines; indices refer to the stored cycle. */
export const calculate_orbital_landing_ratios = async (
  { parameter, orbital, settings },
  report = () => {},
) => {
  const points = orbital.points.map((p) => ({
    x: Number(p.re),
    y: Number(p.im),
  }));
  const result = await find_dynamic_rays(
    parameter,
    { points },
    {
      ...SEED_SURVEY_RAY_OPTIONS,
      max_angle_period: settings.max_angle_period,
      max_families: settings.max_families,
      on_progress: (progress) =>
        report({
          phase: "rays",
          processed: progress.processed,
          total: progress.total,
        }),
    },
  );
  const ratios = (result.rays || []).map((ray) => {
    const target = result.points[ray.point_index];
    const point_index = points.reduce(
      (best, p, i) =>
        Math.hypot(p.x - target.x, p.y - target.y) <
        Math.hypot(points[best].x - target.x, points[best].y - target.y)
          ? i
          : best,
      0,
    );
    if (
      Math.hypot(
        points[point_index].x - target.x,
        points[point_index].y - target.y,
      ) > 1e-6
    )
      throw Error("ray_branch_changed");
    const family = angle_family(ray.angle, settings.max_angle_period);
    return {
      point_index,
      numerator: ray.angle.numerator,
      denominator: ray.angle.denominator,
      family_key: family.key,
      angle_period: family.angles.length,
      landing_error: ray.landing_error,
    };
  });
  validate_landing_families(ratios, orbital.period);
  return {
    status: result.status,
    ratios,
    metadata: {
      status: result.status,
      multiplier: result.multiplier || null,
      search: result.search || null,
      connectedness: result.connectedness || null,
      precision_digits: result.precision_digits || null,
      geometry_arithmetic: "native_with_sdk_terminal_precision_check",
      ray_options: {
        ...SEED_SURVEY_RAY_OPTIONS,
        max_angle_period: settings.max_angle_period,
        max_families: settings.max_families,
      },
    },
  };
};
