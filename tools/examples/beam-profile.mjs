#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { simulateExperiment } from '../../wavebench/src/propagation.js';
import { fitTrace } from '../../tracefit/src/fit.js';

/** A synthetic field calculation followed by an independent parametric fit. */
export function analyzeBeam() {
  const parameters = { preset: 'gaussian', method: 'fresnel', beamWaistMm: 0.2, wavelengthNm: 532, distanceMm: 250, windowMm: 8 };
  const result = simulateExperiment(parameters, 512);
  const data = [];
  for (let col = 0; col < result.n; col += 1) {
    const x = (col - result.n / 2) * result.outputPitchMm;
    if (Math.abs(x) <= 1) data.push({ x, y: result.intensity[(result.n / 2) * result.n + col] });
  }
  const fit = fitTrace(data, { model: 'gaussian', peaks: 1 });
  if (!fit.converged) throw new Error(`Gaussian profile fit did not converge: ${fit.status}`);
  const wavelengthMm = parameters.wavelengthNm / 1e6;
  const rayleighMm = Math.PI * parameters.beamWaistMm ** 2 / wavelengthMm;
  const analyticRadiusMm = parameters.beamWaistMm * Math.sqrt(1 + (parameters.distanceMm / rayleighMm) ** 2);
  // Gaussian intensity exp(-2 x²/w²) has a fitted standard deviation sigma=w/2.
  const fittedRadiusMm = 2 * fit.parameters.peaks[0].width;
  const relativeRadiusError = Math.abs(fittedRadiusMm - analyticRadiusMm) / analyticRadiusMm;
  return {
    source: 'synthetic Fresnel-propagated Gaussian; not measured data',
    parameters,
    gridSize: result.n,
    inputPower: result.inputPower,
    outputPower: result.outputPower,
    analyticRadiusMm,
    fittedRadiusMm,
    relativeRadiusError,
    fit,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node tools/examples/beam-profile.mjs [new-output-directory]');
    const directory = resolve(process.argv[2] ?? 'beam-study');
    const study = analyzeBeam();
    await mkdir(directory);
    await writeFile(resolve(directory, 'study.json'), JSON.stringify(study, null, 2) + '\n');
    const csv = 'x_mm,intensity,fitted,residual\n' + study.fit.samples.map(({ x, y, fitted, residual }) => [x, y, fitted, residual].join(',')).join('\n') + '\n';
    await writeFile(resolve(directory, 'profile.csv'), csv);
    console.log(JSON.stringify({ directory, analyticRadiusMm: study.analyticRadiusMm, fittedRadiusMm: study.fittedRadiusMm, relativeRadiusError: study.relativeRadiusError }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
