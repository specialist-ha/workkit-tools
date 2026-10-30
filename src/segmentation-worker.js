import { refineSelection } from './segmentation.js';

self.onmessage = async event => {
  const { file, points, id } = event.data;
  try {
    const mask = await refineSelection(file, points, message => self.postMessage({ type: 'progress', id, message }));
    self.postMessage({ type: 'done', id, width: mask.width, height: mask.height, alpha: mask.alpha }, [mask.alpha.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};
