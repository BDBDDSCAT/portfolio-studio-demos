import { simulateExperiment } from './propagation.js';
self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    if (data.kind === 'compare') {
      const p = data.params,
        fresnel = simulateExperiment({ ...p, method: 'fresnel' }, p.gridSize, data.mask),
        asm = simulateExperiment({ ...p, method: 'angular-spectrum' }, p.gridSize, data.mask);
      let fieldError = 0,
        fieldNorm = 0,
        intensityError = 0,
        intensityNorm = 0;
      for (let i = 0; i < asm.intensity.length; i++) {
        fieldError += (fresnel.real[i] - asm.real[i]) ** 2 + (fresnel.imag[i] - asm.imag[i]) ** 2;
        fieldNorm += asm.intensity[i];
        intensityError += (fresnel.intensity[i] - asm.intensity[i]) ** 2;
        intensityNorm += asm.intensity[i] ** 2;
      }
      self.postMessage({
        id: data.id,
        comparison: {
          fieldRelativeL2: Math.sqrt(fieldError / Math.max(fieldNorm, 1e-300)),
          intensityRelativeL2: Math.sqrt(intensityError / Math.max(intensityNorm, 1e-300)),
          elapsed: performance.now() - start,
        },
      });
      return;
    }
    const result = simulateExperiment(data.params, data.params.gridSize, data.mask);
    self.postMessage(
      { id: data.id, result, elapsed: performance.now() - start },
      [
        'intensity',
        'normalizedIntensity',
        'real',
        'imag',
        'phase',
        'inputAmplitude',
        'inputPhase',
      ].map((key) => result[key].buffer),
    );
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
