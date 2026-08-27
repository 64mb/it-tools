import { describe, expect, it } from 'vitest';
import { LocalLlmProgressTracker, localLlmFileProgressPercentage } from './local-llm-progress';

describe('local LLM progress tracker', () => {
  it('keeps parallel files on independent monotonic progress bars', () => {
    const tracker = new LocalLlmProgressTracker();
    expect(tracker.update({
      files: [
        { file: 'decoder.onnx_data', loaded: 20, total: 100 },
        { file: 'embed.onnx_data', loaded: 10, total: 50 },
      ],
      loaded: 30,
      status: 'model:progress_total',
      total: 150,
    })).toHaveLength(2);

    const files = tracker.update({ file: 'decoder.onnx_data', loaded: 15, status: 'model:progress', total: 100 });
    expect(files.find(file => file.file === 'decoder.onnx_data')?.loaded).toBe(20);
    expect(files.find(file => file.file === 'embed.onnx_data')?.loaded).toBe(10);
  });

  it('starts a fresh set when model weights replace tokenizer files', () => {
    const tracker = new LocalLlmProgressTracker();
    tracker.update({ file: 'tokenizer.json', loaded: 100, status: 'tokenizer:progress', total: 100 });
    expect(tracker.update({ file: 'onnx/model.onnx', loaded: 1, status: 'model:progress', total: 10 }))
      .toEqual([{ file: 'onnx/model.onnx', loaded: 1, progress: undefined, total: 10 }]);
  });

  it('calculates bounded percentages without combining unrelated files', () => {
    expect(localLlmFileProgressPercentage({ file: 'a', loaded: 25, total: 100 })).toBe(25);
    expect(localLlmFileProgressPercentage({ file: 'a', progress: 120 })).toBe(100);
    expect(localLlmFileProgressPercentage({ file: 'a' })).toBeUndefined();
  });
});
