import { describe, expect, it } from 'vitest';
import modelAssets from './local-llm-model-assets.json';
import {
  LOCAL_LLM_MODELS,
  formatLocalLlmBytes,
  getLocalLlmModelAssetBasePath,
} from './local-llm.models';

describe('local LLM model assets', () => {
  it('keeps runtime models aligned with the pinned same-origin mirror catalog', () => {
    expect(modelAssets.models.map(({ key, modelId, revision }) => ({ key, modelId, revision })))
      .toEqual(LOCAL_LLM_MODELS.map(({ key, modelId, revision }) => ({ key, modelId, revision })));
  });

  it('builds a base-aware same-origin asset path', () => {
    expect(getLocalLlmModelAssetBasePath(LOCAL_LLM_MODELS[0], '/it-tools/'))
      .toBe(`/it-tools/assets/local-llm-models/${LOCAL_LLM_MODELS[0].revision}/`);
  });

  it('contains only the text q4 sessions and their pinned external data chunks', () => {
    for (const model of modelAssets.models) {
      expect(model.files).toContain('onnx/decoder_model_merged_q4.onnx');
      expect(model.files).toContain('onnx/embed_tokens_q4.onnx');
      expect(model.files.some(file => /vision_encoder|fp16|quantized/u.test(file))).toBe(false);
    }
  });

  it('uses byte-sized units for small download progress values', () => {
    expect(formatLocalLlmBytes(0)).toBe('0 B');
    expect(formatLocalLlmBytes(857)).toBe('857 B');
    expect(formatLocalLlmBytes(1.5 * 1024)).toBe('1.5 KiB');
    expect(formatLocalLlmBytes(155 * 1024 ** 2)).toBe('155 MiB');
  });
});
