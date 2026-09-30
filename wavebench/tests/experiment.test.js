import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, encodeHash, serializeSession } from '../src/state.js';
import { simulateExperiment } from '../src/propagation.js';
import {
  DEFAULT_EXPERIMENT, DEFAULT_DISPLAY, METHODS, GRID_SIZES, EXPERIMENT_PRESETS,
  normalizeExperiment, validateExperiment, encodeExperimentHash, decodeExperimentHash,
  serializeExperiment, deserializeExperiment, buildGridCsv, buildSectionCsv, buildManifest,
} from '../src/experiment.js';

const file = (changes = {}) => JSON.stringify({
  version: 2, params: { ...DEFAULT_EXPERIMENT }, view: { ...DEFAULT_DISPLAY }, mask: null, ...changes,
});

test('experiment controls normalize model, grids and Gaussian beam without mutating input', () => {
  assert.ok(Object.isFrozen(DEFAULT_EXPERIMENT));
  assert.ok(Object.isFrozen(DEFAULT_DISPLAY));
  assert.deepEqual(normalizeExperiment(), DEFAULT_EXPERIMENT);
  const source = { preset: 'gaussian', method: 'angular-spectrum', distanceMm: 3000, beamWaistMm: 0, gridSize: 1024, unwanted: true };
  const p = normalizeExperiment(source);
  assert.equal(source.distanceMm, 3000);
  assert.equal(p.preset, 'gaussian');
  assert.equal(p.method, 'angular-spectrum');
  assert.equal(p.distanceMm, 2000);
  assert.equal(p.beamWaistMm, 0.2);
  assert.equal(p.gridSize, 1024);
  assert.equal(Object.hasOwn(p, 'unwanted'), false);
  assert.equal(normalizeExperiment({ preset: 'gaussian', beamWaistMm: 0.01 }).beamWaistMm, 0.1);
  assert.equal(normalizeExperiment({ method: 'bad', gridSize: 300, distanceMm: NaN }).method, 'fraunhofer');
  assert.equal(normalizeExperiment({ gridSize: 300 }).gridSize, 512);
  assert.equal(normalizeExperiment({ beamWaistMm: -1 }).beamWaistMm, 0);
  assert.deepEqual(normalizeExperiment(Object.create({ preset: 'gaussian', method: 'fresnel' })), DEFAULT_EXPERIMENT);
});

test('strict imported parameters retain supplied physical values and reject changed domains', () => {
  assert.equal(validateExperiment({ preset: 'gaussian' }).beamWaistMm, 0.2);
  for (const input of [
    { method: 'unknown' }, { gridSize: 2048 }, { gridSize: '512' }, { preset: 'unknown' },
    { wavelengthNm: Infinity }, { distanceMm: NaN }, { beamWaistMm: '0.2' },
    { windowMm: 10 }, { distanceMm: 0 }, { distanceMm: 2001 }, { beamWaistMm: 3.1 },
    { preset: 'gaussian', beamWaistMm: 0 }, { preset: 'gaussian', beamWaistMm: 0.01 },
    { widthMm: 0.81 }, { count: 2.5 }, { preset: 'grating', count: 7, separationMm: 1.5 },
    { diameterMm: 0.5, innerDiameterMm: 0.49 }, { widthMm: 0.8, separationMm: 0.25 },
  ]) assert.throws(() => validateExperiment(input), undefined, JSON.stringify(input));
  const loaded = validateExperiment({ preset: 'grating', count: 7, separationMm: 1.28 });
  assert.equal(loaded.separationMm, 1.28);
  const prototype = validateExperiment(JSON.parse('{"__proto__":{"polluted":true},"method":"fresnel"}'));
  assert.equal(prototype.method, 'fresnel');
  assert.equal(Object.hasOwn(prototype, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('v2 URLs reproduce every analytic aperture, propagation model, grid and display', () => {
  assert.equal(decodeExperimentHash(''), null);
  assert.equal(decodeExperimentHash('#'), null);
  for (const preset of EXPERIMENT_PRESETS.filter((p) => p !== 'custom')) {
    for (const method of METHODS) {
      for (const gridSize of GRID_SIZES) {
        const params = normalizeExperiment({
          preset, method, gridSize, distanceMm: 183.5, beamWaistMm: 0.2,
          focalLengthMm: 650, wavelengthNm: 635, charge: 3, separationMm: 1.275,
        });
        const view = { mode: 'linear', spanMm: 8 };
        const hash = encodeExperimentHash(params, view);
        assert.ok(hash.startsWith('#v=2&'));
        assert.deepEqual(decodeExperimentHash(hash), { params, view });
        assert.equal(encodeExperimentHash(decodeExperimentHash(hash).params, view), hash);
      }
    }
  }
  assert.throws(() => encodeExperimentHash({ preset: 'custom' }), /experiment file/);
  assert.throws(() => decodeExperimentHash('#v=2&p=custom'), /experiment file/);
});

test('legacy v1 links and session files migrate to the original Fraunhofer experiment', () => {
  const params = { ...DEFAULT_PARAMS, preset: 'vortex', charge: 3, focalLengthMm: 600 };
  const view = { mode: 'linear', spanMm: 16 };
  const expected = { params: normalizeExperiment(params), view };
  assert.deepEqual(decodeExperimentHash(encodeHash(params, view)), expected);
  assert.deepEqual(deserializeExperiment(serializeSession(params, view)), { ...expected, mask: null });
  const mask = Float32Array.from({ length: 512 * 512 }, (_, i) => i % 7 === 0 ? 1 : 0);
  const old = deserializeExperiment(serializeSession({ ...params, preset: 'custom' }, view, mask));
  assert.equal(old.params.gridSize, 512);
  assert.equal(old.params.method, 'fraunhofer');
  assert.deepEqual(old.mask, mask);
});

test('URL inputs reject malformed encoding, ambiguity, unsupported model/grid, and altered science', () => {
  for (const hash of [
    '#v=3', '#p=double', '#v=2&v=2', '#v=2&t=fresnel&t=fraunhofer',
    '#v=2&t=maxwell', '#v=2&g=255', '#v=2&r=0', '#v=2&b=4',
    '#v=2&r=NaN', '#v=2&r=Infinity', '#v=2&w=1e999', '#v=2&g=',
    '#v=2&g=0x200', '#v=2&w=%20', '#v=2&t=%zz', '#v=2&t=%FF',
    '#v=2&p=gaussian&b=0', '#v=2&p=grating&n=7&s=1.5', '#v=2&m=bad', '#v=2&z=3',
  ]) assert.throws(() => decodeExperimentHash(hash), undefined, hash);
  assert.throws(() => decodeExperimentHash(null), /string/);
  assert.throws(() => decodeExperimentHash(`#v=2&x=${'a'.repeat(4096)}`), /large/);
  const good = encodeExperimentHash();
  assert.deepEqual(decodeExperimentHash(`${good}&unknown=x&__proto__=bad`), decodeExperimentHash(good));
});

test('v2 custom files exactly restore binary masks at each supported resolution under 2 MiB', () => {
  for (const gridSize of GRID_SIZES) {
    const mask = Float32Array.from({ length: gridSize * gridSize }, (_, i) => i % 13 === 0 ? 1 : 0);
    const original = mask.slice();
    const params = normalizeExperiment({ preset: 'custom', gridSize, method: 'fresnel', distanceMm: 200 });
    const view = { mode: 'log', spanMm: 8 };
    const text = serializeExperiment(params, view, mask);
    assert.ok(new TextEncoder().encode(text).length < 2 * 1024 * 1024);
    const loaded = deserializeExperiment(text);
    assert.deepEqual(loaded.params, params);
    assert.deepEqual(loaded.view, view);
    assert.ok(loaded.mask instanceof Float32Array);
    assert.deepEqual(loaded.mask, mask);
    assert.deepEqual(mask, original);
    loaded.mask[0] = 0;
    assert.equal(mask[0], 1, 'restored transmission owns a separate buffer');
  }
});

test('file validation rejects hostile schemas, mismatched mask grids and damaged transmissions', () => {
  for (const text of [
    'not JSON', 'null', '[]', file({ version: 3 }), file({ version: '2' }),
    file({ params: null }), file({ params: [] }), file({ view: null }),
    file({ params: { method: 'invalid' } }), file({ params: { gridSize: 2048 } }),
    file({ params: { wavelengthNm: '532' } }), file({ params: { distanceMm: null } }),
    file({ params: { distanceMm: -10 } }), file({ view: { spanMm: '8' } }),
    file({ mask: 'unexpected' }), file({ params: { preset: 'custom', gridSize: 256 }, mask: 'AA==' }),
  ]) assert.throws(() => deserializeExperiment(text), undefined, text.slice(0, 100));
  assert.throws(() => deserializeExperiment('{}'.padEnd(2 * 1024 * 1024 + 1, ' ')), /2 MB/);
  assert.throws(() => deserializeExperiment(`{"x":"${'界'.repeat(700_000)}"}`), /2 MB/);
  const params = normalizeExperiment({ preset: 'custom', gridSize: 256 });
  assert.throws(() => serializeExperiment(params), /exactly/);
  assert.throws(() => serializeExperiment(params, DEFAULT_DISPLAY, new Float32Array(512 * 512)), /exactly/);
  const mask = new Float32Array(256 * 256);
  for (const value of [-0.1, 1.01, NaN, Infinity]) {
    mask[2] = value;
    assert.throws(() => serializeExperiment(params, DEFAULT_DISPLAY, mask), /transmission/);
  }
  mask[2] = 0;
  const saved = JSON.parse(serializeExperiment(params, DEFAULT_DISPLAY, mask));
  saved.params.gridSize = 512;
  assert.throws(() => deserializeExperiment(JSON.stringify(saved)), /dimensions/);
  saved.params.gridSize = 256;
  saved.mask = `${saved.mask.slice(0, -3)}B==`;
  assert.throws(() => deserializeExperiment(JSON.stringify(saved)), /encoding/);
});

function resultFixture() {
  return {
    n: 4,
    inputPitchMm: 2,
    outputPitchMm: 0.5,
    outputSpanMm: 2,
    intensity: Float64Array.from({ length: 16 }, (_, i) => i + 1),
    normalizedIntensity: Float64Array.from({ length: 16 }, (_, i) => (i + 1) / 16),
    phase: Float64Array.from({ length: 16 }, (_, i) => i / 10),
    inputPower: 2,
    outputPower: 1.9,
    diagnostics: [{ code: 'sampling', level: 'warning', message: 'Sampling diagnostic.', privateBuffer: [1, 2] }],
  };
}

test('grid and y=0 section CSV export raw numerical data with centered native coordinates', () => {
  const result = resultFixture();
  const lines = buildGridCsv(result).trim().split('\n');
  assert.equal(lines[0], 'x_mm,y_mm,intensity,normalized_intensity,phase_rad');
  assert.equal(lines.length, 17);
  assert.equal(lines[1], '-1,-1,1,0.0625,0');
  assert.equal(lines[11], '0,0,11,0.6875,1');
  assert.equal(lines[16], '0.5,0.5,16,1,1.5');
  const section = buildSectionCsv(result, 1).trim().split('\n');
  assert.deepEqual(section, [
    'x_mm,intensity,normalized_intensity,phase_rad',
    '-0.5,10,0.625,0.9', '0,11,0.6875,1', '0.5,12,0.75,1.1',
  ]);
  assert.equal(buildSectionCsv(result).trim().split('\n').length, 5);
  assert.throws(() => buildSectionCsv(result, NaN), /span/);
  assert.throws(() => buildGridCsv({ ...result, intensity: [] }), /dimensions/);
  assert.throws(() => buildGridCsv({ ...result, outputPitchMm: 0 }), /pitch/);
  result.intensity[3] = NaN;
  assert.throws(() => buildGridCsv(result), /samples/);
});

test('manifest records model, units and power diagnostics without copying numerical arrays', () => {
  const result = { ...resultFixture(), n: 256, inputPitchMm: 8 / 256, outputPitchMm: 8 / 256, outputSpanMm: 8 };
  const params = normalizeExperiment({ method: 'angular-spectrum', distanceMm: 150, gridSize: 256 });
  const manifest = buildManifest(params, result);
  assert.equal(manifest.version, 2);
  assert.equal(manifest.model, 'angular-spectrum');
  assert.equal(manifest.params.distanceMm, 150);
  assert.equal(manifest.grid.size, 256);
  assert.equal(manifest.grid.outputPitchMm, 8 / 256);
  assert.equal(manifest.units.coordinates, 'mm');
  assert.equal(manifest.units.phase, 'rad');
  assert.equal(manifest.power.input, 2);
  assert.equal(manifest.power.output, 1.9);
  assert.ok(Math.abs(manifest.power.relativeChange + 0.05) < 1e-12);
  assert.deepEqual(manifest.diagnostics, [{ code: 'sampling', level: 'warning', message: 'Sampling diagnostic.' }]);
  const encoded = JSON.stringify(manifest);
  assert.equal(encoded.includes('normalizedIntensity'), false);
  assert.equal(encoded.includes('privateBuffer'), false);
  assert.equal(buildManifest(params, { ...result, inputPower: 0, outputPower: 0 }).power.relativeChange, null);
});

test('manifest uses the separately supplied numerical grid and rejects contradictory settings', () => {
  const params = { preset: 'double', method: 'fresnel', distanceMm: 100 };
  const result = simulateExperiment(params, 256);
  const manifest = buildManifest(params, result);
  assert.equal(Object.hasOwn(params, 'gridSize'), false, 'the caller parameters are not mutated');
  assert.equal(manifest.params.gridSize, 256);
  assert.equal(manifest.grid.size, 256);
  assert.equal(manifest.grid.inputPitchMm, 8 / 256);
  const imported = deserializeExperiment(serializeExperiment(manifest.params));
  const replay = simulateExperiment(imported.params, imported.params.gridSize);
  assert.equal(replay.n, result.n);
  assert.deepEqual(replay.intensity, result.intensity, 'the manifest parameters reproduce the calculated field');
  assert.throws(() => buildManifest({ ...params, gridSize: 512 }, result), /does not match/);
  assert.throws(() => buildManifest(params, resultFixture()), /256, 512, or 1024/);
});
