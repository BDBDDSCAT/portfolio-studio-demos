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

## Next goals

Each item below comes from a reproducible boundary case found during the audit.
They remain separate changes so their numerical assumptions can be reviewed.

1. **Tracefit: preserve finite slopes during unit conversion.**
   [Slope conversion](../tracefit/src/fit.js) divides `yScale` by `span`
   before multiplying the fitted normalized slope. This intermediate can overflow
   although the final slope is finite. Reproduce with 81 Gaussian samples,
   `x = ((i - 40) / 10) * 1e-310`,
   `y = exp(-0.5 * ((i - 40) / 10)^2)`, for `i = 0..80`.
   Acceptance: the fit converges with finite parameters, agrees with the same
   rounded x values rescaled to ordinary units, and retains the existing
   numerical-range warning when covariance is unrepresentable.
2. **Thinfilm: keep inclusive scan coordinates finite.**
   [Scan interpolation](../thinfilm/src/thinfilm.js) multiplies the wavelength
   range by the sample index before division. A five-point bare-interface scan
   from `8e307` to `1.6e308` returns an infinite fourth coordinate despite finite
   endpoints. Acceptance: every coordinate stays finite and within the interval,
   both endpoints stay exact, and single-point scans keep their current behavior.
3. **Tracefit: retain representable Lorentzian tails.**
   [Model evaluation](../tracefit/src/fit.js) squares the normalized distance.
   With peak amplitude `1e100`, center `0`, width `1`, zero baseline, and
   `x = 1e200`, the square overflows and the model returns `0` instead of a
   representable result near `1e-300`. Acceptance: the tail agrees with an
   independent stable expression while ordinary-range evaluations retain their
   accuracy.
