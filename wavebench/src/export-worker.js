import { simulateExperiment } from './propagation.js';
import { buildGridCsv } from './experiment.js';
self.onmessage = ({ data }) => {
  try {
    const result = simulateExperiment(data.params, data.params.gridSize, data.mask);
    const blob = new Blob([buildGridCsv(result)], { type: 'text/csv;charset=utf-8' });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
