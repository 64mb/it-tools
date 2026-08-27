import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_LLM_CACHE_NAME, LOCAL_LLM_MODELS } from './local-llm.models';
import {
  deleteLocalLlmModelCache,
  inspectLocalLlmModelCache,
  isLocalLlmModelCached,
  markLocalLlmModelCached,
} from './local-llm-cache';

class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(String(request));
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(String(request), response);
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map(url => new Request(url));
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = request instanceof Request ? request.url : String(request);
    return this.entries.delete(key);
  }
}

describe('local LLM model cache', () => {
  let cache: FakeCache;
  let cacheExists: boolean;

  beforeEach(() => {
    cache = new FakeCache();
    cacheExists = false;
    vi.stubGlobal('caches', {
      has: vi.fn(async (name: string) => {
        expect(name).toBe(LOCAL_LLM_CACHE_NAME);
        return cacheExists;
      }),
      open: vi.fn(async (name: string) => {
        expect(name).toBe(LOCAL_LLM_CACHE_NAME);
        cacheExists = true;
        return cache;
      }),
    });
  });

  it('marks a completed model without persisting prompts or responses', async () => {
    const model = LOCAL_LLM_MODELS[0];
    expect(await isLocalLlmModelCached(model.modelId)).toBe(false);
    await markLocalLlmModelCached(model.modelId);
    expect(await isLocalLlmModelCached(model.modelId)).toBe(true);
    const serialized = [...cache.entries.values()].map(response => response.clone().text());
    expect((await Promise.all(serialized)).join('')).not.toContain('prompt');
  });

  it('deletes only the selected model and its completion marker', async () => {
    const [lite, standard] = LOCAL_LLM_MODELS;
    cacheExists = true;
    cache.entries.set(`https://huggingface.co/${lite.modelId}/resolve/main/config.json`, new Response('{}'));
    cache.entries.set(`https://huggingface.co/${lite.modelId}/resolve/main/onnx/model.onnx`, new Response('lite'));
    cache.entries.set(`https://huggingface.co/${standard.modelId}/resolve/main/config.json`, new Response('{}'));
    await markLocalLlmModelCached(lite.modelId);
    await markLocalLlmModelCached(standard.modelId);

    await expect(deleteLocalLlmModelCache(lite.modelId)).resolves.toBe(3);
    expect(await isLocalLlmModelCached(lite.modelId)).toBe(false);
    expect(await isLocalLlmModelCached(standard.modelId)).toBe(true);
    expect([...cache.entries.keys()].some(key => key.includes(standard.modelId))).toBe(true);
  });

  it('reports and removes a partial model download without a completion marker', async () => {
    const model = LOCAL_LLM_MODELS[0];
    cacheExists = true;
    cache.entries.set(`https://huggingface.co/${model.modelId}/resolve/main/onnx/model.onnx`, new Response('partial'));

    await expect(inspectLocalLlmModelCache(model.modelId)).resolves.toEqual({ complete: false, entryCount: 1 });
    await expect(deleteLocalLlmModelCache(model.modelId)).resolves.toBe(1);
    await expect(inspectLocalLlmModelCache(model.modelId)).resolves.toEqual({ complete: false, entryCount: 0 });
  });
});
