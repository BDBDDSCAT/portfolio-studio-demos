#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wavelengthScan } from '../../thinfilm/src/thinfilm.js';
import { makeReport, renderReportHTML } from '../../runcheck/src/audit.js';

export const coatingSchema = {
  version: 1,
  columns: {
    run: { type: 'string', nullable: false },
    wavelength_nm: { type: 'number', min: 400, max: 800 },
    R: { type: 'number', min: -1e-12, max: 1 + 1e-12 },
    T: { type: 'number', min: -1e-12, max: 1 + 1e-12 },
    A: { type: 'number', min: -1e-12, max: 1 + 1e-12 },
  },
  extraColumns: 'reject',
  uniqueKeys: [['run', 'wavelength_nm']],
  monotonic: [{ column: 'wavelength_nm', groupBy: ['run'], strict: true }],
  sums: [{ columns: ['R', 'T', 'A'], target: 1, tolerance: 1e-10 }],
};

/** Audit unrounded synthetic coating data, preserving the exact generated CSV. */
export async function auditCoating() {
  const stack = { incident: 1, substrate: 1.5, layers: [{ n: Math.sqrt(1.5), k: 0, dNm: 550 / (4 * Math.sqrt(1.5)) }] };
  const options = { startNm: 400, stopNm: 800, points: 201, angleDeg: 0, polarization: 'unpolarized' };
  const scan = wavelengthScan(stack, options);
  const csv = 'run,wavelength_nm,R,T,A\n' + scan.rows.map(({ wavelengthNm, R, T, A }) => ['ar-design', wavelengthNm, R, T, A].join(',')).join('\n') + '\n';
  const schemaJSON = JSON.stringify(coatingSchema, null, 2) + '\n';
  const report = await makeReport(csv, schemaJSON);
  return { source: 'synthetic constant-index antireflection coating; not measured data', stack, options, csv, schemaJSON, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node tools/examples/coating-audit.mjs [new-output-directory]');
    const directory = resolve(process.argv[2] ?? 'coating-audit');
    const study = await auditCoating();
    await mkdir(directory);
    await Promise.all([
      writeFile(resolve(directory, 'coating.csv'), study.csv),
      writeFile(resolve(directory, 'schema.json'), study.schemaJSON),
      writeFile(resolve(directory, 'report.json'), JSON.stringify(study.report, null, 2) + '\n'),
      writeFile(resolve(directory, 'report.html'), renderReportHTML(study.report)),
      writeFile(resolve(directory, 'model.json'), JSON.stringify({ source: study.source, stack: study.stack, options: study.options }, null, 2) + '\n'),
    ]);
    console.log(JSON.stringify({ directory, passed: study.report.passed, records: study.report.counts.records, hashes: study.report.hashes }, null, 2));
    if (!study.report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
