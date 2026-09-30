/**
 * Scalar, monochromatic Fraunhofer diffraction in a lens's focal plane.
 *
 * The aperture is sampled on a square grid and transformed with a radix-2 FFT.
 * This is a paraxial Fourier-optics model, not a Maxwell or near-field solver.
 * Features narrower than a few aperture pixels are not resolved. Increasing N
 * extends the sampled observation plane; increasing the aperture window makes
 * its observation-plane sampling finer, but coarsens the aperture sampling.
 */

const DEFAULTS = Object.freeze({
  preset: 'double',
  windowMm: 8,
  widthMm: 0.225,
  heightMm: 1.5,
  separationMm: 1,
  count: 5,
  diameterMm: 1.6,
  innerDiameterMm: 1,
  charge: 1,
  wavelengthNm: 532,
  focalLengthMm: 500,
});

const PRESETS = new Set(['single', 'double', 'grating', 'circle', 'annulus', 'vortex', 'custom']);
const plans = new Map();

function checkSize(n) {
  if (!Number.isInteger(n) || n < 2 || n > 2048 || (n & (n - 1)) !== 0) {
    throw new RangeError('Grid size must be a power of two between 2 and 2048.');
  }
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
}

function settings(params, n) {
  checkSize(n);
  if (params != null && (typeof params !== 'object' || Array.isArray(params))) {
    throw new TypeError('Aperture parameters must be an object.');
  }
  const p = { ...DEFAULTS, ...params };
  if (!PRESETS.has(p.preset)) throw new RangeError(`Unknown aperture preset: ${p.preset}`);
  positive(p.windowMm, 'Aperture window');
  positive(p.wavelengthNm, 'Wavelength');
  positive(p.focalLengthMm, 'Focal length');
  if (['single', 'double', 'grating'].includes(p.preset)) {
    positive(p.widthMm, 'Slit width');
    positive(p.heightMm, 'Slit height');
  }
  if (p.preset === 'double' || p.preset === 'grating') {
    positive(p.separationMm, 'Slit center spacing');
  }
  if (p.preset === 'grating' && (!Number.isInteger(p.count) || p.count < 1 || p.count > 128)) {
    throw new RangeError('Grating slit count must be an integer between 1 and 128.');
  }
  if (['circle', 'annulus', 'vortex'].includes(p.preset)) positive(p.diameterMm, 'Outer diameter');
  if (p.preset === 'annulus') {
    if (!Number.isFinite(p.innerDiameterMm) || p.innerDiameterMm < 0 || p.innerDiameterMm >= p.diameterMm) {
      throw new RangeError('Inner diameter must be nonnegative and smaller than the outer diameter.');
    }
  }
  if (p.preset === 'vortex' && (!Number.isInteger(p.charge) || Math.abs(p.charge) > 16)) {
    throw new RangeError('Vortex charge must be an integer between -16 and 16.');
  }
  return p;
}

function intervalCoverage(center, pitch, start, end) {
  return Math.max(0, Math.min(center + pitch / 2, end) - Math.max(center - pitch / 2, start)) / pitch;
}

/** Merge overlapping slit openings so that their field transmission stays <= 1. */
function slitIntervals(p) {
  const count = p.preset === 'single' ? 1 : p.preset === 'double' ? 2 : p.count;
  const intervals = [];
  for (let i = 0; i < count; i += 1) {
    const center = count === 1 ? 0 : (i - (count - 1) / 2) * p.separationMm;
    const interval = [center - p.widthMm / 2, center + p.widthMm / 2];
    const previous = intervals[intervals.length - 1];
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else intervals.push(interval);
  }
  return intervals;
}

function buildAperture(p, n) {
  const real = new Float64Array(n * n);
  const imag = new Float64Array(n * n);
  const pitch = p.windowMm / n;
  const half = n / 2;

  if (p.preset === 'custom') {
    if (!p.mask || p.mask.length !== n * n) {
      throw new RangeError(`Custom mask must contain exactly ${n * n} transmission values.`);
    }
    for (let i = 0; i < real.length; i += 1) {
      const value = p.mask[i];
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError('Custom mask transmission values must be finite numbers between 0 and 1.');
      }
      real[i] = value;
    }
    return { real, imag };
  }

  if (['single', 'double', 'grating'].includes(p.preset)) {
    const intervals = slitIntervals(p);
    const horizontal = new Float64Array(n);
    for (let x = 0; x < n; x += 1) {
      for (const [start, end] of intervals) {
        horizontal[x] += intervalCoverage((x - half) * pitch, pitch, start, end);
      }
      horizontal[x] = Math.min(1, horizontal[x]);
    }
    for (let y = 0; y < n; y += 1) {
      const vertical = intervalCoverage((y - half) * pitch, pitch, -p.heightMm / 2, p.heightMm / 2);
      if (vertical === 0) continue;
      for (let x = 0; x < n; x += 1) real[y * n + x] = horizontal[x] * vertical;
    }
    return { real, imag };
  }

  // Cell-averaged transmission reduces edge aliasing. A 4x4 quadrature also
  // integrates vortex phase through the center instead of choosing a phase
  // for the singular point r = 0. All dimensions outside the window are clipped.
  const radius = p.diameterMm / 2;
  const radiusSquared = radius * radius;
  const innerSquared = p.preset === 'annulus' ? (p.innerDiameterMm / 2) ** 2 : 0;
  const vortex = p.preset === 'vortex' && p.charge !== 0;
  const offsets = [-0.375, -0.125, 0.125, 0.375].map((value) => value * pitch);
  for (let y = 0; y < n; y += 1) {
    const cy = (y - half) * pitch;
    if (Math.abs(cy) - pitch / 2 > radius) continue;
    for (let x = 0; x < n; x += 1) {
      const cx = (x - half) * pitch;
      if (Math.abs(cx) - pitch / 2 > radius) continue;
      let re = 0;
      let im = 0;
      for (const dy of offsets) {
        for (const dx of offsets) {
          const px = cx + dx;
          const py = cy + dy;
          const r2 = px * px + py * py;
          if (r2 > radiusSquared || r2 < innerSquared) continue;
          if (vortex) {
            const angle = p.charge * Math.atan2(py, px);
            re += Math.cos(angle);
            im += Math.sin(angle);
          } else re += 1;
        }
      }
      real[y * n + x] = re / 16;
      imag[y * n + x] = im / 16;
    }
  }
  return { real, imag };
}

/**
 * Complex aperture samples, centered at [N/2, N/2]. Custom masks are real
 * amplitude transmissions in [0,1], not intensity transmissions.
 */
export function makeAperture(params = {}, n = 512) {
  return buildAperture(settings(params, n), n);
}

function planFor(n) {
  let plan = plans.get(n);
  if (plan) return plan;
  const reversal = new Uint16Array(n);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i += 1) {
    let source = i;
    let target = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      target = (target << 1) | (source & 1);
      source >>= 1;
    }
    reversal[i] = target;
  }
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  plan = { reversal, cos, sin };
  plans.set(n, plan);
  return plan;
}

function fftLine(real, imag, n, offset, stride, plan, inverse) {
  for (let i = 0; i < n; i += 1) {
    const j = plan.reversal[i];
    if (j <= i) continue;
    const a = offset + i * stride;
    const b = offset + j * stride;
    const re = real[a];
    const im = imag[a];
    real[a] = real[b];
    imag[a] = imag[b];
    real[b] = re;
    imag[b] = im;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const wr = plan.cos[k * step];
        const wi = (inverse ? 1 : -1) * plan.sin[k * step];
        const tr = wr * real[b] - wi * imag[b];
        const ti = wr * imag[b] + wi * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
}

/** In-place 2D DFT. Forward is unnormalized; inverse divides by N². */
export function fft2d(real, imag, n, inverse = false) {
  checkSize(n);
  if (!real || !imag || real.length !== n * n || imag.length !== n * n) {
    throw new RangeError('FFT buffers must each contain N squared samples.');
  }
  const plan = planFor(n);
  for (let y = 0; y < n; y += 1) fftLine(real, imag, n, y * n, 1, plan, inverse);
  for (let x = 0; x < n; x += 1) fftLine(real, imag, n, x, n, plan, inverse);
  if (inverse) {
    const scale = 1 / (n * n);
    for (let i = 0; i < real.length; i += 1) {
      real[i] *= scale;
      imag[i] *= scale;
    }
  }
  return { real, imag };
}

/**
 * Return a max-normalized diffraction image, its central horizontal cut, and
 * aperture previews. `phase` is aperture phase in radians; `amplitude` is
 * aperture field magnitude. `totalPower` is the area-weighted sum of squared
 * aperture samples (mm² for unit incident irradiance), before normalization.
 *
 * Focal-plane pitch = wavelength * focal length / aperture-window width.
 * Display normalization discards absolute brightness; FFT energy itself obeys
 * Parseval's theorem. Cell averaging and finite sampling limit accuracy at
 * small features, sharp edges, high vortex charges, and large diffraction angles.
 */
export function computeDiffraction(params = {}, n = 512, mask) {
  const p = settings(mask === undefined ? params : { ...params, mask }, n);
  const { real, imag } = buildAperture(p, n);
  const amplitude = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  let powerSum = 0;
  for (let i = 0; i < real.length; i += 1) {
    const squared = real[i] * real[i] + imag[i] * imag[i];
    powerSum += squared;
    amplitude[i] = Math.sqrt(squared);
    phase[i] = squared > 0 ? Math.atan2(imag[i], real[i]) : 0;
  }

  // ifftshift the aperture before FFT. For even N, the same half-period
  // permutation serves as fftshift; it restores physical phase origin too.
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
  fft2d(real, imag, n);

  const intensity = new Float64Array(n * n);
  let peak = 0;
  for (let y = 0; y < n; y += 1) {
    const sourceRow = ((y + half) % n) * n;
    for (let x = 0; x < n; x += 1) {
      const source = sourceRow + ((x + half) % n);
      const value = real[source] * real[source] + imag[source] * imag[source];
      intensity[y * n + x] = value;
      peak = Math.max(peak, value);
    }
  }
  if (peak > 0) {
    for (let i = 0; i < intensity.length; i += 1) intensity[i] /= peak;
  }
  const samplePitchMm = p.windowMm / n;
  const observationPitchMm = (p.wavelengthNm / 1e6) * p.focalLengthMm / p.windowMm;
  return {
    intensity,
    amplitude,
    phase,
    cut: intensity.slice(half * n, (half + 1) * n),
    totalPower: powerSum * samplePitchMm ** 2,
    samplePitchMm,
    observationPitchMm,
    observationSpanMm: observationPitchMm * n,
    n,
  };
}
