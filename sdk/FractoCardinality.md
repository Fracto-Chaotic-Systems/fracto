# FractoCardinality

`FractoCardinality(point, options)` is the SDK's production entry point for
Fracto's best-known orbit-return cardinality estimate. It is a bounded,
finite-precision detector. A returned candidate is evidence under the recorded
settings, not a mathematical proof that an attracting orbit exists, is unique,
or has that exact primitive period.

## Inputs and domain behavior

`point` is the Mandelbrot parameter \(c\), accepted as `{re, im}` or `{x, y}`.
Coordinates may be numbers or numeric strings. Both coordinates are converted
to JavaScript `Number` before cardioid testing and orbit arithmetic; strings do
not preserve extra decimal precision. Both coordinates must convert to finite
numbers. The cardioid test is applied to `point`, not to the optional seed.

By default the orbit begins at \(z_0=0\). To examine another initial
condition, pass `options.seed` as `{re, im}` or `{x, y}`. This sets the starting
orbit value \(z_0\); it does not change \(c\). Seed coordinates must also be
finite.

For a parameter inside the main cardioid, the sampler iterates
\(z_{n+1}=z_n^2+c\) from the selected seed and passes the orbit samples to the
return-cardinality detector. For a parameter outside the main cardioid, the
function bypasses that detector and returns the established `FractoFastCalc`
result directly: `calc()` without an explicit seed, or `calc_from_seed()` when
a seed is supplied. That legacy result shape is passed through; callers must
not assume it has the in-cardioid `status`, `detection`, or `diagnostics`
fields. `seed_level`, when supplied, is used only by the outside-cardioid
`calc_from_seed()` path. The optional `seed_iteration_limit` also applies only
to that outside-cardioid seeded path and takes precedence over its
level-derived horizon; it bounds the main iteration and any follow-up
recurrence-refinement pass.

Malformed parameter or seed coordinates return `status: "invalid_input"`,
`iterations: 0`, `escaped: false`, empty `samples`, and a `detection` object
whose candidate is null. A malformed seed is rejected before domain
dispatch.

## Detection settings

The in-cardioid options are:

| Option | Behavior |
| --- | --- |
| `iterations` | Initial horizon; defaults to 4,096 and is clamped to 1–262,144. |
| `maximum_detection_iterations` | Adaptive ceiling; defaults to 262,144 and cannot be lower than the initial horizon. |
| `adaptive_detection` | Defaults to `true`. When enabled, the sampler restarts from the same seed at successively doubled horizons until the evidence gate passes, the orbit escapes, or the ceiling is reached. Set `false` to run only the initial horizon. |
| `minimum_return_repetitions` | Optional minimum repeated-return evidence passed to the detector; defaults to 5. |
| `seed` | Optional initial orbit point. Omitted means `z0 = 0`. |

Each adaptive pass is a new sample from the same initial condition, rather than
an extension of the previous sample. Escaping terminates adaptive growth.
Inside the cardioid, the radius-2 bailout is used only when \(|c|\le2\), where
crossing that radius guarantees escape. The reported `iterations` is the
actual escape iteration; a non-escaping run reports its completed horizon.

The return detector looks for repeated near-origin return gaps in the sampled
orbit. It reports candidate periods and evidence such as recurrence error,
confidence, ambiguity, matching gaps, and derivative-pyramid diagnostics. The
evidence gate decides whether another horizon is useful; it does not turn the
candidate into proof. With adaptive detection enabled, `diagnostics.checked_horizons`
records every horizon that was tried.

## In-cardioid result shape

The result includes the normalized parameter and seed, `domain`, the actual
iteration count, `escaped`, the sampled orbit points, the full `detection`
object, and `diagnostics`.

- `status: "cardinality_detected"` means the detector returned
  `return_pattern_detected` with an integer `candidate_cardinality`. This is
  independent of `escaped`: a finite-window candidate can be present even when
  the sampled orbit later escapes, so inspect both fields.
- `status: "cardinality_inconclusive"` means no usable integer candidate was
  found within the tried horizon(s). Inspect `detection.status`, diagnostics,
  and `escaped` to distinguish an unresolved finite sample from an escaping
  orbit.
- `status: "invalid_input"` is returned before orbit sampling.

`diagnostics.detector` identifies `critical_orbit_return` or
`seeded_orbit_return`; `seed_strategy` identifies the default critical seed or
the caller-supplied seed. `diagnostics.mathematical_proof` is always false.
Additional detector diagnostics are intentionally retained so consumers can
show why a candidate was selected or why a run remained inconclusive.

The detector does not calculate Newton points. `FractoOrbitalPoints` and the
data-server pipeline consume a cardinality candidate in a later, separate
stage. A caller interested only in cardinality can stop at this result.

## How the Assets seed-survey image uses FractoCardinality

The Assets page fixes \(c\) to the navigator's current focal point, which is
the Mandelbrot parameter under study. Each image sample is a different initial
value \(z_0\) in the complex plane. For every pixel seed, the SDK starts a new
orbit at that seed and iterates \(z_{n+1}=z_n^2+c\); the return detector then
looks for repeated near-origin return gaps in that finite orbit. Thus the
survey asks, for one selected parameter, how the seeded orbit behaves from
each starting point; it is not a map of different parameter values. The seed
may be anywhere in the image square even though the fixed parameter is inside
the main cardioid.

The worker calls `FractoCardinality(c, options)` once per seed. Its settings
are `iterations: 4096`, `maximum_detection_iterations: 4096`,
`adaptive_detection: false`, and `seed_level: 0.00625`. Since the parameter is
inside the cardioid for the return-detection path, each in-domain seed gets one
ordinary-precision, 4,096-step horizon. `seed_level` and the optional
`seed_iteration_limit` affect only the outside-cardioid `calc_from_seed()`
compatibility path. The Assets page sets that limit between 100,000 and
10,000,000,000 iterations, defaulting to 100,000. A seed itself may
lie outside the cardioid; it is the focal parameter \(c\) that selects the
domain behavior.

Preview samples a 121 by 121 grid at 0.025 spacing, including both bounds
\([-1.5,1.5]\), and maps each sample to a 2.1074-pixel square cell on the 255
by 255 canvas. The UI rounds each coordinate to its nearest sample index,
places larger imaginary values toward the top, and uses a small overlap to
avoid seams between cells. Render samples a 1024 by 1024 grid at pixel centers,
with spacing \(3/1024\), over the same bounds. It uses the same coordinate
orientation and calculation settings; render streams rows instead of returning
a million point objects.

The image classification is intentionally conservative. The worker checks for
a detected integer candidate before using the escape flag, so a candidate and
`escaped: true` can coexist in the detector response and will be shown as a
candidate in the survey:

| Survey outcome | Condition | Image treatment |
| --- | --- | --- |
| Non-singleton candidate | Detected integer period greater than 1 and at least that many orbit samples are available for the final pattern-sized sample suffix | Pattern color with confidence-derived lightness |
| Single-point candidate | Detected period 1 | Left blank (`#eeeeee`) |
| Escaped | No integer candidate was classified first, and the seeded orbit escaped | White (`#ffffff`) |
| Unresolved | No detected candidate, but the orbit did not escape | Grey (`#888888`) |
| Invalid/other | Invalid input, numerical failure, or an unusable result | Left blank unless classified as unresolved by the worker |

The UI's confidence scale uses only finite confidence values from painted
non-singleton candidates. A 4,096-bin histogram maps empirical confidence
percentiles to HSL lightness: the lowest 1% is 18%, the highest 1% is 88%, and
the intervening percentile ranks are evenly mapped between those endpoints.
This is a visualization of the detector's confidence score, not a probability
that the candidate is correct. Unresolved and escaped samples do not enter the
confidence histogram.

Preview reports newly accumulated point records as the worker advances, at
eight-sample progress intervals, so the preview canvas can fill before the job
finishes. Render reports one completed row at a time; the page polls using a
row cursor and can receive up to 16 rows per response. The render canvas starts
with `#eeeeee`. Status-1 pixels use the established pattern hue, with lightness
from the confidence distribution; status-2 pixels are `#888888`, and status-3
pixels are `#ffffff` while escape shading is disabled. Status-0 pixels remain
the background color.

Escape iteration counts are carried through the worker response and a separate
percentile-grey scale is implemented. It maps the lowest 1% of escape counts
to light grey and the highest 1% to dark grey. That display is currently
disabled by `ENABLE_ESCAPE_ITERATION_SHADING`; escaped pixels are therefore
white. The escape scale is independent of the confidence scale, and neither
unresolved nor blank pixels affect either distribution.

While render rows arrive, the UI accumulates distribution data but publishes
the confidence scale at ten evenly spaced row-progress milestones. Between
milestones, newly painted rows use the last published scale. A changed scale
repaints the received prefix. When the job completes, the UI computes the
final distribution and repaints the full image once, normalizing all pixels
together. This can change earlier shades as the observed distribution grows.
The selected focal point and resolution key each job; scope-only navigator
changes do not restart it.
Changing the focal point or mode starts a new survey and invalidates stale UI
responses.

The Assets page uses a bounded asynchronous data-server worker. Preview jobs
have a five-minute task timeout; render jobs have a one-hour timeout. Job state
is process-local and expires 15 minutes after completion, so a process restart
loses active or completed jobs. These limits and results are operational
behavior, not part of the mathematical detector contract.

For the API routes, compact render-row record layout, status bytes, and polling
cursor details, see the data-server
[`handlers/orbitals/README.md`](../servers/fracto-data-server/handlers/orbitals/README.md).
For page composition and color-scale implementation, see the UI
[`assets pages README`](../servers/fracto-ui/src/pages/assets/README.md).
