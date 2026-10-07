# Scientific tools goals

Keep Wavebench, Thinfilm, Tracefit, and Runcheck useful as independent local
instruments: calculations should preserve representable results, expose numerical
limits, and export evidence that another user can reproduce.

## First round: trustworthy Runcheck sum rules

Status: implemented and verified locally; ready for review.

Large signed columns previously hid a real residual: `1e16 + 1 - 1e16` passed a
sum rule with target `0` and tolerance `0.5`. Reordering the same rule's columns
could change the outcome. A rounded final total also hid the residual of
`1e16 + 1` against target `1e16`.

The audit now uses compensated accumulation, including the negative target,
and reports the residual when the rule fails. Acceptance criteria:

- All six orders of `1e16`, `1`, and `-1e16` fail against target `0` with
  tolerance `0.5`, and pass against target `1` with tolerance `0`.
- Residuals `+1` and `-1` against a large target fail tolerance `0.5`;
  residuals exactly at `+0.5` and `-0.5` pass.
- Overflow remains a violation; incomplete or malformed member values retain
  their existing skip and individual-issue behavior.
- CLI exit status, JSON, standalone HTML, and browser results agree. Existing
  cross-tool coating audits retain their source hashes and expected outcomes.

Verified with 30 Runcheck numerical/CLI tests, 2 cross-tool workflows, and
6 Runcheck browser tests, including mobile layout and language persistence.

## Second round: preserve representable numerical results

Status: implemented and verified locally; ready for review.

The three previously recorded boundary cases are addressed:

- **Tracefit slope conversion:** an 81-point Gaussian with
  `x = ((i - 40) / 10) * 1e-310` previously threw a parameter-range error.
  [Conversion](../tracefit/src/fit.js) now retains the ordinary arithmetic path,
  then uses a safer product or logarithmic scaling when needed. Positive and
  negative finite slopes, exact power-of-two changes of y units, subnormal scale
  ratios, and genuinely overflowing slopes have regression coverage. A finite
  parameter still accompanies unavailable covariance and its `NUMERICAL_RANGE`
  diagnostic when uncertainty cannot be represented.
- **Thinfilm scan coordinates:** a five-point bare-interface scan from `8e307`
  to `1.6e308` previously returned an infinite fourth coordinate.
  [Interpolation](../thinfilm/src/thinfilm.js) now avoids that intermediate
  overflow. Five-point and maximum-size scans retain finite, increasing
  coordinates within the interval, exact endpoints, analytic Fresnel powers,
  and the existing single-point behavior. CLI JSON and CSV retain those values.
- **Tracefit Lorentzian tails:** peak amplitude `1e100`, center `0`, width `1`,
  zero baseline, and `x = 1e200` previously returned zero instead of a result
  near `1e-300`. [Evaluation](../tracefit/src/fit.js) now uses reciprocal distance
  when the direct square overflows. Tests cover both tail directions, narrow
  widths, subtraction overflow, zero amplitude, and independent ordinary-range
  values. The optimizer and covariance model retain their existing conventions.

Verified with 34 Tracefit and 18 Thinfilm numerical/CLI tests, 2 cross-tool
workflows, and 12 Tracefit/Thinfilm browser tests, including mobile layouts.

## Next goals

These additional cases are reproduced and remain separate work:

1. **Tracefit: retain representable Gaussian tails.**
   [Gaussian evaluation](../tracefit/src/fit.js) computes the exponential before
   multiplying its amplitude. With amplitude `1e200`, center `0`, width `1`,
   zero baseline, and `x = 40`, it returns `0`; a stable combined exponent gives
   approximately `3.668e-148`. Acceptance: representable tails agree with an
   independent combined-exponent reference, ordinary values retain accuracy,
   and truly unrepresentable tails may still round to zero.
2. **Wavebench: distinguish norm-accumulation overflow from final power overflow.**
   [Field measurement](../wavebench/src/propagation.js) sums intensity before
   multiplying by sample area. For `n = 2`, `windowMm = 0.02`, four real samples
   of `1e154`, zero imaginary samples, and zero propagation distance, every raw
   intensity is finite and integrated power is approximately `4e304`, but the
   unweighted intensity sum overflows and throws. Acceptance: a stable
   area-weighted norm agrees with analytic integration and still rejects
   genuinely unrepresentable intensity or integrated power.
