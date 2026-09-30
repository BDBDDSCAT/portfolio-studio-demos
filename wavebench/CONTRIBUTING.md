# Contributing to Wavebench

Contributions should improve a numerical model, a reproducible workflow, or the
instrument's usability. Include the physical problem and the behavior your change
adds or corrects.

## Run and check

Use Node.js 22 or newer. Numerical and CLI checks use Node's built-in test runner:

```bash
npm test
node bin/wavebench.js --help
```

Serve the browser instrument from this directory:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

For browser checks only, install the development dependencies:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

## Numerical changes

Keep the engine independent of the DOM and of runtime packages. State the input
field, coordinate units, carrier convention, normalization, and boundary
conditions. Test the complex field where phase matters; comparing only normalized
images can conceal a scale or phase error.

Use analytical cases or independently computed results for validation. For a
propagation change, check identity, an FFT-bin plane wave, energy behavior, and
an appropriate Gaussian or aperture case. Document the tested grid, window,
wavelength, distance, and error measure. A conservation check alone cannot rule
out phase errors or periodic wraparound.

Changes affecting the physical model or file schema must update
[docs/physics.md](docs/physics.md) or [docs/reference.md](docs/reference.md).
Preserve v1 decoding and deterministic v2 serialization when editing the state
codec. Do not silently change a stored mask's grid or precision.

## Instrument and CLI changes

Include a minimal experiment JSON or CLI command that reproduces the behavior.
Use CSV values for numerical evidence and screenshots for interface changes.
Check labels, keyboard operation, narrow screens, and reduced-motion settings
when editing the interface. Exports must correspond to the completed calculation
and retain the parameters needed to reproduce it.

Run `npm test` before submitting. Run browser checks for controls, source import,
rendering, scans, sharing, or export changes. Keep assets local and retain the
absence of accounts, analytics, CDN use, and remote computation.

## Report a numerical issue

Provide the method, grid, input window, wavelength, focal length or propagation
distance, aperture/source parameters, and expected formula or reference. Attach
an experiment JSON for a custom mask. Include raw values and the effect of a
finer grid if available; a color-mapped image alone is insufficient to diagnose
an irradiance error.

English, Chinese, and Japanese reports are welcome. Contributions use the
project's [MIT License](LICENSE).
