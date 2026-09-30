import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiffraction, fft2d, makeAperture } from '../src/optics.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function sinc(value) {
  return value === 0 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
}

test('FFT impulse, complex frequency, and inverse use consistent DFT conventions', () => {
  const n = 8;
  const real = new Float64Array(n * n);
  const imag = new Float64Array(n * n);
  real[0] = 1;
  fft2d(real, imag, n);
  for (let i = 0; i < real.length; i += 1) {
    close(real[i], 1);
    close(imag[i], 0);
  }
  fft2d(real, imag, n, true);
  close(real[0], 1);
  for (let i = 1; i < real.length; i += 1) close(real[i], 0);

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const angle = 2 * Math.PI * (2 * x + 3 * y) / n;
      real[y * n + x] = Math.cos(angle);
      imag[y * n + x] = Math.sin(angle);
    }
  }
  fft2d(real, imag, n);
  for (let i = 0; i < real.length; i += 1) {
    close(real[i], i === 3 * n + 2 ? n * n : 0, 1e-12);
    close(imag[i], 0, 1e-12);
  }
});

test('2D FFT obeys Parseval and reconstructs a nontrivial complex aperture', () => {
  const n = 32;
  const originalReal = Float64Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.7) + Math.cos(i * 0.13));
  const originalImag = Float64Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.19));
  const real = originalReal.slice();
  const imag = originalImag.slice();
  const energy = originalReal.reduce((sum, value, i) => sum + value ** 2 + originalImag[i] ** 2, 0);
  fft2d(real, imag, n);
  const transformedEnergy = real.reduce((sum, value, i) => sum + value ** 2 + imag[i] ** 2, 0);
  close(transformedEnergy / (n * n), energy, energy * 1e-12);
  fft2d(real, imag, n, true);
  for (let i = 0; i < real.length; i += 1) {
    close(real[i], originalReal[i], 1e-12);
    close(imag[i], originalImag[i], 1e-12);
  }
});

test('single slit follows sinc squared with zeros at wavelength times focal length over width', () => {
  const result = computeDiffraction({
    preset: 'single', windowMm: 8, widthMm: 1, heightMm: 3,
    wavelengthNm: 500, focalLengthMm: 500,
  });
  const center = result.n / 2;
  close(result.samplePitchMm, 8 / 512);
  close(result.observationPitchMm, 0.03125);
  close(result.observationSpanMm, 16);
  close(8 * result.observationPitchMm, 0.25);
  close(result.cut[center], 1);
  assert.ok(result.cut[center + 8] < 1e-20);
  assert.ok(result.cut[center + 16] < 1e-20);
  for (let k = 1; k <= 20; k += 1) {
    close(result.cut[center + k], sinc(k / 8) ** 2, 0.0004);
    close(result.cut[center - k], result.cut[center + k]);
  }
});

test('double slit fringe spacing uses center-to-center separation', () => {
  const result = computeDiffraction({
    preset: 'double', windowMm: 8, widthMm: 0.25, heightMm: 3,
    separationMm: 1, wavelengthNm: 500, focalLengthMm: 500,
  });
  const center = result.n / 2;
  const fringeSpacingMm = 500 / 1e6 * 500 / 1;
  close(8 * result.observationPitchMm, fringeSpacingMm);
  assert.ok(result.cut[center + 4] < 1e-20);
  assert.ok(result.cut[center + 12] < 1e-20);
  for (let k = 0; k <= 20; k += 1) {
    const expected = sinc(0.25 * k / 8) ** 2 * Math.cos(Math.PI * k / 8) ** 2;
    close(result.cut[center + k], expected, 0.003);
  }
});

test('circular aperture has Airy first zero and rotational/reflection symmetry', () => {
  const firstBesselZero = 3.8317059702075125;
  const diameterMm = (firstBesselZero / Math.PI) * 8 / 8;
  const result = computeDiffraction({ preset: 'circle', windowMm: 8, diameterMm });
  const center = result.n / 2;
  const at = (x, y) => result.intensity[(center + y) * result.n + center + x];
  assert.ok(at(8, 0) < 0.000004, `Airy first zero should be dark, got ${at(8, 0)}`);
  assert.ok(at(7, 0) > 0.0001);
  assert.ok(at(9, 0) > 0.0001);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      close(at(x, y), at(y, x), 1e-12);
      close(at(x, y), at(-x, y), 1e-12);
      close(at(x, y), at(x, -y), 1e-12);
    }
  }
});

test('vortex phase suppresses on-axis light; zero charge recovers the circular aperture', () => {
  const positive = computeDiffraction({ preset: 'vortex', charge: 1 });
  const negative = computeDiffraction({ preset: 'vortex', charge: -1 });
  const center = positive.n / 2;
  assert.ok(positive.cut[center] < 1e-20);
  assert.ok(positive.cut[center + 5] > 0.05);
  for (let i = 0; i < positive.intensity.length; i += 1) {
    close(positive.intensity[i], negative.intensity[i], 1e-12);
  }
  const zero = makeAperture({ preset: 'vortex', charge: 0 }, 64);
  const circle = makeAperture({ preset: 'circle' }, 64);
  assert.deepEqual(zero, circle);
});

test('custom masks preserve transmission, input buffers, and finite all-black results', () => {
  const n = 32;
  const black = new Float32Array(n * n);
  const zero = computeDiffraction({ preset: 'custom' }, n, black);
  assert.equal(zero.totalPower, 0);
  assert.ok(zero.intensity.every((value) => value === 0));
  assert.ok(zero.phase.every((value) => value === 0));
  assert.ok(zero.amplitude.every((value) => value === 0));

  const point = black.slice();
  point[(n / 2) * n + n / 2] = 0.5;
  const result = computeDiffraction({ preset: 'custom', windowMm: 8 }, n, point);
  close(result.totalPower, 0.25 * (8 / n) ** 2);
  assert.ok(result.intensity.every((value) => value === 1));
  assert.equal(result.amplitude[(n / 2) * n + n / 2], 0.5);
  assert.equal(point[(n / 2) * n + n / 2], 0.5);
});

test('overlapping slits form a union, annuli exclude their center, and invalid domains fail clearly', () => {
  const overlapped = makeAperture({ preset: 'grating', count: 8, separationMm: 0.1, widthMm: 0.5 }, 64);
  assert.ok(overlapped.real.every((value) => value >= 0 && value <= 1));
  const annulus = makeAperture({ preset: 'annulus' }, 64);
  assert.equal(annulus.real[32 * 64 + 32], 0);
  assert.throws(() => makeAperture({}, 30), /power of two/);
  assert.throws(() => makeAperture({ windowMm: 0 }), /positive/);
  assert.throws(() => makeAperture({ wavelengthNm: NaN }), /positive/);
  assert.throws(() => makeAperture({ preset: 'unknown' }), /Unknown/);
  assert.throws(() => makeAperture({ preset: 'grating', count: 2.5 }), /count/);
  assert.throws(() => makeAperture({ preset: 'annulus', innerDiameterMm: 2 }), /Inner diameter/);
  assert.throws(() => makeAperture({ preset: 'vortex', charge: 0.5 }), /charge/);
  assert.throws(() => makeAperture({ preset: 'custom', mask: [1] }, 4), /exactly/);
  assert.throws(() => makeAperture({ preset: 'custom', mask: Array(16).fill(-1) }, 4), /transmission/);
});
