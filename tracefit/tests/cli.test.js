import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
function run(args) { return spawnSync(process.execPath, ['bin/tracefit.js', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }); }
function directory(t) { const path = mkdtempSync(join(tmpdir(), 'tracefit-test-')); t.after(() => rmSync(path, { force: true, recursive: true })); return path; }
const input = ['fit', '--input', 'examples/gaussian.csv', '--x', 'wavelength_nm', '--y', 'intensity'];

test('CLI known-sigma fit is self-contained and fitted CSV residuals match the report', (t) => {
  const out = directory(t), result = run([...input, '--sigma', 'sigma_y', '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout), report = JSON.parse(readFileSync(join(out, 'fit.json'), 'utf8'));
  assert.equal(summary.converged, true);
  assert.equal(report.schemaVersion, 1); assert.equal(report.columns.x, 'wavelength_nm');
  assert.equal(report.covariance.mode, 'known-sigma'); assert.equal(report.covariance.valid, true);
  assert.ok(Math.abs(report.parameters.peaks[0].center - 545) < 0.5);
  const lines = readFileSync(join(out, 'fitted.csv'), 'utf8').trim().split('\n');
  assert.equal(lines.shift(), 'x,y,sigma,fitted,residual,source_line');
  assert.equal(lines.length, report.samples.length);
  lines.forEach((line, i) => {
    const [x, y, sigma, fitted, residual, sourceLine] = line.split(',').map(Number), sample = report.samples[i];
    assert.equal(x, sample.x); assert.equal(sigma, sample.sigma); assert.equal(sourceLine, sample.sourceLine);
    assert.equal(fitted, sample.fitted); assert.equal(residual, sample.residual);
    assert.ok(Math.abs((y - fitted) - residual) < 1e-14);
  });
});

test('CLI exports finite tiny-unit fit parameters while retaining unavailable covariance', (t) => {
  const base = directory(t), path = join(base, 'tiny-units.csv'), out = join(base, 'out');
  const rows = Array.from({ length: 81 }, (_, i) => {
    const x = (i - 40) / 10;
    return `${x * 1e-310},${Math.exp(-0.5 * x * x) + 0.001 * x}`;
  });
  writeFileSync(path, `x,y\n${rows.join('\n')}\n`);
  const result = run(['fit', '--input', path, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(out, 'fit.json'), 'utf8'));
  assert.equal(report.converged, true);
  assert.ok(Number.isFinite(report.parameters.slope));
  assert.ok(Math.abs(report.parameters.slope * 1e-310 - 0.001) < 1e-8);
  assert.equal(report.covariance.valid, false);
  assert.equal(report.covariance.reason, 'numerical-range');
  assert.ok(report.parameterTable.every(parameter => parameter.standardError === null));
  assert.ok(report.warnings.some(warning => warning.code === 'NUMERICAL_RANGE'));
  const lines = readFileSync(join(out, 'fitted.csv'), 'utf8').trim().split('\n').slice(1);
  assert.equal(lines.length, 81);
  assert.ok(lines.every(line => line.split(',').filter(value => value !== '').map(Number).every(Number.isFinite)));
});

test('unconverged CLI fit exits 3 and retains diagnostic output with invalid uncertainty', (t) => {
  const out = directory(t), result = run([...input, '--iterations', '1', '--starts', '1', '--out', out]);
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(readFileSync(join(out, 'fit.json'), 'utf8'));
  assert.equal(report.converged, false); assert.equal(report.covariance.valid, false);
  assert.ok(report.warnings.some((warning) => warning.code === 'NOT_CONVERGED'));
  assert.ok(report.parameterTable.every((parameter) => parameter.standardError === null));
  assert.ok(existsSync(join(out, 'fitted.csv')));
});

test('CLI protects prior results and rejects unknown flags and invalid integer domains', (t) => {
  const out = directory(t); writeFileSync(join(out, 'fit.json'), 'keep me');
  const blocked = run([...input, '--out', out]);
  assert.equal(blocked.status, 2); assert.match(blocked.stderr, /--force/);
  assert.equal(readFileSync(join(out, 'fit.json'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(out, 'fitted.csv')), false);
  assert.equal(run([...input, '--out', out, '--force']).status, 0);
  for (const flags of [['--mdoel', 'gaussian'], ['--peaks', '4'], ['--peaks', '1.5'], ['--iterations', '1001'], ['--starts', '21'], ['--peaks', '1', '--peaks', '2'], ['--sigma', 'absent']]) {
    assert.equal(run([...input, '--out', join(out, 'invalid'), ...flags]).status, 2, flags.join(' '));
  }
  assert.equal(existsSync(join(out, 'invalid')), false);
});

test('CLI help states covariance and exit-code semantics', () => {
  const result = run(['--help']); assert.equal(result.status, 0);
  assert.match(result.stdout, /known-error covariance/); assert.match(result.stdout, /3 fit did not converge/);
});

test('force cannot replace the input source or its symlink and hardlink aliases', (t) => {
  const base = directory(t), contents = readFileSync(join(root, 'examples/gaussian.csv'));
  for (const kind of ['same-path', 'directory-symlink', 'input-symlink', 'hardlink']) {
    const path = join(base, kind); mkdirSync(path);
    let source = join(path, 'original.csv'), out = path;
    if (kind === 'same-path' || kind === 'directory-symlink') source = join(path, 'fitted.csv');
    writeFileSync(source, contents);
    if (kind === 'directory-symlink') { out = join(base, 'linked-directory'); symlinkSync(path, out, 'dir'); }
    if (kind === 'input-symlink') { source = join(path, 'input.csv'); writeFileSync(join(path, 'fitted.csv'), contents); symlinkSync(join(path, 'fitted.csv'), source); }
    if (kind === 'hardlink') linkSync(source, join(path, 'fit.json'));
    const result = run(['fit', '--input', source, '--x', 'wavelength_nm', '--y', 'intensity', '--out', out, '--force']);
    assert.equal(result.status, 2, `${kind}: ${result.stdout}`);
    assert.match(result.stderr, /input source/);
    assert.deepEqual(readFileSync(source), contents, `${kind} must preserve original bytes`);
    if (kind !== 'hardlink') assert.equal(existsSync(join(path, 'fit.json')), false);
  }
});

test('invalid UTF-8 bytes are rejected even in an unselected text column', (t) => {
  const base = directory(t), path = join(base, 'invalid.csv');
  writeFileSync(path, Buffer.concat([Buffer.from('x,y,note\n0,1,'), Buffer.from([0xff]), Buffer.from('\n1,2,valid\n')]));
  const result = run(['fit', '--input', path, '--out', join(base, 'out')]);
  assert.equal(result.status, 2); assert.match(result.stderr, /encoding utf-8/i);
  assert.equal(existsSync(join(base, 'out')), false);
});
