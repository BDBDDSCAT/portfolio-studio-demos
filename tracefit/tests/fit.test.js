import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTrace, evaluateTrace } from '../src/fit.js';

// Independent data generator: deliberately does not call evaluateTrace.
function truth(x, peaks, model, offset = 2, slope = 0.07, reference = 0) {
  return offset + slope * (x - reference) + peaks.reduce((sum, { amplitude, center, width }) => {
    const squared = ((x - center) / width) ** 2;
    return sum + amplitude * (model === 'gaussian' ? Math.exp(-squared / 2) : 1 / (1 + squared));
  }, 0);
}

function grid(peaks, model, length = 181) {
  return Array.from({ length }, (_, i) => {
    const x = -4 + i * 8 / (length - 1);
    return { x, y: truth(x, peaks, model), sourceLine: i + 2 };
  });
}

function close(actual, expected, tolerance, description = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${description}: ${actual} versus ${expected}, tolerance ${tolerance}`);
}

const mixtures = [
  [{ amplitude: 4, center: 1.1, width: 0.55 }],
  [{ amplitude: 4, center: -0.9, width: 0.7 }, { amplitude: 2.5, center: 0.8, width: 0.8 }],
  [{ amplitude: 4, center: -1.1, width: 0.6 }, { amplitude: 3, center: 0.1, width: 0.7 }, { amplitude: 2, center: 1.3, width: 0.75 }],
];

for (const model of ['gaussian', 'lorentzian']) {
  for (const peaks of mixtures) {
    test(`${model}: recover ${peaks.length} independently generated peaks and sloped baseline`, () => {
      const result = fitTrace(grid(peaks, model), { model, peaks: peaks.length });
      assert.equal(result.converged, true);
      assert.equal(result.status, 'converged');
      assert.equal(result.covariance.valid, true);
      close(result.parameters.offset, 2, 2e-6);
      close(result.parameters.slope, 0.07, 2e-6);
      result.parameters.peaks.forEach((actual, i) => {
        close(actual.amplitude, peaks[i].amplitude, 2e-5, 'amplitude');
        close(actual.center, peaks[i].center, 2e-5, 'center');
        close(actual.width, peaks[i].width, 2e-5, 'width');
      });
      assert.ok(result.statistics.rmse < 1e-7);
      assert.equal(result.statistics.dof, 181 - (3 * peaks.length + 2));
      assert.equal(result.covariance.mode, 'residual-scaled');
      assert.deepEqual(result.warnings, []);
      assert.equal(JSON.stringify(result).includes('null'), true); // covariance reason is explicitly null
    });
  }
}

test('Gaussian: mixed narrow and broad overlapping components escape equal-width seed basins', () => {
  const peaks = [
    { amplitude: 3.160543, center: -0.597195, width: 0.557146 },
    { amplitude: 2.284567, center: -0.227670, width: 0.318038 },
    { amplitude: 1.232025, center: 1.246944, width: 1.276215 },
  ];
  const result = fitTrace(grid(peaks, 'gaussian'), { peaks: 3 });
  assert.equal(result.converged, true);
  assert.ok(result.statistics.rmse < 1e-7);
  result.parameters.peaks.forEach((actual, i) => {
    close(actual.center, peaks[i].center, 2e-5);
    close(actual.width, peaks[i].width, 2e-5);
  });
});

test('sorting preserves source lines, input values and deterministic output', () => {
  const input = grid(mixtures[1], 'lorentzian', 81).reverse();
  const snapshot = structuredClone(input);
  const first = fitTrace(input, { model: 'lorentzian', peaks: 2 });
  assert.deepEqual(first, fitTrace(input, { model: 'lorentzian', peaks: 2 }));
  assert.deepEqual(input, snapshot);
  assert.equal(first.samples[0].sourceLine, 2);
  assert.equal(first.samples.at(-1).sourceLine, 82);
  for (const sample of first.samples) {
    close(sample.y, sample.fitted + sample.residual, 1e-14);
    close(evaluateTrace(sample.x, first.parameters, first.model), sample.fitted, 0);
  }
  assert.deepEqual(evaluateTrace([-1, 0, 1], first.parameters, first.model), [-1, 0, 1].map(x => evaluateTrace(x, first.parameters, first.model)));
});

test('normalization handles offset x units, small y units and changing baseline reference', () => {
  const peaks = mixtures[1];
  const result = fitTrace(grid(peaks, 'gaussian').map(row => ({ x: 1e9 + row.x * 1e-3, y: row.y * 1e-8 })), { peaks: 2 });
  assert.equal(result.converged, true);
  close(result.parameters.offset / 1e-8, 2, 1e-4);
  close(result.parameters.slope / 1e-5, 0.07, 1e-4);
  result.parameters.peaks.forEach((peak, i) => {
    close(peak.amplitude / 1e-8, peaks[i].amplitude, 1e-3);
    close((peak.center - 1e9) / 1e-3, peaks[i].center, 1e-4);
    close(peak.width / 1e-3, peaks[i].width, 1e-4);
  });
});

test('tiny x units retain a finite slope and explicit covariance range warnings', () => {
  for (const slope of [-0.001, 0, 0.001]) {
    const input = Array.from({ length: 81 }, (_, i) => {
      const x = (i - 40) / 10;
      return { x: x * 1e-310, y: Math.exp(-0.5 * x * x) + slope * x };
    });
    const result = fitTrace(input);
    assert.equal(result.converged, true);
    assert.ok(Number.isFinite(result.parameters.slope));
    close(result.parameters.slope * 1e-310, slope, 1e-8);
    close(result.parameters.peaks[0].width / 1e-310, 1, 1e-7);
    assert.ok(result.statistics.rmse < 1e-8);
    assert.equal(result.covariance.valid, false);
    assert.equal(result.covariance.reason, 'numerical-range');
    assert.ok(result.warnings.some(warning => warning.code === 'NUMERICAL_RANGE'));
    assert.ok(result.parameterTable.every(parameter => parameter.standardError === null));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test('slope conversion retains ordinary-order precision when numerator multiplication underflows', () => {
  const input = Array.from({ length: 81 }, (_, i) => {
    const x = (i - 40) / 10;
    return { x: x * 1e-200, y: Math.exp(-0.5 * x * x) * 1e-310 };
  });
  const result = fitTrace(input);
  assert.equal(result.converged, true);
  assert.ok(Number.isFinite(result.parameters.slope));
  // An exact power-of-two change of y units preserves the same normalized
  // observations while keeping the reference fit's intermediate products normal.
  const factor = 2 ** 1000;
  const reference = fitTrace(input.map(({ x, y }) => ({ x, y: y * factor })));
  assert.equal(reference.converged, true);
  assert.notEqual(reference.parameters.slope, 0);
  close(result.parameters.slope / (reference.parameters.slope / factor), 1, 1e-12);
  assert.equal(result.covariance.reason, 'numerical-range');
});

test('subnormal slope scale ratios preserve representable signed slopes', () => {
  for (const [xScale, yScale] of [[1, 1e-310], [1e200, 1e-110]]) {
    for (const slope of [-0.001, 0.001]) {
      const input = Array.from({ length: 81 }, (_, i) => {
        const x = (i - 40) / 10;
        return { x: x * xScale, y: (Math.exp(-0.5 * x * x) + slope * x) * yScale };
      });
      const result = fitTrace(input);
      assert.equal(result.converged, true);
      assert.ok(Number.isFinite(result.parameters.slope) && result.parameters.slope !== 0);
      close((result.parameters.slope * xScale) / yScale, slope, 1e-8);
      assert.equal(result.covariance.reason, 'numerical-range');
    }
  }
});

test('genuinely overflowing physical slopes are still rejected', () => {
  const input = Array.from({ length: 81 }, (_, i) => {
    const x = (i - 40) / 10;
    return { x: x * 1e-310, y: Math.exp(-0.5 * x * x) + 0.1 * x };
  });
  assert.throws(() => fitTrace(input), /parameter units exceed the floating-point range/);
});

test('Lorentzian evaluation retains representable far tails without changing ordinary evaluations', () => {
  const parameters = peak => ({ offset: 0, slope: 0, xReference: 0, peaks: [peak] });
  for (const [x, peak, expected] of [
    [1e200, { amplitude: 1e100, center: 0, width: 1 }, 1e-300],
    [-1e200, { amplitude: 1e100, center: 0, width: 1 }, 1e-300],
    [1e100, { amplitude: 1e300, center: 0, width: 1e-200 }, 1e-300],
    [1e308, { amplitude: 1e308, center: -1e308, width: 1 }, 2.5e-309],
    [1e308, { amplitude: 1e308, center: -1e308, width: 1e308 }, 2e307],
  ]) {
    const actual = evaluateTrace(x, parameters(peak), 'lorentzian');
    assert.ok(actual > 0 && Number.isFinite(actual));
    close(actual / expected, 1, 1e-12);
  }
  assert.equal(evaluateTrace(1e200, parameters({ amplitude: 0, center: 0, width: 1 }), 'lorentzian'), 0);
  const peak = { amplitude: 4, center: 0.7, width: 0.55 };
  for (const x of [-10, -1, 0, 0.7, 1, 10]) {
    const expected = 4 * 0.55 ** 2 / (0.55 ** 2 + (x - 0.7) ** 2);
    close(evaluateTrace(x, parameters(peak), 'lorentzian'), expected, 1e-14);
  }
});

function normalRandom(seed = 794) {
  let state = seed;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

test('heteroscedastic known sigma downweights imprecise observations and predicts held-out x', () => {
  const peaks = mixtures[1];
  const random = normalRandom();
  const input = grid(peaks, 'gaussian', 251).map(row => {
    const sigma = row.x > 0.2 && row.x < 1.6 ? 0.8 : 0.012;
    return { ...row, y: row.y + sigma * random(), sigma };
  });
  const result = fitTrace(input, { peaks: 2 });
  const unweighted = fitTrace(input.map(({ sigma, ...row }) => row), { peaks: 2 });
  assert.equal(result.converged, true);
  assert.equal(result.covariance.valid, true);
  assert.equal(result.covariance.mode, 'known-sigma');
  assert.ok(result.parameterTable.every(parameter => parameter.standardError > 0));
  const holdout = Array.from({ length: 100 }, (_, i) => -3.98 + i * 0.079);
  const predictionError = parameters => Math.sqrt(holdout.reduce((sum, x) => sum + (evaluateTrace(x, parameters) - truth(x, peaks, 'gaussian')) ** 2, 0) / holdout.length);
  assert.ok(predictionError(result.parameters) < 0.015);
  assert.ok(predictionError(result.parameters) < predictionError(unweighted.parameters) / 3);
  close(result.statistics.weightedRss, result.samples.reduce((sum, row) => sum + (row.residual / row.sigma) ** 2, 0), 1e-10);
});

// Independent finite-difference Fisher matrix in physical units. This tests
// Jacobian derivatives, units, covariance axes and known-sigma scaling at once.
function finiteDifferenceCovariance(result, sigma, residualScale = 1) {
  const parameters = result.parameters;
  const values = [parameters.offset, parameters.slope, parameters.peaks[0].amplitude, parameters.peaks[0].center, parameters.peaks[0].width];
  const unpack = vector => ({ offset: vector[0], slope: vector[1], xReference: parameters.xReference, peaks: [{ amplitude: vector[2], center: vector[3], width: vector[4] }] });
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const row of result.samples) {
    const jacobian = values.map((value, index) => {
      const step = 1e-5 * Math.max(1, Math.abs(value));
      const above = [...values];
      const below = [...values];
      above[index] += step;
      below[index] -= step;
      return (truth(row.x, unpack(above).peaks, result.model, above[0], above[1], parameters.xReference) - truth(row.x, unpack(below).peaks, result.model, below[0], below[1], parameters.xReference)) / (2 * step * sigma);
    });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) matrix[i][j] += jacobian[i] * jacobian[j];
  }
  const augmented = matrix.map((row, i) => [...row, ...Array.from({ length: 5 }, (_, j) => i === j ? 1 : 0)]);
  for (let i = 0; i < 5; i++) {
    const pivot = augmented[i][i];
    for (let j = 0; j < 10; j++) augmented[i][j] /= pivot;
    for (let k = 0; k < 5; k++) if (k !== i) {
      const factor = augmented[k][i];
      for (let j = 0; j < 10; j++) augmented[k][j] -= factor * augmented[i][j];
    }
  }
  return augmented.map(row => row.slice(5).map(value => value * residualScale));
}

for (const model of ['gaussian', 'lorentzian']) {
  test(`${model}: covariance agrees with independent physical-unit finite differences`, () => {
    const random = normalRandom();
    const input = grid(mixtures[0], model, 141).map(row => ({ ...row, y: row.y + 0.03 * random(), sigma: 0.03 }));
    for (const known of [true, false]) {
      const result = fitTrace(known ? input : input.map(({ sigma, ...row }) => row), { model });
      assert.equal(result.covariance.valid, true);
      const reference = finiteDifferenceCovariance(result, known ? 0.03 : 1, known ? 1 : result.statistics.rss / result.statistics.dof);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) close(result.covariance.matrix[i][j], reference[i][j], Math.max(1e-12, Math.abs(reference[i][j]) * 2e-5), `covariance ${i},${j}`);
      result.parameterTable.forEach((parameter, i) => close(parameter.standardError ** 2, result.covariance.matrix[i][i], 1e-14));
    }
  });
}

test('known sigma covariance is not rescaled to zero for an exact trace', () => {
  const input = grid(mixtures[0], 'gaussian', 101).map(row => ({ ...row, sigma: 0.05 }));
  const known = fitTrace(input);
  const scaled = fitTrace(input.map(({ sigma, ...row }) => row));
  assert.equal(known.covariance.valid, true);
  assert.equal(scaled.covariance.valid, true);
  assert.ok(known.parameterTable[2].standardError > 0.005);
  assert.ok(scaled.parameterTable[2].standardError < 1e-7);
});

test('iteration budget exhaustion is explicit, never dressed up as a successful fit', () => {
  const result = fitTrace(grid(mixtures[2], 'gaussian'), { peaks: 3, maxIterations: 1 });
  assert.equal(result.converged, false);
  assert.equal(result.status, 'max-iterations');
  assert.equal(result.iterations, 1);
  assert.equal(result.covariance.valid, false);
  assert.equal(result.covariance.matrix, null);
  assert.equal(result.covariance.reason, 'not-converged');
  assert.ok(result.parameterTable.every(parameter => parameter.standardError === null));
  assert.ok(result.warnings.some(warning => warning.code === 'NOT_CONVERGED'));
  assert.ok(result.samples.every(sample => Number.isFinite(sample.fitted)));
});

test('a center at a data boundary suppresses symmetric standard errors', () => {
  const input = Array.from({ length: 101 }, (_, i) => ({ x: i / 10, y: 2 + 4 * Math.exp(-0.5 * (i / 7) ** 2) }));
  const result = fitTrace(input);
  assert.equal(result.converged, true);
  close(result.parameters.peaks[0].center, 0, 1e-8);
  assert.equal(result.covariance.valid, false);
  assert.equal(result.covariance.reason, 'boundary');
  assert.ok(result.warnings.some(warning => warning.code === 'BOUNDARY'));
  assert.ok(result.parameterTable.every(parameter => parameter.standardError === null));
});

test('unidentifiable overlapping peaks return a singular diagnostic and null errors', () => {
  const peaks = [{ amplitude: 4, center: 0, width: 0.8 }];
  const result = fitTrace(grid(peaks, 'gaussian'), { peaks: 2, maxIterations: 300 });
  assert.equal(result.covariance.valid, false);
  assert.ok(result.warnings.some(warning => warning.code === 'SINGULAR' || warning.code === 'BOUNDARY'));
  assert.ok(result.parameterTable.every(parameter => parameter.standardError === null));
});

test('constant data flags unidentifiable peaks instead of giving invented uncertainties', () => {
  const result = fitTrace(Array.from({ length: 41 }, (_, i) => ({ x: i / 4, y: 3 })), { peaks: 2 });
  assert.ok(result.statistics.rmse < 1e-8);
  assert.equal(result.covariance.valid, false);
  assert.ok(result.warnings.some(warning => warning.code === 'BOUNDARY' || warning.code === 'SINGULAR'));
});

test('extreme finite sigma invalidates unrepresentable covariance instead of inventing zero or infinite errors', () => {
  for (const sigma of [1e-250, 1e250]) {
    const result = fitTrace(grid(mixtures[0], 'gaussian', 81).map(row => ({ ...row, sigma })));
    assert.equal(result.converged, true);
    assert.equal(result.covariance.valid, false);
    assert.equal(result.covariance.reason, 'numerical-range');
    assert.ok(result.warnings.some(warning => warning.code === 'NUMERICAL_RANGE'));
    assert.ok(result.parameterTable.every(parameter => parameter.standardError === null));
    const json = JSON.parse(JSON.stringify(result));
    assert.deepEqual(json, result);
  }
});

test('invalid input, duplicate x, incomplete sigma and impossible options are rejected', () => {
  const valid = grid(mixtures[0], 'gaussian', 31);
  assert.throws(() => fitTrace(valid.slice(0, 7)), /at least 8/);
  assert.throws(() => fitTrace(valid.slice(0, 12), { peaks: 3 }), /at least 13/);
  assert.throws(() => fitTrace([...valid, valid[0]]), /duplicate x/);
  assert.throws(() => fitTrace(valid.map((row, i) => i === 0 ? { ...row, y: NaN } : row)), /finite x and y/);
  assert.throws(() => fitTrace(valid.map((row, i) => i === 0 ? { ...row, sigma: 0.1 } : row)), /every sample/);
  assert.throws(() => fitTrace(valid.map(row => ({ ...row, sigma: 0 }))), /positive finite sigma/);
  assert.throws(() => fitTrace(valid, { model: 'voigt' }), /model/);
  assert.throws(() => fitTrace(valid, { peaks: 4 }), /peaks/);
  assert.throws(() => fitTrace(valid, { maxIterations: 0 }), /maxIterations/);
  assert.throws(() => fitTrace(valid, { multiStarts: 0 }), /multiStarts/);
  assert.throws(() => fitTrace(valid, { tolerance: NaN }), /tolerance/);
  assert.throws(() => fitTrace(valid, { peak: 2 }), /unknown fit option: peak/);
  assert.throws(() => fitTrace(valid, { weighted: true }), /unknown fit option: weighted/);
});
