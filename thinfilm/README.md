# Thinfilm

Multilayer optical scattering, with a browser instrument and a zero-dependency Node.js CLI. **Constant complex indices. Real power fractions. Complex reflection and transmission coefficients.**

[Browser instrument](https://bdbddscat.github.io/portfolio-studio-demos/thinfilm/) · [中文](README.zh-CN.md) · [Physics](docs/physics.md) · [Examples](examples/README.md)

[![Bragg mirror layer editor and computed reflection, transmission and absorption](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/thinfilm/)

Thinfilm calculates coherent reflection, transmission, and absorption for passive, isotropic films at oblique incidence. A scattering recursion keeps only decaying propagation factors, so thick absorbing films do not overflow a characteristic matrix.

![Computed power spectra for the bundled AR, Bragg, and absorbing-film examples](docs/spectra.svg)

- `s`, `p`, and unpolarized power; wavelength and angle scans.
- Editable layer stack, local JSON import/export, raw CSV and result JSON. Result imports restore full scan settings and reject invalid configurations; the 10 MB file limit accommodates the 2001-point unpolarized export.
- DOM-independent ES module; no runtime dependencies or CDN.
- Analytic tests for Fresnel interfaces, Brewster reflection, total internal reflection, quarter-wave AR films, and Bragg mirrors.

## Run

Node.js **22 or newer**. No installation is required.

```sh
npm test
npm run serve
```

Open `http://127.0.0.1:8080`. The browser instrument works entirely locally after loading. Serve it over HTTP rather than opening the HTML as a `file:` URL.

## CLI

```sh
node bin/thinfilm.js --help
node bin/thinfilm.js spectrum --stack examples/ar.json \
  --start 400 --stop 800 --points 201 --angle 0 --polarization s --out out
node bin/thinfilm.js angle --stack examples/interface.json \
  --wavelength 550 --start 0 --stop 85 --points 171 --polarization p --out out-angle
```

`--out DIR` writes `curve.csv`, `stack.json`, and `result.json`. Existing destination files require `--force`; an output that overlaps the input stack is always rejected. Omit `--out` to stream raw CSV to stdout. Unknown, duplicate, and invalid flags fail explicitly.

## Library

```js
import {
  solveStack,
  wavelengthScan,
  angleScan,
  scanToCsv,
} from "./src/thinfilm.js";

const stack = {
  incident: 1,
  substrate: 1.5,
  layers: [{ n: Math.sqrt(1.5), k: 0, dNm: 550 / (4 * Math.sqrt(1.5)) }],
};

const result = solveStack(stack, {
  wavelengthNm: 550,
  angleDeg: 0,
  polarization: "s",
});
// { r: {re,im}, t: {re,im}, R, T, A, wavelengthNm, angleDeg, ... }
// R ≈ 0, T ≈ 1 at the design wavelength.

const spectrum = wavelengthScan(stack, {
  startNm: 400,
  stopNm: 800,
  points: 201,
  angleDeg: 0,
  polarization: "s",
});
const angular = angleScan(stack, {
  wavelengthNm: 550,
  startDeg: 0,
  stopDeg: 85,
  points: 171,
  polarization: "p",
});
console.log(scanToCsv(spectrum));
```

Scans return `{kind, polarization, rows, diagnostics}`. Each row contains complex coefficients, power fractions, wavelength, and angle. Unpolarized rows average the **powers** of `s` and `p`; `r` and `t` are `null`, with separate results in `components`. There is no coherent mean amplitude for an incoherent mixture.

## Model and limits

Layer indices are `n + i k` under `exp(-iωt)`; `n > 0`, `k ≥ 0`. Wavelength and thickness are in **nm**, angle in degrees. Boundary indices must be real and positive. Up to **128 layers**, **2001 scan points**, and angles **0–85°** are supported. A one-point scan samples its start coordinate.

The calculation assumes planar, homogeneous, isotropic, coherent layers with constant indices. It does not model dispersion, roughness, scattering, anisotropy, fluorescence, or partially coherent thick substrates. The substrate is semi-infinite. Values are simulated optical flux fractions, not measurement data or calibrated watts.

The substrate critical-angle limit has zero transmitted normal flux. A finite internal layer with `q ≈ 0` is rejected explicitly because its traveling-wave decomposition is degenerate; move the angle slightly. Read [the conventions and numerical limits](docs/physics.md) before using phases or near-critical results.

## Reproducible examples

At 550 nm, normal incidence, `s` polarization:

| Stack                       |        R |        T |        A |
| --------------------------- | -------: | -------: | -------: |
| Air → index 1.5             | 0.040000 | 0.960000 |        0 |
| Matched quarter-wave AR     |      ≈ 0 |        1 |        0 |
| Eight high/low Bragg pairs  | 0.992907 | 0.007093 |        0 |
| 300 nm film, index 2 + 0.5i | 0.134463 | 0.028584 | 0.836953 |

These values come from the bundled [stack JSON files](examples/README.md), not fitted material datasets. `npm test` checks physical power balance, independent analytic references, thick-absorber stability, validation, and CLI/API agreement.

MIT licensed. Contributions with reproducible physical references and regression cases are welcome.
