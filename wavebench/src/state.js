/** Small, versioned share links and portable, local-only experiment files. */
export const DEFAULT_PARAMS = Object.freeze({
  preset: 'double',
  windowMm: 8,
  widthMm: 0.225,
  heightMm: 1.5,
  separationMm: 1,
  count: 5,
  diameterMm: 1.6,
  innerDiameterMm: 1,
  charge: 1,
  wavelengthNm: 532,
  focalLengthMm: 500,
});

export const PRESETS = Object.freeze(['double', 'single', 'grating', 'circle', 'annulus', 'vortex', 'custom']);
export const DEFAULT_VIEW = Object.freeze({ mode: 'log', spanMm: 4 });

const LIMITS = Object.freeze({
  widthMm: [0.125, 0.8],
  heightMm: [0.25, 4],
  separationMm: [0.25, 1.5],
  count: [2, 7],
  diameterMm: [0.25, 3],
  innerDiameterMm: [0.1, 2.95],
  charge: [1, 5],
  wavelengthNm: [380, 750],
  focalLengthMm: [200, 1000],
});
const HASH_KEYS = Object.freeze({
  preset: 'p', windowMm: 'a', widthMm: 'sw', heightMm: 'sh', separationMm: 's',
  count: 'n', diameterMm: 'd', innerDiameterMm: 'i', charge: 'q', wavelengthNm: 'w', focalLengthMm: 'f',
});
const SPANS = Object.freeze([2, 4, 8, 16]);
const MASK_LENGTH = 512 * 512;
const MASK_BASE64_LENGTH = Math.ceil(MASK_LENGTH / 3) * 4;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Normalize control values without allowing unrecognized fields into state. */
export function normalizeParams(input = {}) {
  const source = isObject(input) ? input : {};
  const result = { ...DEFAULT_PARAMS };
  if (own(source, 'preset') && PRESETS.includes(source.preset)) result.preset = source.preset;
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!own(source, key) || !Number.isFinite(source[key])) continue;
    const value = key === 'count' || key === 'charge' ? Math.round(source[key]) : source[key];
    result[key] = clamp(value, min, max);
  }
  result.separationMm = Math.max(result.widthMm, result.separationMm);
  // Only a grating uses count; retaining its hidden value must not limit double slits.
  if (result.preset === 'grating') {
    const maximum = (result.windowMm - result.widthMm) / (result.count - 1);
    if (result.separationMm > maximum) {
      // Round down to the spacing slider's 0.025 mm step so the control and
      // exported experiment agree, while retaining arbitrary valid loaded values.
      result.separationMm = Math.floor(maximum * 40) / 40;
    }
  }
  result.innerDiameterMm = Math.min(result.innerDiameterMm, result.diameterMm - 0.05);
  return result;
}

export function normalizeView(input = {}) {
  const source = isObject(input) ? input : {};
  const mode = own(source, 'mode') && ['log', 'linear'].includes(source.mode) ? source.mode : DEFAULT_VIEW.mode;
  const requested = own(source, 'spanMm') && Number.isFinite(source.spanMm) ? source.spanMm : DEFAULT_VIEW.spanMm;
  const spanMm = SPANS.reduce((nearest, span) => Math.abs(span - requested) < Math.abs(nearest - requested) ? span : nearest);
  return { mode, spanMm };
}

function validateParams(input) {
  if (!isObject(input)) throw new TypeError('Experiment parameters must be an object.');
  if (own(input, 'preset') && !PRESETS.includes(input.preset)) throw new Error('Unknown aperture preset.');
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    if (key !== 'preset' && own(input, key) && !Number.isFinite(input[key])) {
      throw new TypeError(`Invalid numeric parameter: ${key}.`);
    }
  }
  return normalizeParams(input);
}

function validateView(input) {
  if (!isObject(input)) throw new TypeError('Experiment view must be an object.');
  if (own(input, 'mode') && !['log', 'linear'].includes(input.mode)) throw new Error('Unknown display mode.');
  if (own(input, 'spanMm') && !Number.isFinite(input.spanMm)) throw new TypeError('Invalid numeric parameter: spanMm.');
  return normalizeView(input);
}

/** Custom drawings travel in session files; share links contain parametric apertures. */
export function encodeHash(params = DEFAULT_PARAMS, view = DEFAULT_VIEW) {
  const p = normalizeParams(params);
  if (p.preset === 'custom') throw new Error('Custom apertures must be shared with a session file.');
  const v = normalizeView(view);
  const query = new URLSearchParams({ v: '1' });
  for (const [key, shortKey] of Object.entries(HASH_KEYS)) query.set(shortKey, String(p[key]));
  query.set('m', v.mode);
  query.set('z', String(v.spanMm));
  return `#${query}`;
}

function parseNumber(value, key) {
  // Number(''), Number('0x10'), and infinities do not represent valid URL controls.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    throw new TypeError(`Invalid numeric parameter: ${key}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid numeric parameter: ${key}.`);
  return number;
}

export function decodeHash(hash) {
  if (typeof hash !== 'string') throw new TypeError('Share link must be a string.');
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  if (text.length > 4096) throw new Error('Share link is too large.');
  // URLSearchParams tolerates damaged percent escapes; reject them explicitly.
  try { decodeURIComponent(text); } catch { throw new Error('Malformed share link encoding.'); }
  const query = new URLSearchParams(text);
  const known = new Set(['v', 'm', 'z', ...Object.values(HASH_KEYS)]);
  for (const key of known) {
    if (query.getAll(key).length > 1) throw new Error(`Duplicate share link parameter: ${key}.`);
  }
  if (query.get('v') !== '1') throw new Error('Unsupported share link version.');
  const params = {};
  for (const [key, shortKey] of Object.entries(HASH_KEYS)) {
    if (query.has(shortKey)) params[key] = key === 'preset' ? query.get(shortKey) : parseNumber(query.get(shortKey), key);
  }
  const p = validateParams(params);
  if (p.preset === 'custom') throw new Error('Custom apertures require a session file.');
  const view = {};
  if (query.has('m')) view.mode = query.get('m');
  if (query.has('z')) view.spanMm = parseNumber(query.get('z'), 'spanMm');
  return { params: p, view: validateView(view) };
}

function encodeMask(mask) {
  if (!mask || mask.length !== MASK_LENGTH) throw new Error(`Custom mask must contain exactly ${MASK_LENGTH} samples (512 × 512).`);
  const bytes = new Uint8Array(MASK_LENGTH);
  for (let i = 0; i < bytes.length; i += 1) {
    const sample = mask[i];
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new Error('Custom mask transmission samples must be finite numbers between 0 and 1.');
    }
    bytes[i] = Math.round(sample * 255);
  }
  // Chunking avoids the argument limit of String.fromCharCode(...bytes).
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

function decodeMask(encoded) {
  if (typeof encoded !== 'string' || encoded.length !== MASK_BASE64_LENGTH ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Invalid custom mask encoding or dimensions; expected 512 × 512.');
  }
  let binary;
  try { binary = atob(encoded); } catch { throw new Error('Invalid custom mask encoding.'); }
  if (binary.length !== MASK_LENGTH || btoa(binary) !== encoded) {
    throw new Error('Invalid custom mask encoding or dimensions; expected 512 × 512.');
  }
  const mask = new Float32Array(MASK_LENGTH);
  for (let i = 0; i < mask.length; i += 1) mask[i] = binary.charCodeAt(i) / 255;
  return mask;
}

/** Binary brush samples round-trip exactly; other transmissions use 8-bit precision. */
export function serializeSession(params = DEFAULT_PARAMS, view = DEFAULT_VIEW, mask = null) {
  const p = validateParams(params);
  const v = validateView(view);
  return JSON.stringify({ version: 1, params: p, view: v, mask: p.preset === 'custom' ? encodeMask(mask) : null });
}

export function deserializeSession(text) {
  if (typeof text !== 'string') throw new TypeError('Session file must contain JSON text.');
  if (text.length > MAX_SESSION_BYTES || new TextEncoder().encode(text).length > MAX_SESSION_BYTES) {
    throw new Error('Session file exceeds the 2 MB limit.');
  }
  let session;
  try { session = JSON.parse(text); } catch { throw new Error('Session file is not valid JSON.'); }
  if (!isObject(session)) throw new Error('Invalid session file.');
  if (session.version !== 1) throw new Error('Unsupported session file version.');
  const params = validateParams(session.params);
  const view = validateView(session.view);
  let mask = null;
  if (params.preset === 'custom') mask = decodeMask(session.mask);
  else if (session.mask != null) throw new Error('Only custom aperture sessions may contain a mask.');
  return { params, view, mask };
}
