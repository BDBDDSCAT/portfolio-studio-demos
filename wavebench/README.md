# Wavebench · 光の実験室

**[Open the live demo](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Draw a small opening. See where the light goes.

Wavebench is a browser diffraction sandbox: change a slit, ring, or phase mask and
watch its Fourier-plane pattern respond. A quiet workbench for optics, generative
shapes, and the moment an equation becomes something you can see.

[![Wavebench: aperture, diffraction pattern, and intensity section](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)

HTML, CSS, and JavaScript. No build step, runtime dependencies, CDN, analytics, or
API key. Computation and file exports stay in your browser.

## Try an experiment

1. Start with **Double slit**. Increase the slit separation: the fringes move
   closer together.
2. Switch to **Circular**. Make the aperture smaller: the central spot widens.
3. Try **Vortex** and change the charge: a phase winding produces a dark center.
4. Select **Draw your own**, draw an opening, and compare its shape with its
   diffraction pattern.

The aperture preview shows amplitude or phase. The diffraction view offers linear
and logarithmic display, and the center section shows normalized intensity on a
physical distance axis.

## What is included

| Experiment | What to change | What to watch |
| --- | --- | --- |
| Single slit | Slit width | Width of the central maximum and side lobes |
| Double slit | Width and separation | The diffraction envelope and interference fringes |
| Grating | Slit count and spacing | Narrow peaks from many openings |
| Circular | Diameter | The Airy pattern |
| Annular | Outer and inner diameters | Redistribution of the rings |
| Vortex | Diameter and integer charge | A phase winding and central null |
| Custom | Draw or erase the aperture | The Fourier pattern of your own mask |

- Wavelength, focal length, and aperture controls with physical units.
- Aperture amplitude/phase preview, diffraction image, and central intensity section.
- PNG export of both panels, the intensity section, and parameters; CSV export
  for the intensity section.
- Shareable links for the six parameter-based experiments.
- JSON session export/import, including a custom drawn aperture.

[See an exported vortex experiment](docs/vortex.png): the PNG includes the mask,
pattern, physical scale, parameters, and a linear intensity section.

Custom drawings are saved in JSON sessions; a share link does not include their
pixel data. Clipboard copying requires HTTPS or localhost and browser permission.

## Run locally

Serve the repository with any static HTTP server. Python is one option:

```bash
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos/wavebench
python3 -m http.server 8080 --bind 127.0.0.1
```

Open <http://127.0.0.1:8080>. No package installation is needed to use the app.
Use an HTTP server rather than opening `index.html` as a `file://` URL, since the
app uses JavaScript modules.

## What the model means

Wavebench calculates **scalar, monochromatic Fraunhofer diffraction** in the focal
plane of an ideal lens. The complex aperture field is transformed with a 2D FFT;
the squared magnitude gives intensity.

The default grid is 512 × 512 over an 8 mm aperture window. Aperture sampling is
`L / N`; observation-plane sampling is `λ f / L`. Increasing wavelength or focal
length stretches the pattern's physical scale.

The view starts at 4 mm across, with 2, 4, 8, and 16 mm options. It is resampled
from the FFT output and limited to the available sampled range. The intensity
section uses the same displayed distance range.

Each result is normalized to its own peak. The image helps compare shape and
relative intensity within an experiment; it does not compare absolute brightness
between different apertures. The finite grid can underresolve fine features and
sharp edges. Near-field propagation, polarization, lens aberrations, and material
dispersion are outside this model.

Equations, units, sampling limits, and analytical checks are in
[docs/physics.md](docs/physics.md).

## Development

Node.js 22 or newer is used for the built-in numerical tests:

```bash
npm test
```

The browser checks use Playwright as a development dependency:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow. Reports of
incorrect units, numerical behavior, keyboard access, or confusing controls are
especially useful.

## License

[MIT](LICENSE) · BDBDDSCAT
