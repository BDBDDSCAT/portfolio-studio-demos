# Model and statistical interpretation

For `k` peaks, Tracefit fits `3k + 2` parameters. The fixed reference coordinate is `(min(x) + max(x)) / 2`:

```text
baseline(x) = offset + slope × (x − xReference)
Gaussian:   y(x) = baseline(x) + Σ amplitude[j] exp(−½ ((x−center[j])/width[j])²)
Lorentzian: y(x) = baseline(x) + Σ amplitude[j] / (1 + ((x−center[j])/width[j])²)
```

Each amplitude is nonnegative, each center lies in the observed x interval, and each width lies between `1e-5 × x span` and `2 × x span`. Offset and slope are unconstrained. Peaks are returned in ascending center order, and covariance axes use that same order.

Gaussian width is standard deviation; FWHM is `2 sqrt(2 ln 2) × width`. Lorentzian width is HWHM; FWHM is `2 × width`. Amplitudes are peak heights above the baseline, not integrated areas.

## Objective and algorithm

Without sigma, the objective is `RSS = Σ (observed − fitted)²`. With a positive, known `sigma[i]` for every point, it is `weightedRSS = Σ ((observed − fitted) / sigma[i])²`. RMSE always reports the unweighted `sqrt(RSS / n)`, in y units. Degrees of freedom are `n − (3k + 2)`.

The engine normalizes x and y before optimization, uses an analytic Jacobian, and applies damped Levenberg–Marquardt steps with parameter projection onto the bounds. Several deterministic candidate starts reduce dependence on a single initialization. Multi-start fitting does not guarantee the global minimum, particularly for strongly overlapping peaks, insufficient x coverage, or an incorrect peak count.

The reported `iterations` belongs to the selected start, not the total work across all starts. `algorithm.bestStart`, `multiStarts`, tolerance, and iteration limit are included in the JSON report. Status and convergence must be checked before treating estimated parameters as a successful fit.

## Local covariance

For Jacobian `J` at the fitted solution:

```text
No sigma:     C ≈ (JᵀJ)⁻¹ × RSS / DOF
Known sigma:  C ≈ (JᵀWJ)⁻¹, where W[i,i] = 1 / sigma[i]²
standardError[j] = sqrt(C[j,j])
```

Supplied sigma is treated as an **absolute known measurement standard deviation**, not a relative weight. Known-sigma covariance is not multiplied by fitted residual variance. If only relative uncertainties are available, rescaling them changes the quoted errors; do not interpret those errors as calibrated absolute uncertainty.

The local approximation assumes the model is correct, errors are independent, and local linearization describes the parameter likelihood adequately. The unweighted case additionally assumes a shared residual variance. Correlated errors, instrument response, background misspecification, heteroscedasticity without sigma, and unresolved peaks can invalidate that interpretation despite numerical convergence.

Standard errors are `null`, and covariance is explicitly invalid, when optimization does not converge, parameters touch a constraint, or the information matrix is singular or poorly conditioned. A `VALID` covariance flag means the numerical local checks passed; it is not validation of the measurement model. Exact noiseless data may yield zero residual-scaled errors; that reflects the supplied data, not a claim about real instrument accuracy.

Extremely small or large supplied units can exceed floating-point range. Unrepresentable covariance also invalidates standard errors with a `NUMERICAL_RANGE` diagnostic. An overflowing RSS or weighted RSS is reported as `null` with a warning rather than infinity; RMSE uses a stable calculation. If fitted parameters or predictions cannot be represented, fitting throws an error asking for rescaled units.

## CSV and provenance

Input is comma-separated UTF-8 text with a unique named header. BOM, CRLF, escaped double quotes, quoted commas, and quoted multiline fields are supported. The selected numerical cells must be finite decimal or scientific-notation values; blank cells, hexadecimal notation, infinities, and malformed rows are rejected with source context. At most 100,000 rows and 20 MB are accepted.

CLI and browser upload reject invalid UTF-8 bytes. Truly blank physical lines may be skipped; explicit empty-field records such as `,` are retained and rejected when selected numerical cells are empty. Nonzero decimals that underflow to zero are rejected with a request to rescale units. The CLI never replaces its input source or realpath/inode aliases, even when `--force` permits replacement of prior reports.

Samples are sorted by x. Duplicate x is rejected rather than silently averaged, because averaging and uncertainty propagation require an explicit measurement policy. The physical source line for each record is retained even after sorting or multiline quoted fields.

`fit.json` contains original selected x/y/sigma data and fitted values; it is sufficient to inspect the result without the original CSV. Physical units must be supplied or interpreted from the preserved source column names; Tracefit does not infer them.

## 中文要点

模型为正峰之和加仿射基线。高斯宽度表示标准差，洛伦兹宽度表示半高半宽。幅值非负、中心位于观测区间，宽度约束为输入跨度的 `1e-5..2` 倍。

σ 列被视为已知绝对测量标准差；不提供 σ 时，协方差按 `RSS / 自由度` 缩放。局部标准误依赖正确模型、独立误差及局部线性近似。未收敛、边界或矩阵奇异时，标准误为空，不能将收敛等同于模型有效或全局最优。

检查残差是否存在系统形状，再判断峰数与背景模型是否合适。真实实验的仪器响应、相关噪声与峰形失配不包含在局部标准误中。
