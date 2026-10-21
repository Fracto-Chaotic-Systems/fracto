# Local 1/3 and 2/3 minibrot wakes

The study canvas requests the selected component's local root access and the
1/2, 1/3 and 2/3 satellite wakes. The last two are distinct attachments, each
with a pair of global external rays. Local rotation fractions identify bulbs;
the labels drawn beside the rays are their actual global external angles.

## Published theoretical basis

- John Milnor, _Periodic Orbits, External Rays and the Mandelbrot Set: An
  Expository Account_, Astérisque 261 (2000), 277–333,
  [sections 6 and 8](https://numdam.org/item/AST_2000__261__277_0/):
  multiplier coordinates, satellite components and binary tuning.
- Dierk Schleicher, _Rational parameter rays of the Mandelbrot set_,
  Astérisque 261 (2000), 405–443,
  [published article](https://numdam.org/item/AST_2000__261__405_0/):
  rational parameter rays and characteristic wake pairs.

These results motivate the construction; our finite numerical continuation
and endpoint tolerances do not constitute a proof of landing.

## Attachment and exact angle construction

For parent period P, `FractoParameterAttachment.js` follows the parent periodic
point from multiplier zero to exp(2*pi*i*p/3), for p=1 or p=2, in 64 steps.
It solves the periodic-point and multiplier equations together, checking their
residuals. The attached child has period 3P. Existing real multipliers +1 and
-1 remain the root and doubling cases.

Only completed, verified parent root access supplies tuning angles. Normalize
the parent characteristic pair to length-P binary blocks A and B. For the
main cardioid, use A=0 and B=1. Binary substitution gives:

| Local rotation | Binary words | Tuned blocks |
| -------------- | ------------ | ------------ |
| 1/2            | 01, 10       | AB, BA       |
| 1/3            | 001, 010     | AAB, ABA     |
| 2/3            | 101, 110     | BAB, BBA     |

`FractoParameterTuning.js` concatenates the blocks with BigInt arithmetic.
The thirds have denominator 2^(3P)-1 before fraction reduction. Numerators
and denominators remain exact strings, including beyond Number's integer
precision. Every resulting angle must have exact doubling period 3P.
Each ray is then traced toward its independently computed attachment.

## Ownership, limits and partial paths

`FractoSatelliteRays.js` owns the two threefold groups. The existing
`find_minibrot_rays` facade enables them with `include_thirds: true`; omission
preserves its root/doubling API behavior. The minibrot worker enables the flag.
The result includes `thirds["1/3"]` and `thirds["2/3"]`, each with its own
status and paths, alongside `root_access` and `doubling`.

Parent periods 1 through 32 are supported. Each threefold group receives
max(4096,256*P*3) inward iterations, at most 24576. Root and doubling groups
retain max(4096,512*P). These are bounded engineering budgets.

Without verified root angles a third group returns `root_angles_required`.
It does not tune from incomplete root paths or guess the missing pair.
Other groups remain available. Every accepted partial path is retained,
regardless of distance to the attachment, and landing remains unconfirmed.
Failed samples and artificial final connectors are excluded. The canvas keeps
white unselected paths and lighter pattern-colored selected paths, with dark
outlines. Only the selected group receives global fraction labels in bordered
white boxes; AppText identifies unresolved groups separately.

## Validation

`test/sdk_satellite_rays.test.js` checks the analytic main-cardioid attachments
at -1/8 +/- sqrt(27)*i/8 and their pairs 1/7,2/7 and 5/7,6/7.
For the period-two parent centered at -1, attachments are
-9/8 +/- sqrt(3)*i/8, with pairs 22/63,25/63 and 38/63,41/63.
The 22/63,25/63 example also appears in Milnor's Figure 1.

Tests cover exact substitution beyond safe integer precision, unsupported
rotations, missing root angles and independent partial-group preservation.
The reported period-sixteen core 0.273428557437+0.595445688613i completes
all eight root/satellite rays at tolerance 0.000005015, with both new pairs of period 48.
UI tests check worker opt-in and separate failure labels. Existing parameter
ray regressions retain their endpoint checks.

The study view additionally enables `include_tip` in `FractoMinibrotRays`.
`FractoAntennaRays.js` reuses exact parent-block tuning and the parameter-ray
tracer for the principal preperiodic antenna tip. It checks a critical-orbit
relation instead of a parabolic multiplier attachment. See
[ANTENNA_RAYS.md](ANTENNA_RAYS.md) for ownership, exact fractions, limits,
partial-path handling, validation and the published Milnor/Schleicher basis.
Earlier descriptions of root and satellite groups describe that subset;
the tip is a separate fifth group.

For the current 1–32 attempt range, Decimal endpoint/angle fallbacks, satellite
ancestry shortcut, exact-coordinate propagation, progress timer, runtime limits
and higher-period regression examples, see
[PARAMETER_PRECISION.md](PARAMETER_PRECISION.md). Earlier native algorithm
sections describe the fast path through period 20; the precision guide defines
the extended path and cites the published Milnor/Schleicher and numerical
extrapolation references. Period 32 is the recommended next ceiling to attempt.
