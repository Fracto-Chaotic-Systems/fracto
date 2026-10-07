const DEFAULT_MINIMUM_REPETITIONS = 5;
const MAX_MINIMUM_REPETITIONS = 64;
const MINIMUM_RADIUS_GAP_RATIO = 10;
const DERIVATIVE_PYRAMID_CYCLES = 10;
const DEFAULT_NEAR_ZERO_TOLERANCE = 1e-30;
const DEFAULT_PRECISION_DIGITS = 15;
const DEFAULT_MAX_PRECISION_DIGITS = 128;
const DEFAULT_PRECISION_ESCALATION_FACTOR = 2;
const DEFAULT_HARMONIC_SCORE_TOLERANCE = 0.1;
const DEFAULT_PERIOD_VALIDATION_TOLERANCE = 1e-9;

const select_kth = (values, target_index) => {
  let left = 0;
  let right = values.length - 1;
  while (left <= right) {
    const pivot = values[Math.floor((left + right) / 2)];
    let lower = left;
    let current = left;
    let upper = right;
    while (current <= upper) {
      if (values[current] < pivot) {
        [values[lower], values[current]] = [values[current], values[lower]];
        lower += 1;
        current += 1;
      } else if (values[current] > pivot) {
        [values[current], values[upper]] = [values[upper], values[current]];
        upper -= 1;
      } else {
        current += 1;
      }
    }
    if (target_index < lower) right = lower - 1;
    else if (target_index > upper) left = upper + 1;
    else return values[target_index];
  }
  return undefined;
};

/** Public selector for the derivative-pyramid-only detector. */
export const DETECTION_MODE_PYRAMID_ONLY = "pyramid_only";

/**
 * Create the compact mutable state owned by one pyramid contender. Keeping
 * scheduling, derivative, and elimination metadata together lets the later
 * streaming implementation update contenders in place without allocating a
 * new pyramid for every orbit iteration.
 *
 * @param {number} cardinality Candidate orbital cardinality.
 * @param {number} max_layers Maximum derivative levels to retain.
 * @returns {object} Mutable contender state.
 */
const create_pyramid_contender_state = (cardinality, max_layers) => ({
  cardinality,
  next_iteration: cardinality,
  sample_count: 0,
  sample_values: [],
  derivative_values: new Float64Array(max_layers + 1),
  derivative_counts: new Uint32Array(max_layers + 1),
  derivative_scales: new Float64Array(max_layers),
  derivative_signs: new Int8Array(max_layers),
  indeterminate_levels: new Uint8Array(max_layers),
  near_zero_events: 0,
  pyramid_layers: 0,
  sign_changes: 0,
  eliminated: false,
  elimination_level: null,
  elimination_reason: null,
  state_index: -1,
  schedule_next_index: -1,
});

/**
 * Incorporate one radius into a contender's finite-difference pyramid.
 * Each level retains only its latest value; the generated difference is fed
 * immediately into the next level, avoiding temporary level arrays.
 *
 * @param {object} contender Mutable contender state.
 * @param {number} radius Origin-based orbit radius.
 * @param {number} max_layers Maximum levels to update.
 * @param {number} noise_factor Relative numerical-noise multiplier.
 * @param {number} near_zero_tolerance Absolute near-zero floor.
 * @returns {boolean} Whether the contender remains sign-coherent.
 */
const update_contender_derivative_state = (
  contender,
  radius,
  max_layers,
  noise_factor,
  near_zero_tolerance,
) => {
  let value = radius;
  for (let level = 0; level <= max_layers; level += 1) {
    if (contender.derivative_counts[level] === 0) {
      contender.derivative_values[level] = value;
      contender.derivative_counts[level] = 1;
      return true;
    }
    const difference = value - contender.derivative_values[level];
    contender.derivative_values[level] = value;
    contender.derivative_counts[level] += 1;
    if (level < max_layers) {
      contender.derivative_scales[level] = Math.max(
        contender.derivative_scales[level],
        Math.abs(difference),
      );
      const epsilon = Math.max(
        Number.EPSILON *
          noise_factor *
          Math.max(1, contender.derivative_scales[level]),
        near_zero_tolerance,
      );
      if (Math.abs(difference) <= epsilon) {
        // A near-zero derivative does not provide reliable sign information;
        // preserve the contender for a later precision-promotion pass.
        contender.near_zero_events += 1;
        contender.indeterminate_levels[level] = 1;
      } else {
        const sign = Math.sign(difference);
        const expected_sign = contender.derivative_signs[level];
        if (expected_sign === 0) {
          contender.derivative_signs[level] = sign;
        } else if (expected_sign !== sign) {
          contender.eliminated = true;
          contender.elimination_level = level;
          contender.elimination_reason = "derivative_sign_change";
          contender.sign_changes += 1;
          return false;
        }
        contender.pyramid_layers = Math.max(
          contender.pyramid_layers,
          level + 1,
        );
      }
    }
    value = difference;
  }
  return true;
};

/**
 * Rank a surviving contender using only evidence available to the
 * pyramid-only pass. Near-zero events are reported separately rather than
 * treated as sign failures; their precision status is resolved later.
 *
 * @param {object} contender Mutable contender state.
 * @param {number} minimum_cycles Required repeated samples.
 * @param {number} max_layers Configured layer limit.
 * @returns {{score:number,repetition:number,layers:number,sign_stability:number,near_zero:number,precision_status:string}}
 *   Score components and precision status.
 */
const score_pyramid_contender = (contender, minimum_cycles, max_layers) => {
  const repetition = Math.min(
    1,
    Math.max(0, contender.sample_count - 1) / Math.max(1, minimum_cycles),
  );
  const layers = Math.min(
    1,
    contender.pyramid_layers / Math.max(1, max_layers),
  );
  const sign_stability = contender.sign_changes === 0 ? 1 : 0;
  const near_zero = contender.near_zero_events > 0 ? 0.5 : 1;
  const score =
    0.35 * repetition + 0.4 * layers + 0.2 * sign_stability + 0.05 * near_zero;
  return {
    score,
    repetition,
    layers,
    sign_stability,
    near_zero,
    precision_status: "native",
  };
};

/**
 * Validate a candidate period against the full complex orbit, rather than
 * only its origin-based radius. This rejects divisors that happen to pass
 * the scalar derivative-pyramid test while visiting different orbital phases.
 *
 * @param {Array<object>} samples Critical-orbit samples.
 * @param {number} cardinality Candidate period.
 * @param {number} minimum_cycles Required recurrence comparisons.
 * @param {number} tolerance Absolute complex recurrence tolerance.
 * @returns {{valid:boolean,max_residual:number,mean_residual:number,sample_count:number}}
 *   Period-validation diagnostics.
 */
const validate_candidate_period = (
  samples,
  cardinality,
  minimum_cycles,
  tolerance,
) => {
  const first_iteration = samples[0]?.iteration;
  const sample_by_iteration = new Map(
    samples.map((sample) => [sample.iteration, sample]),
  );
  const residuals = [];
  for (let cycle = 0; cycle < minimum_cycles; cycle += 1) {
    const left = sample_by_iteration.get(first_iteration + cycle * cardinality);
    const right = sample_by_iteration.get(
      first_iteration + (cycle + 1) * cardinality,
    );
    if (!left || !right) break;
    residuals.push(
      Math.hypot(
        Number(right.re) - Number(left.re),
        Number(right.im) - Number(left.im),
      ),
    );
  }
  const max_residual = residuals.length
    ? residuals.reduce((maximum, value) => Math.max(maximum, value), 0)
    : Infinity;
  const mean_residual = residuals.length
    ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length
    : Infinity;
  return {
    valid: residuals.length >= minimum_cycles && max_residual <= tolerance,
    max_residual,
    mean_residual,
    sample_count: residuals.length,
  };
};

/**
 * Label surviving multiples when a comparable-scoring proper divisor also
 * survives. Harmonics remain visible for diagnostics but rank after their
 * fundamental candidate.
 *
 * @param {Array<object>} survivors Survivor records.
 * @param {number} score_tolerance Maximum score difference for suppression.
 * @returns {number} Number of survivors classified as harmonics.
 */
const suppress_harmonic_survivors = (survivors, score_tolerance) => {
  const by_cardinality = new Map(
    survivors.map((survivor) => [survivor.cardinality, survivor]),
  );
  let harmonic_count = 0;
  survivors.forEach((survivor) => {
    for (let divisor = 2; divisor < survivor.cardinality; divisor += 1) {
      if (survivor.cardinality % divisor !== 0) continue;
      const lower = by_cardinality.get(divisor);
      if (
        lower &&
        lower.period_validation?.valid === true &&
        lower.score >= survivor.score - score_tolerance &&
        lower.cardinality < survivor.cardinality
      ) {
        survivor.harmonic = true;
        survivor.harmonic_of = divisor;
        harmonic_count += 1;
        break;
      }
    }
  });
  return harmonic_count;
};

const greatest_common_divisor = (left, right) => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
};

/**
 * Measure sign coherence in the finite-difference pyramid sampled every N
 * iterations. Alternating signs between layers are expected; a sign change
 * within one layer indicates a wavering candidate progression.
 *
 * @param {Array<object>} samples Critical-orbit samples.
 * @param {number} gap Candidate cardinality.
 * @param {(iteration:number)=>object|undefined} sample_at_iteration Sample lookup.
 * @returns {{coherence:number,layers:number,sign_changes:number,sample_count:number}} Pyramid diagnostics.
 */
const derivative_pyramid = (samples, gap, sample_at_iteration) => {
  const values = [];
  const first_iteration = samples[0]?.iteration;
  if (!Number.isFinite(first_iteration)) {
    return {
      coherence: 0,
      magnitude_coherence: 0,
      minimum_layer_magnitude_coherence: 0,
      layers: 0,
      sign_changes: 0,
      sample_count: 0,
      layer_diagnostics: [],
    };
  }
  for (let cycle = 0; cycle <= DERIVATIVE_PYRAMID_CYCLES; cycle += 1) {
    const sample = sample_at_iteration(first_iteration + cycle * gap);
    if (!sample) break;
    values.push(sample.radius);
  }
  if (values.length < 3) {
    return {
      coherence: 0,
      magnitude_coherence: 0,
      minimum_layer_magnitude_coherence: 0,
      layers: 0,
      sign_changes: 0,
      sample_count: values.length,
      layer_diagnostics: [],
    };
  }
  let layer = values;
  let coherent_layers = 0;
  let sign_changes = 0;
  const layer_diagnostics = [];
  while (layer.length > 1) {
    const differences = layer
      .slice(1)
      .map((value, index) => value - layer[index]);
    const scale = differences.reduce(
      (maximum, value) => Math.max(maximum, Math.abs(value)),
      0,
    );
    const epsilon = Math.max(scale * 1e-12, 1e-30);
    let minimum_absolute_change = Infinity;
    let maximum_absolute_change = 0;
    let absolute_change_total = 0;
    let positive_change_count = 0;
    let negative_change_count = 0;
    let ignored_change_count = 0;
    let positive_change_magnitude = 0;
    let negative_change_magnitude = 0;
    differences.forEach((value) => {
      const absolute_change = Math.abs(value);
      minimum_absolute_change = Math.min(
        minimum_absolute_change,
        absolute_change,
      );
      maximum_absolute_change = Math.max(
        maximum_absolute_change,
        absolute_change,
      );
      absolute_change_total += absolute_change;
      if (value > epsilon) {
        positive_change_count += 1;
        positive_change_magnitude += value;
      } else if (value < -epsilon) {
        negative_change_count += 1;
        negative_change_magnitude += Math.abs(value);
      } else {
        ignored_change_count += 1;
      }
    });
    const absolute_change_spread =
      maximum_absolute_change - minimum_absolute_change;
    const total_directional_magnitude =
      positive_change_magnitude + negative_change_magnitude;
    const directional_magnitude_coherence =
      total_directional_magnitude > 0
        ? Math.abs(positive_change_magnitude - negative_change_magnitude) /
          total_directional_magnitude
        : 1;
    layer_diagnostics.push({
      finite_difference_order: layer_diagnostics.length + 1,
      sample_count: differences.length,
      noise_threshold: epsilon,
      scale,
      minimum_absolute_change: Number.isFinite(minimum_absolute_change)
        ? minimum_absolute_change
        : 0,
      maximum_absolute_change,
      mean_absolute_change: absolute_change_total / differences.length,
      absolute_change_spread,
      normalized_absolute_change_spread:
        scale > 0 ? absolute_change_spread / scale : 0,
      positive_change_count,
      negative_change_count,
      ignored_change_count,
      positive_change_magnitude,
      negative_change_magnitude,
      directional_magnitude_coherence,
    });
    const signs = differences
      .filter((value) => Math.abs(value) > epsilon)
      .map((value) => Math.sign(value));
    if (signs.length > 0) {
      const positive = signs.filter((sign) => sign > 0).length;
      const negative = signs.length - positive;
      if (positive === 0 || negative === 0) coherent_layers += 1;
      sign_changes += Math.min(positive, negative);
    }
    layer = differences;
  }
  const layers = values.length - 1;
  const magnitude_coherence =
    layer_diagnostics.reduce(
      (sum, diagnostic) => sum + diagnostic.directional_magnitude_coherence,
      0,
    ) / Math.max(1, layer_diagnostics.length);
  const minimum_layer_magnitude_coherence = layer_diagnostics.reduce(
    (minimum, diagnostic) =>
      Math.min(minimum, diagnostic.directional_magnitude_coherence),
    1,
  );
  return {
    coherence: coherent_layers / Math.max(1, layers),
    magnitude_coherence,
    minimum_layer_magnitude_coherence,
    layers,
    sign_changes,
    sample_count: values.length,
    layer_diagnostics,
  };
};

/**
 * Sieve possible cardinalities by requiring sign consistency at every
 * derivative-pyramid level. This is intentionally separate from the mature
 * recurrence detector so its performance and false-elimination behavior can
 * be measured independently.
 *
 * @param {Array<object>} samples Critical-orbit samples with origin radius.
 * @param {{minimum_cycles?:number,max_cardinality?:number,max_layers?:number,
 *   noise_factor?:number,near_zero_tolerance?:number,precision_digits?:number,
 *   max_precision_digits?:number,precision_escalation_factor?:number}} [options]
 *   Contender-sieve and numerical-policy controls. Precision settings are
 *   reported now and consumed by the high-precision promotion stage.
 * @returns {object} Surviving contenders, elimination counts, and timing.
 */
export const detect_pyramid_contenders = (samples, options = {}) => {
  const started = performance.now();
  const minimum_cycles = Math.max(
    2,
    Math.floor(Number(options.minimum_cycles) || 10),
  );
  const max_cardinality = Math.min(
    Math.floor((samples.length - 1) / minimum_cycles),
    Math.max(1, Math.floor(Number(options.max_cardinality) || 4096)),
  );
  const noise_factor = Math.max(1, Number(options.noise_factor) || 64);
  const near_zero_tolerance = Math.max(
    Number.EPSILON,
    Number(options.near_zero_tolerance) || DEFAULT_NEAR_ZERO_TOLERANCE,
  );
  const max_layers = Math.max(
    1,
    Math.min(
      minimum_cycles,
      Math.floor(Number(options.max_layers) || minimum_cycles),
    ),
  );
  const precision_digits = Math.max(
    15,
    Math.floor(Number(options.precision_digits) || DEFAULT_PRECISION_DIGITS),
  );
  const max_precision_digits = Math.max(
    precision_digits,
    Math.floor(
      Number(options.max_precision_digits) || DEFAULT_MAX_PRECISION_DIGITS,
    ),
  );
  const precision_escalation_factor = Math.max(
    2,
    Number(options.precision_escalation_factor) ||
      DEFAULT_PRECISION_ESCALATION_FACTOR,
  );
  const stop_on_confident =
    options.stop_on_confident === true || options.stop_on_confident === "true";
  const confidence_threshold = Math.min(
    1,
    Math.max(0, Number(options.confidence_threshold) || 1),
  );
  const harmonic_score_tolerance = Math.max(
    0,
    Number(options.harmonic_score_tolerance) ||
      DEFAULT_HARMONIC_SCORE_TOLERANCE,
  );
  const period_validation_tolerance = Math.max(
    Number.EPSILON,
    Number(options.period_validation_tolerance) ||
      DEFAULT_PERIOD_VALIDATION_TOLERANCE,
  );
  const first_iteration = samples[0]?.iteration;
  const survivors = [];
  const contender_states = [];
  let eliminated = 0;
  let insufficient = 0;
  let near_zero_contenders = 0;
  let near_zero_events = 0;
  const elimination_by_level = {};
  let max_layer_reached = 0;
  const record_elimination = (contender) => {
    const level = Number.isInteger(contender.elimination_level)
      ? String(contender.elimination_level)
      : "unknown";
    elimination_by_level[level] = (elimination_by_level[level] || 0) + 1;
  };
  const last_iteration = samples.at(-1)?.iteration;
  const schedule_span =
    Number.isFinite(first_iteration) && Number.isFinite(last_iteration)
      ? Math.max(0, last_iteration - first_iteration + 1)
      : 0;
  const schedule_heads = new Int32Array(schedule_span);
  schedule_heads.fill(-1);
  let stopped_early = false;
  let stop_iteration = null;
  let processed_iterations = 0;
  let scheduled_updates = 0;
  const schedule_contender = (iteration, contender) => {
    if (!Number.isFinite(iteration)) return;
    const offset = iteration - first_iteration;
    if (offset < 0 || offset >= schedule_heads.length) return;
    contender.schedule_next_index = schedule_heads[offset];
    schedule_heads[offset] = contender.state_index;
  };
  for (let cardinality = 1; cardinality <= max_cardinality; cardinality += 1) {
    const contender = create_pyramid_contender_state(cardinality, max_layers);
    contender.state_index = contender_states.length;
    contender_states.push(contender);
    const initial_sample = samples[0];
    if (initial_sample) {
      contender.sample_values.push(initial_sample.radius);
      update_contender_derivative_state(
        contender,
        initial_sample.radius,
        max_layers,
        noise_factor,
        near_zero_tolerance,
      );
      contender.sample_count = 1;
      contender.next_iteration = first_iteration + cardinality;
      schedule_contender(contender.next_iteration, contender);
    }
  }

  // Walk the orbit once. A contender is visited only when its cardinality
  // requires the current iteration, avoiding the previous full scan for each
  // candidate cardinality.
  for (const sample of samples) {
    processed_iterations += 1;
    const offset = sample.iteration - first_iteration;
    let contender_index =
      offset >= 0 && offset < schedule_heads.length
        ? schedule_heads[offset]
        : -1;
    if (offset >= 0 && offset < schedule_heads.length) {
      schedule_heads[offset] = -1;
    }
    while (contender_index >= 0) {
      const contender = contender_states[contender_index];
      const next_contender_index = contender.schedule_next_index;
      contender.schedule_next_index = -1;
      if (contender.sample_count < minimum_cycles + 1) {
        scheduled_updates += 1;
        contender.sample_values.push(sample.radius);
        const remains_viable = update_contender_derivative_state(
          contender,
          sample.radius,
          max_layers,
          noise_factor,
          near_zero_tolerance,
        );
        contender.sample_count += 1;
        contender.next_iteration = sample.iteration + contender.cardinality;
        if (remains_viable && contender.sample_count < minimum_cycles + 1) {
          schedule_contender(contender.next_iteration, contender);
        }
      }
      contender_index = next_contender_index;
    }
    if (
      stop_on_confident &&
      contender_states.some(
        (contender) =>
          !contender.eliminated &&
          contender.sample_count >= minimum_cycles + 1 &&
          contender.pyramid_layers / Math.max(1, max_layers) >=
            confidence_threshold &&
          contender.near_zero_events === 0,
      )
    ) {
      stopped_early = true;
      stop_iteration = sample.iteration;
      break;
    }
  }

  contender_states.forEach((contender) => {
    const values = contender.sample_values;
    if (contender.eliminated) {
      contender.sample_values.length = 0;
      eliminated += 1;
      record_elimination(contender);
      max_layer_reached = Math.max(max_layer_reached, contender.pyramid_layers);
      return;
    }
    if (contender.near_zero_events > 0) {
      near_zero_contenders += 1;
      near_zero_events += contender.near_zero_events;
    }
    if (values.length < minimum_cycles + 1) {
      contender.sample_count = values.length;
      contender.next_iteration =
        first_iteration + values.length * contender.cardinality;
      contender.elimination_reason = "insufficient_samples";
      contender.sample_values.length = 0;
      insufficient += 1;
      return;
    }
    contender.sample_count = values.length;
    contender.next_iteration =
      first_iteration + values.length * contender.cardinality;
    let layer = values;
    let coherent_layers = 0;
    let sign_changes = 0;
    let rejected = false;
    while (layer.length > 1 && !rejected && coherent_layers < max_layers) {
      const differences = layer
        .slice(1)
        .map((value, index) => value - layer[index]);
      const scale = differences.reduce(
        (maximum, value) => Math.max(maximum, Math.abs(value)),
        0,
      );
      const epsilon = Math.max(
        Number.EPSILON * noise_factor * Math.max(1, scale),
        near_zero_tolerance,
      );
      const signs = differences
        .filter((value) => Math.abs(value) > epsilon)
        .map((value) => Math.sign(value));
      if (signs.length > 0) {
        const positive = signs.filter((sign) => sign > 0).length;
        const negative = signs.length - positive;
        if (positive > 0 && negative > 0) {
          sign_changes += Math.min(positive, negative);
          rejected = true;
          contender.eliminated = true;
          contender.elimination_level = coherent_layers;
          contender.elimination_reason = "derivative_sign_change";
        } else {
          coherent_layers += 1;
        }
      }
      layer = differences;
    }
    if (rejected) {
      eliminated += 1;
      record_elimination(contender);
    } else {
      contender.pyramid_layers = coherent_layers;
      contender.sign_changes = sign_changes;
      max_layer_reached = Math.max(max_layer_reached, coherent_layers);
      const score = score_pyramid_contender(
        contender,
        minimum_cycles,
        max_layers,
      );
      const period_validation = validate_candidate_period(
        samples,
        contender.cardinality,
        minimum_cycles,
        period_validation_tolerance,
      );
      survivors.push({
        cardinality: contender.cardinality,
        cycles: values.length - 1,
        pyramid_layers: coherent_layers,
        sign_changes,
        near_zero_events: contender.near_zero_events,
        score: score.score,
        score_components: score,
        period_validation,
      });
    }
    // Retain the state metadata, but release per-contender samples. The
    // streaming implementation will replace this temporary working array.
    contender.sample_values.length = 0;
  });
  survivors.sort(
    (left, right) =>
      right.score - left.score || left.cardinality - right.cardinality,
  );
  const harmonic_count = suppress_harmonic_survivors(
    survivors,
    harmonic_score_tolerance,
  );
  survivors.sort(
    (left, right) =>
      Number(!left.period_validation.valid) -
        Number(!right.period_validation.valid) ||
      Number(Boolean(left.harmonic)) - Number(Boolean(right.harmonic)) ||
      right.score - left.score ||
      left.cardinality - right.cardinality,
  );
  survivors.forEach((survivor, index) => {
    survivor.rank = index + 1;
  });
  return {
    status: survivors.length
      ? "pyramid_contenders_found"
      : "pyramid_inconclusive",
    minimum_cycles,
    max_cardinality,
    max_layers,
    contender_state_count: contender_states.length,
    scheduled_updates,
    iterations_processed: processed_iterations,
    max_layer_reached,
    elimination_by_level,
    precision_promotions: 0,
    precision_status: "native",
    noise_factor,
    near_zero_tolerance,
    precision_policy: {
      initial_digits: precision_digits,
      max_digits: max_precision_digits,
      escalation_factor: precision_escalation_factor,
      status: "reserved_for_precision_promotion",
    },
    early_stop: {
      enabled: stop_on_confident,
      confidence_threshold,
      stopped: stopped_early,
      stop_iteration,
      processed_iterations,
    },
    contender_count: Math.max(0, max_cardinality - 2),
    eliminated_count: eliminated,
    insufficient_count: insufficient,
    near_zero_contenders,
    near_zero_events,
    harmonic_score_tolerance,
    harmonic_count,
    period_validation_tolerance,
    survivor_count: survivors.length,
    survivors,
    elapsed_ms: performance.now() - started,
  };
};

/**
 * Detect a cardinality from repeated near-zero returns of a sampled orbit.
 *
 * @param {Array<{iteration:number,radius:number}>} samples Critical-orbit samples;
 *   `radius` is the origin-based magnitude `|z|`.
 * @param {{minimum_return_repetitions?:number,contiguous_iterations?:boolean}}
 *   [options] Detection controls. Cardinality's internal sampler may enable
 *   the contiguous mode to avoid building an iteration-index Map.
 * @returns {object} Candidate cardinality, supporting minima, and confidence.
 */
export const detect_return_cardinality = (samples, options = {}) => {
  const requested_repetitions = Number(options.minimum_return_repetitions);
  const minimum_repetitions = Math.min(
    MAX_MINIMUM_REPETITIONS,
    Math.max(
      DEFAULT_MINIMUM_REPETITIONS,
      Math.floor(requested_repetitions) || DEFAULT_MINIMUM_REPETITIONS,
    ),
  );
  const minima = samples.filter(
    (sample, index) =>
      index > 0 &&
      index < samples.length - 1 &&
      sample.radius <= samples[index - 1].radius &&
      sample.radius < samples[index + 1].radius,
  );
  const radius_sorted = [...minima].sort(
    (left, right) => left.radius - right.radius,
  );
  let return_minima = minima;
  let largest_radius_gap = 0;
  let radius_gap_index = -1;
  for (let index = 1; index < radius_sorted.length; index += 1) {
    const ratio =
      radius_sorted[index].radius /
      Math.max(radius_sorted[index - 1].radius, 1e-30);
    if (ratio > largest_radius_gap) {
      largest_radius_gap = ratio;
      radius_gap_index = index;
    }
  }
  if (largest_radius_gap >= MINIMUM_RADIUS_GAP_RATIO) {
    const radius_limit = Math.sqrt(
      radius_sorted[radius_gap_index - 1].radius *
        radius_sorted[radius_gap_index].radius,
    );
    return_minima = minima.filter((sample) => sample.radius <= radius_limit);
  }
  const gap_groups = new Map();
  // Radius minima can alternate between sub-gaps (for example 3 and 4) even
  // when the actual orbit returns every 7 iterations. Compare nearby minima
  // pairs so composite periods are not discarded as noise.
  // A 28-cycle can contain nine alternating radius minima before the same
  // phase is revisited; allow enough intervening minima to expose that full
  // composite gap while keeping candidate generation bounded.
  const MAX_MINIMA_PAIR_DISTANCE = 24;
  for (let index = 1; index < return_minima.length; index += 1) {
    for (
      let previous_index = Math.max(0, index - MAX_MINIMA_PAIR_DISTANCE);
      previous_index < index;
      previous_index += 1
    ) {
      const gap =
        return_minima[index].iteration -
        return_minima[previous_index].iteration;
      if (gap > 0) {
        const group = gap_groups.get(gap) || [];
        group.push([previous_index, index]);
        gap_groups.set(gap, group);
      }
    }
  }
  const sample_by_iteration = options.contiguous_iterations
    ? null
    : new Map(samples.map((sample) => [sample.iteration, sample]));
  const sample_at_iteration = options.contiguous_iterations
    ? (iteration) => samples[iteration]
    : (iteration) => sample_by_iteration.get(iteration);
  const recurrence_start = Math.floor(samples.length * 0.5);
  const tail_step_errors = [];
  for (let index = recurrence_start + 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = samples[index - 1];
    tail_step_errors.push(Math.hypot(sample.re - previous.re, sample.im - previous.im));
  }
  const baseline_error =
    select_kth(tail_step_errors, Math.floor(tail_step_errors.length / 2)) || 1;
  const ranked = [...gap_groups.entries()]
    // Do not spend a tail-wide recurrence pass on gaps that cannot satisfy
    // the repetition requirement in the first place.
    .filter(([, indexes]) => indexes.length >= minimum_repetitions)
    .map(([gap, indexes]) => {
      // Minima identify plausible periods, but their locations can be
      // transient. Validate each gap against every available tail sample so
      // a true return (such as 28 here) outranks a coincidental minima gap.
      const errors = [];
      for (let index = recurrence_start; index < samples.length; index += 1) {
        const current = samples[index];
        const previous = sample_at_iteration(current.iteration - gap);
        if (previous) {
          errors.push(Math.hypot(current.re - previous.re, current.im - previous.im));
        }
      }
      return {
        gap,
        indexes,
        recurrence_error: select_kth(errors, Math.floor(errors.length / 2)) ?? Infinity,
        pyramid: derivative_pyramid(samples, gap, sample_at_iteration),
      };
    })
    .sort(
      (left, right) =>
        left.recurrence_error - right.recurrence_error ||
        right.indexes.length - left.indexes.length,
    );
  const best = ranked[0];
  if (!best) {
    return {
      status: "inconclusive",
      minimum_return_repetitions: minimum_repetitions,
      minima,
      candidate_cardinality: null,
      matching_gaps: 0,
    };
  }
  const cardinality = best.gap;
  // Integer multiples are expected harmonics of the same return period, not
  // independent competing explanations. Exclude them from the ambiguity
  // margin while retaining them in the diagnostics below.
  const competing_candidates = ranked
    .slice(1)
    .filter((candidate) => candidate.gap % cardinality !== 0);
  const next_best = competing_candidates[0];
  const recurrence_quality = Math.max(
    0,
    Math.min(1, 1 - best.recurrence_error / Math.max(baseline_error, 1e-30)),
  );
  const confidence_margin = next_best
    ? Math.max(
        0,
        Math.min(
          1,
          (next_best.recurrence_error - best.recurrence_error) /
            Math.max(next_best.recurrence_error, 1e-30),
        ),
      )
    : 1;
  const matching_minima = [return_minima[best.indexes[0][0]]];
  let minimum_radius = matching_minima[0].radius;
  let maximum_radius = minimum_radius;
  for (const pair of best.indexes) {
    const sample = return_minima[pair[1]];
    matching_minima.push(sample);
    minimum_radius = Math.min(minimum_radius, sample.radius);
    maximum_radius = Math.max(maximum_radius, sample.radius);
  }
  const radius_stability =
    1 -
    Math.min(
      1,
      (maximum_radius - minimum_radius) / Math.max(maximum_radius, 1e-30),
    );
  const recurrence = Math.min(1, best.indexes.length / minimum_repetitions);
  const legacy_ambiguous =
    recurrence_quality < 0.5 ||
    confidence_margin < 0.1 ||
    best.pyramid.coherence < 0.5;
  return {
    status: "return_pattern_detected",
    minimum_return_repetitions: minimum_repetitions,
    candidate_cardinality: cardinality,
    matching_gaps: best.indexes.length,
    recurrence_error: best.recurrence_error,
    recurrence_baseline_error: baseline_error,
    recurrence_quality,
    pyramid_coherence: best.pyramid.coherence,
    pyramid_magnitude_coherence: best.pyramid.magnitude_coherence,
    pyramid_minimum_layer_magnitude_coherence:
      best.pyramid.minimum_layer_magnitude_coherence,
    pyramid_layers: best.pyramid.layers,
    pyramid_sign_changes: best.pyramid.sign_changes,
    pyramid_layer_diagnostics: best.pyramid.layer_diagnostics,
    legacy_ambiguous,
    confidence_margin,
    ambiguous:
      recurrence_quality < 0.5 ||
      confidence_margin < 0.1 ||
      best.pyramid.magnitude_coherence < 0.5 ||
      best.pyramid.minimum_layer_magnitude_coherence < 0.5,
    alternatives: ranked.slice(1, 6).map((candidate) => ({
      cardinality: candidate.gap,
      matching_gaps: candidate.indexes.length,
      recurrence_error: candidate.recurrence_error,
      harmonic: candidate.gap % cardinality === 0,
      pyramid_coherence: candidate.pyramid.coherence,
      pyramid_magnitude_coherence: candidate.pyramid.magnitude_coherence,
      pyramid_minimum_layer_magnitude_coherence:
        candidate.pyramid.minimum_layer_magnitude_coherence,
      pyramid_layers: candidate.pyramid.layers,
      pyramid_sign_changes: candidate.pyramid.sign_changes,
      pyramid_layer_diagnostics: candidate.pyramid.layer_diagnostics,
    })),
    gap_gcd: best.indexes.reduce(
      (result, index) =>
        greatest_common_divisor(
          result,
          return_minima[index[1]].iteration - return_minima[index[0]].iteration,
        ),
      0,
    ),
    minima,
    matching_minima,
    minimum_radius,
    maximum_radius,
    radius_stability,
    recurrence,
    confidence:
      0.4 * recurrence_quality +
      0.3 * confidence_margin +
      0.1 * radius_stability +
      0.1 * best.pyramid.coherence +
      0.1 * Math.min(1, recurrence),
  };
};
