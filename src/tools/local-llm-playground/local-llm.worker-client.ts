import {
  LOCAL_LLM_MAX_OUTPUT_CHARACTERS,
  type LocalLlmModel,
} from './local-llm.models';
import {
  LocalLlmError,
  type LocalLlmGenerationOptions,
  type LocalLlmProgress,
  type LocalLlmWorkerRequest,
  parseLocalLlmWorkerMessage,
  validateLocalLlmGenerationOptions,
} from './local-llm.protocol';

const MODEL_LOAD_TIMEOUT_MS = 30 * 60 * 1_000;
const GENERATION_TIMEOUT_MS = 10 * 60 * 1_000;
const CANCEL_GRACE_MS = 2_000;

export interface LocalLlmWorkerHandle {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (message: LocalLlmWorkerRequest) => void
  terminate: () => void
}

export type LocalLlmWorkerFactory = () => LocalLlmWorkerHandle;

export interface LocalLlmGenerationResult {
  cancelled: boolean
  elapsedMs: number
  output: string
  tokenCount: number
}

interface ActiveOperation {
  jobId: number
  kind: 'load' | 'generate'
  timeout: ReturnType<typeof globalThis.setTimeout>
  cancelFallback?: ReturnType<typeof globalThis.setTimeout>
  expectedModelId?: string
  lastTokenCount: number
  maxNewTokens?: number
  onProgress?: (progress: LocalLlmProgress) => void
  onToken?: (text: string, tokenCount: number) => void
  streamedCharacters: number
  resolve: (value: { elapsedMs: number } | LocalLlmGenerationResult) => void
  reject: (error: LocalLlmError) => void
}

function createWorker(): LocalLlmWorkerHandle {
  return new Worker(new URL('./local-llm.worker.ts', import.meta.url), {
    name: 'it-tools-local-llm',
    type: 'module',
  });
}

export class LocalLlmWorkerClient {
  private worker: LocalLlmWorkerHandle | undefined;
  private active: ActiveOperation | undefined;
  private nextJobId = 0;
  private loadedModelId: string | undefined;
  private disposed = false;

  constructor(private readonly workerFactory: LocalLlmWorkerFactory = createWorker) {}

  get currentModelId(): string | undefined {
    return this.loadedModelId;
  }

  async load(model: LocalLlmModel, onProgress?: (progress: LocalLlmProgress) => void): Promise<{ elapsedMs: number }> {
    if (this.loadedModelId === model.modelId) {
      return { elapsedMs: 0 };
    }
    if (this.loadedModelId) {
      throw new LocalLlmError('model', 'Unload the current model before selecting another one.');
    }
    return this.startOperation('load', MODEL_LOAD_TIMEOUT_MS, onProgress, undefined, jobId => ({
      jobId,
      modelId: model.modelId,
      type: 'load',
    })) as Promise<{ elapsedMs: number }>;
  }

  async generate(
    options: LocalLlmGenerationOptions,
    onToken?: (text: string, tokenCount: number) => void,
  ): Promise<LocalLlmGenerationResult> {
    if (!this.loadedModelId) {
      throw new LocalLlmError('model', 'Load a local model before generating.');
    }
    const validated = validateLocalLlmGenerationOptions(options);
    return this.startOperation('generate', GENERATION_TIMEOUT_MS, undefined, onToken, jobId => ({
      ...validated,
      jobId,
      type: 'generate',
    })) as Promise<LocalLlmGenerationResult>;
  }

  cancelGeneration(): void {
    const active = this.active;
    if (!active || active.kind !== 'generate' || !this.worker || active.cancelFallback) {
      return;
    }
    this.worker.postMessage({ jobId: active.jobId, type: 'cancel' });
    active.cancelFallback = globalThis.setTimeout(() => {
      this.invalidate(new LocalLlmError('cancelled', 'Generation was cancelled and the model was unloaded.'));
    }, CANCEL_GRACE_MS);
  }

  cancelLoad(): void {
    if (this.active?.kind === 'load') {
      this.invalidate(new LocalLlmError('cancelled', 'Model loading was cancelled.'));
    }
  }

  unload(): void {
    this.rejectActive(new LocalLlmError('cancelled', 'The local model was unloaded.'));
    this.terminateWorker();
    this.loadedModelId = undefined;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectActive(new LocalLlmError('cancelled', 'The local model tool was closed.'));
    this.terminateWorker();
    this.loadedModelId = undefined;
  }

  private startOperation(
    kind: 'load' | 'generate',
    timeoutMs: number,
    onProgress: ((progress: LocalLlmProgress) => void) | undefined,
    onToken: ((text: string, tokenCount: number) => void) | undefined,
    request: (jobId: number) => LocalLlmWorkerRequest,
  ): Promise<{ elapsedMs: number } | LocalLlmGenerationResult> {
    if (this.disposed) {
      return Promise.reject(new LocalLlmError('unavailable', 'The local model tool has already been closed.'));
    }
    if (this.active) {
      return Promise.reject(new LocalLlmError('worker', 'Another local model operation is already running.'));
    }
    let worker: LocalLlmWorkerHandle;
    try {
      worker = this.ensureWorker();
    }
    catch {
      return Promise.reject(new LocalLlmError('unavailable', 'Web Workers are unavailable in this browser.'));
    }
    this.nextJobId = this.nextJobId === Number.MAX_SAFE_INTEGER ? 1 : this.nextJobId + 1;
    const jobId = this.nextJobId;

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.invalidate(new LocalLlmError('worker', `${kind === 'load' ? 'Model loading' : 'Generation'} timed out.`));
      }, timeoutMs);
      const payload = request(jobId);
      this.active = {
        expectedModelId: payload.type === 'load' ? payload.modelId : undefined,
        jobId,
        kind,
        lastTokenCount: 0,
        maxNewTokens: payload.type === 'generate' ? payload.maxNewTokens : undefined,
        onProgress,
        onToken,
        reject,
        resolve,
        streamedCharacters: 0,
        timeout,
      };
      try {
        worker.postMessage(payload);
      }
      catch {
        this.invalidate(new LocalLlmError('worker', 'The local model worker could not be started.'));
      }
    });
  }

  private ensureWorker(): LocalLlmWorkerHandle {
    if (this.worker) {
      return this.worker;
    }
    const worker = this.workerFactory();
    worker.onmessage = event => this.handleMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.invalidate(new LocalLlmError('worker', 'The local model worker stopped unexpectedly.'));
    };
    worker.onmessageerror = (event) => {
      event.preventDefault();
      this.invalidate(new LocalLlmError('worker', 'The local model worker returned an unreadable message.'));
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(value: unknown): void {
    let message;
    try {
      message = parseLocalLlmWorkerMessage(value);
    }
    catch (error) {
      this.invalidate(error instanceof LocalLlmError ? error : new LocalLlmError('worker', 'The local model worker returned an invalid message.'));
      return;
    }
    const active = this.active;
    if (!active || message.jobId !== active.jobId) {
      return;
    }
    if (message.type === 'progress') {
      if (active.kind !== 'load') {
        this.invalidate(new LocalLlmError('worker', 'The local model worker returned progress for the wrong operation.'));
        return;
      }
      active.onProgress?.(message.progress);
      return;
    }
    if (message.type === 'token') {
      const nextCharacters = active.streamedCharacters + message.text.length;
      if (active.kind !== 'generate'
        || message.tokenCount < active.lastTokenCount
        || message.tokenCount > (active.maxNewTokens ?? 0)
        || nextCharacters > LOCAL_LLM_MAX_OUTPUT_CHARACTERS) {
        this.invalidate(new LocalLlmError('worker', 'The local model worker exceeded its streaming result bounds.'));
        return;
      }
      active.lastTokenCount = message.tokenCount;
      active.streamedCharacters = nextCharacters;
      active.onToken?.(message.text, message.tokenCount);
      return;
    }
    if (message.type === 'error') {
      this.finishActive();
      active.reject(new LocalLlmError(message.code, message.message));
      return;
    }
    if (message.type === 'loaded') {
      if (active.kind !== 'load' || message.modelId !== active.expectedModelId) {
        this.invalidate(new LocalLlmError('worker', 'The local model worker returned the wrong loaded model.'));
        return;
      }
      this.loadedModelId = message.modelId;
      this.finishActive();
      active.resolve({ elapsedMs: message.elapsedMs });
      return;
    }
    if (active.kind !== 'generate' || message.tokenCount > (active.maxNewTokens ?? 0)) {
      this.invalidate(new LocalLlmError('worker', 'The local model worker returned a result for the wrong operation.'));
      return;
    }
    this.finishActive();
    active.resolve({
      cancelled: message.cancelled,
      elapsedMs: message.elapsedMs,
      output: message.output,
      tokenCount: message.tokenCount,
    });
  }

  private finishActive(): void {
    if (!this.active) {
      return;
    }
    globalThis.clearTimeout(this.active.timeout);
    if (this.active.cancelFallback !== undefined) {
      globalThis.clearTimeout(this.active.cancelFallback);
    }
    this.active = undefined;
  }

  private rejectActive(error: LocalLlmError): void {
    const active = this.active;
    if (!active) {
      return;
    }
    this.finishActive();
    active.reject(error);
  }

  private invalidate(error: LocalLlmError): void {
    this.rejectActive(error);
    this.terminateWorker();
    this.loadedModelId = undefined;
  }

  private terminateWorker(): void {
    if (!this.worker) {
      return;
    }
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = undefined;
  }
}

export function createLocalLlmWorkerClient(): LocalLlmWorkerClient {
  return new LocalLlmWorkerClient();
}
