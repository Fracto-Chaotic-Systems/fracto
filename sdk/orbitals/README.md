# SDK orbital calculation helpers

This folder contains the numerical building blocks used by the public
`FractoCardinality` and `FractoOrbitalPoints` interfaces. These helpers are
kept separate so sampling, candidate scoring, and Newton refinement can be
tested independently. Application code should normally use the public SDK interfaces. The seeded
survey and dynamic-ray tools also use the low-level Newton helper explicitly
to retain their chosen starting seed and refinement budget.

`FractoOrbitalDiscovery.js` retains the legacy seeded/explicit-period and
ray-endpoint diagnostic helpers, and calculates selected-cycle dynamic rays.
The persistent workflow now uses the shared Seed Surveys scan below.
`FractoCatalogOrbitalDiscovery.js` provides the standalone denominator-catalog,
representative-ray discovery route described below; persistent application job
integration is a subsequent step.
`FractoOrbitalIdentity.js`
supplies decimal-preserving closure/primitive-period checks and complete-cycle
identity under cyclic rotation. They do not use the UI scan's display grouping
as persistent identity. See [the storage and worker contract](../../servers/fracto-data-server/ORBITAL_DATA.md).

Both public SDK entry points are scoped to the main cardioid. When a valid
parameter is outside that domain, `FractoCardinality` and
`FractoOrbitalPoints` return `FractoFastCalc.calc(re, im)` directly. The
cardinality detector and Newton solvers are skipped; the calculator's result
shape is preserved as-is. `FractoCardinality` also returns that result by
default outside the cardioid, but uses `calc_from_seed()` there when an
explicit seed is provided.

- `FractoOrbitSampling.js` iterates an orbit from a configurable complex seed
  for a bounded horizon and retains the samples used by return detection.
  Escaping samples stop at the radius-2 bailout when valid for the parameter,
  and report the actual iteration count rather than the configured horizon.
  `sample_critical_orbit()` remains a zero-seed wrapper for compatibility.
- `FractoReturnDetection.js` identifies repeated near-origin return gaps and
  provides the separate derivative-pyramid candidate sieve. The latter is
  experimental; neither method proves a mathematical period.
  Cardinality passes contiguous iteration metadata from its sampler so the
  detector can index samples directly and select recurrence medians without
  sorting; standalone detector calls retain support for arbitrary iteration
  labels. The return detector keeps numeric scratch buffers local to each
  invocation and reuses them across recurrence-median selections and all
  candidate derivative pyramids. Candidate ranking, diagnostic calculations,
  and returned detail remain unchanged. No mutable scratch state is shared
  between concurrent detector calls.
- `FractoCardinalityQuality.js` evaluates whether a return candidate has
  enough repeated-gap evidence to stop adaptive horizon growth.
- `FractoNewtonDerived.js` refines a supplied cardinality with JavaScript
  `Number` arithmetic.
- `FractoNewtonBigComplex.js` refines a supplied cardinality with `BigComplex`
  arithmetic and configurable significant-digit precision.

## Denominator-based preprocessing catalog

`FractoDenominatorCatalog.js` builds a focal-point-independent catalog of every
reduced periodic external angle with denominator at most a requested bound.
The bundled `data/denominator-catalog.json` covers denominators through 255:
412 doubling families and 13,231 distinct angles, including the fixed angle
`0/1`. The JSON is compact, deterministic, and versioned as
`fracto-denominator-catalog-v1`.

Each odd-denominator entry stores its exact angle period (the multiplicative
order of 2), every positive divisor of that period as a **candidate** orbital
period, and its families. Each family stores a canonical `key` (its least
numerator over the reduced denominator) and all numerators in doubling order.
Fractions are stored as decimal strings. Non-coprime numerators are excluded
because their reduced fractions belong to earlier denominators. Reduced even
denominators are preperiodic and outside this periodic catalog. There is no
angle-period-24 cutoff: denominator 59, for example, has angle period 58.

`build_denominator_catalog({max_denominator, previous, angle_budget})` validates
and reuses existing entries and computes only newly added odd denominators.
An even maximum is allowed and means inclusive coverage through that bound.
`validate_denominator_catalog()` checks coverage, reduction, canonical ordering,
exact doubling, closure, period/divisor metadata, and totals. It refuses missing
or corrupted families rather than silently repairing a partial file.
`catalog_doubling_families(catalog, {orbital_period})` iterates the records in the
existing SDK ray-family shape; the optional filter selects divisor candidates.
Call the validator when loading an external catalog before iterating it.

The preprocessing allocation guard is denominator 1,000,000. A separate default
budget of 1,000,000 total angles rejects oversized builds _before_ family
generation; it never silently truncates a catalog or filters by period.
The CLI can explicitly raise the angle budget. Work and file size grow roughly
quadratically with the denominator bound, so increase it in measured steps.

Build, expand, or verify the bundled catalog from the repository root:

```sh
node scripts/build_orbital_denominator_catalog.js
node scripts/build_orbital_denominator_catalog.js --max-denominator 1023
node scripts/build_orbital_denominator_catalog.js --check
node --test test/sdk_denominator_catalog.test.js
```

`--out FILE` selects another file. Existing entries are validated on every run,
an explicit smaller bound is rejected, and no bound argument preserves any
previous expansion. Writes replace the file atomically; unchanged output is
not rewritten. A catalog records combinatorial possibilities, not confirmed
landings. Pass the validated catalog to `find_dynamic_rays` through
`options.catalog` to use denominator-based family tracing, as described below.
The application discovery jobs and stored-orbital workflow still use their
existing route until the subsequent discovery integration step.

## Catalog-driven family tracing

`FractoCatalogDynamicRays.js` supplies `find_catalog_dynamic_rays` and
`trace_catalog_ray_family`. The existing `find_dynamic_rays(c, {points}, options)`
dispatches to this route when `options.catalog` is supplied. Without it, the
period-based enumeration, budgets, and checkpoint format remain unchanged.

The catalog route validates its input, selects families whose angle periods
are divisible by the assessed orbital period, and visits them in denominator
and representative-numerator order. It does not stop at the first matching
angle period. `max_angle_period` does not filter this route, even if inherited
from `SEED_SURVEY_RAY_OPTIONS`. Each explicit family supplies its complete exact
cycle length to the existing tracer; all member landings, terminal precision,
approach, closure, and endpoint dynamics must validate before acceptance.

`max_families` (default 256) bounds the family attempts. `max_family_rays`
(default 4096) explicitly bounds the number of rays in one family. Oversized
families remain in `unresolved` with reason `family_ray_limit`, rather than being
silently omitted. Other unresolved attempts retain reasons such as `point_limit`,
`precision_limit`, or `landing_mismatch`. Search metadata reports the catalog
version/bound, eligible and remaining family counts, and budget exhaustion.
`search.complete` remains false: numerical coverage does not certify that all
possible accesses or orbitals have been found.

`max_work_units` limits whole families per call and returns `status: "checkpoint"`.
Resume by passing the returned `state`. The checkpoint binds the exact focal
point, selected orbit, catalog version/bound, budgets, and numerical profile;
incompatible resumes fail. Cancellation after work begins also includes a state
with completed families retained. Changing a bound/profile requires a fresh
search, with persistent reuse to be added by the later cache/ledger integration.

For example, after loading the bundled JSON:

```js
const result = await find_dynamic_rays(
  parameter,
  { points },
  {
    catalog,
    max_families: 1024,
    max_family_rays: 4096,
    max_work_units: 4,
    state: priorCheckpoint,
  },
);
```

The tracer is tested against all 58 analytic rays in the `1/59` family for
`z -> z²`, as well as a period-two ray family landing on a period-one orbit
for `z -> z² - 1`. The selected-orbit entry point still requires orbital
assessment to succeed; its numerical failures and input-size guards are not
overridden by catalog membership. For ray-first discovery without a supplied
spatial orbit, use the following entry point.

## Representative-ray orbital discovery

### Adaptive solver for catalog-only jobs

`FractoRepresentativeRaySolver.js` exports `discover_representative_orbital(c,
family, options)` and `representative_ray_profile()`. Its separate solver version
is `catalog-representative-discovery-v1`. It is not yet dispatched by application
jobs; existing full-family discovery below keeps its current numerical identity.

The new solver starts one continuing inverse-Böttcher ray and probes progressively
deeper potentials (defaults: depth 12, increments 16, limit 512). Each probe keeps
the existing square-root branch chain rather than starting again at infinity.
It retains only 16 endpoint-history points and enforces one cumulative 16,000
sample budget. Coarser curve sampling uses tolerance 1e-4; endpoint/root distance
uses a separate 1e-8 threshold. Decimal terminal evaluation uses the exact supplied
parameter. Precision starts at 64 digits or higher for long angle periods,
increases when needed, and final refinement uses at least 128 digits by default.

Confirmation repair revision 2 detects when the ray has converged more tightly
than the current Newton cycle's rounding error. When the remaining discrepancy
is consistent with that cycle's closure residual, it raises precision and
re-evaluates the same continuing ray at the current depth, then repeats Newton
and the original confirmation checks. The residual is only an escalation
heuristic; it does not relax acceptance. Nearby wrong divisor roots remain
rejected, and independent assignment validation is still required. Final
precision increases remain in force for later probes rather than falling back
to the earlier precision. The depth, sample and maximum-precision budgets are
unchanged; no sibling rays or drawing geometry are added.

`REPRESENTATIVE_CONFIRMATION_REVISION` and result `confirmation_revision` track
this repair without changing the compatible solver/profile identity. Existing
validated evidence remains reusable; the coordinator retries only old cached
confirmation-depth failures. `npm run test:orbital-confirmation` covers all ten
regressions, cancellation, precision ceilings and durable job repair.

Only divisor periods whose exterior seeds have adequate depth are tried. The
complete angle period is tried first once eligible; canonicalization independently
checks forward closure and reduces repeated traversals. A second deeper endpoint
must approach the same point consistently. A nearby wrong divisor-period root
whose distance exceeds the observed ray movement is rejected. Final high-precision
Newton refinement rechecks closure, cycle identity, and a repelling multiplier.
Cancellation is supported during tracing and Newton iteration. Depth, point,
precision and period limits remain explicit unresolved outcomes; no guess is
returned when the numerical budget fails. Parabolic/neutral cases are not accepted.

Success returns `orbital_candidate`: exact canonical points, primitive period,
compact representative evidence, numerical profile, progress counters, and
independent lifecycle state (`orbital: validated`, `assignments: pending`,
`paths.status: missing`). No sibling rays, full path arrays, or verified landing
ratios are returned. Approach consistency is numerical evidence, not a certificate
of the ray's landing association; the separate assignment-validation step must
resolve that association before publishing ratios. Local continuation state is
in-memory; persistent jobs will still checkpoint completed family outcomes.

`npm run test:orbital-representative` covers analytic landing points, divisor
periods, the nearby wrong period-29 root in the period-58 example, the 162-ray
family that formerly stopped jobs at 233, continuation budgets, and cancellation.
`npm run data:orbital:representative:benchmark -- --full-reference` compares these
candidate results with full-family discovery and saves explicit profiles and
timings to `logs/representative_orbital_benchmark.json`. The comparison has different
validation/geometry requirements and is not a speed guarantee for a completed job.

### Compact landing-assignment validation

`FractoLandingAssignments.js` exports `validate_representative_assignments(c,
family, discovery, options)` and the convenience wrapper
`discover_validated_representative_orbital(c, family, {discovery, validation,
cancelled, on_progress})`. The assignment version is
`catalog-representative-assignments-v1`, separate from the discovery solver.
Application jobs use this validator through the compact investigation contract;
the legacy full-geometry route remains compatible.

The validator independently checks the exact parameter/family binding, canonical
primitive closure and repelling cycle. Around each cycle point it constructs a
guarded Decimal inverse-branch disk. The radii satisfy the stronger sufficient
inequality `2(|z_i|-r_i)r_i > r_(i+1) + residual_i`, with weighted inverse
contraction below one. A residual/contraction estimate bounds the discrepancy
between the approximate and true periodic centers.

A fresh representative trace is sampled at outer potential T and inner potential
T/2^q, where q is the angle period. Its intervening arc is checked while streaming
endpoints, midpoints and adaptive deviation estimates through the representative
disk; no sampled curve is retained. Terminal inverse evaluation independently
returns q+1 Decimal transport endpoints. Every endpoint must lie in its proposed
cycle disk with landing error within the configured tolerance, and the q-th must
agree with the independently traced outer endpoint. The exact doubling family
then supplies all point assignments, including multiple accesses per point and
spatial periods dividing q. Newton convergence or endpoint proximity alone is
insufficient: the period-58 regression rejects the nearby wrong period-29 orbit.

These are numerical validation checks with guarded Decimal arithmetic and
adaptive native arc estimates, not an interval-arithmetic certificate. Compact
evidence retains disk radii, root-error bounds, contraction, transport endpoints,
and arc summary; it does not retain drawing paths. Success is
`assignments_verified` with complete validated landing ratios, while lifecycle
paths remain missing. Failures preserve the selectable closed orbital with
`assignments_pending` and no published ratios. Depth, precision, point budgets,
inconsistent anchors and cancellation cannot promote pending evidence.

Validation retries deeper independent representative traces within its explicit
budget. `full_fallback: true` additionally allows the existing full-family tracer
to resolve ambiguity; this is disabled by default and any transient fallback
geometry is discarded. Neither route populates a path cache. Ordinary path
generation remains reserved for orbital selection in the later integration.

Run `npm run test:orbital-assignments`. The representative benchmark accepts
`--assignments --full-reference` to compare complete numerical ratio assignments
against full-family tracing, saving `logs/landing_assignment_benchmark.json`.

### Existing full-family discovery

`FractoCatalogOrbitalDiscovery.js` exports
`discover_catalog_orbitals(parameter, {catalog, ...options})` and the single-family
helper `discover_catalog_orbital_family(parameter, family, options)`. Neither
requires a survey, a requested orbital period, or preexisting spatial points.

After establishing connectedness with the existing eligibility checks, discovery
traces a representative at terminal depth `max(minimum_depth, angle_period + 40)`.
It requires terminal precision agreement and a stable last-16-sample window.
`FractoDynamicRayTrace` now preserves its terminal high-precision coordinate as
`endpoint_decimal`; Newton uses those strings instead of a rounded native seed.
Every divisor of the angle period is tried with bounded Newton iterations and
precision escalation. Closed candidates are independently checked and reduced
to their numerically primitive period by `canonical_orbital`. Roots away from the
representative landing region are rejected.

Candidate membership alone is insufficient. The complete doubling family must
pass its existing landing, approach, terminal precision, closure, and endpoint
dynamics checks. A failed nearby divisor-period root does not stop the search:
remaining divisors, including the full angle period, are still tried. Repelling
cycles are accepted; neutral and attracting outcomes remain unresolved here.
The survey route remains necessary for attracting cycles.

Representative geometry is reused when it already satisfies the full-family
depth and precision requirements. Otherwise the first ray is traced more deeply.
An explicit canonical point index keeps the family aligned after cycle rotation.
All numerical orbit identity and closure checks retain decimal coordinates.

Repeated families are merged into one cycle with combined `landing_ratios` and
`families`. Optional `existing_orbitals` accepts canonical point arrays or stored
`{point: {re, im}}` rows, checks their parameter/closure, and deduplicates them
before family validation. Matches appear in `existing_matches` with their
`orbital_id`; only new cycles enter `candidates`. Their returned coordinates are
in canonical forward order. This SDK operation does not read or write the database.

Catalog keys use the minimum numerical numerator; existing landing-record keys
use lexicographic angle ordering. Results explicitly preserve both as
`catalog_key` and `landing_family_key`, so the storage identity does not change.
`validate_landing_families(ratios, period, {max_angle_period})` supports an explicit
larger family budget; its default remains 24 for existing storage callers.

The default profile uses tolerance `1e-6`, 128-digit arithmetic, 80 Newton steps,
depth 128–512, 16,000 path vertices, and 256 family attempts. Per-family ray and
refinement limits default to 4,096; refinement cannot exceed the canonical
orbit helper's 4,096-point input guard. Depth cannot exceed 1,023 with native
potential arithmetic. Limits, nonconvergence, and failed validations produce
explicit `unresolved` family records, not guessed orbitals or absence claims.

`max_work_units` returns a JSON-serializable checkpoint between families;
cancellation retains completed work too. Resume with `state`. The checkpoint
binds the parameter, catalog version/bound, numerical profile, and existing
orbital snapshot. `families` contains accepted family/refinement evidence;
`search` reports attempted and remaining coverage and retains `complete: false`.
Geometry is omitted by default; use `retain_geometry: true` to retain validated
ray polylines for the later cache integration.

```js
const result = await discover_catalog_orbitals(parameter, {
  catalog,
  existing_orbitals,
  max_work_units: 2,
  state: previousCheckpoint,
});
```

Tests cover unit-circle discovery through denominator 7, basilica lower-period
landings, airplane-family deduplication, and period-58 discovery from `1/59`.
Persistent family outcomes are supported by the provider contract below.
New application jobs use ledger-backed representative discovery directly from
the catalog and report bounded denominator coverage. Historical jobs retain
their shared survey and full-family solver. See the data service's
`ORBITAL_DATA.md` for resumable scheduling, publication and UI reporting.

## Persistent family investigations

`FractoOrbitalLifecycle.js` defines the versioned orbital/assignment/path state
contract. Orbital selectability depends on orbital validation alone. Cached paths
have independent target-identity and accuracy evidence. The contract also defines
the catalog-only representative-ray strategy and its on-selection path
policy. The coordinator enables this strategy for new jobs with separate
format-3 checkpoints and compact, independently rechecked family outcomes. See the data service's
`ORBITAL_DATA.md` for persistence, legacy normalization and checkpoint compatibility.

`discover_catalog_orbitals` accepts an optional `investigation_store` with async
`claim(context, {retry_unresolved})`, `complete(context, token, outcome)`, and
`release(context, token, reason)` methods. Each context contains the exact
parameter, family, normalized numerical profile, and catalog/solver versions.
`catalog_discovery_profile()` and `CATALOG_ORBITAL_DISCOVERY_VERSION` expose the
same normalization/version used by discovery.

A cached claim supplies a completed result; a claimed family is traced and
saved before the in-memory discovery cursor advances. A busy claim returns
`investigation_busy` with a resumable state. Cancellation releases the active
family; failed persistence leaves the cursor unchanged and attaches
`discovery_state` to the error. Completed families can therefore be recovered
from SQL even after a crash between a result commit and a job checkpoint.

With persistence enabled, full validated geometry is retained for the provider
even when the public result omits it. Repeated runs can request geometry later
without retracing. Stored outcomes are deduplicated against the _current_
existing-orbital snapshot when loaded. `retry_unresolved: true` explicitly
reinvestigates unresolved families; otherwise their recorded outcomes are reused.
Changed numerical settings or solver versions produce separate investigations.
Search results include persistence hit/write counts. There is no implicit
fallback to unpersisted work when a store write fails.

The server implementation is `OrbitalFamilyInvestigationStore`, documented in
[the orbital data contract](../../servers/fracto-data-server/ORBITAL_DATA.md#catalog-investigation-ledger).

Verification includes independent analytic unit-circle landing assignments,
primitive-cycle/divisor-family discovery, period-58 refinement, disconnected and
bounded numerical outcomes, cancellation/replay, persistent cache validation,
owner fencing, real process-death recovery, and coverage reload. Run the root
`test:orbital-catalog`, `test:orbital-investigations`, and
`test:orbital-catalog-jobs` commands; database checks require
`FRACTO_DB_INTEGRATION=1`. `npm run data:orbital:catalog:benchmark` verifies
cold/resumed, cached, and uninterrupted SDK parity on analytic and stored focal
points, saving explicit profiles and timings to `logs/orbital_catalog_benchmark.json`.
The default diagnostic denominator bound is 31, separate from the bundled
catalog bound 255. Larger supported ratios are verified by targeted tests;
benchmark timings do not imply full-bound runtime or mathematical completeness.

## Return-detector scratch memory and performance

`detect_return_cardinality()` allocates its mutable numeric workspace at the
start of each detector call. The recurrence-error `Float64Array` is sized for
the largest tail window needed by that call; its active length is reset for
the baseline median and each candidate median. Three fixed-capacity arrays
hold the radius samples and alternating finite-difference layers for the
derivative pyramids. They are reused candidate by candidate, while each
candidate's returned diagnostic objects are newly created and retained.

The workspace is local to one synchronous detector invocation. It is not a
module-level singleton, is not shared across worker threads or concurrent
requests, and is discarded when the call returns. Adaptive horizon passes
and separate survey seeds each make their own detector call and workspace.
The output orbit samples, minima, matching-minima references, and diagnostic
records remain allocated because they are part of the returned result. The
change reduces temporary-array churn; it does not remove calculations, alter
candidate ranking, or reduce an iteration horizon.

A single-run comparison against the committed detector before this change was
measured on Windows with Node.js 22.19.0. Each implementation ran in a fresh
process; peak RSS was sampled before result hashing and includes Node's
runtime baseline. The survey payload and complete single-point result hashes
were identical between versions.

| Case                                     | Baseline | Scratch-buffer version | Peak RSS, baseline → version |
| ---------------------------------------- | -------: | ---------------------: | ---------------------------: |
| Stable survey seed, 4,096 iterations     |  31.1 ms |                27.4 ms |              52.7 → 52.1 MiB |
| Ambiguous survey seed, 4,096 iterations  |  34.7 ms |                28.9 ms |              52.9 → 52.7 MiB |
| Near-cusp case, adaptive through 262,144 | 139.4 ms |               128.4 ms |            120.4 → 114.1 MiB |
| 121×121 survey, 14,641 seeds             |   32.2 s |                 26.7 s |            134.1 → 131.4 MiB |

These are single-run observations, not statistically stable benchmarks. The
near-cusp case remained inconclusive at the same 262,144-iteration cap. The
survey retained the same 3,927 non-singleton candidates, 10,684 escaped seeds,
30 unresolved seeds, and confidence range. Repeat measurements under a
controlled system load before treating the observed speed or memory changes
as a general performance guarantee.

The Newton solvers require a positive integer candidate and never search
cardinalities themselves. `FractoOrbitalPoints.js` obtains the default
candidate from `FractoCardinality` or records the source when a caller passes
an explicit candidate. Both Newton methods default their root guess to zero. The low-level
`newton_big_complex(point, limit, cardinality, options)` also accepts
`options.seed` as `{x, y}` or `{re, im}`, preserving decimal strings. This
selects the initial Newton root guess; existing callers still start at zero.
The detect tab supplies its hovered seed here and uses the cardinality from
`calc_from_seed()` at that same seed. This is a starting guess for solving the supplied-period equation,
not a cardinality detector or a claim that ordinary zero-based orbit
iteration reveals the sought orbital. The returned points and least Newton
step are numerical evidence, not proof of closure, primitive period, or
stability.

Return-detection results include `pyramid_layer_diagnostics` for the winning
candidate and each reported alternative. Each finite-difference order reports
its scale, minimum/maximum/mean absolute change, absolute and normalized
spread, noise threshold, counts of positive/negative/ignored changes, summed
positive/negative change magnitudes, and magnitude-weighted directional
coherence. Per-layer coherence is `abs(positive_magnitude -
negative_magnitude) / (positive_magnitude + negative_magnitude)`; a
zero-magnitude layer scores 1 because it has no measurable directional
conflict. The aggregate `pyramid_magnitude_coherence` is the mean of those
per-layer values, while
`pyramid_minimum_layer_magnitude_coherence` preserves the weakest layer. Both
now inform the ambiguity and adaptive stopping rules. The prior
`pyramid_coherence`, `pyramid_sign_changes`, and `legacy_ambiguous` values
remain available for comparison; the existing `confidence` composite also
continues to use the raw sign-only coherence. The `0.5` and `0.9` cutoffs
remain heuristic, and a passing gate is not proof of a mathematical orbit.

Newton results now explicitly report `closure_reached`, `closure_error`, and
`closure_tolerance` (1e-7). Closure checks every transition, including wraparound;
BigComplex checks use its decimal precision. Failure has status
`closure_not_reached`, an empty `point_list`, and accepted `cardinality: 0`.
The supplied estimate remains `candidate_cardinality` for diagnostics only.
Callers must require `closure_reached === true`; an iteration-limit approximation
must never be rendered or counted as an orbital. Closure does not prove the
supplied primitive period or dynamical stability.

Best-iterate selection in BigComplex uses Decimal comparisons, not JavaScript
object comparisons, and saves the updated root estimate. This corrects stale
approximations caused by exponent-form comparisons and avoids constructing the
saved cycle from the pre-update iterated point. The formerly reported six-point
99.74% example now closes within tolerance after this correction; an insufficient
iteration budget remains explicitly rejected.

## Dynamic rays

The dynamic-ray modules classify selected cycles, discover bounded candidate
angles, and trace validated numerical polylines for connected Julia sets.
See [RAYS.md](RAYS.md) for contracts, limits, validation, and the published
basis: [Milnor, Astérisque 261 (2000)](https://numdam.org/item/AST_2000__261__277_0/)
and [Benini–Lyubich, AIF 64 (2014), §2](https://doi.org/10.5802/aif.2888).
These rays live in the seed plane, not the Mandelbrot parameter plane.

`trace_known_dynamic_rays` is the selection-time path entry point. It uses only
supplied ratios, accepts complete catalog families beyond the enumeration cap
of 24, and validates exact stored cycles without another rounded-seed Newton
solve. Families trace to at least `angle_period + 40` levels within configured
depth/point bounds. Per-ray progress carries no unvalidated family geometry;
complete validated families can be cached independently of discovery results.

`FractoRayFamilies.js` enumerates nonduplicate exact-period doubling cycles
modulo `2^n-1` and validates their landing against the selected orbital.
All supported periods use this general path, without a fixed seven-angle
registry or broad angular discovery. See [RAYS.md](RAYS.md) for budgets and
multiple-access cases, and the published
[Milnor (2000), §2](https://numdam.org/item/AST_2000__261__277_0/) basis.

The [ray guide](RAYS.md) includes a step-by-step account of the current
selected-orbital pipeline, a [proposed c,n-only discovery flowchart](RAYS.md#flowchart-1-proposed-discovery-from-c-and-n),
and the [implemented single-ray tracer flowchart](RAYS.md#flowchart-2-implemented-single-ray-tracer).
The discovery chart is explicitly a design; the tracer chart describes
existing code. Both use the published Milnor and Benini–Lyubich references
listed in the guide.

## Minibrot parameter rays

`FractoMinibrotRays.js` coordinates root access, doubling and optional thirds
(`include_thirds`) and principal tip (`include_tip`). The study worker enables
both flags. UI rows appear as tip, 1/2, 1/3, 2/3, 0/1, with the tip selected
initially. The default SDK call remains root/doubling. All labels are global
external fractions, even when table rows identify local rotations.

- `FractoParameterRootAngles.js` coordinates numerical discovery and recursive
  ancestry tuning via `FractoParameterParent.js`; ancestors are not retraced.
- `FractoParameterAttachment.js` refines the center and continues real/complex
  multipliers to parabolic attachments.
- `FractoParameterAngles.js` discovers root angles and fallback doubling angles.
- `FractoParameterTuning.js` performs exact BigInt binary-block substitution
  for the three satellite pairs and the preperiodic tip angles.
- `FractoParameterRays.js` owns doubling and independent partner collection;
  `FractoSatelliteRays.js` owns local 1/3 and 2/3 groups.
- `FractoAntennaRays.js` locates and checks the tuned analogue of c=-2 using a
  preperiodic critical-orbit relation, distinct from parabolic continuation.
- `FractoParameterRayTrace.js` follows inward paths;
  `FractoParameterRaySolver.js` uses a 64-digit native-path or 80-digit precise reference with native
  perturbations to retain small corrections. The reference cache is bounded.

Every requested group retains its status and accepted partial paths. Landing
is unconfirmed for incomplete paths and no final connector is synthesized.
Only completed root access supplies exact tuning. Without it, doubling keeps
its independent probe fallback; thirds and tip report missing root angles.
Parent periods 1–32 are supported. Inward depth is max(4096,512*P) for root,
doubling and final tip tracing, and max(4096,768*P) for thirds. Tip discovery
uses max(256,64*P). These budgets and visual endpoint checks are numerical
engineering choices rather than proof of landing.

See [PARAMETER_RAYS.md](PARAMETER_RAYS.md) for the five-group overview,
flowchart, API, ownership, rendering policy and diagnostics;
[SATELLITE_RAYS.md](SATELLITE_RAYS.md) for complex multiplier attachments and
threefold tuning; and [ANTENNA_RAYS.md](ANTENNA_RAYS.md) for tip angles,
preperiodic endpoint checks and partial-result limitations. Their published
basis is [Milnor (2000), sections 3, 6 and 8](https://numdam.org/item/AST_2000__261__277_0/)
and [Schleicher (2000)](https://numdam.org/item/AST_2000__261__405_0/).
Finite-arithmetic context is provided by
[Romera et al. (2013)](https://doi.org/10.1155/2013/105283).

For the current 1–32 attempt range, Decimal endpoint/angle fallbacks, satellite
ancestry shortcut, exact-coordinate propagation, progress timer, runtime limits
and higher-period regression examples, see
[PARAMETER_PRECISION.md](PARAMETER_PRECISION.md). Earlier native algorithm
sections describe the fast path through period 20; the precision guide defines
the extended path and cites the published Milnor/Schleicher and numerical
extrapolation references. Period 32 is the recommended next ceiling to attempt.

Parameter-ray geometry now supports shared per-minibrot persistence through
`FractoMinibrotRayCache.js`. See [RAY_CACHE.md](RAY_CACHE.md) for versioned
identity, per-group accuracy reuse, incremental saves, transactional merge,
compressed storage, migration rollout and verification. Cached geometry keeps
the published numerical/theoretical distinctions described in these guides.

## Shared Seed Surveys discovery

`FractoSeedSurveyScan.js` and `FractoSeedSurveyConfirmation.js` own the scan
used by Seed Surveys Detect and the persistent orbital worker. The UI files
re-export these SDK modules. Common defaults are 250×250 bounds samples,
half-span 1.5, 100,000 iterations, Newton 80/64 digits, closure 1e-7, 0.01
configuration grouping, and 100 results ranked by discovery count. The scan
also preserves Decimal coordinate strings for storage. The persistent pipeline
has no independent period sweep or period-4 filter. See the data service's
`ORBITAL_DATA.md` for storage identity, progress, time limits and verification.

The persistent coordinator checkpoints bounded SDK work without changing the
normal Seed Surveys calculation. `scan_orbitals` accepts `max_samples` and
its existing mutable state; persist all found groups and tested pixels to retain
counts/rankings. `find_dynamic_rays` accepts `max_work_units` and its returned
checkpoint state. One work unit is a complete doubling family. Assessment,
accepted families, and exact cursors survive JSON round trips; completed families
are skipped on resume. Default calls still finish the whole configured search.
The storage wrapper retains compact ray descriptors rather than renderer paths.
