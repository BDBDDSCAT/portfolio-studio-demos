import { computeDiffraction } from './optics.js';
self.onmessage = ({ data }) => {
  try {
    const result = computeDiffraction(data.params, 512, data.mask);
    const buffers = ['intensity', 'amplitude', 'phase', 'cut'].map((key) => result[key].buffer);
    self.postMessage({ id: data.id, result }, buffers);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
