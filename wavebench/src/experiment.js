/** Versioned experiments and numerical exports, independent of the browser UI. */
import {
  DEFAULT_PARAMS,
  DEFAULT_VIEW,
  PRESETS,
  normalizeParams,
  normalizeView,
  decodeHash,
  deserializeSession,
} from './state.js';

export const METHODS = Object.freeze(['fraunhofer', 'fresnel', 'angular-spectrum']);
export const GRID_SIZES = Object.freeze([256, 512, 1024]);
export const EXPERIMENT_PRESETS = Object.freeze([...PRESETS, 'gaussian']);
export const DEFAULT_EXPERIMENT = Object.freeze({
  ...DEFAULT_PARAMS,
  preset: 'double',
  method: 'fraunhofer',
  distanceMm: 100,
  beamWaistMm: 0,
  gridSize: 512,
});
export const DEFAULT_DISPLAY = DEFAULT_VIEW;

const HASH_KEYS = Object.freeze({
  preset: 'p',
  windowMm: 'a',
  widthMm: 'sw',
  heightMm: 'sh',
  separationMm: 's',
  count: 'n',
  diameterMm: 'd',
  innerDiameterMm: 'i',
  charge: 'q',
  wavelengthNm: 'w',
  focalLengthMm: 'f',
  method: 't',
  distanceMm: 'r',
  beamWaistMm: 'b',
  gridSize: 'g',
});
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Controls may be clamped; imported experiments use the stricter validator below. */
export function normalizeExperiment(input = {}) {
  const source = isObject(input) ? input : {};
  const preset =
    own(source, 'preset') && EXPERIMENT_PRESETS.includes(source.preset)
      ? source.preset
      : DEFAULT_EXPERIMENT.preset;
  const aperture = {};
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    if (own(source, key)) aperture[key] = source[key];
  }
  aperture.preset = preset === 'gaussian' ? 'circle' : preset;
  const result = { ...normalizeParams(aperture), preset };
  result.method =
    own(source, 'method') && METHODS.includes(source.method)
      ? source.method
      : DEFAULT_EXPERIMENT.method;
  result.distanceMm =
    own(source, 'distanceMm') && Number.isFinite(source.distanceMm)
      ? clamp(source.distanceMm, 0.1, 2000)
      : DEFAULT_EXPERIMENT.distanceMm;
  result.beamWaistMm =
    own(source, 'beamWaistMm') && Number.isFinite(source.beamWaistMm)
      ? clamp(source.beamWaistMm, 0, 3)
      : DEFAULT_EXPERIMENT.beamWaistMm;
  if (preset === 'gaussian')
    result.beamWaistMm = result.beamWaistMm === 0 ? 0.2 : Math.max(0.1, result.beamWaistMm);
  result.gridSize =
    own(source, 'gridSize') && GRID_SIZES.includes(source.gridSize)
      ? source.gridSize
      : DEFAULT_EXPERIMENT.gridSize;
  return result;
}

/** Reject altered science on import: accepted supplied settings must survive intact. */
export function validateExperiment(input) {
  if (!isObject(input)) throw new TypeError('Experiment parameters must be an object.');
  if (own(input, 'preset') && !EXPERIMENT_PRESETS.includes(input.preset))
    throw new Error('Unknown aperture preset.');
  if (own(input, 'method') && !METHODS.includes(input.method))
    throw new Error('Unknown propagation method.');
  if (own(input, 'gridSize') && !GRID_SIZES.includes(input.gridSize)) {
    throw new Error('Grid size must be 256, 512, or 1024.');
  }
  for (const key of Object.keys(DEFAULT_EXPERIMENT)) {
    if (key !== 'preset' && key !== 'method' && own(input, key) && !Number.isFinite(input[key])) {
      throw new TypeError(`Invalid numeric parameter: ${key}.`);
    }
  }
  const normalized = normalizeExperiment(input);
  for (const key of Object.keys(DEFAULT_EXPERIMENT)) {
    if (key !== 'preset' && key !== 'method' && own(input, key) && input[key] !== normalized[key]) {
      throw new RangeError(`Parameter outside its supported domain or geometry: ${key}.`);
    }
  }
  return normalized;
}

function validateDisplay(input) {
  if (!isObject(input)) throw new TypeError('Experiment display must be an object.');
  if (own(input, 'mode') && !['log', 'linear'].includes(input.mode))
    throw new Error('Unknown display mode.');
  if (
    own(input, 'spanMm') &&
    (!Number.isFinite(input.spanMm) || ![2, 4, 8, 16].includes(input.spanMm))
  ) {
    throw new Error('Display span must be 2, 4, 8, or 16 mm.');
  }
  return normalizeView(input);
}

export function encodeExperimentHash(params = DEFAULT_EXPERIMENT, view = DEFAULT_DISPLAY) {
  const p = normalizeExperiment(params);
  if (p.preset === 'custom')
    throw new Error('Custom apertures must be shared with an experiment file.');
  const v = normalizeView(view);
  const query = new URLSearchParams({ v: '2' });
  for (const [key, shortKey] of Object.entries(HASH_KEYS)) query.set(shortKey, String(p[key]));
  query.set('m', v.mode);
  query.set('z', String(v.spanMm));
  return `#${query}`;
}

function parseNumber(text, key) {
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
    !Number.isFinite(Number(text))
  ) {
    throw new TypeError(`Invalid numeric parameter: ${key}.`);
  }
  return Number(text);
}

export function decodeExperimentHash(hash) {
  if (typeof hash !== 'string') throw new TypeError('Share link must be a string.');
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  if (text.length > 4096) throw new Error('Share link is too large.');
  try {
    decodeURIComponent(text);
  } catch {
    throw new Error('Malformed share link encoding.');
  }
  const query = new URLSearchParams(text);
  if (query.get('v') === '1') {
    const old = decodeHash(hash);
    return { params: normalizeExperiment(old.params), view: old.view };
  }
  for (const key of ['v', 'm', 'z', ...Object.values(HASH_KEYS)]) {
    if (query.getAll(key).length > 1) throw new Error(`Duplicate share link parameter: ${key}.`);
  }
  if (query.get('v') !== '2') throw new Error('Unsupported share link version.');
  const input = {};
  for (const [key, shortKey] of Object.entries(HASH_KEYS)) {
    if (query.has(shortKey))
      input[key] =
        key === 'preset' || key === 'method'
          ? query.get(shortKey)
          : parseNumber(query.get(shortKey), key);
  }
  const params = validateExperiment(input);
  if (params.preset === 'custom') throw new Error('Custom apertures require an experiment file.');
  const view = {};
  if (query.has('m')) view.mode = query.get('m');
  if (query.has('z')) view.spanMm = parseNumber(query.get('z'), 'spanMm');
  return { params, view: validateDisplay(view) };
}

function encodeMask(mask, n) {
  const length = n * n;
  if (!mask || mask.length !== length)
    throw new Error(`Custom mask must contain exactly ${length} samples (${n} × ${n}).`);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const sample = mask[i];
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new Error('Mask transmission samples must be finite numbers between 0 and 1.');
    }
    bytes[i] = Math.round(sample * 255);
  }
  let binary = '';
  for (let i = 0; i < length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function decodeMask(text, n) {
  const length = n * n;
  if (
    typeof text !== 'string' ||
    text.length !== Math.ceil(length / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(text)
  ) {
    throw new Error(`Invalid mask encoding or dimensions; expected ${n} × ${n}.`);
  }
  let binary;
  try {
    binary = atob(text);
  } catch {
    throw new Error('Invalid mask encoding.');
  }
  if (binary.length !== length || btoa(binary) !== text)
    throw new Error(`Invalid mask encoding or dimensions; expected ${n} × ${n}.`);
  const mask = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mask[i] = binary.charCodeAt(i) / 255;
  return mask;
}

/** Binary brush masks are exact; fractional transmissions use byte/255 precision. */
export function serializeExperiment(
  params = DEFAULT_EXPERIMENT,
  view = DEFAULT_DISPLAY,
  mask = null,
) {
  const p = validateExperiment(params);
  const v = validateDisplay(view);
  return JSON.stringify({
    version: 2,
    params: p,
    view: v,
    mask: p.preset === 'custom' ? encodeMask(mask, p.gridSize) : null,
  });
}

export function deserializeExperiment(text) {
  if (typeof text !== 'string') throw new TypeError('Experiment file must contain JSON text.');
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    throw new Error('Experiment file exceeds the 2 MB limit.');
  }
  let experiment;
  try {
    experiment = JSON.parse(text);
  } catch {
    throw new Error('Experiment file is not valid JSON.');
  }
  if (!isObject(experiment)) throw new Error('Invalid experiment file.');
  if (experiment.version === 1) {
    const old = deserializeSession(text);
    return { params: normalizeExperiment(old.params), view: old.view, mask: old.mask };
  }
  if (experiment.version !== 2) throw new Error('Unsupported experiment file version.');
  const params = validateExperiment(experiment.params);
  const view = validateDisplay(experiment.view);
  let mask = null;
  if (params.preset === 'custom') mask = decodeMask(experiment.mask, params.gridSize);
  else if (experiment.mask != null)
    throw new Error('Only custom aperture experiments may contain a mask.');
  return { params, view, mask };
}

function checkGrid(result, requireSamples = true) {
  if (
    !isObject(result) ||
    !Number.isInteger(result.n) ||
    result.n < 2 ||
    result.n > 1024 ||
    result.n % 2 !== 0
  ) {
    throw new Error('Numerical result must contain an even grid size between 2 and 1024.');
  }
  if (!Number.isFinite(result.outputPitchMm) || result.outputPitchMm <= 0)
    throw new Error('Invalid output sample pitch.');
  if (requireSamples) {
    for (const key of ['intensity', 'normalizedIntensity', 'phase']) {
      if (!result[key] || result[key].length !== result.n * result.n)
        throw new Error(`Invalid ${key} array dimensions.`);
    }
  }
}

function sampleValues(result, index) {
  const values = [result.intensity[index], result.normalizedIntensity[index], result.phase[index]];
  if (!values.every(Number.isFinite) || values[0] < 0 || values[1] < 0)
    throw new Error('Numerical result contains invalid intensity or phase samples.');
  return values.join(',');
}

/** Full native sampled field; display modes/crops never alter numerical exports. */
export function buildGridCsv(result) {
  checkGrid(result);
  const n = result.n;
  const coordinates = Array.from({ length: n }, (_, i) =>
    String((i - n / 2) * result.outputPitchMm),
  );
  const blocks = ['x_mm,y_mm,intensity,normalized_intensity,phase_rad'];
  for (let y = 0; y < n; y += 1) {
    const rows = new Array(n);
    for (let x = 0; x < n; x += 1)
      rows[x] = `${coordinates[x]},${coordinates[y]},${sampleValues(result, y * n + x)}`;
    blocks.push(rows.join('\n'));
  }
  return `${blocks.join('\n')}\n`;
}

/** Horizontal section at y = 0, retaining native samples within the requested span. */
export function buildSectionCsv(result, spanMm = result.outputSpanMm) {
  checkGrid(result);
  if (!Number.isFinite(spanMm) || spanMm <= 0)
    throw new Error('Section span must be a finite positive number.');
  const rows = ['x_mm,intensity,normalized_intensity,phase_rad'];
  const offset = (result.n / 2) * result.n;
  for (let x = 0; x < result.n; x += 1) {
    const coordinate = (x - result.n / 2) * result.outputPitchMm;
    if (Math.abs(coordinate) <= spanMm / 2)
      rows.push(`${coordinate},${sampleValues(result, offset + x)}`);
  }
  return `${rows.join('\n')}\n`;
}

/** A compact reproducibility manifest, without sampled field buffers. */
export function buildManifest(params, result) {
  const p = validateExperiment(params);
  checkGrid(result, false);
  if (!GRID_SIZES.includes(result.n)) {
    throw new Error('Reproducible experiment manifests require a grid size of 256, 512, or 1024.');
  }
  if (own(params, 'gridSize') && p.gridSize !== result.n) {
    throw new Error('Experiment gridSize does not match the numerical result grid.');
  }
  // The numerical API accepts its grid as a separate argument. Its actual
  // result, rather than the UI default, determines an omitted grid setting.
  p.gridSize = result.n;
  for (const key of ['inputPitchMm', 'outputSpanMm', 'inputPower', 'outputPower']) {
    if (!Number.isFinite(result[key]) || result[key] < 0)
      throw new Error(`Invalid numerical metadata: ${key}.`);
  }
  return {
    version: 2,
    application: 'Wavebench',
    model: p.method,
    params: p,
    grid: {
      size: result.n,
      apertureWindowMm: p.windowMm,
      inputPitchMm: result.inputPitchMm,
      outputPitchMm: result.outputPitchMm,
      outputSpanMm: result.outputSpanMm,
      ordering: 'row-major; x and y centered at index n/2',
    },
    units: {
      coordinates: 'mm',
      wavelength: 'nm',
      phase: 'rad',
      intensity: 'relative field amplitude squared',
      power: 'relative field amplitude squared × mm²',
    },
    power: {
      input: result.inputPower,
      output: result.outputPower,
      relativeChange:
        result.inputPower === 0
          ? null
          : (result.outputPower - result.inputPower) / result.inputPower,
    },
    diagnostics: Array.isArray(result.diagnostics)
      ? result.diagnostics.map((entry) => ({
          code: typeof entry?.code === 'string' ? entry.code : 'unknown',
          level: typeof entry?.level === 'string' ? entry.level : 'info',
          message: typeof entry?.message === 'string' ? entry.message : '',
        }))
      : [],
  };
}
