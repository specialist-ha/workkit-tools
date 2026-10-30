// Guided segmentation: entirely on-device inference with SlimSAM + Transformers.js.
// Models are downloaded from Hugging Face; image bytes stay in the browser.
import { SamModel, AutoProcessor, RawImage, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

const MODEL_ID = 'Xenova/slimsam-77-uniform';
let modelPromise;

async function loadModel() {
  if (!navigator.gpu) throw new Error('AI 영역 재분석에는 WebGPU를 지원하는 최신 Chrome 또는 Edge가 필요합니다.');
  modelPromise ||= Promise.all([
    SamModel.from_pretrained(MODEL_ID, { dtype: 'fp16', device: 'webgpu' }),
    AutoProcessor.from_pretrained(MODEL_ID),
  ]).catch(error => { modelPromise = null; throw error; });
  return modelPromise;
}

export async function refineSelection(file, points) {
  if (!points.length) throw new Error('살릴 영역 또는 지울 영역을 먼저 표시해주세요.');
  const [model, processor] = await loadModel();
  const url = URL.createObjectURL(file);
  try {
    const image = await RawImage.fromURL(url);
    const processed = await processor(image);
    const embeddings = await model.get_image_embeddings(processed);
    const [height, width] = processed.reshaped_input_sizes[0];
    const input_points = new Tensor('float32', points.flatMap(p => [p.x * width, p.y * height]), [1, 1, points.length, 2]);
    const input_labels = new Tensor('int64', points.map(p => BigInt(p.keep ? 1 : 0)), [1, 1, points.length]);
    const { pred_masks, iou_scores } = await model({ ...embeddings, input_points, input_labels });
    const masks = await processor.post_process_masks(pred_masks, processed.original_sizes, processed.reshaped_input_sizes);
    const mask = RawImage.fromTensor(masks[0][0]);
    const count = iou_scores.data.length;
    let best = 0;
    for (let i = 1; i < count; i++) if (iou_scores.data[i] > iou_scores.data[best]) best = i;
    const alpha = new Uint8ClampedArray(mask.width * mask.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[count * i + best] ? 255 : 0;
    return { width: mask.width, height: mask.height, alpha };
  } finally {
    URL.revokeObjectURL(url);
  }
}
