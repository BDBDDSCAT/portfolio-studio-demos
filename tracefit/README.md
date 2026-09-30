# Tracefit

**Constrained peak fitting with residuals and uncertainty you can inspect.**

[Browser workspace](https://bdbddscat.github.io/portfolio-studio-demos/tracefit/) · [中文文档](README.zh-CN.md) · [Model & statistics](docs/model.md)

[![Synthetic weighted doublet fit, residuals, and local parameter errors](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/tracefit/)

Fit one to three positive Gaussian or Lorentzian peaks with an affine baseline. Tracefit ships the same numerical engine as a browser workspace, an ES module, and a Node CLI. It uses no runtime dependencies, external fonts, or remote services.

- Bounded Levenberg–Marquardt with an analytic Jacobian, normalized coordinates, and deterministic multiple starting points.
- Optional positive `sigma` values for weighted least squares.
- Raw and weighted RSS, RMSE, degrees of freedom, fitted values, and signed residuals.
- Local covariance and standard errors; convergence failures, constraints, and singular information matrices invalidate uncertainty explicitly.
- Quoted CSV fields, UTF-8 BOM, multiline fields, sorted x coordinates, and source-line provenance.
- Browser CSV upload, interactive model controls, fit and residual plots, bilingual interface, and CSV/JSON downloads.

The supplied Gaussian, doublet, and Lorentzian datasets are **synthetic**, with deterministic generated noise. They are not experimental measurements.

## Use the CLI

Requires Node 22 or newer. No installation is needed.

```sh
node bin/tracefit.js fit \
  --input examples/gaussian.csv \
  --x wavelength_nm --y intensity \
  --model gaussian --peaks 1 --out out

node bin/tracefit.js fit \
  --input examples/doublet.csv \
  --x wavelength_nm --y intensity --sigma sigma_y \
  --model gaussian --peaks 2 --out doublet-out

node bin/tracefit.js --help
```

Output consists of `fit.json` and `fitted.csv`. Existing files require `--force`. The input source is always protected, including symlink and hardlink aliases; choose a different output directory if an output would replace input data. The JSON includes every input sample, selected column names, fitted parameters, algorithm settings, convergence status, covariance validity, and diagnostics. Physical units are not inferred from headers.

`fitted.csv` columns are `x,y,sigma,fitted,residual,source_line`; `sigma` is empty when no error column was selected. Residual means **observed minus fitted**.

CLI flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--input` | required | Input comma-separated CSV |
| `--x`, `--y` | first, second column | Named numerical columns |
| `--sigma` | omitted | Positive, known y standard deviations |
| `--model` | `gaussian` | `gaussian` or `lorentzian` |
| `--peaks` | `1` | Integer `1..3` |
| `--iterations` | `150` | Maximum LM iterations per start, `1..1000` |
| `--starts` | `5` | Deterministic initializations, `1..20` |
| `--out` | `out` | Output directory |
| `--force` | off | Replace existing output files |

Exit `0` means converged or help; `2` means invalid input or an I/O error; `3` means the fit did not converge. An unconverged run still writes diagnostic results, with invalid covariance and `null` standard errors.

## Use the library

```js
import { fitTrace, evaluateTrace } from './src/fit.js';
import { parseCsv, selectTrace } from './src/csv.js';

const data = selectTrace(parseCsv(csvText), {
  x: 'wavelength_nm', y: 'intensity', sigma: 'sigma_y',
});
const result = fitTrace(data, { model: 'gaussian', peaks: 2 });

if (result.converged) {
  const prediction = evaluateTrace(550, result.parameters, result.model);
}
```

The library accepts an array of `{x,y,sigma?,sourceLine?}` objects. If any sample has `sigma`, every sample must have a finite positive value. Numerical inputs must be finite. Repeated x values are rejected; combine repeated measurements explicitly before fitting. At least `max(8, 3 × peaks + 4)` samples are required.

Peak width means Gaussian **standard deviation** or Lorentzian **half width at half maximum**, not a shared FWHM convention. See [the model reference](docs/model.md) for equations, bounds, and uncertainty assumptions.

## Run locally and verify

```sh
npm test
npm run serve
# Open http://127.0.0.1:8080
```

The tests check independent known-truth recovery, overlapping peaks, Gaussian and Lorentzian shapes, heteroscedastic errors, held-out predictions, covariance semantics, failure diagnostics, CSV quoting, output protection, and exported residual consistency.

Convergence does not establish that the selected model is correct or globally optimal. Local standard errors assume the chosen model and error specification; they do not account for model misspecification or correlated measurement noise. Inspect residuals and read [the statistical limits](docs/model.md).

MIT · [BDBDDSCAT](https://github.com/BDBDDSCAT)
