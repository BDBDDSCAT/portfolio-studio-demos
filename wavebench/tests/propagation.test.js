import test from 'node:test';
import assert from 'node:assert/strict';
import { propagateField, simulateExperiment } from '../src/propagation.js';

const METHODS = ['fresnel', 'angular-spectrum'];

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual), `Expected a finite value, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
}

function relativeClose(actual, expected, tolerance = 1e-10) {
  close(actual, expected, Math.max(Math.abs(expected), 1e-30) * tolerance);
}

function mode(n, kx, ky, amplitude = 1) {
  const real = new Float64Array(n * n);
  const imag = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const angle = (2 * Math.PI * (kx * x + ky * y)) / n;
      real[y * n + x] = amplitude * Math.cos(angle);
      imag[y * n + x] = amplitude * Math.sin(angle);
    }
  }
  return { real, imag };
}

function gaussian(n, windowMm, waistMm) {
  const real = new Float64Array(n * n);
  const imag = new Float64Array(n * n);
  const pitch = windowMm / n;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const radiusSquared = ((x - n / 2) * pitch) ** 2 + ((y - n / 2) * pitch) ** 2;
      real[y * n + x] = Math.exp(-radiusSquared / waistMm ** 2);
    }
  }
  return { real, imag };
}

function measuredWaist(intensity, n, pitch) {
  let total = 0;
  let secondMoment = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const value = intensity[y * n + x];
      total += value;
      secondMoment += value * ((x - n / 2) * pitch) ** 2;
    }
  }
  // For I(x,y) = I0 exp(-2 r²/w²), <x²> = w²/4.
  return 2 * Math.sqrt(secondMoment / total);
}

function warningCodes(result) {
  assert.ok(Array.isArray(result.diagnostics));
  for (const diagnostic of result.diagnostics) {
    assert.equal(typeof diagnostic.code, 'string');
    assert.equal(typeof diagnostic.message, 'string');
    assert.ok(['info', 'warning'].includes(diagnostic.level));
  }
  return result.diagnostics.map(({ code }) => code);
}

test('carrier-removed near-field propagation leaves a uniform complex plane wave unchanged', () => {
  const n = 128;
  const field = {
    real: new Float64Array(n * n).fill(0.8),
    imag: new Float64Array(n * n).fill(0.6),
  };
  for (const method of METHODS) {
    const result = propagateField(field, {
      n,
      windowMm: 4,
      wavelengthNm: 532,
      distanceMm: 300,
      method,
    });
    close(result.samplePitchMm, 4 / n);
    relativeClose(result.inputPower, 16);
    relativeClose(result.outputPower, 16);
    for (let i = 0; i < result.real.length; i += 1) {
      close(result.real[i], 0.8, 1e-12);
      close(result.imag[i], 0.6, 1e-12);
      close(result.intensity[i], 1, 1e-12);
      close(result.phase[i], Math.atan2(0.6, 0.8), 1e-7);
    }
  }
});

test('zero distance preserves every complex sample exactly without mutating or reusing input buffers', () => {
  const n = 32;
  const field = {
    real: Float64Array.from({ length: n * n }, (_, i) => 2 * Math.sin(i * 0.7)),
    imag: Float64Array.from({ length: n * n }, (_, i) => Math.cos(i * 0.19)),
  };
  const originalReal = field.real.slice();
  const originalImag = field.imag.slice();
  // The small pitch puts most of this field above the propagating cutoff.
  for (const method of METHODS) {
    const result = propagateField(field, {
      n,
      windowMm: 0.001,
      wavelengthNm: 532,
      distanceMm: 0,
      method,
    });
    assert.deepEqual(result.real, originalReal);
    assert.deepEqual(result.imag, originalImag);
    assert.notEqual(result.real, field.real);
    assert.notEqual(result.imag, field.imag);
    for (let i = 0; i < field.real.length; i += 1) {
      close(result.intensity[i], originalReal[i] ** 2 + originalImag[i] ** 2, 1e-12);
    }
    relativeClose(result.outputPower, result.inputPower, 1e-12);
    const codes = warningCodes(result);
    assert.ok(!codes.includes('evanescent-decay'));
    assert.ok(!codes.includes('evanescent-truncated'));
  }
  assert.deepEqual(field.real, originalReal);
  assert.deepEqual(field.imag, originalImag);
});

test('a tilted propagating plane wave acquires the analytic Fresnel or angular-spectrum phase', () => {
  const n = 128;
  const windowMm = 4;
  const wavelengthNm = 532;
  const wavelengthMm = wavelengthNm / 1e6;
  const distanceMm = 130;
  const kx = 5;
  const ky = -3;
  const field = mode(n, kx, ky, 2);
  const frequencySquared = (kx ** 2 + ky ** 2) / windowMm ** 2;
  for (const method of METHODS) {
    const result = propagateField(field, { n, windowMm, wavelengthNm, distanceMm, method });
    const angle =
      method === 'fresnel'
        ? -Math.PI * wavelengthMm * distanceMm * frequencySquared
        : ((2 * Math.PI) / wavelengthMm) *
          distanceMm *
          (Math.sqrt(1 - wavelengthMm ** 2 * frequencySquared) - 1);
    for (let i = 0; i < field.real.length; i += 1) {
      close(
        result.real[i],
        field.real[i] * Math.cos(angle) - field.imag[i] * Math.sin(angle),
        3e-10,
      );
      close(
        result.imag[i],
        field.real[i] * Math.sin(angle) + field.imag[i] * Math.cos(angle),
        3e-10,
      );
      close(result.intensity[i], 4, 1e-11);
    }
    const codes = warningCodes(result);
    assert.ok(!codes.includes('evanescent-decay'));
    assert.ok(!codes.includes('evanescent-truncated'));
  }
});

test('propagating spectra conserve area-weighted power and recover under forward/backward propagation', () => {
  const n = 128;
  const a = mode(n, 3, -2, 0.7);
  const b = mode(n, -7, 4, 0.3);
  const field = {
    real: a.real.map((value, i) => value + b.real[i]),
    imag: a.imag.map((value, i) => value + b.imag[i]),
  };
  const originalReal = field.real.slice();
  const originalImag = field.imag.slice();
  const params = { n, windowMm: 4, wavelengthNm: 532, distanceMm: 275 };
  for (const method of METHODS) {
    const forward = propagateField(field, { ...params, method });
    const backward = propagateField(forward, { ...params, distanceMm: -params.distanceMm, method });
    relativeClose(forward.inputPower, (0.7 ** 2 + 0.3 ** 2) * params.windowMm ** 2, 1e-11);
    relativeClose(forward.outputPower, forward.inputPower, 1e-11);
    relativeClose(backward.outputPower, forward.inputPower, 1e-11);
    for (let i = 0; i < field.real.length; i += 1) {
      close(backward.real[i], originalReal[i], 1e-11);
      close(backward.imag[i], originalImag[i], 1e-11);
    }
  }
  assert.deepEqual(field.real, originalReal);
  assert.deepEqual(field.imag, originalImag);
});

test('near-field intensity retains absolute brightness rather than normalizing its peak', () => {
  const n = 128;
  const params = { n, windowMm: 4, wavelengthNm: 532, distanceMm: 170 };
  const field = gaussian(n, params.windowMm, 0.2);
  const brighter = { real: field.real.map((value) => 3 * value), imag: field.imag.slice() };
  for (const method of METHODS) {
    const dim = propagateField(field, { ...params, method });
    const bright = propagateField(brighter, { ...params, method });
    relativeClose(bright.inputPower, 9 * dim.inputPower, 1e-11);
    relativeClose(bright.outputPower, 9 * dim.outputPower, 1e-11);
    for (let i = 0; i < dim.intensity.length; i += 1) {
      close(bright.intensity[i], 9 * dim.intensity[i], 1e-11);
      close(dim.intensity[i], dim.real[i] ** 2 + dim.imag[i] ** 2, 1e-12);
    }
  }
});

test('Fresnel propagation matches Gaussian-beam width, on-axis irradiance, and power', () => {
  const n = 256;
  const windowMm = 4;
  const wavelengthNm = 532;
  const waistMm = 0.2;
  const distanceMm = 350;
  const rayleighMm = (Math.PI * waistMm ** 2) / (wavelengthNm / 1e6);
  const expectedWaist = waistMm * Math.sqrt(1 + (distanceMm / rayleighMm) ** 2);
  const field = gaussian(n, windowMm, waistMm);
  const result = propagateField(field, {
    n,
    windowMm,
    wavelengthNm,
    distanceMm,
    method: 'fresnel',
  });
  relativeClose(measuredWaist(result.intensity, n, result.samplePitchMm), expectedWaist, 1e-7);
  relativeClose(result.intensity[(n / 2) * n + n / 2], (waistMm / expectedWaist) ** 2, 1e-7);
  relativeClose(result.inputPower, (Math.PI * waistMm ** 2) / 2, 1e-11);
  relativeClose(result.outputPower, result.inputPower, 1e-11);
});

test('angular spectrum agrees with Fresnel for a well-sampled paraxial Gaussian beam', () => {
  const n = 256;
  const params = { n, windowMm: 4, wavelengthNm: 532, distanceMm: 150 };
  const field = gaussian(n, params.windowMm, 0.2);
  const fresnel = propagateField(field, { ...params, method: 'fresnel' });
  const angular = propagateField(field, { ...params, method: 'angular-spectrum' });
  let error = 0;
  let energy = 0;
  for (let i = 0; i < field.real.length; i += 1) {
    error += (angular.real[i] - fresnel.real[i]) ** 2 + (angular.imag[i] - fresnel.imag[i]) ** 2;
    energy += fresnel.intensity[i];
  }
  assert.ok(
    Math.sqrt(error / energy) < 5e-6,
    `Relative complex-field error: ${Math.sqrt(error / energy)}`,
  );
  relativeClose(angular.outputPower, angular.inputPower, 1e-11);
});

test('Fraunhofer Gaussian irradiance and observation coordinates use the focal-plane physical scale', () => {
  const n = 256;
  const windowMm = 4;
  const wavelengthNm = 500;
  const focalLengthMm = 200;
  const waistMm = 0.3;
  const result = simulateExperiment(
    {
      preset: 'gaussian',
      method: 'fraunhofer',
      beamWaistMm: waistMm,
      windowMm,
      wavelengthNm,
      focalLengthMm,
      distanceMm: 17,
    },
    n,
  );
  const expectedPitch = ((wavelengthNm / 1e6) * focalLengthMm) / windowMm;
  const expectedWaist = ((wavelengthNm / 1e6) * focalLengthMm) / (Math.PI * waistMm);
  const center = (n / 2) * n + n / 2;
  close(result.inputPitchMm, windowMm / n);
  close(result.outputPitchMm, expectedPitch);
  close(result.outputSpanMm, n * expectedPitch);
  relativeClose(result.inputPower, (Math.PI * waistMm ** 2) / 2, 1e-11);
  relativeClose(result.outputPower, result.inputPower, 1e-11);
  relativeClose(
    result.intensity[center],
    ((Math.PI * waistMm ** 2) / ((wavelengthNm / 1e6) * focalLengthMm)) ** 2,
    1e-10,
  );
  relativeClose(measuredWaist(result.intensity, n, result.outputPitchMm), expectedWaist, 1e-9);
  close(result.normalizedIntensity[center], 1);
  const codes = warningCodes(result);
  assert.ok(!codes.includes('transfer-undersampled'));
  assert.ok(!codes.includes('evanescent-decay'));
  assert.ok(!codes.includes('evanescent-truncated'));
});

test('Fraunhofer doubling focal length quarters raw irradiance while conserving power; distance is irrelevant', () => {
  const n = 128;
  const params = {
    preset: 'gaussian',
    method: 'fraunhofer',
    beamWaistMm: 0.3,
    windowMm: 4,
    wavelengthNm: 532,
    focalLengthMm: 150,
  };
  const a = simulateExperiment({ ...params, distanceMm: 10 }, n);
  const b = simulateExperiment({ ...params, focalLengthMm: 300, distanceMm: 1000 }, n);
  const same = simulateExperiment({ ...params, distanceMm: 1000 }, n);
  close(b.outputPitchMm, 2 * a.outputPitchMm);
  relativeClose(b.outputPower, a.outputPower, 1e-11);
  assert.deepEqual(same.intensity, a.intensity);
  for (let i = 0; i < a.intensity.length; i += 1) {
    close(b.intensity[i], a.intensity[i] / 4, 1e-12);
    close(b.normalizedIntensity[i], a.normalizedIntensity[i], 1e-12);
  }
});

test('experiment Gaussian illumination multiplies aperture amplitude and zero waist represents a plane wave', () => {
  const n = 64;
  const windowMm = 4;
  const beamWaistMm = 0.5;
  const mask = new Float64Array(n * n).fill(0.5);
  const original = mask.slice();
  const params = {
    preset: 'custom',
    method: 'fresnel',
    windowMm,
    beamWaistMm,
    distanceMm: 0,
    wavelengthNm: 532,
  };
  const gaussianResult = simulateExperiment(params, n, mask);
  const planeResult = simulateExperiment({ ...params, beamWaistMm: 0 }, n, mask);
  const pureGaussian = simulateExperiment({ ...params, preset: 'gaussian' }, n);
  const center = (n / 2) * n + n / 2;
  close(gaussianResult.inputAmplitude[center], 0.5);
  close(planeResult.inputAmplitude[center], 0.5);
  for (let i = 0; i < mask.length; i += 1) {
    close(gaussianResult.inputAmplitude[i], pureGaussian.inputAmplitude[i] / 2, 1e-7);
    close(gaussianResult.intensity[i], pureGaussian.intensity[i] / 4, 1e-12);
    close(planeResult.intensity[i], 0.25, 1e-12);
    close(gaussianResult.inputPhase[i], 0, 1e-12);
  }
  assert.ok(pureGaussian.inputAmplitude[0] > 0, 'A pure Gaussian has no hard aperture cutoff');
  close(gaussianResult.inputPitchMm, windowMm / n);
  close(gaussianResult.outputPitchMm, windowMm / n);
  assert.deepEqual(mask, original);
});

test('empty experiments return finite zero raw and normalized intensity with zero power', () => {
  const n = 32;
  const mask = new Float64Array(n * n);
  for (const method of ['fraunhofer', ...METHODS]) {
    const result = simulateExperiment(
      { preset: 'custom', method, beamWaistMm: 0.2, distanceMm: 20 },
      n,
      mask,
    );
    assert.equal(result.inputPower, 0);
    assert.equal(result.outputPower, 0);
    for (const key of [
      'intensity',
      'normalizedIntensity',
      'real',
      'imag',
      'phase',
      'inputAmplitude',
      'inputPhase',
    ]) {
      assert.ok(
        result[key].every((value) => value === 0),
        `${method} ${key} must contain finite zeros`,
      );
    }
    const codes = warningCodes(result);
    assert.ok(!codes.includes('evanescent-decay'));
    assert.ok(!codes.includes('evanescent-truncated'));
  }
});

test('angular spectrum exponentially decays occupied evanescent waves and truncates them backwards', () => {
  const n = 128;
  const windowMm = 0.0128;
  const wavelengthNm = 532;
  const wavelengthMm = wavelengthNm / 1e6;
  const distanceMm = 0.0002;
  const kx = 32;
  const field = mode(n, kx, 0);
  const q = ((wavelengthMm * kx) / windowMm) ** 2;
  assert.ok(q > 1);
  const decay = Math.exp(((-2 * Math.PI) / wavelengthMm) * distanceMm * Math.sqrt(q - 1));
  const carrierPhase = ((-2 * Math.PI) / wavelengthMm) * distanceMm;
  const forward = propagateField(field, {
    n,
    windowMm,
    wavelengthNm,
    distanceMm,
    method: 'angular-spectrum',
  });
  for (let i = 0; i < field.real.length; i += 1) {
    close(
      forward.real[i],
      decay * (field.real[i] * Math.cos(carrierPhase) - field.imag[i] * Math.sin(carrierPhase)),
      1e-12,
    );
    close(
      forward.imag[i],
      decay * (field.real[i] * Math.sin(carrierPhase) + field.imag[i] * Math.cos(carrierPhase)),
      1e-12,
    );
    close(forward.intensity[i], decay ** 2, 1e-12);
  }
  relativeClose(forward.outputPower, forward.inputPower * decay ** 2, 1e-11);
  assert.ok(warningCodes(forward).includes('evanescent-decay'));
  const backward = propagateField(field, {
    n,
    windowMm,
    wavelengthNm,
    distanceMm: -distanceMm,
    method: 'angular-spectrum',
  });
  assert.ok(backward.intensity.every((value) => value < 1e-24));
  assert.ok(warningCodes(backward).includes('evanescent-truncated'));
});

test('diagnostics flag paraxial misuse, transfer undersampling, and boundary energy', () => {
  const n = 128;
  const wavelengthNm = 532;
  const kx = 15;
  const highAngle = propagateField(mode(n, kx, 0), {
    n,
    windowMm: ((wavelengthNm / 1e6) * kx) / 0.75,
    wavelengthNm,
    distanceMm: 0.001,
    method: 'fresnel',
  });
  assert.ok(warningCodes(highAngle).includes('paraxial-angle'));
  const wrapped = propagateField(gaussian(n, 4, 0.2), {
    n,
    windowMm: 4,
    wavelengthNm,
    distanceMm: 100000,
    method: 'fresnel',
  });
  const codes = warningCodes(wrapped);
  assert.ok(codes.includes('transfer-undersampled'));
  // Periodic propagation can recur at very long distances, so use a source
  // wider than the window to check actual border occupancy independently.
  const clipped = propagateField(gaussian(n, 4, 2.5), {
    n,
    windowMm: 4,
    wavelengthNm,
    distanceMm: 10,
    method: 'fresnel',
  });
  assert.ok(warningCodes(clipped).includes('border-energy'));
});

test('source sampling diagnostics flag coarse physical features and clear on a finer grid', () => {
  const geometries = [
    { preset: 'single', widthMm: 0.125, heightMm: 1.5 },
    { preset: 'double', widthMm: 0.125, heightMm: 1.5 },
    { preset: 'grating', widthMm: 0.125, heightMm: 1.5 },
    { preset: 'single', widthMm: 1.5, heightMm: 0.125 },
    { preset: 'gaussian', beamWaistMm: 0.1 },
    { preset: 'circle', diameterMm: 0.125 },
    { preset: 'vortex', diameterMm: 0.125, charge: 1 },
    { preset: 'annulus', diameterMm: 1.6, innerDiameterMm: 1.4 },
  ];
  for (const geometry of geometries) {
    const params = { ...geometry, windowMm: 8, method: 'fraunhofer' };
    const coarse = simulateExperiment(params, 256);
    const fine = simulateExperiment(params, 512);
    const warning = coarse.diagnostics.find(({ code }) => code === 'source-undersampled');
    assert.ok(warning, `${JSON.stringify(geometry)} should warn at 256 samples`);
    assert.equal(warning.level, 'warning');
    assert.match(warning.message, /heuristic, not an accuracy guarantee/);
    assert.ok(
      !warningCodes(fine).includes('source-undersampled'),
      `${JSON.stringify(geometry)} should clear at 512 samples`,
    );
  }
  const sixSamples = simulateExperiment({ preset: 'single', widthMm: 0.1875, windowMm: 8 }, 256);
  assert.ok(!warningCodes(sixSamples).includes('source-undersampled'));
});

test('source sampling check applies Gaussian illumination but does not infer custom mask geometry', () => {
  const n = 256;
  const mask = new Float32Array(n * n);
  mask[(n / 2) * n + n / 2] = 1;
  const params = {
    preset: 'custom',
    widthMm: 0.001,
    windowMm: 8,
    method: 'fresnel',
    distanceMm: 0,
  };
  const custom = simulateExperiment(params, n, mask);
  assert.ok(!warningCodes(custom).includes('source-undersampled'));
  const illuminated = simulateExperiment({ ...params, beamWaistMm: 0.1 }, n, mask);
  assert.ok(warningCodes(illuminated).includes('source-undersampled'));
});

test('propagation and experiment validation reject malformed fields and invalid physical domains', () => {
  const n = 32;
  const field = mode(n, 1, 0);
  const params = { n, windowMm: 4, wavelengthNm: 532, distanceMm: 10, method: 'fresnel' };
  for (const invalid of [
    { n: 30 },
    { windowMm: 0 },
    { windowMm: Infinity },
    { wavelengthNm: -1 },
    { wavelengthNm: NaN },
    { distanceMm: Infinity },
    { method: 'unknown' },
  ]) {
    assert.throws(() => propagateField(field, { ...params, ...invalid }));
  }
  assert.throws(() => propagateField({ real: new Float64Array(n), imag: field.imag }, params));
  assert.throws(() => propagateField({ real: field.real }, params));
  const nonfinite = field.real.slice();
  nonfinite[7] = NaN;
  assert.throws(() => propagateField({ real: nonfinite, imag: field.imag }, params));
  assert.throws(() => simulateExperiment({ method: 'unknown' }, n));
  assert.throws(() => simulateExperiment({ preset: 'gaussian', beamWaistMm: -1 }, n));
  assert.throws(() => simulateExperiment({ preset: 'gaussian', beamWaistMm: Infinity }, n));
  assert.throws(() => simulateExperiment({ method: 'fraunhofer', focalLengthMm: 0 }, n));
});
