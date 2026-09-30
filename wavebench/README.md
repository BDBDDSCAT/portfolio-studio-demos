# Wavebench

Scalar wave propagation in JavaScript, with a Node.js CLI and a browser instrument.
Compare Fresnel and angular-spectrum propagation, inspect complex fields on a
physical grid, and export a parameter study that another machine can reproduce.
An ideal-lens Fraunhofer model is included for focal-plane diffraction.

```bash
node bin/wavebench.js simulate --preset double --method angular-spectrum --distance 100 --wavelength 532 --grid 512 --out out
node bin/wavebench.js scan --preset gaussian --waist 0.3 --method fresnel --start 10 --stop 500 --steps 21 --out scan
```

**[Browser instrument](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)** ·
[Source](https://github.com/BDBDDSCAT/portfolio-studio-demos/tree/main/wavebench) ·
[简体中文](README.zh-CN.md) · [日本語](README.ja.md)

[![Wavebench propagation instrument: source field, output field, sampling diagnostics, and distance scan](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)

The CLI writes native-grid data and a manifest. The browser provides the same
models with controls, phase views, distance scans, and local file import/export.
No server backend, account, API key, CDN, or runtime package is required.

## Models and output grids

| Method             | Physical calculation                                      | Output sampling        |
| ------------------ | --------------------------------------------------------- | ---------------------- |
| `fraunhofer`       | Fourier field at the focal plane of an ideal lens         | `λ f / L`              |
| `fresnel`          | Paraxial free-space propagation by a transfer function    | `L / N`, same as input |
| `angular-spectrum` | Scalar free-space propagation by plane-wave decomposition | `L / N`, same as input |

Fresnel and angular spectrum describe the same free-space problem at different
levels of approximation. The lens focal-plane model describes a different optical
configuration. Focal length and propagation distance are separate parameters.

The input window is 8 × 8 mm. Choose 256, 512, or 1024 samples per axis; the default
is 512. Sources include single/double slits, a grating, circular and annular
apertures, a vortex, a custom amplitude mask, and a Gaussian beam. Apertures can
use plane or Gaussian illumination.

The browser starts with a 0.2 mm Gaussian waist, angular-spectrum propagation,
and a 250 mm distance. A comparison calculation reports the relative L2
difference between Fresnel and angular-spectrum complex fields and intensities
for the same source and distance.

## Reuse the numerical engine

The engine is an ES module and does not depend on the DOM:

```js
import { simulateExperiment } from './src/propagation.js';

const result = simulateExperiment(
  {
    preset: 'double',
    method: 'angular-spectrum',
    windowMm: 8,
    wavelengthNm: 532,
    distanceMm: 100,
  },
  512,
);
console.log({
  pitchMm: result.outputPitchMm,
  inputPower: result.inputPower,
  outputPower: result.outputPower,
});
```

Use `propagateField({ real, imag }, options)` for an arbitrary complex input.
See [the API and file reference](docs/reference.md) for an example, return values,
coordinate conventions, CLI flags, and export schemas. The exported complex
envelope has its uniform propagation carrier removed; phase is in radians. Raw
intensity and peak-normalized intensity are separate quantities.

## Reproducible experiments

- **Single plane:** export the full native 2D grid and its central horizontal
  section, including coordinates, raw relative irradiance, normalized intensity,
  and phase. Screen zoom and color mapping do not change these values.
- **Distance scan:** propagate the same source to each requested distance. The
  default scan has 21 planes and produces an `x`–`z` central-section heatmap and
  CSV data. The browser heatmap and its `global_normalized_intensity` column use
  one peak across all central cuts, preserving relative peak changes between
  planes. CLI scan CSV also provides per-plane `normalized_intensity`.
- **Source import:** convert a local PNG/JPG/WebP into an amplitude mask, preserving
  its aspect ratio with black padding. Image import is available in the browser.
- **Experiment JSON:** save parameters, grid size, display settings, and a custom
  mask when present. Parameter-based sources also have deterministic v2 share
  links; v1 links restore the original Fraunhofer setup.
- **Preview PNG:** export the visible instrument panels and parameters for a
  report; export a result manifest for model, sampling, and diagnostics. Use CSV
  for numerical analysis.

A custom mask is shared through an experiment JSON file, rather than a URL.
Fractional mask samples are stored at 8-bit amplitude precision. All browser file
processing happens locally.

## Run from source

Use Node.js 22 or newer for the CLI and numerical tests:

```bash
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos/wavebench
node bin/wavebench.js --help
npm test
```

For the browser, serve this directory with any static HTTP server:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open <http://127.0.0.1:8080>. A build or package installation is unnecessary for
normal use. JavaScript modules require HTTP; opening `index.html` directly as a
local file is insufficient.

Browser checks use development dependencies only:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

## Numerical validation and limits

The numerical tests check FFT conventions and inversion, Parseval energy,
single-slit and double-slit profiles, the Airy first zero, and vortex cancellation.
The propagation checks cover identity, plane-wave phase, power conservation,
Gaussian-beam evolution, and the paraxial agreement of Fresnel and angular spectrum.
For the tested Gaussian case, beam width and peak irradiance use a `10⁻⁷` relative
tolerance; the paraxial model comparison requires a relative complex-field RMS
difference below `5×10⁻⁶`. CLI checks also integrate full-grid CSV values and
verify the scan's Gaussian width. [The physics notes](docs/physics.md) state the
grids, equations, and limits of this evidence.

This is a computational optics tool for learning, prototyping, and reproducible
parameter studies. It is not a validated optical design suite or a vector Maxwell
solver. Finite grids, periodic FFT boundaries, aperture rasterization, and sampled
transfer functions constrain the result. Sampling and boundary diagnostics are
heuristic warnings; passing them does not establish convergence. Check a larger
window or finer grid before interpreting small features quantitatively.

Contributions and reproducible numerical reports are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md). [MIT License](LICENSE).
