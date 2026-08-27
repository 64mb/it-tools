import {
  LOCAL_LLM_MAX_ERROR_CHARACTERS,
  LOCAL_LLM_MAX_NEW_TOKENS,
  LOCAL_LLM_MAX_OUTPUT_CHARACTERS,
  LOCAL_LLM_MAX_PROGRESS_FILES,
  LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS,
  LOCAL_LLM_MAX_PROGRESS_STATUS_CHARACTERS,
  LOCAL_LLM_MAX_PROMPT_CHARACTERS,
  LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS,
  LOCAL_LLM_MIN_NEW_TOKENS,
  getLocalLlmModelById,
} from './local-llm.models';

export type LocalLlmErrorCode = 'cancelled' | 'input-limit' | 'model' | 'unavailable' | 'worker';

export interface LocalLlmLoadRequest {
  type: 'load'
  jobId: number
  modelId: string
}

export interface LocalLlmGenerateRequest {
  type: 'generate'
  jobId: number
  prompt: string
  systemPrompt: string
  maxNewTokens: number
}

export interface LocalLlmCancelRequest {
  type: 'cancel'
  jobId: number
}

export type LocalLlmWorkerRequest = LocalLlmLoadRequest | LocalLlmGenerateRequest | LocalLlmCancelRequest;

export interface LocalLlmProgress {
  file?: string
  files?: LocalLlmProgressFile[]
  loaded?: number
  total?: number
  progress?: number
  status: string
}

export interface LocalLlmProgressFile {
  file: string
  loaded?: number
  total?: number
  progress?: number
}

export type LocalLlmWorkerMessage =
  | { type: 'progress'; jobId: number; progress: LocalLlmProgress }
  | { type: 'loaded'; jobId: number; modelId: string; elapsedMs: number }
  | { type: 'token'; jobId: number; text: string; tokenCount: number }
  | { type: 'generated'; jobId: number; output: string; tokenCount: number; elapsedMs: number; cancelled: boolean }
  | { type: 'error'; jobId: number; code: LocalLlmErrorCode; message: string };

export interface LocalLlmGenerationOptions {
  prompt: string
  systemPrompt: string
  maxNewTokens: number
}

export class LocalLlmError extends Error {
  constructor(
    public readonly code: LocalLlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalLlmError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJobId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new LocalLlmError('worker', 'The local model worker returned an invalid job identifier.');
  }
  return Number(value);
}

export function validateLocalLlmGenerationOptions(value: LocalLlmGenerationOptions): LocalLlmGenerationOptions {
  const prompt = value.prompt.trim();
  const systemPrompt = value.systemPrompt.trim();
  if (!prompt) {
    throw new LocalLlmError('input-limit', 'Enter a prompt before generating.');
  }
  if (prompt.length > LOCAL_LLM_MAX_PROMPT_CHARACTERS) {
    throw new LocalLlmError('input-limit', `Prompt is limited to ${LOCAL_LLM_MAX_PROMPT_CHARACTERS.toLocaleString('en-US')} characters.`);
  }
  if (systemPrompt.length > LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS) {
    throw new LocalLlmError('input-limit', `System instructions are limited to ${LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS.toLocaleString('en-US')} characters.`);
  }
  if (!Number.isSafeInteger(value.maxNewTokens)
    || value.maxNewTokens < LOCAL_LLM_MIN_NEW_TOKENS
    || value.maxNewTokens > LOCAL_LLM_MAX_NEW_TOKENS) {
    throw new LocalLlmError('input-limit', `Maximum output must be between ${LOCAL_LLM_MIN_NEW_TOKENS} and ${LOCAL_LLM_MAX_NEW_TOKENS} tokens.`);
  }
  return { maxNewTokens: value.maxNewTokens, prompt, systemPrompt };
}

export function parseLocalLlmWorkerRequest(value: unknown): LocalLlmWorkerRequest {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new LocalLlmError('worker', 'The local model worker received an invalid request.');
  }
  const jobId = parseJobId(value.jobId);
  if (value.type === 'cancel') {
    return { jobId, type: 'cancel' };
  }
  if (value.type === 'load') {
    if (typeof value.modelId !== 'string' || !getLocalLlmModelById(value.modelId)) {
      throw new LocalLlmError('model', 'The requested local model is not supported.');
    }
    return { jobId, modelId: value.modelId, type: 'load' };
  }
  if (value.type === 'generate') {
    const validated = validateLocalLlmGenerationOptions({
      maxNewTokens: Number(value.maxNewTokens),
      prompt: typeof value.prompt === 'string' ? value.prompt : '',
      systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
    });
    return { jobId, type: 'generate', ...validated };
  }
  throw new LocalLlmError('worker', 'The local model worker received an unsupported request.');
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseProgressFiles(value: unknown): LocalLlmProgressFile[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > LOCAL_LLM_MAX_PROGRESS_FILES) {
    throw new LocalLlmError('worker', 'The local model worker returned invalid file progress.');
  }
  return value.map((entry) => {
    if (!isRecord(entry)
      || typeof entry.file !== 'string'
      || !entry.file
      || entry.file.length > LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS) {
      throw new LocalLlmError('worker', 'The local model worker returned invalid file progress.');
    }
    return {
      file: entry.file,
      loaded: parseOptionalFiniteNumber(entry.loaded),
      progress: parseOptionalFiniteNumber(entry.progress),
      total: parseOptionalFiniteNumber(entry.total),
    };
  });
}

export function parseLocalLlmWorkerMessage(value: unknown): LocalLlmWorkerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new LocalLlmError('worker', 'The local model worker returned an unreadable message.');
  }
  const jobId = parseJobId(value.jobId);
  if (value.type === 'progress') {
    if (!isRecord(value.progress)
      || typeof value.progress.status !== 'string'
      || value.progress.status.length > LOCAL_LLM_MAX_PROGRESS_STATUS_CHARACTERS
      || (value.progress.file !== undefined
        && (typeof value.progress.file !== 'string'
          || value.progress.file.length > LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS))) {
      throw new LocalLlmError('worker', 'The local model worker returned invalid progress.');
    }
    return {
      jobId,
      type: 'progress',
      progress: {
        file: typeof value.progress.file === 'string' ? value.progress.file : undefined,
        files: parseProgressFiles(value.progress.files),
        loaded: parseOptionalFiniteNumber(value.progress.loaded),
        progress: parseOptionalFiniteNumber(value.progress.progress),
        status: value.progress.status,
        total: parseOptionalFiniteNumber(value.progress.total),
      },
    };
  }
  if (value.type === 'loaded') {
    if (typeof value.modelId !== 'string' || !getLocalLlmModelById(value.modelId)) {
      throw new LocalLlmError('worker', 'The local model worker returned an unknown model.');
    }
    return { jobId, type: 'loaded', modelId: value.modelId, elapsedMs: parseOptionalFiniteNumber(value.elapsedMs) ?? 0 };
  }
  if (value.type === 'token') {
    if (typeof value.text !== 'string'
      || value.text.length > LOCAL_LLM_MAX_OUTPUT_CHARACTERS
      || !Number.isSafeInteger(value.tokenCount)
      || Number(value.tokenCount) < 0
      || Number(value.tokenCount) > LOCAL_LLM_MAX_NEW_TOKENS) {
      throw new LocalLlmError('worker', 'The local model worker returned an invalid text fragment.');
    }
    return { jobId, type: 'token', text: value.text, tokenCount: Number(value.tokenCount) };
  }
  if (value.type === 'generated') {
    if (typeof value.output !== 'string'
      || value.output.length > LOCAL_LLM_MAX_OUTPUT_CHARACTERS
      || !Number.isSafeInteger(value.tokenCount)
      || Number(value.tokenCount) < 0
      || Number(value.tokenCount) > LOCAL_LLM_MAX_NEW_TOKENS
      || typeof value.cancelled !== 'boolean') {
      throw new LocalLlmError('worker', 'The local model worker returned an invalid result.');
    }
    return {
      cancelled: value.cancelled,
      elapsedMs: parseOptionalFiniteNumber(value.elapsedMs) ?? 0,
      jobId,
      output: value.output,
      tokenCount: Number(value.tokenCount),
      type: 'generated',
    };
  }
  if (value.type === 'error') {
    const codes: LocalLlmErrorCode[] = ['cancelled', 'input-limit', 'model', 'unavailable', 'worker'];
    if (typeof value.message !== 'string'
      || value.message.length > LOCAL_LLM_MAX_ERROR_CHARACTERS
      || !codes.includes(value.code as LocalLlmErrorCode)) {
      throw new LocalLlmError('worker', 'The local model worker returned an invalid error.');
    }
    return { code: value.code as LocalLlmErrorCode, jobId, message: value.message, type: 'error' };
  }
  throw new LocalLlmError('worker', 'The local model worker returned an unsupported message.');
}
