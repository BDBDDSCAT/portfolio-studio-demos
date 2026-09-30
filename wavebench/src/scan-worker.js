import { simulateExperiment } from './propagation.js';
self.onmessage = async ({ data }) => {
  try {
    const { params, mask, start, stop, steps } = data;
    if (params.method === 'fraunhofer')
      throw new Error('Propagation sweeps require a near-field model.');
    const n = params.gridSize,
      raw = new Float64Array(n * steps),
      phase = new Float32Array(n * steps),
      distances = new Float64Array(steps),
      powers = new Float64Array(steps),
      warnings = new Set();
    let peak = 0;
    for (let row = 0; row < steps; row++) {
      const z = start + ((stop - start) * row) / (steps - 1),
        result = simulateExperiment({ ...params, distanceMm: z }, n, mask);
      distances[row] = z;
      powers[row] = result.outputPower;
      for (let x = 0; x < n; x++) {
        const value = result.intensity[(n / 2) * n + x];
        raw[row * n + x] = value;
        phase[row * n + x] = result.phase[(n / 2) * n + x];
        peak = Math.max(peak, value);
      }
      for (const d of result.diagnostics) if (d.level === 'warning') warnings.add(d.code);
      self.postMessage({ progress: row + 1, steps });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    self.postMessage(
      {
        result: {
          raw,
          phase,
          distances,
          powers,
          peak,
          n,
          steps,
          pitchMm: params.windowMm / n,
          params,
          warnings: [...warnings],
        },
      },
      [raw.buffer, phase.buffer, distances.buffer, powers.buffer],
    );
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
