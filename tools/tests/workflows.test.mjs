import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzeBeam } from '../examples/beam-profile.mjs';
import { auditCoating, coatingSchema } from '../examples/coating-audit.mjs';
import { auditCSV } from '../../runcheck/src/audit.js';

test('Wavebench complex-field calculation yields the independent analytic Gaussian radius through Tracefit', () => {
  const study = analyzeBeam();
  assert.ok(study.fit.converged);
  assert.ok(study.relativeRadiusError < 1e-5, `radius error: ${study.relativeRadiusError}`);
  assert.ok(Math.abs(study.outputPower / study.inputPower - 1) < 1e-12);
  assert.ok(Math.abs(study.fit.parameters.peaks[0].center) < 1e-7);
});

test('Thinfilm unrounded CSV passes Runcheck with byte provenance; corrupted data fails balance and key checks', async () => {
  const study = await auditCoating();
  assert.ok(study.report.passed);
  assert.equal(study.report.counts.records, 201);
  assert.equal(study.report.hashes.inputSha256, createHash('sha256').update(study.csv).digest('hex'));
  const lines = study.csv.trimEnd().split('\n');
  const row = lines[1].split(',');
  row[3] = String(Number(row[3]) + 0.01);
  lines[1] = row.join(',');
  lines.push(lines[2]);
  const damaged = auditCSV(lines.join('\n') + '\n', coatingSchema);
  assert.equal(damaged.passed, false);
  assert.ok(damaged.issueCounts.sum >= 1);
  assert.ok(damaged.issueCounts.unique >= 1);
  assert.ok(damaged.issueCounts.monotonic >= 1);
});
