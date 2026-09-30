import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS, DEFAULT_VIEW, PRESETS, normalizeParams, normalizeView,
  encodeHash, decodeHash, serializeSession, deserializeSession,
} from '../src/state.js';

const session = (changes = {}) => JSON.stringify({
  version: 1, params: { ...DEFAULT_PARAMS }, view: { ...DEFAULT_VIEW }, mask: null, ...changes,
});

test('defaults stay immutable and control normalization preserves physical constraints', () => {
  assert.ok(Object.isFrozen(DEFAULT_PARAMS));
  assert.ok(Object.isFrozen(DEFAULT_VIEW));
  assert.ok(Object.isFrozen(PRESETS));
  assert.deepEqual(normalizeParams(), DEFAULT_PARAMS);
  const input = {
    preset: 'grating', windowMm: 100, widthMm: 8, heightMm: -3,
    separationMm: 100, count: 6.9, diameterMm: 0.25, innerDiameterMm: 3,
    charge: 20, wavelengthNm: 100, focalLengthMm: 2000, unwanted: 'payload',
  };
  const p = normalizeParams(input);
  assert.equal(input.widthMm, 8, 'the caller state is never mutated');
  assert.equal(p.windowMm, 8);
  assert.equal(p.widthMm, 0.8);
  assert.equal(p.heightMm, 0.25);
  assert.equal(p.count, 7);
  assert.ok(p.separationMm >= p.widthMm);
  assert.ok((p.count - 1) * p.separationMm + p.widthMm <= 8);
  assert.equal(p.innerDiameterMm, 0.2);
  assert.equal(p.charge, 5);
  assert.equal(p.wavelengthNm, 380);
  assert.equal(p.focalLengthMm, 1000);
  assert.equal(own(p, 'unwanted'), false);
  assert.equal(normalizeParams({ widthMm: 0.8, separationMm: 0.25 }).separationMm, 0.8);
  assert.equal(normalizeParams({ preset: 'bad', wavelengthNm: Infinity, widthMm: NaN }).preset, DEFAULT_PARAMS.preset);
  assert.equal(normalizeParams({ wavelengthNm: Infinity }).wavelengthNm, DEFAULT_PARAMS.wavelengthNm);
  assert.equal(normalizeParams({ widthMm: NaN }).widthMm, DEFAULT_PARAMS.widthMm);
  assert.deepEqual(normalizeParams(Object.create({ widthMm: 0.5 })), DEFAULT_PARAMS);
  assert.deepEqual(normalizeView({ mode: 'linear', spanMm: 14, extra: true }), { mode: 'linear', spanMm: 16 });
  assert.deepEqual(normalizeView({ mode: 'bad', spanMm: NaN }), DEFAULT_VIEW);
});

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

test('switching from seven-slit grating to double slit restores the full spacing range', () => {
  const grating = normalizeParams({ preset: 'grating', count: 7, separationMm: 1.5 });
  assert.equal(grating.separationMm, 1.275, 'grating footprint clamps down to an offered slider value');
  assert.ok((grating.count - 1) * grating.separationMm + grating.widthMm <= grating.windowMm);
  const double = normalizeParams({ ...grating, preset: 'double', separationMm: 1.5 });
  assert.equal(double.count, 7, 'the prior preset keeps its control value');
  assert.equal(double.separationMm, 1.5, 'hidden slit count does not constrain the double slit');
  assert.equal(decodeHash(encodeHash(double)).params.separationMm, 1.5);
  assert.equal(deserializeSession(serializeSession(double)).params.separationMm, 1.5);
  assert.deepEqual(normalizeParams(grating), grating, 'repeated normalization is stable');

  const loaded = normalizeParams({ preset: 'grating', count: 7, separationMm: 1.28 });
  assert.equal(loaded.separationMm, 1.28, 'already valid fractional loaded spacing is retained');
  assert.deepEqual(decodeHash(encodeHash(loaded)).params, loaded);
  const arbitraryWidth = normalizeParams({ preset: 'grating', widthMm: 0.7131, count: 7, separationMm: 1.5 });
  assert.equal(arbitraryWidth.separationMm, 1.2);
  assert.ok((arbitraryWidth.count - 1) * arbitraryWidth.separationMm + arbitraryWidth.widthMm <= 8);
});

test('every parametric preset and supported view has a deterministic share-link round trip', () => {
  assert.equal(decodeHash(''), null);
  assert.equal(decodeHash('#'), null);
  for (const preset of PRESETS.filter((value) => value !== 'custom')) {
    for (const spanMm of [2, 4, 8, 16]) {
      const params = normalizeParams({
        ...DEFAULT_PARAMS, preset, widthMm: 0.7, heightMm: 3.5, separationMm: 1.35,
        count: 7, diameterMm: 2.6, innerDiameterMm: 1.7, charge: 3, wavelengthNm: 620, focalLengthMm: 700,
      });
      const view = { mode: 'linear', spanMm };
      const hash = encodeHash(params, view);
      assert.deepEqual(decodeHash(hash), { params, view });
      assert.equal(encodeHash(decodeHash(hash).params, decodeHash(hash).view), hash);
      assert.deepEqual(decodeHash(`${hash}&unknown=ignored&__proto__=payload`), { params, view });
    }
  }
  assert.throws(() => encodeHash({ preset: 'custom' }), /session file/);
  assert.throws(() => decodeHash('#v=1&p=custom'), /session file/);
});

test('damaged, ambiguous, and nonfinite share-link input fails clearly', () => {
  for (const hash of [
    '#v=2', '#p=double', '#v=1&v=1', '#v=1&w=532&w=600',
    '#v=1&w=NaN', '#v=1&w=Infinity', '#v=1&w=1e999', '#v=1&w=',
    '#v=1&w=0x10', '#v=1&w=%20', '#v=1&p=%zz', '#v=1&p=%FF',
    '#v=1&p=unsupported', '#v=1&m=bad', '#v=1&z=NaN',
  ]) assert.throws(() => decodeHash(hash), undefined, hash);
  assert.throws(() => decodeHash(null), /string/);
  assert.throws(() => decodeHash(`#v=1&x=${'a'.repeat(4096)}`), /large/);
  assert.equal(decodeHash('#v=1&w=900').params.wavelengthNm, 750);
  assert.deepEqual(decodeHash('#v=1').params, DEFAULT_PARAMS);
});

test('ordinary sessions round-trip only whitelisted state and view', () => {
  const params = { ...DEFAULT_PARAMS, preset: 'vortex', charge: 4, wavelengthNm: 450, injection: 'ignored' };
  const view = { mode: 'linear', spanMm: 8 };
  const text = serializeSession(params, view);
  assert.deepEqual(deserializeSession(text), { params: normalizeParams(params), view, mask: null });
  assert.equal(JSON.parse(text).version, 1);
  assert.equal(text.includes('injection'), false);
  const polluted = session({ params: JSON.parse('{"__proto__":{"polluted":true},"wavelengthNm":600}') });
  const loaded = deserializeSession(polluted);
  assert.equal(loaded.params.wavelengthNm, 600);
  assert.equal(own(loaded.params, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('custom sessions exactly reconstruct binary 512-square masks without mutating buffers', () => {
  const mask = Float32Array.from({ length: 512 * 512 }, (_, i) => i % 11 === 0 ? 1 : 0);
  const original = mask.slice();
  const params = { ...DEFAULT_PARAMS, preset: 'custom' };
  const text = serializeSession(params, DEFAULT_VIEW, mask);
  assert.ok(text.length < 400_000);
  const loaded = deserializeSession(text);
  assert.deepEqual(loaded.params, params);
  assert.deepEqual(loaded.view, DEFAULT_VIEW);
  assert.ok(loaded.mask instanceof Float32Array);
  assert.deepEqual(loaded.mask, mask);
  assert.deepEqual(mask, original);
  loaded.mask[0] = 0;
  assert.equal(mask[0], 1, 'the loaded mask owns its buffer');
});

test('session parsing rejects malformed schemas, excessive size, and invalid numeric types', () => {
  for (const text of [
    'not json', 'null', '[]', session({ version: 2 }), session({ version: '1' }),
    session({ params: [] }), session({ params: null }), session({ view: null }),
    session({ params: { wavelengthNm: 'NaN' } }), session({ params: { wavelengthNm: '532' } }),
    session({ params: { wavelengthNm: null } }), session({ params: { preset: 'unsupported' } }),
    session({ view: { mode: 'unknown' } }), session({ view: { spanMm: 'Infinity' } }),
    session({ mask: 'unexpected' }),
  ]) assert.throws(() => deserializeSession(text), undefined, text.slice(0, 100));
  assert.throws(() => deserializeSession('{}'.padEnd(2 * 1024 * 1024 + 1, ' ')), /2 MB/);
  assert.throws(() => deserializeSession(`{"x":"${'界'.repeat(700_000)}"}`), /2 MB/);
  assert.throws(() => serializeSession({ wavelengthNm: Infinity }), /numeric/);
  assert.throws(() => serializeSession({ focalLengthMm: NaN }), /numeric/);
});

test('custom sessions reject missing masks, bad dimensions, nonfinite transmission, and bad base64', () => {
  const params = { ...DEFAULT_PARAMS, preset: 'custom' };
  assert.throws(() => serializeSession(params), /exactly/);
  assert.throws(() => serializeSession(params, DEFAULT_VIEW, new Float32Array(256 * 256)), /exactly/);
  for (const value of [-0.1, 1.01, NaN, Infinity]) {
    const mask = new Float32Array(512 * 512);
    mask[17] = value;
    assert.throws(() => serializeSession(params, DEFAULT_VIEW, mask), /transmission/);
  }
  for (const mask of [null, [], 'AA==', 'A'.repeat(349_528), `${'A'.repeat(349_524)}@@==`]) {
    assert.throws(() => deserializeSession(session({ params, mask })), /mask/);
  }
  const encoded = JSON.parse(serializeSession(params, DEFAULT_VIEW, new Float32Array(512 * 512)));
  // A nonzero unused padding bit decodes to the same bytes but is not canonical.
  encoded.mask = `${encoded.mask.slice(0, -3)}B==`;
  assert.throws(() => deserializeSession(JSON.stringify(encoded)), /mask/);
});
