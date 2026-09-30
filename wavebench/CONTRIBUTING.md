# Contributing to Wavebench

Bug reports, clearer explanations, accessible controls, and numerical corrections
are welcome. Please keep changes small enough that someone can see what behavior
they improve.

## Set up

Use Node.js 22 or newer for tests. The app itself runs from a static HTTP server:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open <http://127.0.0.1:8080>. No runtime package installation or build is required.

Run the numerical checks with Node's built-in test runner:

```bash
npm test
```

For browser checks, install the development dependencies and Chromium:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

## Before opening a pull request

- Explain the problem and the resulting behavior. Include a screenshot for a
  visible change and a share link or JSON session for a reproducible experiment.
- Run `npm test`. Run the browser checks when changing controls, rendering,
  drawing, sharing, or exports.
- Check narrow screens, keyboard focus, labels, and reduced-motion preferences
  for interface changes.
- Keep browser assets local. The project uses no runtime dependencies, CDN,
  analytics, or remote computation.
- Update the physics notes if a change affects units, normalization, sampling,
  or the propagation model. Add a numerical check against a relevant analytical
  result when changing the solver.

## Report a problem

Use the issue templates. Include the browser and operating system, the steps
that reproduce the result, and what you expected. For numerical questions,
include the aperture parameters, wavelength, focal length, and the formula or
reference you are comparing against.

Share links cover parameter-based presets. For a drawn aperture, attach a JSON
session instead. Remove any unrelated personal information before attaching files.

English, Chinese, and Japanese reports are welcome. Code contributions are
licensed under the project's [MIT License](LICENSE).
