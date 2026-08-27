import { describe, expect, it } from 'vitest';
import {
  LOCAL_LLM_MAX_NEW_TOKENS,
  LOCAL_LLM_MAX_OUTPUT_CHARACTERS,
  LOCAL_LLM_MAX_PROMPT_CHARACTERS,
  LOCAL_LLM_MODELS,
} from './local-llm.models';
import {
  parseLocalLlmWorkerMessage,
  parseLocalLlmWorkerRequest,
  validateLocalLlmGenerationOptions,
} from './local-llm.protocol';

describe('local LLM protocol', () => {
  it('accepts only the reviewed Lite, Standard, and Quality model identifiers', () => {
    for (const model of LOCAL_LLM_MODELS) {
      expect(parseLocalLlmWorkerRequest({ jobId: 1, modelId: model.modelId, type: 'load' }))
        .toEqual({ jobId: 1, modelId: model.modelId, type: 'load' });
    }
    expect(() => parseLocalLlmWorkerRequest({ jobId: 1, modelId: 'unknown/max-model', type: 'load' }))
      .toThrow('not supported');
  });

  it('trims bounded generation input and rejects oversized prompts and output limits', () => {
    expect(validateLocalLlmGenerationOptions({
      maxNewTokens: 512,
      prompt: '  Explain this  ',
      systemPrompt: '  Be concise  ',
    })).toEqual({ maxNewTokens: 512, prompt: 'Explain this', systemPrompt: 'Be concise' });

    expect(() => validateLocalLlmGenerationOptions({
      maxNewTokens: 512,
      prompt: 'x'.repeat(LOCAL_LLM_MAX_PROMPT_CHARACTERS + 1),
      systemPrompt: '',
    })).toThrow('limited');
    expect(() => validateLocalLlmGenerationOptions({
      maxNewTokens: LOCAL_LLM_MAX_NEW_TOKENS + 1,
      prompt: 'Hello',
      systemPrompt: '',
    })).toThrow('Maximum output');
  });

  it('rejects malformed streaming and terminal worker envelopes', () => {
    expect(parseLocalLlmWorkerMessage({
      jobId: 2,
      progress: {
        files: [{ file: 'onnx/model.onnx_data', loaded: 5, total: 10 }],
        status: 'model:progress_total',
      },
      type: 'progress',
    })).toMatchObject({
      progress: { files: [{ file: 'onnx/model.onnx_data', loaded: 5, total: 10 }] },
    });
    expect(parseLocalLlmWorkerMessage({
      jobId: 2,
      text: 'hello',
      tokenCount: 3,
      type: 'token',
    })).toMatchObject({ text: 'hello', tokenCount: 3, type: 'token' });
    expect(() => parseLocalLlmWorkerMessage({ jobId: 2, text: 42, tokenCount: 3, type: 'token' }))
      .toThrow('invalid text fragment');
    expect(() => parseLocalLlmWorkerMessage({
      cancelled: false,
      elapsedMs: 1,
      jobId: 2,
      output: 'x'.repeat(LOCAL_LLM_MAX_OUTPUT_CHARACTERS + 1),
      tokenCount: 3,
      type: 'generated',
    })).toThrow('invalid result');
    expect(() => parseLocalLlmWorkerMessage({ jobId: 0, type: 'loaded' }))
      .toThrow('job identifier');
  });
});
