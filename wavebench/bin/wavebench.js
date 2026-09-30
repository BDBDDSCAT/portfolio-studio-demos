#!/usr/bin/env node
/** Reproducible scalar-optics runs using the same engine as the browser. */
import { readFile, mkdir, lstat, writeFile, rename, link, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { simulateExperiment } from '../src/propagation.js';
import {
  DEFAULT_EXPERIMENT, normalizeExperiment, validateExperiment, deserializeExperiment,
  buildGridCsv, buildSectionCsv, buildManifest,
} from '../src/experiment.js';

const FLAGS = Object.freeze({
  preset: 'preset', method: 'method', grid: 'gridSize',
  distance: 'distanceMm', focal: 'focalLengthMm', wavelength: 'wavelengthNm',
  window: 'windowMm', width: 'widthMm', height: 'heightMm',
  separation: 'separationMm', count: 'count', diameter: 'diameterMm',
  inner: 'innerDiameterMm', charge: 'charge', waist: 'beamWaistMm',
  out: null, session: null, start: null, stop: null, steps: null,
});
const TEXT_FLAGS = new Set(['preset', 'method', 'out', 'session']);
const INTEGER_FLAGS = new Set(['grid', 'count', 'charge', 'steps']);
const HELP = `Wavebench — scalar diffraction with reproducible CSV output

Usage:
  wavebench simulate [options]
  wavebench scan [options] --start 10 --stop 500 --steps 21

Commands:
  simulate   Export field.csv, section.csv, and manifest.json.
  scan       Export the central row at each distance to scan.csv + manifest.json.
             Uses fresnel by default; angular-spectrum is also supported.

Options (lengths in mm except wavelength in nm):
  --preset       double (default), single, grating, circle, annulus, vortex,
                 gaussian, custom (requires a session containing a mask)
  --method       fraunhofer (simulate default), fresnel, angular-spectrum
  --grid         256, 512 (default), 1024
  --distance     Near-field propagation distance, 0.1..2000 (default 100)
  --focal        Fraunhofer lens focal length, 200..1000 (default 500)
  --wavelength   380..750 (default 532)
  --waist        Incident Gaussian amplitude waist, 0..3; 0 = plane wave.
                 Gaussian preset: 0.1..3, default 0.2.
  --width        Slit width, 0.125..0.8 (default 0.225)
  --height       Slit height, 0.25..4 (default 1.5)
  --separation   Slit center spacing, 0.25..1.5 (default 1)
  --count        Grating slit count, integer 2..7 (default 5)
  --diameter     Outer diameter, 0.25..3 (default 1.6)
  --inner        Inner diameter, 0.1..2.95 (default 1)
  --charge       Vortex charge, integer 1..5 (default 1)
  --window       Input window, fixed at 8
  --session      Load a portable experiment JSON; explicit flags override it.
  --out          Output directory (default ./out)
  --force        Replace existing output files.
  --start        Scan first distance, 0.1..2000 (default 10)
  --stop         Scan last distance, 0.1..2000 (default 500)
  --steps        Scan samples, integer 2..1000 (default 21)
  --help, -h     Print this help.

Scan requires start < stop. It samples the native central row; no interpolation.
Intensity is raw |U|² and normalized_intensity is divided by that plane's peak.
Custom masks retain their session grid; changing that grid is rejected.
Output files are protected unless --force is given. Errors exit with code 2.

Examples:
  node bin/wavebench.js simulate --preset double --method angular-spectrum \\
    --distance 100 --wavelength 532 --grid 512 --out out
  node bin/wavebench.js scan --preset gaussian --method fresnel \\
    --waist 0.2 --start 10 --stop 500 --steps 21 --grid 256 --out scan
`;

function numeric(value, name) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    throw new Error(`--${name} requires a finite decimal number; received ${JSON.stringify(value)}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${name} requires a finite number.`);
  if (INTEGER_FLAGS.has(name) && !Number.isInteger(number)) {
    throw new Error(`--${name} requires an integer.`);
  }
  return number;
}

function parse(argv) {
  const options = {};
  let command = 'simulate';
  if (argv[0] && !argv[0].startsWith('-')) command = argv.shift();
  if (command === 'help') {
    command = 'simulate';
    options.help = true;
  }
  if (!['simulate', 'scan'].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h') {
      if (options.help) throw new Error('Duplicate option: --help.');
      options.help = true;
      continue;
    }
    const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(token);
    if (!match) throw new Error(`Unexpected argument: ${token}. Use --help.`);
    const [, name, attached] = match;
    if (!Object.hasOwn(FLAGS, name) && name !== 'help' && name !== 'force') throw new Error(`Unknown option: --${name}.`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: --${name}.`);
    if (name === 'help' || name === 'force') {
      if (attached !== undefined) throw new Error(`--${name} does not take a value.`);
      options[name] = true;
      continue;
    }
    const value = attached ?? argv[++index];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
    options[name] = TEXT_FLAGS.has(name) ? value : numeric(value, name);
  }
  if (command === 'simulate' && ['start', 'stop', 'steps'].some((name) => Object.hasOwn(options, name))) {
    throw new Error('--start, --stop, and --steps are only available for scan.');
  }
  if (command === 'scan' && ['distance', 'focal'].some((name) => Object.hasOwn(options, name))) {
    throw new Error('Use --start and --stop to set scan distances; --distance and --focal are unavailable for scan.');
  }
  return { command, options };
}

async function settings(command, options) {
  let params = { ...DEFAULT_EXPERIMENT };
  let mask = null;
  if (options.session) {
    const session = deserializeExperiment(await readFile(resolve(options.session), 'utf8'));
    params = session.params;
    mask = session.mask;
  }
  params = { ...params };
  if (command === 'scan' && !Object.hasOwn(options, 'method') && !options.session) params.method = 'fresnel';
  for (const [flag, key] of Object.entries(FLAGS)) {
    if (key && Object.hasOwn(options, flag)) params[key] = options[flag];
  }
  if (params.preset === 'gaussian' && !Object.hasOwn(options, 'waist') && params.beamWaistMm === 0) {
    params.beamWaistMm = 0.2;
  }
  // Geometry normalization may update an unused inherited control (for example,
  // inner diameter when shrinking a circular aperture). Explicit CLI settings
  // must always survive unchanged; no invalid requested value is clamped.
  const normalized = normalizeExperiment(params);
  for (const [flag, key] of Object.entries(FLAGS)) {
    if (key && Object.hasOwn(options, flag) && normalized[key] !== params[key]) {
      throw new Error(`--${flag} is outside its supported domain or violates the aperture geometry.`);
    }
  }
  params = validateExperiment(normalized);
  if (command === 'scan' && params.method === 'fraunhofer') {
    throw new Error('scan requires --method fresnel or --method angular-spectrum; Fraunhofer uses a fixed lens focal plane.');
  }
  if (command === 'simulate' && params.method === 'fraunhofer' && Object.hasOwn(options, 'distance')) {
    throw new Error('--distance applies to fresnel or angular-spectrum. For fraunhofer, use --focal.');
  }
  if (command === 'simulate' && params.method !== 'fraunhofer' && Object.hasOwn(options, 'focal')) {
    throw new Error('--focal applies to fraunhofer. For near-field propagation, use --distance.');
  }
  if (params.preset === 'custom' && !mask) throw new Error('The custom preset requires --session with a custom aperture mask.');
  if (params.preset !== 'custom') mask = null;
  if (mask) {
    const sourceSize = Math.sqrt(mask.length);
    if (!Number.isInteger(sourceSize)) throw new Error('The session mask must be a square grid.');
    if (sourceSize !== params.gridSize) {
      throw new Error(`Custom mask has a ${sourceSize} × ${sourceSize} grid; use --grid ${sourceSize} to preserve its samples.`);
    }
  }
  return { params, mask };
}

async function prepareOutput(directory, names, force) {
  await mkdir(directory, { recursive: true });
  const paths = Object.fromEntries(names.map((name) => [name, join(directory, name)]));
  for (const path of Object.values(paths)) {
    try {
      const existing = await lstat(path);
      if (!force) throw new Error(`Output already exists: ${path}. Use --force to replace it.`);
      if (!existing.isFile()) throw new Error(`Output is not a regular file: ${path}.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return paths;
}

/** Stage every file before exposing results; exclusive links protect against races. */
async function writeOutputs(paths, contents, force) {
  const staged = [];
  const published = [];
  try {
    for (const [name, content] of Object.entries(contents)) {
      const path = paths[name];
      const temporary = `${path}.${randomUUID()}.tmp`;
      staged.push(temporary);
      await writeFile(temporary, content, { flag: 'wx' });
    }
    for (let i = 0; i < staged.length; i += 1) {
      const path = paths[Object.keys(contents)[i]];
      if (force) await rename(staged[i], path);
      else {
        await link(staged[i], path);
        published.push(path);
      }
    }
  } catch (error) {
    // Roll back newly linked files only; never remove preexisting output files.
    if (!force) await Promise.all(published.map((path) => unlink(path).catch(() => {})));
    throw error;
  } finally {
    await Promise.all(staged.map((path) => unlink(path).catch(() => {})));
  }
}

function summary(command, params, paths, result, extra = {}) {
  return {
    command, preset: params.preset, method: params.method, grid: params.gridSize,
    files: paths, inputPower: result.inputPower, outputPower: result.outputPower,
    powerRatio: result.inputPower > 0 ? result.outputPower / result.inputPower : null,
    warnings: result.diagnostics.length, ...extra,
  };
}

async function simulate(options) {
  const { params, mask } = await settings('simulate', options);
  const paths = await prepareOutput(resolve(options.out ?? 'out'), ['field.csv', 'section.csv', 'manifest.json'], options.force);
  const result = simulateExperiment(params, params.gridSize, mask);
  const manifest = buildManifest(params, result);
  await writeOutputs(paths, {
    'field.csv': buildGridCsv(result),
    'section.csv': buildSectionCsv(result, result.outputSpanMm),
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  }, options.force);
  process.stdout.write(`${JSON.stringify(summary('simulate', params, paths, result))}\n`);
}

async function scan(options) {
  const { params, mask } = await settings('scan', options);
  const start = options.start ?? 10;
  const stop = options.stop ?? 500;
  const steps = options.steps ?? 21;
  if (start < 0.1 || start > 2000 || stop < 0.1 || stop > 2000 || start >= stop) {
    throw new Error('Scan distances must satisfy 0.1 <= start < stop <= 2000 mm.');
  }
  if (!Number.isInteger(steps) || steps < 2 || steps > 1000) throw new Error('--steps must be an integer between 2 and 1000.');
  const paths = await prepareOutput(resolve(options.out ?? 'out'), ['scan.csv', 'manifest.json'], options.force);
  const lines = ['z_mm,x_mm,intensity,normalized_intensity,phase_rad'];
  const planes = [];
  let firstResult;
  let warnings = 0;
  for (let step = 0; step < steps; step += 1) {
    const distanceMm = start + (stop - start) * step / (steps - 1);
    const current = { ...params, distanceMm };
    const result = simulateExperiment(current, current.gridSize, mask);
    firstResult ??= result;
    warnings += result.diagnostics.length;
    const rowStart = Math.floor(result.n / 2) * result.n;
    for (let x = 0; x < result.n; x += 1) {
      const i = rowStart + x;
      lines.push([
        distanceMm, (x - result.n / 2) * result.outputPitchMm,
        result.intensity[i], result.normalizedIntensity[i], result.phase[i],
      ].join(','));
    }
    planes.push({
      distanceMm, inputPower: result.inputPower, outputPower: result.outputPower,
      outputPitchMm: result.outputPitchMm, diagnostics: result.diagnostics,
    });
  }
  const manifest = buildManifest({ ...params, distanceMm: start }, firstResult);
  manifest.scan = {
    startMm: start, stopMm: stop, steps, sampleCount: steps * params.gridSize,
    sectionYMm: 0, normalization: 'Each plane is divided by its own full-grid maximum.',
    columns: ['z_mm', 'x_mm', 'intensity', 'normalized_intensity', 'phase_rad'], planes,
  };
  await writeOutputs(paths, {
    'scan.csv': `${lines.join('\n')}\n`,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  }, options.force);
  process.stdout.write(`${JSON.stringify(summary('scan', params, paths, firstResult, { steps, warnings }))}\n`);
}

try {
  const { command, options } = parse(process.argv.slice(2));
  if (options.help) process.stdout.write(HELP);
  else if (command === 'scan') await scan(options);
  else await simulate(options);
} catch (error) {
  process.stderr.write(`wavebench: ${error.message}\n`);
  process.exitCode = 2;
}
