import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeExperiment, DEFAULT_EXPERIMENT, DEFAULT_DISPLAY } from '../src/experiment.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const executable = resolve(root, 'bin/wavebench.js');

function cli(args) {
  return spawnSync(process.execPath, [executable, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
}

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wavebench-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function csv(path) {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  return { header, rows: rows.map((row) => row.split(',').map(Number)) };
}

function success(run) {
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  return JSON.parse(run.stdout);
}

function close(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
}

test('CLI exports a complete physical field with conserved power and native coordinates', (t) => {
  const out = temporary(t);
  const summary = success(cli([
    'simulate', '--preset', 'gaussian', '--method', 'angular-spectrum',
    '--distance', '100', '--wavelength', '532', '--waist', '0.2', '--grid', '256', '--out', out,
  ]));
  assert.equal(summary.grid, 256);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.model, 'angular-spectrum');
  assert.equal(manifest.params.distanceMm, 100);
  assert.equal(manifest.params.beamWaistMm, 0.2);
  assert.equal(manifest.units.phase, 'rad');
  assert.equal(manifest.units.coordinates, 'mm');
  assert.ok(Array.isArray(manifest.diagnostics));
  const field = csv(join(out, 'field.csv'));
  assert.equal(field.header, 'x_mm,y_mm,intensity,normalized_intensity,phase_rad');
  assert.equal(field.rows.length, 256 * 256);
  assert.ok(field.rows.every((row) => row.length === 5 && row.every(Number.isFinite)));
  close(field.rows[0][0], -4, 1e-12);
  close(field.rows[0][1], -4, 1e-12);
  close(field.rows.at(-1)[0], 4 - 8 / 256, 1e-12);
  const area = manifest.grid.outputPitchMm ** 2;
  const csvPower = field.rows.reduce((sum, row) => sum + row[2] * area, 0);
  close(csvPower, manifest.power.output, 1e-12);
  close(manifest.power.output / manifest.power.input, 1, 1e-10);
  const center = field.rows[(128 * 256) + 128];
  assert.ok(center[2] > 0 && center[2] < 1, 'Raw intensity must preserve Gaussian beam spreading.');
  close(center[3], 1, 1e-10);
  const section = csv(join(out, 'section.csv'));
  assert.equal(section.header, 'x_mm,intensity,normalized_intensity,phase_rad');
  assert.equal(section.rows.length, 256);
  assert.deepEqual(section.rows[128], [center[0], ...center.slice(2)]);
  assert.equal(summary.files['field.csv'], join(out, 'field.csv'));
});

test('CLI scan preserves per-plane intensities and agrees with Gaussian diffraction scaling', (t) => {
  const out = temporary(t);
  const summary = success(cli([
    'scan', '--preset', 'gaussian', '--method', 'fresnel', '--waist', '0.2',
    '--start', '10', '--stop', '500', '--steps', '3', '--grid', '256', '--out', out,
  ]));
  assert.equal(summary.steps, 3);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.scan.steps, 3);
  assert.equal(manifest.scan.sampleCount, 3 * 256);
  assert.equal(manifest.params.distanceMm, 10);
  assert.equal(manifest.scan.planes.length, 3);
  const data = csv(join(out, 'scan.csv'));
  assert.equal(data.header, 'z_mm,x_mm,intensity,normalized_intensity,phase_rad');
  assert.equal(data.rows.length, 3 * 256);
  const peaks = [];
  for (let plane = 0; plane < 3; plane += 1) {
    const rows = data.rows.slice(plane * 256, (plane + 1) * 256);
    const z = [10, 255, 500][plane];
    assert.ok(rows.every((row) => row[0] === z));
    assert.equal(rows[128][1], 0);
    close(rows[128][3], 1, 1e-10);
    peaks.push(rows[128][2]);
    const total = rows.reduce((sum, row) => sum + row[2], 0);
    const secondMoment = rows.reduce((sum, row) => sum + row[1] ** 2 * row[2], 0) / total;
    const rayleighMm = Math.PI * 0.2 ** 2 / 0.000532;
    const expectedRmsMm = 0.2 * Math.sqrt(1 + (z / rayleighMm) ** 2) / 2;
    close(Math.sqrt(secondMoment), expectedRmsMm, 0.00001);
    const power = manifest.scan.planes[plane];
    close(power.outputPower / power.inputPower, 1, 1e-10);
  }
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2]);
});

test('existing output files are protected; force explicitly replaces them', (t) => {
  const out = temporary(t);
  writeFileSync(join(out, 'field.csv'), 'preserve this file');
  const args = ['simulate', '--grid', '256', '--out', out];
  const failed = cli(args);
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /already exists.*--force/);
  assert.equal(readFileSync(join(out, 'field.csv'), 'utf8'), 'preserve this file');
  assert.equal(existsSync(join(out, 'manifest.json')), false);
  success(cli([...args, '--force']));
  assert.match(readFileSync(join(out, 'field.csv'), 'utf8'), /^x_mm,y_mm,intensity/);
});

test('a smaller circle adjusts its unused inner-diameter default without changing the requested diameter', (t) => {
  const out = temporary(t);
  success(cli(['simulate', '--preset', 'circle', '--diameter', '0.5', '--grid', '256', '--out', out]));
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.params.preset, 'circle');
  assert.equal(manifest.params.diameterMm, 0.5);
  assert.ok(manifest.params.innerDiameterMm < 0.5);
});

test('CLI rejects invalid domains, unknown options, duplicates, and irrelevant model flags', (t) => {
  const out = temporary(t);
  const invalid = [
    ['--unknown', '1'], ['--constructor', '2'], ['--grid', '128'],
    ['--wavelength', 'NaN'], ['--wavelength', 'Infinity'], ['--wavelength', '1e999'],
    ['--wavelength', '0x210'], ['--wavelength', '751'], ['--window', '16'],
    ['--count', '2.5'], ['--count', '8'], ['--grid', '256', '--grid', '512'],
    ['--method', 'unknown'], ['--preset', 'unknown'], ['--preset', 'custom'],
    ['--preset', 'gaussian', '--waist', '0'], ['--preset', 'annulus', '--inner', '2'],
    ['--distance', '10'], ['--method', 'fresnel', '--distance', '0'],
    ['--method', 'fresnel', '--focal', '500'], ['--start', '10'], ['--force=true'],
  ];
  for (const args of invalid) {
    const run = cli(['simulate', '--out', join(out, 'invalid'), ...args]);
    assert.equal(run.status, 2, `${args.join(' ')} unexpectedly passed: ${run.stdout}`);
    assert.match(run.stderr, /^wavebench: /);
    assert.equal(run.stdout, '');
  }
  for (const args of [
    ['--method', 'fraunhofer'], ['--start', '500', '--stop', '10'],
    ['--steps', '1'], ['--distance', '100'], ['--stop', '2001'],
  ]) {
    const run = cli(['scan', '--out', join(out, 'invalid'), ...args]);
    assert.equal(run.status, 2, `${args.join(' ')} unexpectedly passed`);
  }
  assert.equal(existsSync(join(out, 'invalid')), false);
});

test('portable custom sessions preserve mask samples and reject a mismatched grid', (t) => {
  const directory = temporary(t);
  const path = join(directory, 'custom.json');
  const mask = new Float32Array(256 * 256).fill(1);
  writeFileSync(path, serializeExperiment({
    ...DEFAULT_EXPERIMENT, preset: 'custom', method: 'angular-spectrum', gridSize: 256,
  }, DEFAULT_DISPLAY, mask));
  const out = join(directory, 'results');
  const summary = success(cli(['simulate', '--session', path, '--distance', '10', '--out', out]));
  assert.equal(summary.preset, 'custom');
  assert.equal(summary.grid, 256);
  close(summary.inputPower, 64, 1e-12);
  close(summary.outputPower, 64, 1e-12);
  const failed = cli(['simulate', '--session', path, '--grid', '512', '--out', join(directory, 'bad')]);
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /use --grid 256/);
  assert.equal(existsSync(join(directory, 'bad')), false);
});

test('CLI help explains units and file protection without producing output files', () => {
  for (const args of [['--help'], ['simulate', '-h'], ['scan', '--help'], ['help']]) {
    const run = cli(args);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /lengths in mm except wavelength in nm/);
    assert.match(run.stdout, /--force/);
    assert.match(run.stdout, /scan/);
  }
});
