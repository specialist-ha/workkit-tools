import { removeBackground } from '@imgly/background-removal';

export async function removeImageBackground(file, onProgress) {
  return removeBackground(file, {
    progress: (key, current, total) => {
      if (total > 0) onProgress?.(Math.round(current / total * 100));
    },
  });
}
