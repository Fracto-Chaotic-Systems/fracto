# Numerical dynamic rays

## Published theoretical basis

- John Milnor, “Periodic orbits, externals rays and the Mandelbrot set: an
  expository account,” _Astérisque_ **261** (2000), 277–333,
  [published article](https://numdam.org/item/AST_2000__261__277_0/).
  Section 2 supplies orbit portraits and angle doubling; Appendix A supplies
  the Green function and Böttcher coordinate description of external rays.
- Anna Miriam Benini and Mikhail Lyubich, “Repelling periodic points and landing
  of rays for post-singularly bounded exponential maps,” _Annales de l’Institut
  Fourier_ **64**(4) (2014), 1493–1520,
  [published article](https://doi.org/10.5802/aif.2888).
  Section 2 treats the polynomial case with connected Julia set, using inverse
  branches to establish landing at repelling periodic points. The exponential
  case is not the implementation model.

These works justify the dynamical framework. The bounded search, numerical
thresholds, budgets, and rendering decisions below are engineering choices,
not algorithms or correctness guarantees claimed by either publication.

## Domain and ownership

These are **dynamic-plane** rays for the fixed polynomial `f_c(z)=z²+c`, drawn
on the seed survey. They are not parameter-plane rays or Mandelbrot wake
boundaries. An orbit's confidence and discovery count neither establish
repulsion nor determine its external angles.

`FractoRayEligibility.js` refines the selected cycle with 64, 128, 256, then
512-digit Newton arithmetic as necessary, requires residual <= 1e-24, rejects a
branch displacement > 1e-5, reduces repeated traversals, and computes
`lambda = product(2*z_i)`. Attracting cycles have no external landing rays;
neutral/near-parabolic cycles require specialized handling and are unsupported.
The neutral band is `abs(log(abs(lambda))) <= approximately 1e-6`.

Connectedness evidence comes from an attracting fixed point, the interior of
the period-two disk, or a propagated trapping disk containing the critical
orbit after at most 2,048 iterates. Escaping critical orbits identify unsupported
disconnected cases. Bounded critical iteration alone is deliberately inconclusive.
Disk arithmetic includes a numerical margin, but is not interval arithmetic:
this is numerical evidence, not a certified connectedness proof.

`FractoRayFamilies.js` enumerates exact-period angle cycles generally. For an
angle period `n`, use `D = 2^n - 1` and repeatedly apply `k -> 2*k mod D`.
A bitset marks every numerator already visited, so cyclic rotations of a
previous family are never emitted again. Cycles shorter than `n` are omitted;
this matters when `n` is composite. For `n=1`, the family is `0/1`.

For example, period five has six families, including `1,2,4,8,16` and
`3,6,12,24,17` modulo 31. Period seven has 18 families, with no special case
for `5/127`. Enumeration uses exact native integers within the supported
period range 1–24, and reduces displayed fractions with BigInt arithmetic.
This construction follows Milnor's angle-doubling framework cited above.
Distinct angle families do not guarantee distinct spatial orbitals or attraction:
several rays can land on one point, and angle period can exceed orbital period.

`FractoDynamicRays.js` starts with angle period equal to the selected cycle's
refined primitive period `p`. It tests each distinct family by tracing its first
ray, matching the landing to any selected point, then validating the whole
family in dynamical order. If no family matches, it tries angle periods `2p`,
`3p`, etc., through the configured maximum (default 24). This preserves cases
such as two or three rays landing on a fixed point. It completes the first
matching angle period and stops; it does not claim to find every higher-period
access. All completed members of a family must pass landing/precision/dynamics
checks before that family is accepted.

There is no dyadic sampling, angular subdivision, speculative nearby-angle
screening, fixed-family registry, or broad-search fallback. The default budget
is 256 candidate families, configurable via `options.max_families` up to 4,096.
The angle-period cap is configurable via `options.max_angle_period`, bounded
at 24. These bounds are engineering choices, not theoretical restrictions.
Cancellation is checked during enumeration and tracing; the UI can terminate
the worker immediately. A budget limit without validated rays returns
`family_limit`, which does not assert nonexistence. Diagnostics use
`strategy: "doubling_families"`, zero discovery evaluations, actual candidate
counts, limits, and `budget_reached`/`exhausted` flags.

`FractoDynamicRayTrace.js` starts in the exterior at Green potential 8,
using `phi^-1(w) = w - c/(2w) + O(w^-3)`, and continues inverse square-root
branches inward. Step halving checks branch continuity, midpoint curvature,
and agreement between a full step and two half steps. Geometry tolerance is
one quarter of a pixel in the 550px, span-3 survey. Exact BigInt fractions
transport angles through doubling without loss of combinatorial identity.
Terminal inverse chains are checked again with 128-digit arithmetic and exact
rational phase. The terminal depth adapts to the multiplier, between 96 and
384 doublings; a ray has at most 6,000 vertices.

Accepted rays must reach within `min(tolerance/4, 1e-6)` of their refined
landing point, approach it rather than diverge, pass terminal precision
agreement, and obey the endpoint dynamics under angle doubling. These are
numerical validation checks, not rigorous landing proofs. No straight segment
is appended to force a curve to meet its expected landing point. Failed or
incomplete candidates are omitted, rather than displayed as successful rays.

## Results and limitations

`find_dynamic_rays(c, {points}, {on_progress, cancelled})` reports classification,
then a `doubling_families` progress stage. A result contains accepted polylines,
exact fraction angles, point indices, landing/precision errors, multiplier,
connectedness evidence, and bounded-search diagnostics. `search.complete` is
always false: even a successful search does not claim to find all landing rays.

Statuses distinguish missing/invalid input, failed closure, branch changes,
attracting/neutral cycles, disconnected/unresolved Julia sets, period limits,
cancellation, family-budget limits, no validated rays, and successful approximations. `no_rays` means
only that the budgets and numerical checks found none. Very slow landing,
near-critical paths, many candidate families, or high angle periods can exceed
the numerical/enumeration budgets. Orbital refinement preserves decimal parameters, but ray geometry uses
Number-valued coordinates/parameters; the 128-digit terminal check verifies
that numerical parameter, not additional decimal input digits. More digits cannot repair a missed angle or prove completeness.

The detect tab runs this work in its own terminable Web Worker. Table scanning,
hover, canvas data loading, and tracing have independent ownership. See the UI
survey RAYS.md for interaction and overlay details.

## Verification

`node --test test/sdk_dynamic_rays.test.js` covers exact angle transport,
analytic radial rays for `c=0`, the basilica fixed point's 1/3 and 2/3 accesses,
a period-three orbit, the rabbit fixed point's three accesses, primitive-period
reduction, cancellation, unsupported classifications, and general family
validation across focal parameters and cyclic reorderings. Enumeration tests
cover period-five examples, composite-period exclusion, and duplicate avoidance. These examples follow
the dynamic-ray/orbit-portrait framework of the published works cited above.
