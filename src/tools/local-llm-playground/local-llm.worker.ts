/// <reference lib="webworker" />

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import {
  LOCAL_LLM_CACHE_NAME,
  LOCAL_LLM_MAX_ERROR_CHARACTERS,
  LOCAL_LLM_MAX_OUTPUT_CHARACTERS,
  LOCAL_LLM_MAX_PROGRESS_FILES,
  LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS,
  LOCAL_LLM_MAX_PROGRESS_STATUS_CHARACTERS,
  getLocalLlmModelAssetBasePath,
  getLocalLlmModelById,
} from './local-llm.models';
import {
  LocalLlmError,
  type LocalLlmErrorCode,
  type LocalLlmProgress,
  type LocalLlmWorkerMessage,
  parseLocalLlmWorkerRequest,
} from './local-llm.protocol';

type LocalTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type LocalModel = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
type LocalStoppingCriteria = InstanceType<typeof InterruptableStoppingCriteria>;

interface LocalLlmWorkerScope {
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void
  postMessage: (message: LocalLlmWorkerMessage) => void
}

const workerScope = globalThis as unknown as LocalLlmWorkerScope;
let runtimePromise: Promise<void> | undefined;
let tokenizer: LocalTokenizer | undefined;
let model: LocalModel | undefined;
let loadedModelId: string | undefined;
let activeJobId: number | undefined;
let activeOperation: 'load' | 'generate' | undefined;
let stoppingCriteria: LocalStoppingCriteria | undefined;
let generationCancelled = false;

function post(message: LocalLlmWorkerMessage): void {
  workerScope.postMessage(message);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, LOCAL_LLM_MAX_ERROR_CHARACTERS);
  }
  return 'The local model operation failed.';
}

function normalizeProgress(value: unknown, phase: string): LocalLlmProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: phase };
  }
  const record = value as Record<string, unknown>;
  const finite = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
    ? candidate
    : undefined;
  const files = record.files && typeof record.files === 'object' && !Array.isArray(record.files)
    ? Object.entries(record.files as Record<string, unknown>)
      .slice(0, LOCAL_LLM_MAX_PROGRESS_FILES)
      .flatMap(([file, fileProgress]) => {
        if (!file || typeof fileProgress !== 'object' || fileProgress === null || Array.isArray(fileProgress)) {
          return [];
        }
        const fileRecord = fileProgress as Record<string, unknown>;
        return [{
          file: file.slice(0, LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS),
          loaded: finite(fileRecord.loaded),
          total: finite(fileRecord.total),
        }];
      })
    : undefined;
  return {
    file: typeof record.file === 'string' ? record.file.slice(0, LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS) : undefined,
    files,
    loaded: finite(record.loaded),
    progress: finite(record.progress),
    status: (typeof record.status === 'string' ? `${phase}:${record.status}` : phase)
      .slice(0, LOCAL_LLM_MAX_PROGRESS_STATUS_CHARACTERS),
    total: finite(record.total),
  };
}

async function initializeRuntime(): Promise<void> {
  runtimePromise ??= (async () => {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.experimental_useCrossOriginStorage = false;
    env.useFS = false;
    env.useFSCache = false;
    env.useBrowserCache = false;
    env.useCustomCache = false;
    env.customCache = null;

    if (typeof globalThis.caches !== 'undefined') {
      try {
        env.customCache = await globalThis.caches.open(LOCAL_LLM_CACHE_NAME);
        env.useCustomCache = true;
      }
      catch {
        // The model can still run for this tab when Cache Storage is denied.
      }
    }
  })();
  await runtimePromise;
}

async function loadModel(jobId: number, modelId: string): Promise<void> {
  if (activeOperation) {
    throw new LocalLlmError('worker', 'Another local model operation is already running.');
  }
  if (loadedModelId === modelId && tokenizer && model) {
    post({ elapsedMs: 0, jobId, modelId, type: 'loaded' });
    return;
  }
  if (loadedModelId && loadedModelId !== modelId) {
    throw new LocalLlmError('model', 'Unload the current model before selecting another one.');
  }

  activeJobId = jobId;
  activeOperation = 'load';
  const startedAt = performance.now();
  try {
    await initializeRuntime();
    const selectedModel = getLocalLlmModelById(modelId);
    if (!selectedModel) {
      throw new LocalLlmError('model', 'The requested local model is not supported.');
    }
    env.localModelPath = getLocalLlmModelAssetBasePath(selectedModel, import.meta.env.BASE_URL);
    post({ jobId, progress: { status: 'runtime:ready' }, type: 'progress' });
    tokenizer = await AutoTokenizer.from_pretrained(modelId, {
      local_files_only: true,
      progress_callback: value => post({ jobId, progress: normalizeProgress(value, 'tokenizer'), type: 'progress' }),
    });
    model = await AutoModelForCausalLM.from_pretrained(modelId, {
      device: 'webgpu',
      dtype: {
        decoder_model_merged: 'q4',
        embed_tokens: 'q4',
      },
      local_files_only: true,
      progress_callback: value => post({ jobId, progress: normalizeProgress(value, 'model'), type: 'progress' }),
    });
    loadedModelId = modelId;
    post({ elapsedMs: performance.now() - startedAt, jobId, modelId, type: 'loaded' });
  }
  catch (error) {
    tokenizer = undefined;
    model = undefined;
    loadedModelId = undefined;
    throw error;
  }
  finally {
    activeJobId = undefined;
    activeOperation = undefined;
  }
}

async function generateText(
  jobId: number,
  prompt: string,
  systemPrompt: string,
  maxNewTokens: number,
): Promise<void> {
  if (activeOperation) {
    throw new LocalLlmError('worker', 'Another local model operation is already running.');
  }
  if (!tokenizer || !model || !loadedModelId) {
    throw new LocalLlmError('model', 'Load a local model before generating.');
  }

  activeJobId = jobId;
  activeOperation = 'generate';
  generationCancelled = false;
  const startedAt = performance.now();
  let output = '';
  let tokenCount = 0;
  try {
    await initializeRuntime();
    stoppingCriteria = new InterruptableStoppingCriteria();
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ content: systemPrompt, role: 'system' });
    }
    messages.push({ content: prompt, role: 'user' });
    const chatPrompt = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });
    const modelInputs = await tokenizer(`${chatPrompt}<think>\n\n</think>\n\n`);
    const streamer = new TextStreamer(tokenizer, {
      callback_function: (fragment) => {
        if (!fragment || generationCancelled) {
          return;
        }
        const available = LOCAL_LLM_MAX_OUTPUT_CHARACTERS - output.length;
        const accepted = fragment.slice(0, Math.max(0, available));
        output += accepted;
        if (accepted) {
          post({ jobId, text: accepted, tokenCount, type: 'token' });
        }
        if (accepted.length !== fragment.length) {
          stoppingCriteria?.interrupt();
        }
      },
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => {
        tokenCount += 1;
      },
    });

    await model.generate({
      ...modelInputs,
      do_sample: false,
      max_new_tokens: maxNewTokens,
      streamer,
      stopping_criteria: stoppingCriteria,
    });

    output = output.replace(/<\|im_end\|>/gu, '').trimStart();
    post({
      cancelled: generationCancelled,
      elapsedMs: performance.now() - startedAt,
      jobId,
      output,
      tokenCount,
      type: 'generated',
    });
  }
  finally {
    stoppingCriteria = undefined;
    activeJobId = undefined;
    activeOperation = undefined;
    generationCancelled = false;
  }
}

function errorCode(error: unknown, operation: 'load' | 'generate' | undefined): LocalLlmErrorCode {
  if (error instanceof LocalLlmError) {
    return error.code;
  }
  const message = toErrorMessage(error);
  if (/WebGPU|GPU|adapter|device/iu.test(message)) {
    return 'unavailable';
  }
  return operation === 'load' ? 'model' : 'worker';
}

async function handleRequest(value: unknown): Promise<void> {
  let jobId = 1;
  let operation: 'load' | 'generate' | undefined;
  try {
    const request = parseLocalLlmWorkerRequest(value);
    jobId = request.jobId;
    if (request.type === 'cancel') {
      if (activeOperation === 'generate' && activeJobId === request.jobId) {
        generationCancelled = true;
        stoppingCriteria?.interrupt();
      }
      return;
    }
    if (request.type === 'load') {
      operation = 'load';
      await loadModel(request.jobId, request.modelId);
      return;
    }
    operation = 'generate';
    await generateText(request.jobId, request.prompt, request.systemPrompt, request.maxNewTokens);
  }
  catch (error) {
    post({ code: errorCode(error, operation), jobId, message: toErrorMessage(error), type: 'error' });
  }
}

workerScope.addEventListener('message', (event) => {
  handleRequest(event.data);
});
