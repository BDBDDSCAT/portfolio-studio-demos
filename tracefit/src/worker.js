import { fitTrace } from './fit.js';
self.onmessage = ({ data: { id, samples, options } }) => {
  try { self.postMessage({ id, result: fitTrace(samples, options) }); }
  catch (error) { self.postMessage({ id, error: error.message }); }
};
