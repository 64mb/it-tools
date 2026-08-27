import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_LLM_MAX_OUTPUT_CHARACTERS, LOCAL_LLM_MODELS } from './local-llm.models';
import {
  LocalLlmWorkerClient,
  type LocalLlmWorkerHandle,
} from './local-llm.worker-client';
import type { LocalLlmError, LocalLlmWorkerRequest } from './local-llm.protocol';

class FakeWorker implements LocalLlmWorkerHandle {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: LocalLlmWorkerRequest[] = [];
  terminated = false;

  postMessage(message: LocalLlmWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function createHarness() {
  const workers: FakeWorker[] = [];
  const client = new LocalLlmWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

async function expectCode(promise: Promise<unknown>, code: LocalLlmError['code']): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code, name: 'LocalLlmError' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LocalLlmWorkerClient', () => {
  it('loads lazily, reports progress, and streams a bounded generation result', async () => {
    const { client, workers } = createHarness();
    expect(workers).toHaveLength(0);
    const progress = vi.fn();
    const loading = client.load(LOCAL_LLM_MODELS[1], progress);
    expect(workers).toHaveLength(1);
    expect(workers[0].posted[0]).toMatchObject({ jobId: 1, modelId: LOCAL_LLM_MODELS[1].modelId, type: 'load' });
    workers[0].emit({ jobId: 1, progress: { loaded: 5, status: 'model:progress', total: 10 }, type: 'progress' });
    workers[0].emit({ elapsedMs: 1_500, jobId: 1, modelId: LOCAL_LLM_MODELS[1].modelId, type: 'loaded' });
    await expect(loading).resolves.toEqual({ elapsedMs: 1_500 });
    expect(progress).toHaveBeenCalledWith({ loaded: 5, progress: undefined, status: 'model:progress', total: 10, file: undefined });

    const streamed = vi.fn();
    const generation = client.generate({ maxNewTokens: 64, prompt: 'Hello', systemPrompt: '' }, streamed);
    workers[0].emit({ jobId: 2, text: 'Hi ', tokenCount: 1, type: 'token' });
    workers[0].emit({ jobId: 2, text: 'there', tokenCount: 2, type: 'token' });
    workers[0].emit({ cancelled: false, elapsedMs: 250, jobId: 2, output: 'Hi there', tokenCount: 2, type: 'generated' });
    await expect(generation).resolves.toEqual({ cancelled: false, elapsedMs: 250, output: 'Hi there', tokenCount: 2 });
    expect(streamed.mock.calls.map(([fragment]) => fragment).join('')).toBe('Hi there');
    expect(workers).toHaveLength(1);
  });

  it('uses graceful generation cancellation and physically terminates a stuck worker', async () => {
    vi.useFakeTimers();
    const { client, workers } = createHarness();
    const loading = client.load(LOCAL_LLM_MODELS[0]);
    workers[0].emit({ elapsedMs: 10, jobId: 1, modelId: LOCAL_LLM_MODELS[0].modelId, type: 'loaded' });
    await loading;

    const graceful = client.generate({ maxNewTokens: 64, prompt: 'Hello', systemPrompt: '' });
    client.cancelGeneration();
    expect(workers[0].posted.at(-1)).toEqual({ jobId: 2, type: 'cancel' });
    workers[0].emit({ cancelled: true, elapsedMs: 20, jobId: 2, output: 'partial', tokenCount: 1, type: 'generated' });
    await expect(graceful).resolves.toMatchObject({ cancelled: true, output: 'partial' });
    expect(workers[0].terminated).toBe(false);

    const stuck = client.generate({ maxNewTokens: 64, prompt: 'Again', systemPrompt: '' });
    const stuckRejection = expectCode(stuck, 'cancelled');
    client.cancelGeneration();
    await vi.advanceTimersByTimeAsync(2_000);
    await stuckRejection;
    expect(workers[0].terminated).toBe(true);
    expect(client.currentModelId).toBeUndefined();
  });

  it('physically terminates downloads and route disposal, then rejects stale work', async () => {
    const { client, workers } = createHarness();
    const loading = client.load(LOCAL_LLM_MODELS[2]);
    client.cancelLoad();
    await expectCode(loading, 'cancelled');
    expect(workers[0].terminated).toBe(true);

    const retry = client.load(LOCAL_LLM_MODELS[0]);
    expect(workers).toHaveLength(2);
    client.dispose();
    await expectCode(retry, 'cancelled');
    expect(workers[1].terminated).toBe(true);
    workers[1].emit({ elapsedMs: 1, jobId: 2, modelId: LOCAL_LLM_MODELS[0].modelId, type: 'loaded' });
    expect(client.currentModelId).toBeUndefined();
  });

  it('rejects cumulative streaming output beyond the transport bound', async () => {
    const { client, workers } = createHarness();
    const loading = client.load(LOCAL_LLM_MODELS[0]);
    workers[0].emit({ elapsedMs: 10, jobId: 1, modelId: LOCAL_LLM_MODELS[0].modelId, type: 'loaded' });
    await loading;

    const generation = client.generate({ maxNewTokens: 64, prompt: 'Hello', systemPrompt: '' });
    const rejection = expectCode(generation, 'worker');
    const fragment = 'x'.repeat(Math.floor(LOCAL_LLM_MAX_OUTPUT_CHARACTERS / 2) + 1);
    workers[0].emit({ jobId: 2, text: fragment, tokenCount: 1, type: 'token' });
    workers[0].emit({ jobId: 2, text: fragment, tokenCount: 2, type: 'token' });
    await rejection;
    expect(workers[0].terminated).toBe(true);
  });
});
