# API, CLI, and export reference

Numerical arrays use a centered square grid in millimeters, row-major ordering
with `x` varying fastest. The origin is at `(N/2,N/2)` and native coordinate `j`
is `(j-N/2)*pitchMm`. Wavelength input is in nanometers; phase output is in radians.
See [physics.md](physics.md) for the model and carrier conventions.

## Propagation API

```js
import { propagateField, simulateExperiment } from '../src/propagation.js';
```

Use a path relative to your script. The module runs in Node.js or a browser.

`propagateField({ real, imag }, options)` takes two equally sized complex-field
buffers and these options:

| Option         | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `n`            | Power-of-two samples per axis, 2–2048; default 512 |
| `windowMm`     | Positive width of the input square                 |
| `wavelengthNm` | Positive wavelength                                |
| `distanceMm`   | Signed propagation distance; zero is identity      |
| `method`       | `'fresnel'` or `'angular-spectrum'`                |

The input arrays are not mutated. Its return includes `real`, `imag`, raw
`intensity`, output `phase`, `samplePitchMm`, `inputPower`, `outputPower`, and
`diagnostics`. `real`, `imag`, and `intensity` use Float64 buffers; phase uses a
Float32 buffer. Diagnostics are objects with `code`, `level`, and `message`.

A complete arbitrary-source example:

```js
import { propagateField } from './src/propagation.js';

const n = 256,
  windowMm = 8,
  waistMm = 0.2;
const real = new Float64Array(n * n);
const imag = new Float64Array(n * n);
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    const xx = ((x - n / 2) * windowMm) / n;
    const yy = ((y - n / 2) * windowMm) / n;
    real[y * n + x] = Math.exp(-(xx * xx + yy * yy) / (waistMm * waistMm));
  }
}
const output = propagateField(
  { real, imag },
  {
    n,
    windowMm,
    wavelengthNm: 532,
    distanceMm: 100,
    method: 'fresnel',
  },
);
console.log(output.samplePitchMm, output.inputPower, output.outputPower);
```

`simulateExperiment(params, n = 512, mask?)` constructs an aperture/source and
runs one of the three methods. `mask` contains `n*n` real amplitude transmissions
in `[0,1]` for the `custom` source. The second argument controls the solver grid;
a stored `params.gridSize` does not replace it. To rerun a decoded experiment,
use `simulateExperiment(data.params, data.params.gridSize, data.mask)`.
Its result includes:

| Field                                           | Meaning                                               |
| ----------------------------------------------- | ----------------------------------------------------- |
| `n`                                             | Samples per axis                                      |
| `real`, `imag`                                  | Output complex field                                  |
| `intensity`                                     | Raw relative irradiance `real²+imag²`                 |
| `normalizedIntensity`                           | Intensity divided by the output peak; zero stays zero |
| `phase`                                         | Output phase in radians                               |
| `inputAmplitude`, `inputPhase`                  | Source field previews                                 |
| `inputPitchMm`, `outputPitchMm`, `outputSpanMm` | Physical sampling metadata                            |
| `inputPower`, `outputPower`                     | Area-weighted raw intensity sums                      |
| `diagnostics`                                   | Sampling and boundary risk messages                   |

The experiment-facing parameter domains are listed below. The instrument/CLI
validate these domains; the low-level propagation API is intended for numerical
work with explicit physical settings.

## CLI

Run with Node.js 22 or newer from the `wavebench` directory:

```bash
node bin/wavebench.js simulate --preset double --method angular-spectrum --distance 100 --out out
node bin/wavebench.js scan --preset gaussian --waist 0.3 --method fresnel --start 10 --stop 500 --steps 21 --out scan
node bin/wavebench.js --help
```

| Flag                    | Parameter / accepted values                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `--preset`              | `single`, `double`, `grating`, `circle`, `annulus`, `vortex`, `custom`, `gaussian`     |
| `--method`              | `fraunhofer`, `fresnel`, `angular-spectrum`                                            |
| `--grid`                | 256, 512, 1024                                                                         |
| `--distance`            | `distanceMm`, 0.1–2000 mm, free-space methods                                          |
| `--focal`               | `focalLengthMm`, 200–1000 mm, lens focal-plane model                                   |
| `--wavelength`          | `wavelengthNm`, 380–750 nm                                                             |
| `--waist`               | `beamWaistMm`, 0–3 mm; 0 selects plane illumination, Gaussian source requires 0.1–3 mm |
| `--width`, `--height`   | Slit width 0.125–0.8 mm, height 0.25–4 mm                                              |
| `--separation`          | Slit center spacing 0.25–1.5 mm, subject to aperture geometry                          |
| `--count`               | Integer grating count 2–7                                                              |
| `--diameter`, `--inner` | Outer diameter 0.25–3 mm, inner diameter 0.1–2.95 mm; inner must be smaller than outer |
| `--charge`              | Integer vortex charge 1–5                                                              |
| `--window`              | 8 mm in the instrument's experiment schema                                             |
| `--session`             | Load a saved experiment JSON, including a custom mask                                  |
| `--out`                 | Output directory; default `out`                                                        |
| `--force`               | Allow existing output files to be replaced                                             |

CLI defaults are double slit, Fraunhofer, grid 512, wavelength 532 nm, focal length
500 mm, free-space distance 100 mm, and plane illumination. Selecting a Gaussian
source without a waist uses 0.2 mm. Slit defaults are width 0.225 mm, height
1.5 mm, spacing 1 mm; grating count 5; outer/inner diameter 1.6/1 mm; charge 1.

`scan` supports `fresnel` or `angular-spectrum`; its default method is Fresnel
unless a session supplies another method. Its distance options are `--start`,
`--stop`, and `--steps`, defaulting to 10 mm, 500 mm, and 21 planes. Distances must
satisfy `0.1 ≤ start < stop ≤ 2000 mm`; steps must be an integer from 2 to 1000.
A scan uses the same source for every distance. Lens focal-plane scans are not
supported. Use `simulate` for a focal-plane calculation.

The CLI rejects `--distance` with Fraunhofer and `--focal` with free-space
methods. A scan uses `--start`/`--stop` and rejects `--distance`/`--focal`.
Explicit flags override a loaded session, but a custom mask cannot be moved to a
different grid by an override.

Successful calculations and help exit with code 0; invalid input and I/O errors
exit with code 2. Existing output files are protected unless `--force` is supplied.
Successful runs print one JSON summary to stdout with the command, model,
parameters identifying the run, output paths, power values, and diagnostic count.
The summary's `warnings` count includes all returned diagnostics, including info
entries. The manifest preserves their severity and messages.

## Numerical CSV files

A simulation produces `field.csv`, `section.csv`, and `manifest.json`.

Full-grid CSV header:

```csv
x_mm,y_mm,intensity,normalized_intensity,phase_rad
```

There are `N²` rows, in row-major order. `intensity` is raw relative field-amplitude
squared; it is not a calibrated irradiance in W/m². `normalized_intensity` is
peak-normalized per plane. Phase values near zero intensity have little physical
meaning. The CSV is independent of preview interpolation and log color mapping.

Section CSV header:

```csv
x_mm,intensity,normalized_intensity,phase_rad
```

It is the central horizontal row at `y=0`. The exporter can retain only native
samples within a requested span; it does not interpolate the data. The CLI uses
the full native section.

A **CLI scan** produces `scan.csv` and `manifest.json`, with this CSV header:

```csv
z_mm,x_mm,intensity,normalized_intensity,phase_rad
```

There are `steps*N` rows, ordered by increasing distance, then native `x`.
Normalization is by each plane's full-grid peak. Use the raw intensity column to
compare relative brightness between planes; per-plane normalization removes the
change in peak intensity.

A **browser sweep** exports a `-sweep.csv` file with a different normalization:

```csv
z_mm,x_mm,intensity,global_normalized_intensity,phase_rad
```

It contains all `steps*N` native central-row samples. The global column divides
raw intensity by the maximum over all central-section rows in the sweep, matching
the heatmap's scale. It does not normalize each plane separately or use a peak
outside the central cut. This preserves relative peak changes between distances.
Both formats retain raw `intensity` and phase.

## Manifest and experiment JSON

A simulation manifest contains `version: 2`, `application: "Wavebench"`, `model`,
full `params`, `grid` sampling/order metadata, `units`, area-integrated `power`,
and `diagnostics`. It describes numerical results without storing field buffers.
For a custom source, preserve its experiment JSON as well: the parameter names
alone cannot reconstruct its pixels.

A scan manifest describes the first plane in its top-level sampling and power
fields. Its `scan` object records the start/stop, steps, sample count, section
position, normalization, columns, and `planes` metadata. Each plane has its own
distance, input/output power, output pitch, and diagnostics.

A portable browser experiment has this structure:

```json
{
  "version": 2,
  "params": {
    "preset": "gaussian",
    "method": "fresnel",
    "windowMm": 8,
    "wavelengthNm": 532,
    "focalLengthMm": 500,
    "distanceMm": 100,
    "beamWaistMm": 0.2,
    "gridSize": 512
  },
  "view": { "mode": "log", "spanMm": 4 },
  "mask": null
}
```

Missing parameters take defined defaults. A supplied invalid parameter is
rejected rather than silently changed. A custom mask is Base64-encoded `Uint8`
amplitude data, with `gridSize²` samples and decoded values `byte/255`. Binary
samples round-trip exactly; other values are rounded to 8-bit amplitude precision.
Mask dimensions must match the stored grid. The codec does not silently resample
imported masks. The file size limit is 2 MiB in UTF-8.

A manifest and a portable experiment serve different purposes: the manifest
records sampling and output diagnostics; the experiment file carries display
settings and custom source pixels. Neither CSV nor a preview PNG is a substitute
for the custom mask needed to rerun a calculation.

## Share links and browser views

V2 URL fragments encode the source, method, physical parameters, grid, and
intensity display settings in a stable key order. Equal normalized settings
produce equal fragments. Custom pixel masks use experiment files, not links.
Old v1 links and files load as Fraunhofer experiments on the original 512 grid.
Unknown methods, grids, versions, malformed values, and invalid mask dimensions
are rejected.

The browser offers linear/log intensity and phase views, physical-distance
controls, and preview PNG export. Its 2, 4, 8, and 16 mm spans are constrained by
the available output grid. Preview pixels can be resampled; exported native
numeric data retain the solver's coordinates and values. The phase preview hides
samples below `10⁻⁸` of the plane's peak intensity; the CSV retains their numerical
phase. Clipboard copying
requires HTTPS or localhost and browser permission.

The browser starts with a Gaussian source, 0.2 mm waist, angular-spectrum method,
250 mm propagation distance, grid 512, and a 2 mm view. Its initial sweep covers
10–800 mm in 21 planes. The browser accepts 3–61 planes with
`0.1 ≤ start < stop ≤ 2000 mm`. The heatmap and `global_normalized_intensity`
column share one maximum over the sampled central sections. The log display
spans eight decades; linear mode is also available.

The browser's **Result manifest** downloads single-plane model, sampling, power,
and diagnostic metadata. **Snapshot PNG** produces a 1600 × 1100 image of the
source amplitude, output intensity, output phase, center section, and parameters;
it does not contain all native numerical values or the sweep data.

Local PNG/JPG/WebP import uses decoded browser RGB bytes and alpha to construct
**field amplitude**, not intensity. With `R,G,B,a` in `[0,255]`:

```text
A = round[(0.2126 R + 0.7152 G + 0.0722 B) a / 255] / 255
```

It operates on encoded RGB channel values without a physical transmittance
conversion or linear-light correction. The image is rescaled into the square
input window with its aspect ratio preserved and the remaining space filled
with zero amplitude. This is a constructed mask, not calibrated optical image
data. Files up to 20 MiB are accepted. Save the experiment JSON to preserve the
resulting mask; the CLI can load that JSON, but does not decode images itself.
Changing the browser grid explicitly resamples an existing mask by nearest
neighbor; importing its JSON preserves the saved grid.

The Fresnel/angular-spectrum comparison uses the same source, grid, wavelength,
and distance and reports relative L2 discrepancies, using angular spectrum as
the denominator:

```text
field error = ||U_Fresnel - U_ASM||₂ / ||U_ASM||₂
intensity error = ||I_Fresnel - I_ASM||₂ / ||I_ASM||₂
```

It measures disagreement between these two scalar discretizations; agreement
does not prove either calculation is converged or physically accurate. The
second-moment radius readout is `sqrt(2 <r²>)` after removing the intensity
centroid; for a circular Gaussian it equals the 1/e² intensity radius. On other
fields it is a moment-based size metric rather than a fitted Gaussian waist.
