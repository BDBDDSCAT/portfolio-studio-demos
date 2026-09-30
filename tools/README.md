# Scientific tools

Local tools by J_photonics for computational optics and experimental data.
Each project is an independent ES-module library, a Node.js CLI, and a static
browser instrument. Copy a project directory to use it on its own.

**[Open the tools](https://bdbddscat.github.io/portfolio-studio-demos/tools/)** · [Download source archives](https://github.com/BDBDDSCAT/portfolio-studio-demos/releases/tag/scientific-tools-v1.0.0)

| Tool | Use it to | Outputs |
| --- | --- | --- |
| [Wavebench](../wavebench/README.md) | Propagate a complex field and compare numerical models | Native-grid fields, phase, sampling diagnostics, distance sweeps |
| [Thinfilm](../thinfilm/README.md) | Calculate a multilayer coating's optical response | s/p reflection, transmission, absorption; wavelength and angle scans |
| [Tracefit](../tracefit/README.md) | Estimate peak parameters from a CSV trace | Gaussian/Lorentzian peaks, residuals, convergence and local uncertainty |
| [Runcheck](../runcheck/README.md) | Validate experimental CSV files against a schema | Rule violations, column statistics, SHA256 provenance, standalone reports |

The optical models use idealized assumptions. Spectral fitting requires an
appropriate model and informative samples. Dataset validation checks explicit
rules; it does not establish that a measurement is physically correct. Each
project documents its conventions and limits, and includes synthetic examples
and numerical tests.

## Run locally

Use Node.js 22 or newer. Each CLI and numerical test suite runs without installing
packages. See the individual README for commands and module exports. To open the
instruments from this repository:

```sh
python3 -m http.server 8099 --bind 127.0.0.1
```

Open <http://127.0.0.1:8099/tools/>. Files are processed locally in the browser.
The tools have no runtime packages, external APIs, or server backend.

## Check a change

Run `npm test` in the project directory. Cross-project browser tests live in
[`tools-tests/`](../tools-tests/), with development dependencies only. CI runs
each new project's numerical/CLI suite and the cross-project browser checks.

The tools are MIT licensed; each project directory contains its own license.

## Cross-tool examples

From the repository root, run either recipe into a new output directory:

```sh
node tools/examples/beam-profile.mjs beam-study
node tools/examples/coating-audit.mjs coating-audit
node --test tools/tests/workflows.test.mjs
```

`beam-profile.mjs` propagates a synthetic Gaussian using Wavebench, passes its
unrounded central intensity section to Tracefit, and compares twice the fitted
Gaussian sigma with the analytic beam radius. It writes the profile and full fit.
This noiseless synthetic fit demonstrates model compatibility; its parameter
uncertainties do not characterize a physical measurement.

`coating-audit.mjs` simulates a quarter-wave antireflection coating using Thinfilm,
then audits its CSV using Runcheck. The schema checks finite ranges, unique scan
coordinates, increasing wavelength, and `R + T + A = 1`. Input/configuration
hashes identify the exact bytes. The model, schema, CSV, and JSON/HTML reports are
saved together. Passing that algebraic balance check does not independently
validate Thinfilm's physics; its numerical tests compare against analytic cases.
