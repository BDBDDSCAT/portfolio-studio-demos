/**
 * Reusable scalar Fourier-optics propagation, with millimetres as the length
 * unit. These routines preserve complex fields and do not normalize their
 * intensity. The omitted exp(i k z) carrier is a spatially uniform phase.
 *
 * Near-field FFT propagation is periodic on a fixed square grid: a result is
 * not an unbounded-space solution unless the window and sampling are adequate.
 * Diagnostics flag selected risks, not convergence or a guaranteed error bound.
 */
import { fft2d, makeAperture } from './optics.js';

const TWO_PI = 2 * Math.PI;
const SIGNIFICANT_SPECTRUM = 1e-6;
const BORDER_FRACTION = 0.05;
const BORDER_POWER_THRESHOLD = 0.01;
const MIN_SOURCE_SAMPLES = 6;

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be finite and positive.`);
}

function validateGrid(n, windowMm, wavelengthNm) {
  if (!Number.isInteger(n) || n < 2 || n > 2048 || (n & (n - 1)) !== 0) {
    throw new RangeError('Grid size must be a power of two between 2 and 2048.');
  }
  positive(windowMm, 'Window size');
  positive(wavelengthNm, 'Wavelength');
  const samplePitchMm = windowMm / n;
  const wavelengthMm = wavelengthNm / 1e6;
  const waveNumber = TWO_PI / wavelengthMm;
  if (
    !(samplePitchMm > 0) ||
    !Number.isFinite(1 / samplePitchMm) ||
    !(wavelengthMm > 0) ||
    !Number.isFinite(waveNumber)
  ) {
    throw new RangeError('Grid and wavelength are outside the representable numerical range.');
  }
  return { samplePitchMm, wavelengthMm, waveNumber };
}

function copyField(field, n) {
  if (
    !field ||
    !field.real ||
    !field.imag ||
    field.real.length !== n * n ||
    field.imag.length !== n * n
  ) {
    throw new RangeError('Complex field buffers must each contain N squared samples.');
  }
  const real = new Float64Array(n * n);
  const imag = new Float64Array(n * n);
  for (let i = 0; i < real.length; i += 1) {
    if (!Number.isFinite(field.real[i]) || !Number.isFinite(field.imag[i])) {
      throw new RangeError('Complex field samples must be finite numbers.');
    }
    real[i] = field.real[i];
    imag[i] = field.imag[i];
  }
  return { real, imag };
}

function measureField(real, imag, pitch) {
  const intensity = new Float64Array(real.length);
  const phase = new Float32Array(real.length);
  let sum = 0;
  for (let i = 0; i < real.length; i += 1) {
    const value = real[i] * real[i] + imag[i] * imag[i];
    intensity[i] = value;
    phase[i] = value > 0 ? Math.atan2(imag[i], real[i]) : 0;
    sum += value;
  }
  const power = sum * pitch * pitch;
  if (!Number.isFinite(sum) || !Number.isFinite(power))
    throw new RangeError('Field power exceeds the representable numerical range.');
  return { intensity, phase, power, sum };
}

function borderEnergy(intensity, n) {
  const border = Math.max(1, Math.floor(n * BORDER_FRACTION));
  let total = 0;
  let edge = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const value = intensity[y * n + x];
      total += value;
      if (x < border || x >= n - border || y < border || y >= n - border) edge += value;
    }
  }
  return total > 0 ? edge / total : 0;
}

function borderDiagnostic(input, output, n, fourierPlane = false) {
  const inputFraction = borderEnergy(input, n);
  const outputFraction = fourierPlane ? 0 : borderEnergy(output, n);
  if (Math.max(inputFraction, outputFraction) <= BORDER_POWER_THRESHOLD) return null;
  return {
    code: 'border-energy',
    level: 'warning',
    message: fourierPlane
      ? `${(100 * inputFraction).toFixed(2)}% of input intensity is in the outer 5% grid border. The finite aperture window may truncate the source; enlarge it and check convergence.`
      : `Input/output border intensity fractions are ${(100 * inputFraction).toFixed(2)}% / ${(100 * outputFraction).toFixed(2)}% in the outer 5% grid border. FFT propagation assumes periodic boundaries, so an isolated field can wrap across edges. Enlarge the window and check convergence; an intentional periodic plane wave is an exception.`,
  };
}

function sourceDiagnostic(params, pitch) {
  const features = [];
  if (params.beamWaistMm > 0) features.push(['Gaussian field waist', params.beamWaistMm]);
  if (['single', 'double', 'grating'].includes(params.preset)) {
    features.push(['Slit width', params.widthMm], ['Slit height', params.heightMm]);
  } else if (params.preset === 'circle' || params.preset === 'vortex') {
    features.push(['Aperture diameter', params.diameterMm]);
  } else if (params.preset === 'annulus') {
    features.push(['Annulus radial thickness', (params.diameterMm - params.innerDiameterMm) / 2]);
  }
  // Unknown structure in custom raster masks is not inferred from its edges.
  const coarse = features
    .map(([name, width]) => [name, width / pitch])
    .filter(([, samples]) => samples < MIN_SOURCE_SAMPLES);
  if (coarse.length === 0) return null;
  return {
    code: 'source-undersampled',
    level: 'warning',
    message: `${coarse.map(([name, samples]) => `${name}: ${samples.toFixed(2)} input samples`).join('; ')}. Source features below ${MIN_SOURCE_SAMPLES} samples may be poorly resolved. This is a heuristic, not an accuracy guarantee; increase the grid size at fixed window and check convergence.`,
  };
}

// Stable evaluation avoids cancellation in sqrt(1-s) - 1 at small angles.
function relativePhase(s, method, carrierPhase) {
  if (method === 'fresnel') return -0.5 * carrierPhase * s;
  return (-carrierPhase * s) / (1 + Math.sqrt(Math.max(0, 1 - s)));
}

/**
 * Propagate a sampled complex scalar field without changing its input buffers.
 *
 * Fresnel: H = exp(-i pi lambda z (fx² + fy²)).
 * Angular spectrum: H = exp(i k z (sqrt(1-lambda² f²) - 1)).
 * For forward z, evanescent modes decay exp(-k z sqrt(lambda² f²-1));
 * they also carry exp(-i k z) in this carrier-relative convention. For negative
 * z they are discarded rather than exponentially amplified. At z=0 every
 * sample is preserved exactly, including evanescent content.
 *
 * Powers are dx² sum(|U|²); they are a sampled field norm, not calibrated watts
 * or a full electromagnetic flux measurement for evanescent/high-angle fields.
 */
export function propagateField(field, options = {}) {
  if (options == null || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Propagation options must be an object.');
  const {
    n = 512,
    windowMm = 8,
    wavelengthNm = 532,
    distanceMm = 100,
    method = 'fresnel',
  } = options;
  if (!['fresnel', 'angular-spectrum'].includes(method))
    throw new RangeError('Propagation method must be fresnel or angular-spectrum.');
  if (!Number.isFinite(distanceMm)) throw new RangeError('Propagation distance must be finite.');
  const { samplePitchMm, wavelengthMm, waveNumber } = validateGrid(n, windowMm, wavelengthNm);
  const { real, imag } = copyField(field, n);
  const input = measureField(real, imag, samplePitchMm);
  const diagnostics = [];

  if (distanceMm === 0 || input.sum === 0) {
    const border = borderDiagnostic(input.intensity, input.intensity, n);
    if (border) diagnostics.push(border);
    return {
      real,
      imag,
      intensity: input.intensity,
      phase: input.phase,
      inputPower: input.power,
      outputPower: input.power,
      samplePitchMm,
      diagnostics,
    };
  }

  const carrierPhase = waveNumber * distanceMm;
  if (!Number.isFinite(carrierPhase))
    throw new RangeError('Propagation phase exceeds the representable numerical range.');
  fft2d(real, imag, n);
  let spectralPeak = 0;
  let spectralPower = 0;
  for (let i = 0; i < real.length; i += 1) {
    const value = real[i] * real[i] + imag[i] * imag[i];
    spectralPeak = Math.max(spectralPeak, value);
    spectralPower += value;
  }
  if (!Number.isFinite(spectralPower))
    throw new RangeError('Fourier field power exceeds the representable numerical range.');
  const squaredFrequency = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const signedIndex = i < n / 2 ? i : i - n;
    squaredFrequency[i] = ((wavelengthMm * signedIndex) / windowMm) ** 2;
    if (!Number.isFinite(squaredFrequency[i]))
      throw new RangeError('Spatial frequencies exceed the representable numerical range.');
  }
  const significantThreshold = spectralPeak * SIGNIFICANT_SPECTRUM;
  let maxOccupiedS = 0;
  let maxStep = 0;
  let evanescentPower = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const index = y * n + x;
      const energy = real[index] ** 2 + imag[index] ** 2;
      const s = squaredFrequency[x] + squaredFrequency[y];
      const evanescent = method === 'angular-spectrum' && s > 1;
      let attenuation = 1;
      let angle;
      if (evanescent) {
        evanescentPower += energy;
        attenuation = distanceMm < 0 ? 0 : Math.exp(-carrierPhase * Math.sqrt(s - 1));
        angle = -carrierPhase;
      } else {
        angle = relativePhase(s, method, carrierPhase);
      }
      if (!Number.isFinite(angle))
        throw new RangeError('Transfer-function phase exceeds the representable numerical range.');
      if (energy >= significantThreshold && energy > 0) {
        maxOccupiedS = Math.max(maxOccupiedS, s);
        if (!evanescent) {
          const adjacent = [
            squaredFrequency[(x + 1) % n] + squaredFrequency[y],
            squaredFrequency[x] + squaredFrequency[(y + 1) % n],
          ];
          for (const neighbor of adjacent) {
            if (method === 'angular-spectrum' && neighbor > 1) continue;
            maxStep = Math.max(
              maxStep,
              Math.abs(relativePhase(neighbor, method, carrierPhase) - angle),
            );
          }
        }
      }
      const re = real[index];
      const im = imag[index];
      const hr = attenuation * Math.cos(angle);
      const hi = attenuation * Math.sin(angle);
      real[index] = re * hr - im * hi;
      imag[index] = re * hi + im * hr;
    }
  }

  if (maxStep > Math.PI)
    diagnostics.push({
      code: 'transfer-undersampled',
      level: 'warning',
      message: `The unwrapped transfer phase changes by up to ${(maxStep / Math.PI).toFixed(2)}π between adjacent frequency samples near significant modes (spectral intensity ≥ 10⁻⁶ of peak). Periodic sampling can alias the propagated field; enlarge the window and compare grids. This is a risk indicator, not an error estimate.`,
    });
  if (method === 'fresnel' && maxOccupiedS > 0.01)
    diagnostics.push({
      code: 'paraxial-angle',
      level: 'warning',
      message: `Significant input modes reach λ|f|=${Math.sqrt(maxOccupiedS).toFixed(3)}. Fresnel propagation assumes small angles; compare the angular-spectrum model and check sampling.`,
    });
  const evanescentFraction = spectralPower > 0 ? evanescentPower / spectralPower : 0;
  if (evanescentFraction > 1e-10)
    diagnostics.push({
      code: distanceMm < 0 ? 'evanescent-truncated' : 'evanescent-decay',
      level: distanceMm < 0 ? 'warning' : 'info',
      message:
        distanceMm < 0
          ? `${(100 * evanescentFraction).toFixed(4)}% of input spectral norm is evanescent. These modes are set to zero for backward propagation to avoid exponential amplification; this operation is not invertible for those modes.`
          : `${(100 * evanescentFraction).toFixed(4)}% of input spectral norm is evanescent and decays with propagation distance. The reported intensity integral is a scalar field norm, not electromagnetic flux.`,
    });
  fft2d(real, imag, n, true);
  const output = measureField(real, imag, samplePitchMm);
  const border = borderDiagnostic(input.intensity, output.intensity, n);
  if (border) diagnostics.push(border);
  return {
    real,
    imag,
    intensity: output.intensity,
    phase: output.phase,
    inputPower: input.power,
    outputPower: output.power,
    samplePitchMm,
    diagnostics,
  };
}

function shiftHalf(real, imag, n) {
  const half = n / 2;
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const a = y * n + x;
      const b = (y + half) * n + ((x + half) % n);
      const re = real[a];
      const im = imag[a];
      real[a] = real[b];
      imag[a] = imag[b];
      real[b] = re;
      imag[b] = im;
    }
  }
}

/**
 * Build an aperture/source and run a reproducible scalar optics experiment.
 *
 * beamWaistMm=0 supplies uniform plane-wave illumination. A positive waist
 * multiplies field by exp(-(x²+y²)/w0²): w0 is the intensity 1/e² radius, not
 * diameter. The gaussian preset has no hard aperture and requires w0 > 0.
 * Every sampled source still occupies a finite numerical window.
 * Source-feature widths below six grid samples produce a heuristic sampling
 * diagnostic. Its absence does not establish accuracy; custom mask geometry
 * and fine vortex phase structure are not inferred by this check.
 *
 * Fraunhofer is an ideal-lens Fourier focal plane, controlled by focalLengthMm
 * (distanceMm has no effect). Output pitch is lambda*f/window. Field scaling
 * is dx²/(lambda*f), giving equal discrete input/output norms. The returned
 * complex value is the Fourier field; global carrier/constant phase and the
 * observation-plane quadratic phase are omitted. Fresnel/angular-spectrum
 * methods instead propagate in homogeneous free space over distanceMm, on the
 * unchanged input grid, with no lens phase applied.
 */
export function simulateExperiment(params = {}, n = 512, mask) {
  if (params == null || typeof params !== 'object' || Array.isArray(params))
    throw new TypeError('Experiment parameters must be an object.');
  const p = {
    windowMm: 8,
    wavelengthNm: 532,
    focalLengthMm: 500,
    distanceMm: 100,
    beamWaistMm: 0,
    preset: 'double',
    method: 'fraunhofer',
    // Keep geometric defaults explicit so source-sampling diagnostics use the
    // same dimensions as makeAperture, including when parameters are omitted.
    widthMm: 0.225,
    heightMm: 1.5,
    diameterMm: 1.6,
    innerDiameterMm: 1,
    ...params,
  };
  const { samplePitchMm, wavelengthMm } = validateGrid(n, p.windowMm, p.wavelengthNm);
  if (!['fraunhofer', 'fresnel', 'angular-spectrum'].includes(p.method))
    throw new RangeError('Experiment method must be fraunhofer, fresnel, or angular-spectrum.');
  if (!Number.isFinite(p.beamWaistMm) || p.beamWaistMm < 0)
    throw new RangeError('Beam waist must be finite and nonnegative.');
  if (p.preset === 'gaussian' && p.beamWaistMm === 0)
    throw new RangeError('The gaussian source requires a positive beamWaistMm.');
  if (p.method === 'fraunhofer') positive(p.focalLengthMm, 'Focal length');
  else if (!Number.isFinite(p.distanceMm))
    throw new RangeError('Propagation distance must be finite.');

  const source =
    p.preset === 'gaussian'
      ? { real: new Float64Array(n * n).fill(1), imag: new Float64Array(n * n) }
      : makeAperture({ ...p, ...(mask === undefined ? {} : { mask }) }, n);
  const inputAmplitude = new Float32Array(n * n);
  const inputPhase = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const cy = (y - n / 2) * samplePitchMm;
    for (let x = 0; x < n; x += 1) {
      const index = y * n + x;
      const cx = (x - n / 2) * samplePitchMm;
      const illumination =
        p.beamWaistMm > 0 ? Math.exp(-((cx / p.beamWaistMm) ** 2 + (cy / p.beamWaistMm) ** 2)) : 1;
      source.real[index] *= illumination;
      source.imag[index] *= illumination;
      const value = Math.hypot(source.real[index], source.imag[index]);
      inputAmplitude[index] = value;
      inputPhase[index] = value > 0 ? Math.atan2(source.imag[index], source.real[index]) : 0;
    }
  }

  let result;
  let outputPitchMm = samplePitchMm;
  if (p.method !== 'fraunhofer') {
    result = propagateField(source, {
      n,
      windowMm: p.windowMm,
      wavelengthNm: p.wavelengthNm,
      distanceMm: p.distanceMm,
      method: p.method,
    });
  } else {
    const denominator = wavelengthMm * p.focalLengthMm;
    outputPitchMm = denominator / p.windowMm;
    const scale = (samplePitchMm * samplePitchMm) / denominator;
    if (
      !(outputPitchMm > 0) ||
      !Number.isFinite(outputPitchMm * n) ||
      !(scale > 0) ||
      !Number.isFinite(scale)
    ) {
      throw new RangeError('Focal-plane sampling exceeds the representable numerical range.');
    }
    const input = measureField(source.real, source.imag, samplePitchMm);
    const real = source.real.slice();
    const imag = source.imag.slice();
    shiftHalf(real, imag, n);
    fft2d(real, imag, n);
    shiftHalf(real, imag, n);
    for (let i = 0; i < real.length; i += 1) {
      real[i] *= scale;
      imag[i] *= scale;
    }
    const output = measureField(real, imag, outputPitchMm);
    const diagnostics = [];
    const border = borderDiagnostic(input.intensity, output.intensity, n, true);
    if (border) diagnostics.push(border);
    let peak = 0;
    let maxNA = 0;
    for (const value of output.intensity) peak = Math.max(peak, value);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (
          output.intensity[y * n + x] < peak * SIGNIFICANT_SPECTRUM ||
          output.intensity[y * n + x] === 0
        )
          continue;
        maxNA = Math.max(maxNA, (Math.hypot(x - n / 2, y - n / 2) * wavelengthMm) / p.windowMm);
      }
    }
    if (maxNA > 0.1)
      diagnostics.push({
        code: 'paraxial-angle',
        level: 'warning',
        message: `Significant Fourier-plane modes reach transverse coordinate/focal-length ratio ${maxNA.toFixed(3)}. The ideal focal-plane mapping assumes paraxial scalar optics; high-angle results require a different model.`,
      });
    result = {
      real,
      imag,
      intensity: output.intensity,
      phase: output.phase,
      inputPower: input.power,
      outputPower: output.power,
      diagnostics,
    };
  }
  const sourceWarning = sourceDiagnostic(p, samplePitchMm);
  if (sourceWarning) result.diagnostics.push(sourceWarning);
  const normalizedIntensity = new Float64Array(result.intensity.length);
  let peak = 0;
  for (const value of result.intensity) peak = Math.max(peak, value);
  if (peak > 0) {
    for (let i = 0; i < normalizedIntensity.length; i += 1)
      normalizedIntensity[i] = result.intensity[i] / peak;
  }
  return {
    intensity: result.intensity,
    normalizedIntensity,
    real: result.real,
    imag: result.imag,
    phase: result.phase,
    inputAmplitude,
    inputPhase,
    n,
    inputPitchMm: samplePitchMm,
    outputPitchMm,
    outputSpanMm: outputPitchMm * n,
    inputPower: result.inputPower,
    outputPower: result.outputPower,
    diagnostics: result.diagnostics,
  };
}
