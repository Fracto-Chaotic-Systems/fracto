# Principal antenna tip parameter rays

The principal tip is the image of c=-2 under the selected component's tuning
embedding. It is distinct from the parabolic root and the local internal 1/2
satellite attachment. It is a preperiodic (Misiurewicz) parameter.

## Published theoretical basis

- John Milnor, _Periodic Orbits, External Rays and the Mandelbrot Set: An
  Expository Account_, Astérisque 261 (2000), 277–333,
  [section 8, especially Theorem 8.2](https://numdam.org/item/AST_2000__261__277_0/):
  tuning embeddings and the small Mandelbrot set.
- Dierk Schleicher, _Rational parameter rays of the Mandelbrot set_,
  Astérisque 261 (2000), 405–443,
  [published article](https://numdam.org/item/AST_2000__261__405_0/):
  rational ray landing, including preperiodic angles at Misiurewicz parameters.

The construction follows this theory. Our finite continuation and residual
checks are numerical evidence, not certified landing proofs.

## Reuse and ownership

`FractoParameterTuning.tuned_tip_angles` reuses the verified parent root-block
normalization. For length-P binary blocks A and B, substitute into the two
expansions of local external angle 1/2: 0.1000... and 0.0111.... This produces
0.BAAA... and 0.ABBB.... With base S=2^P and integer blocks a,b, the exact
fractions are (b*(S-1)+a)/(S*(S-1)) and (a*(S-1)+b)/(S*(S-1)). BigInt preserves
exactness and duplicate fractions are removed. P=1 yields a single ray 1/2.

`FractoAntennaRays.js` owns endpoint discovery and checking. It does not alter
the multiplier attachment solver, which computes parabolic parameters.
The existing parameter-ray tracer first follows one tuned angle with the core
as its numerical reference, collecting a prefix with max(256,64*P) depth.
The final accepted point seeds Newton refinement of
f_c^(3P)(0)-f_c^(2P)(0)=0. Parameter derivatives reuse `critical` from the
attachment module. The proposed point must have finite iterates, residual at
most 1e-8, a repelling P-step return with multiplier modulus above 1+1e-6,
and distinct f_c^P(0) and f_c^(2P)(0). The actual eventual period may divide P;
requiring primitive period exactly P would incorrectly reject satellite copies.

A movement guard rejects a Newton result far from its ray-derived initial
estimate. The tuned angle determines the intended branch; the orbit equation
alone has many unrelated solutions. Once a target passes checks, the existing
`trace_parameter_ray_group` retraces both rays toward it using the ordinary
endpoint tolerance and max(4096,512*P) depth. No final connector is fabricated.

If refinement cannot verify the tip, available prefixes remain incomplete and
landing unconfirmed. Root-angle failure returns `root_angles_required`;
unsupported periods or tolerances return `unsupported`. Native endpoint
refinement can lose accuracy in tiny components even though the shared tracer
uses a high-precision reference; partial paths remain useful in that case.
Parent periods remain limited to 1–20. An inaccurate reference/core may also
prevent discovery. No claim is made that every supported input will resolve.

## API and UI

`find_minibrot_rays(..., { include_tip: true })` adds `antenna_tip` to its
result and merges accepted tip paths independently of other groups. The flag
is optional for compatibility. The minibrot worker enables it automatically.
Progress uses tip_angles, tip_locating and tip_tracing; messages use AppText.

The table adds a separate principal-tip row. It has no stable pattern block:
the endpoint is preperiodic. Selecting it highlights its paths in the parent
period hue, with iteration 10000, as a display convention. Only the selected
entry's global fractions appear on the canvas. The principal tip is selected
by default; rows appear as tip, 1/2, 1/3, 2/3, 0/1. White background paths,
dark outlines and partial-path policy remain intact.

## Validation

`test/sdk_antenna_rays.test.js` checks the main tip -2 (angle 1/2), the
period-two tip near -1.5436890126920764 (5/12,7/12), and the rabbit tip near
-0.10109636384562219+0.9562865108091415i (9/56,15/56). Each completed ray
must reach the checked endpoint within the requested tolerance. Tests also
cover exact arithmetic at period twenty, invalid inputs, rejection of a
periodic critical point and missing verified parent angles. UI regressions
check automatic worker opt-in, tip selection, color and independent failure
messaging. Existing root/satellite tests retain their checks.

For a concrete contrast, the period-two parent centered at -1 has root access
1/3,2/3; its doubling attachment has 2/5,3/5; its principal tip has 5/12,7/12.
The tip is not another bulb and its display hue does not assert the existence
of a stable orbital there. The main-cardioid tip's single 1/2 ray is deduplicated.

In the endpoint-refinement fallback, returned paths are explicitly forced to
`landed: false` and the group includes `endpoint_status: tip_unresolved`.
Here paths were traced using the core as reference, so their `endpoint_error`
is distance to that reference, not a certified error to an unknown tip.
The UI reports incomplete landing; it does not treat this diagnostic as a
verified endpoint. The final validated trace uses the refined tip as reference.
