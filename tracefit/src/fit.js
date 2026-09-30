/**
 * Deterministic, bounded least-squares fitting for positive spectral peaks.
 * Gaussian width is sigma; Lorentzian width is half width at half maximum.
 * Everything is calculated in normalized coordinates; returned values are in
 * the original units. No random seeds or runtime dependencies are required.
 */

const MODELS = new Set(['gaussian', 'lorentzian']);

export function evaluateTrace(x, parameters, model = 'gaussian') {
  if (!MODELS.has(model)) throw new RangeError('model must be gaussian or lorentzian');
  if (Array.isArray(x)) return x.map(value => evaluateTrace(value, parameters, model));
  let result = parameters.offset + parameters.slope * (x - parameters.xReference);
  for (const peak of parameters.peaks) {
    const t = (x - peak.center) / peak.width;
    result += peak.amplitude * (model === 'gaussian' ? Math.exp(-0.5 * t * t) : 1 / (1 + t * t));
  }
  return result;
}

export function fitTrace(data, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('fit options must be an object');
  const acceptedOptions = new Set(['model', 'peaks', 'maxIterations', 'multiStarts', 'tolerance']);
  for (const key of Object.keys(options)) if (!acceptedOptions.has(key)) throw new RangeError(`unknown fit option: ${key}`);
  const model = options.model ?? 'gaussian';
  const count = options.peaks ?? 1;
  const maxIterations = options.maxIterations ?? 150;
  const multiStarts = options.multiStarts ?? 5;
  const tolerance = options.tolerance ?? 1e-9;
  if (!MODELS.has(model)) throw new RangeError('model must be gaussian or lorentzian');
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new RangeError('peaks must be an integer from 1 to 3');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10000) throw new RangeError('maxIterations must be an integer from 1 to 10000');
  if (!Number.isInteger(multiStarts) || multiStarts < 1 || multiStarts > 50) throw new RangeError('multiStarts must be an integer from 1 to 50');
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.01) throw new RangeError('tolerance must be positive and at most 0.01');
  const dimension = 2 + count * 3;
  if (!Array.isArray(data) || data.length < Math.max(8, dimension + 2)) {
    throw new RangeError(`at least ${Math.max(8, dimension + 2)} samples are required for ${count} peak(s)`);
  }
  const hasSigma = data.some(sample => sample?.sigma !== undefined);
  const samples = data.map((sample, index) => {
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      throw new TypeError(`sample ${index + 1} must have finite x and y`);
    }
    if (hasSigma && (!Number.isFinite(sample.sigma) || sample.sigma <= 0)) {
      throw new TypeError(`sample ${index + 1} must have a positive finite sigma; supply sigma for every sample`);
    }
    return { ...sample };
  }).sort((a, b) => a.x - b.x);
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].x === samples[i - 1].x) throw new RangeError(`duplicate x value: ${samples[i].x}`);
  }
  const xmin = samples[0].x;
  const xmax = samples.at(-1).x;
  const span = xmax - xmin;
  if (!Number.isFinite(span) || span <= 0) throw new RangeError('x range must be finite and positive');
  const xReference = xmin + span / 2;
  let ymin = Infinity;
  let ymax = -Infinity;
  let sigmaReference = 1;
  if (hasSigma) sigmaReference = Infinity;
  for (const sample of samples) {
    ymin = Math.min(ymin, sample.y);
    ymax = Math.max(ymax, sample.y);
    if (hasSigma) sigmaReference = Math.min(sigmaReference, sample.sigma);
  }
  const yReference = ymin + (ymax - ymin) / 2;
  const yScale = ymax > ymin ? ymax - ymin : Math.max(1, Math.abs(yReference) * Number.EPSILON);
  if (!Number.isFinite(yScale) || !Number.isFinite(yReference)) throw new RangeError('y range is too large to fit safely');
  const rows = samples.map(sample => ({
    x: (sample.x - xReference) / span,
    y: (sample.y - yReference) / yScale,
    weight: hasSigma ? sigmaReference / sample.sigma : 1,
  }));
  const seeds = makeSeeds(rows, count, model, multiStarts);
  let best;
  for (let start = 0; start < seeds.length; start++) {
    let initial = seeds[start];
    if (count > 1 && start >= 3 && best && best.cost > 1e-18) {
      // A weak extra peak often accompanies a broad component absorbing two
      // real peaks. Restart by splitting that component, instead of spending
      // every start in near-identical basins from the initial grid.
      const components = Array.from({ length: count }, (_, i) => ({ amplitude: best.p[2 + i * 3], center: best.p[3 + i * 3], width: best.p[4 + i * 3] }));
      const remove = components.reduce((a, peak, i) => peak.amplitude < components[a].amplitude ? i : a, 0);
      const eligible = components.map((peak, i) => ({ peak, i })).filter(item => item.i !== remove);
      const split = eligible.reduce((a, item) => (start % 2 ? item.peak.amplitude * item.peak.width : item.peak.width) > (start % 2 ? a.peak.amplitude * a.peak.width : a.peak.width) ? item : a).i;
      const component = components[split];
      const splitPeaks = components.filter((_, i) => i !== remove && i !== split).map(peak => ({ center: peak.center, width: peak.width }));
      const separation = start % 2 ? 0.45 : 0.7;
      for (const sign of [-1, 1]) splitPeaks.push({ center: Math.max(-0.49, Math.min(0.49, component.center + sign * component.width * separation)), width: component.width * 0.85 });
      initial = linearSeed(rows, splitPeaks, model)?.p ?? initial;
    }
    const result = optimize(rows, initial, model, maxIterations, tolerance);
    result.start = start;
    // A numerically successful result takes precedence only at equal residual.
    if (!best || result.cost < best.cost - 1e-15 || (Math.abs(result.cost - best.cost) <= 1e-15 && result.converged && !best.converged)) best = result;
  }
  // Sorting once, after optimization, also sorts the covariance axes.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => best.p[3 + a * 3] - best.p[3 + b * 3]);
  const permutation = [0, 1, ...order.flatMap(i => [2 + i * 3, 3 + i * 3, 4 + i * 3])];
  const p = permutation.map(index => best.p[index]);
  const parameters = {
    offset: yReference + yScale * p[0],
    slope: yScale / span * p[1],
    xReference,
    peaks: Array.from({ length: count }, (_, i) => ({
      amplitude: yScale * p[2 + i * 3],
      center: xReference + span * p[3 + i * 3],
      width: span * p[4 + i * 3],
    })),
  };
  if (![parameters.offset, parameters.slope, ...parameters.peaks.flatMap(peak => [peak.amplitude, peak.center, peak.width])].every(Number.isFinite)) {
    throw new RangeError('parameter units exceed the floating-point range; rescale x or y before fitting');
  }
  const resultSamples = samples.map(sample => {
    const fitted = evaluateTrace(sample.x, parameters, model);
    if (!Number.isFinite(fitted) || !Number.isFinite(sample.y - fitted)) throw new RangeError('fitted values exceed the floating-point range; rescale x or y before fitting');
    const result = { x: sample.x, y: sample.y, fitted, residual: sample.y - fitted };
    if (hasSigma) result.sigma = sample.sigma;
    if (sample.sourceLine !== undefined) result.sourceLine = sample.sourceLine;
    return result;
  });
  const sum = squaredSum(resultSamples.map(sample => sample.residual));
  const rss = sum.sum;
  const weightedRss = hasSigma ? squaredSum(resultSamples.map(sample => sample.residual / sample.sigma)).sum : rss;
  const dof = rows.length - dimension;
  const warnings = [];
  if (!Number.isFinite(rss) || !Number.isFinite(weightedRss)) warnings.push({ code: 'NUMERICAL_RANGE', message: 'A sum-of-squares statistic exceeds the floating-point range and is returned as null; rescale the data or measurement-error units.' });
  if (!best.converged) warnings.push({ code: 'NOT_CONVERGED', message: `Optimization stopped with status ${best.status}; parameters and uncertainty should not be treated as a successful fit.` });
  const boundary = boundaryParameters(p);
  if (boundary.length) warnings.push({ code: 'BOUNDARY', message: `Parameters are on or very near a constraint: ${boundary.join(', ')}. Symmetric covariance errors are not valid at a boundary.` });
  const normal = linearize(rows, p, model);
  const inversion = invertInformation(normal.hessian);
  if (!inversion.valid) warnings.push({ code: 'SINGULAR', message: 'The information matrix is rank deficient or poorly conditioned; the data do not identify all parameters separately.' });
  let covarianceValid = best.converged && !boundary.length && inversion.valid;
  const logScales = [Math.log(yScale), Math.log(yScale) - Math.log(span), ...Array.from({ length: count }, () => [Math.log(yScale), Math.log(span), Math.log(span)]).flat()];
  const logFactor = hasSigma ? 2 * (Math.log(sigmaReference) - Math.log(yScale)) : Math.log(normal.cost) - Math.log(dof);
  // Logs avoid overflow in intermediate unit conversions even when the final
  // covariance is representable. Unrepresentable diagonal variance is never
  // converted into an apparently exact standard error.
  let matrix = covarianceValid ? inversion.inverse.map((row, i) => row.map((value, j) => value === 0 ? 0 : Math.sign(value) * Math.exp(Math.log(Math.abs(value)) + logScales[i] + logScales[j] + logFactor))) : null;
  const covarianceRangeInvalid = matrix && (matrix.some(row => row.some(value => !Number.isFinite(value))) || matrix.some((row, i) => row[i] < 0 || (row[i] === 0 && (hasSigma || normal.cost > 0))));
  if (covarianceRangeInvalid) {
    covarianceValid = false;
    matrix = null;
    warnings.push({ code: 'NUMERICAL_RANGE', message: 'Covariance cannot be represented in these units without overflow or underflow; standard errors are unavailable. Rescale x, y or sigma.' });
  }
  const values = [parameters.offset, parameters.slope, ...parameters.peaks.flatMap(peak => [peak.amplitude, peak.center, peak.width])];
  const names = ['offset', 'slope', ...parameters.peaks.flatMap((_, i) => [`peak${i + 1}.amplitude`, `peak${i + 1}.center`, `peak${i + 1}.width`])];
  return {
    model,
    peaks: count,
    converged: best.converged,
    status: best.status,
    iterations: best.iterations,
    parameters,
    parameterTable: names.map((name, i) => ({ name, value: values[i], standardError: matrix ? Math.sqrt(matrix[i][i]) : null })),
    statistics: { rss: Number.isFinite(rss) ? rss : null, weightedRss: Number.isFinite(weightedRss) ? weightedRss : null, rmse: sum.scale * Math.sqrt(sum.scaled / rows.length), dof },
    covariance: {
      valid: covarianceValid,
      mode: hasSigma ? 'known-sigma' : 'residual-scaled',
      matrix,
      parameterOrder: names,
      conditionNumber: Number.isFinite(inversion.conditionNumber) ? inversion.conditionNumber : null,
      reason: covarianceValid ? null : !best.converged ? 'not-converged' : boundary.length ? 'boundary' : !inversion.valid ? 'singular' : 'numerical-range',
    },
    warnings,
    samples: resultSamples,
    algorithm: { name: 'bounded-levenberg-marquardt', analyticJacobian: true, normalized: true, deterministic: true, multiStarts: seeds.length, bestStart: best.start + 1, maxIterations, tolerance },
  };
}

function squaredSum(values) {
  let scale = 0;
  let scaled = 0;
  for (const value of values) {
    const absolute = Math.abs(value);
    if (!Number.isFinite(absolute)) return { sum: Infinity, scale: Infinity, scaled: 1 };
    if (absolute === 0) continue;
    if (absolute > scale) {
      scaled = 1 + scaled * (scale / absolute) ** 2;
      scale = absolute;
    } else scaled += (absolute / scale) ** 2;
  }
  return { sum: scale * (scale * scaled), scale, scaled };
}

function shape(t, model) {
  return model === 'gaussian' ? Math.exp(-0.5 * t * t) : 1 / (1 + t * t);
}

function prediction(x, p, model) {
  let y = p[0] + p[1] * x;
  for (let i = 2; i < p.length; i += 3) y += p[i] * shape((x - p[i + 1]) / p[i + 2], model);
  return y;
}

function linearize(rows, p, model) {
  const n = p.length;
  const hessian = Array.from({ length: n }, () => Array(n).fill(0));
  const gradient = Array(n).fill(0);
  let cost = 0;
  for (const row of rows) {
    const jacobian = [1, row.x];
    for (let i = 2; i < n; i += 3) {
      const t = (row.x - p[i + 1]) / p[i + 2];
      const g = shape(t, model);
      const common = model === 'gaussian' ? p[i] * g / p[i + 2] : 2 * p[i] * g * g / p[i + 2];
      jacobian.push(g, common * t, common * t * t);
    }
    const residual = (row.y - prediction(row.x, p, model)) * row.weight;
    cost += residual * residual;
    for (let i = 0; i < n; i++) {
      const ji = jacobian[i] * row.weight;
      gradient[i] += ji * residual;
      for (let j = 0; j <= i; j++) hessian[i][j] += ji * jacobian[j] * row.weight;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) hessian[j][i] = hessian[i][j];
  return { cost, gradient, hessian };
}

function constrain(p) {
  const result = [...p];
  for (let i = 2; i < result.length; i += 3) {
    result[i] = Math.max(0, result[i]);
    result[i + 1] = Math.min(0.5, Math.max(-0.5, result[i + 1]));
    result[i + 2] = Math.min(2, Math.max(1e-5, result[i + 2]));
  }
  return result;
}

function optimize(rows, initial, model, maxIterations, tolerance) {
  let p = constrain(initial);
  let state = linearize(rows, p, model);
  let damping = 0.001;
  let converged = false;
  let status = 'max-iterations';
  let iterations = 0;
  let stalled = 0;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;
    const diagonal = state.hessian.map((row, i) => Math.max(row[i], 1e-10));
    const gradientSize = Math.max(...state.gradient.map((g, i) => Math.abs(g) / Math.sqrt(diagonal[i])));
    if (iteration > 1 && (state.cost < 1e-24 || gradientSize < tolerance * Math.max(1, Math.sqrt(state.cost)))) {
      converged = true;
      status = 'converged';
      break;
    }
    let accepted = false;
    let stepSize = Infinity;
    let decrease = 0;
    for (let trial = 0; trial < 16; trial++) {
      const damped = state.hessian.map((row, i) => row.map((value, j) => value + (i === j ? damping * diagonal[i] : 0)));
      const delta = solve(damped, state.gradient);
      if (!delta) { damping *= 10; continue; }
      const candidate = constrain(p.map((value, i) => value + delta[i]));
      const next = linearize(rows, candidate, model);
      if (Number.isFinite(next.cost) && next.cost < state.cost) {
        stepSize = Math.max(...candidate.map((value, i) => Math.abs(value - p[i]) / (Math.abs(p[i]) + 1)));
        decrease = state.cost - next.cost;
        p = candidate;
        state = next;
        damping = Math.max(1e-12, damping / 3);
        accepted = true;
        break;
      }
      damping *= 8;
    }
    if (accepted) {
      if (iteration > 2 && stepSize < tolerance && decrease < tolerance * Math.max(state.cost, 1e-14)) {
        converged = true;
        status = 'converged';
        break;
      }
      stalled = 0;
    } else {
      stalled++;
      // A projected gradient recognizes a constrained optimum without claiming
      // that covariance uncertainty is valid for the boundary parameters.
      const probe = constrain(p.map((value, i) => value + state.gradient[i] / diagonal[i]));
      const projectedGradient = Math.max(...probe.map((value, i) => Math.abs(value - p[i]) * Math.sqrt(diagonal[i])));
      if (iteration > 1 && projectedGradient < Math.sqrt(tolerance) * Math.max(1, Math.sqrt(state.cost))) {
        converged = true;
        status = 'converged';
        break;
      }
      if (stalled >= 3 || damping > 1e30) { status = 'stalled'; break; }
    }
  }
  if (!Number.isFinite(state.cost) || !p.every(Number.isFinite)) status = 'numerical-failure';
  return { p, cost: state.cost, converged, status, iterations };
}

// Linear baseline and positive amplitudes are solved before every nonlinear
// start. This makes seed selection independent of baseline level and units.
function linearSeed(rows, peaks, model) {
  const dimension = peaks.length + 2;
  const h = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const b = Array(dimension).fill(0);
  for (const row of rows) {
    const basis = [1, row.x, ...peaks.map(peak => shape((row.x - peak.center) / peak.width, model))];
    for (let i = 0; i < dimension; i++) {
      b[i] += basis[i] * row.y * row.weight ** 2;
      for (let j = 0; j <= i; j++) h[i][j] += basis[i] * basis[j] * row.weight ** 2;
    }
  }
  for (let i = 0; i < dimension; i++) for (let j = 0; j < i; j++) h[j][i] = h[i][j];
  let active = Array.from({ length: dimension }, (_, i) => i);
  let coefficients = Array(dimension).fill(0);
  for (let attempt = 0; attempt <= peaks.length; attempt++) {
    const solution = solve(active.map(i => active.map(j => h[i][j])), active.map(i => b[i]));
    if (!solution) return null;
    coefficients.fill(0);
    active.forEach((index, i) => { coefficients[index] = solution[i]; });
    let mostNegative = -1;
    for (const index of active) if (index >= 2 && coefficients[index] < 0 && (mostNegative < 0 || coefficients[index] < coefficients[mostNegative])) mostNegative = index;
    if (mostNegative < 0) break;
    active = active.filter(index => index !== mostNegative);
  }
  const p = [coefficients[0], coefficients[1], ...peaks.flatMap((peak, i) => [Math.max(0.015, coefficients[i + 2]), peak.center, peak.width])];
  const cost = rows.reduce((sum, row) => sum + ((row.y - prediction(row.x, p, model)) * row.weight) ** 2, 0);
  return { p, cost };
}

function makeSeeds(rows, count, model, number) {
  // Initialization is bounded in cost for long traces. Optimization and all
  // reported statistics still use every original observation.
  if (rows.length > 301) rows = Array.from({ length: 301 }, (_, i) => rows[Math.round(i * (rows.length - 1) / 300)]);
  const pool = [];
  const add = peaks => { const candidate = linearSeed(rows, peaks, model); if (candidate) pool.push(candidate); };
  const edge = Math.max(2, Math.floor(rows.length * 0.12));
  const left = median(rows.slice(0, edge).map(row => row.y));
  const right = median(rows.slice(-edge).map(row => row.y));
  const signal = rows.map(row => Math.max(0, row.y - (left + right) / 2 - (right - left) * row.x));
  const total = signal.reduce((sum, value) => sum + value, 0);
  const centroid = total ? rows.reduce((sum, row, i) => sum + row.x * signal[i], 0) / total : 0;
  const variance = total ? rows.reduce((sum, row, i) => sum + (row.x - centroid) ** 2 * signal[i], 0) / total : 0.04;
  const massWidth = Math.max(0.015, Math.sqrt(variance));
  const maxima = [];
  const smooth = signal.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(rows.length - 1, i + 2); j++) {
      const w = 3 - Math.abs(i - j);
      sum += signal[j] * w;
      weight += w;
    }
    return sum / weight;
  });
  for (let i = 1; i < rows.length - 1; i++) if (smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1]) maxima.push(i);
  maxima.sort((a, b) => smooth[b] - smooth[a]);
  const widths = [0.015, 0.035, 0.07, 0.12, 0.22, 0.4, 0.7, massWidth];
  if (count === 1) {
    const centers = [centroid, ...maxima.slice(0, 5).map(i => rows[i].x), ...Array.from({ length: 15 }, (_, i) => -0.45 + 0.9 * i / 14)];
    for (const center of centers) for (const width of widths) add([{ center, width }]);
  } else {
    // Greedy dictionary pursuit admits different widths within a mixture;
    // equal-width split starts alone can miss a narrow peak on a broad one.
    let dictionaryPeaks = [];
    const dictionary = [];
    for (let i = 0; i < 31; i++) for (const width of [0.02, 0.04, 0.075, 0.13, 0.22, 0.38]) dictionary.push({ center: -0.45 + i * 0.03, width });
    for (let level = 0; level < count; level++) {
      let bestDictionary;
      for (const peak of dictionary) {
        if (dictionaryPeaks.some(other => Math.abs(other.center - peak.center) < 0.005 && Math.abs(Math.log(other.width / peak.width)) < 0.1)) continue;
        const trialPeaks = [...dictionaryPeaks, peak];
        const trial = linearSeed(rows, trialPeaks, model);
        if (trial && (!bestDictionary || trial.cost < bestDictionary.cost)) bestDictionary = { ...trial, peaks: trialPeaks };
      }
      dictionaryPeaks = bestDictionary?.peaks ?? dictionaryPeaks;
    }
    if (dictionaryPeaks.length === count) {
      add(dictionaryPeaks);
      // Coordinate refinement is confined to seed generation; its coarse
      // grid is deliberately followed by analytic-Jacobian LM on all samples.
      for (let sweep = 0; sweep < 3; sweep++) {
        for (let index = 0; index < count; index++) {
          let localBest = linearSeed(rows, dictionaryPeaks, model);
          let localPeak = dictionaryPeaks[index];
          const current = dictionaryPeaks[index];
          for (const dc of [-0.04, -0.02, 0, 0.02, 0.04]) for (const factor of [0.6, 0.8, 1, 1.25, 1.6]) {
            const candidate = { center: Math.max(-0.49, Math.min(0.49, current.center + dc)), width: Math.max(0.01, Math.min(0.7, current.width * factor)) };
            const trialPeaks = dictionaryPeaks.map((peak, i) => i === index ? candidate : peak);
            const trial = linearSeed(rows, trialPeaks, model);
            if (trial && (!localBest || trial.cost < localBest.cost)) { localBest = trial; localPeak = candidate; }
          }
          dictionaryPeaks[index] = localPeak;
        }
        add(dictionaryPeaks);
      }
    }
    for (const separation of [0.02, 0.06, 0.12]) {
      const chosen = [];
      for (const index of maxima) {
        if (chosen.every(other => Math.abs(rows[index].x - rows[other].x) > separation)) chosen.push(index);
        if (chosen.length === count) break;
      }
      if (chosen.length === count) {
        const centers = chosen.map(index => rows[index].x).sort((a, b) => a - b);
        const measuredWidths = chosen.map(index => {
          const half = smooth[index] * 0.5;
          let a = index;
          let b = index;
          while (a > 0 && smooth[a] > half) a--;
          while (b < rows.length - 1 && smooth[b] > half) b++;
          return Math.max(0.015, (rows[b].x - rows[a].x) / (model === 'gaussian' ? 2.355 : 2));
        });
        add(chosen.map((index, i) => ({ center: rows[index].x, width: measuredWidths[i] })));
        for (const width of widths) add(centers.map(center => ({ center, width })));
      }
    }
    // Symmetric split starts find mixtures whose broad overlapping peaks have
    // only one visible local maximum. Different widths avoid a single basin.
    for (const center of [centroid, 0, ...maxima.slice(0, 2).map(index => rows[index].x)]) {
      for (const spread of [0.06, 0.12, 0.2, 0.3, 0.4, Math.min(0.4, massWidth * 1.4)]) {
        for (const ratio of [0.45, 0.85, 1.4]) {
          add(Array.from({ length: count }, (_, i) => ({ center: Math.max(-0.45, Math.min(0.45, center + (i / (count - 1) - 0.5) * spread * 2)), width: Math.max(0.015, spread * ratio) })));
        }
      }
    }
    // Weighted signal quantiles provide asymmetric starts for unequal mixtures.
    if (total > 0) {
      let cumulative = 0;
      const centers = [];
      for (let i = 0; i < rows.length && centers.length < count; i++) {
        cumulative += signal[i];
        if (cumulative / total >= (centers.length + 0.5) / count) centers.push(rows[i].x);
      }
      if (centers.length === count) for (const width of widths) add(centers.map(center => ({ center, width })));
    }
  }
  pool.sort((a, b) => a.cost - b.cost);
  const selected = [];
  for (const seed of pool) {
    const peaks = Array.from({ length: count }, (_, i) => ({ center: seed.p[3 + i * 3], width: seed.p[4 + i * 3] })).sort((a, b) => a.center - b.center);
    const duplicate = selected.some(other => {
      const otherPeaks = Array.from({ length: count }, (_, i) => ({ center: other.p[3 + i * 3], width: other.p[4 + i * 3] })).sort((a, b) => a.center - b.center);
      return peaks.every((peak, i) => Math.abs(peak.center - otherPeaks[i].center) < 0.035 && Math.abs(Math.log(peak.width / otherPeaks[i].width)) < 0.45);
    });
    if (!duplicate) selected.push(seed);
    if (selected.length === number) break;
  }
  if (!selected.length) selected.push({ p: [0, 0, ...Array.from({ length: count }, (_, i) => [0.5, (i + 0.5) / count - 0.5, 0.1]).flat()] });
  return selected.map(seed => seed.p);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function solve(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  const scales = matrix.map(row => Math.max(...row.map(Math.abs)));
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(a[row][column]) / (scales[row] || 1) > Math.abs(a[pivot][column]) / (scales[pivot] || 1)) pivot = row;
    if (!Number.isFinite(a[pivot][column]) || Math.abs(a[pivot][column]) < 1e-15 * (scales[pivot] || 1)) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    [scales[column], scales[pivot]] = [scales[pivot], scales[column]];
    for (let row = column + 1; row < size; row++) {
      const factor = a[row][column] / a[column][column];
      for (let j = column; j <= size; j++) a[row][j] -= factor * a[column][j];
    }
  }
  const result = Array(size).fill(0);
  for (let i = size - 1; i >= 0; i--) {
    let value = a[i][size];
    for (let j = i + 1; j < size; j++) value -= a[i][j] * result[j];
    result[i] = value / a[i][i];
  }
  return result.every(Number.isFinite) ? result : null;
}

function invertInformation(matrix) {
  const size = matrix.length;
  const scales = matrix.map((row, i) => Math.sqrt(row[i]));
  if (scales.some(scale => !Number.isFinite(scale) || scale < 1e-12)) return { valid: false, conditionNumber: Infinity };
  const a = matrix.map((row, i) => row.map((value, j) => value / scales[i] / scales[j]));
  const vectors = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => i === j ? 1 : 0));
  // Jacobi eigen-decomposition on the dimensionless correlation matrix detects
  // loss of identifiability without depending on the physical parameter units.
  for (let sweep = 0; sweep < 100; sweep++) {
    let largest = 0;
    for (let p = 0; p < size; p++) for (let q = p + 1; q < size; q++) {
      const off = a[p][q];
      largest = Math.max(largest, Math.abs(off));
      if (Math.abs(off) < 1e-14) continue;
      const angle = 0.5 * Math.atan2(2 * off, a[q][q] - a[p][p]);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const app = c * c * a[p][p] - 2 * s * c * off + s * s * a[q][q];
      const aqq = s * s * a[p][p] + 2 * s * c * off + c * c * a[q][q];
      for (let k = 0; k < size; k++) if (k !== p && k !== q) {
        const kp = a[k][p];
        const kq = a[k][q];
        a[k][p] = a[p][k] = c * kp - s * kq;
        a[k][q] = a[q][k] = s * kp + c * kq;
      }
      a[p][p] = app;
      a[q][q] = aqq;
      a[p][q] = a[q][p] = 0;
      for (let k = 0; k < size; k++) {
        const vp = vectors[k][p];
        const vq = vectors[k][q];
        vectors[k][p] = c * vp - s * vq;
        vectors[k][q] = s * vp + c * vq;
      }
    }
    if (largest < 1e-12) break;
  }
  const eigenvalues = a.map((row, i) => row[i]);
  const largest = Math.max(...eigenvalues);
  const smallest = Math.min(...eigenvalues);
  const conditionNumber = largest / smallest;
  if (smallest <= 0 || !Number.isFinite(conditionNumber) || conditionNumber > 1e12) return { valid: false, conditionNumber };
  const inverse = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => {
    let value = 0;
    for (let k = 0; k < size; k++) value += vectors[i][k] * vectors[j][k] / eigenvalues[k];
    return value / scales[i] / scales[j];
  }));
  return { valid: true, conditionNumber, inverse };
}

function boundaryParameters(p) {
  const result = [];
  for (let i = 2; i < p.length; i += 3) {
    const name = `peak${(i - 2) / 3 + 1}`;
    if (p[i] <= 1e-7) result.push(`${name}.amplitude`);
    if (Math.abs(p[i + 1]) >= 0.5 - 1e-7) result.push(`${name}.center`);
    if (p[i + 2] <= 1.0001e-5 || p[i + 2] >= 2 - 1e-7) result.push(`${name}.width`);
  }
  return result;
}
