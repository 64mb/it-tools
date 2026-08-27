export type LocalLlmModelKey = 'lite' | 'standard' | 'quality';

export interface LocalLlmModel {
  key: LocalLlmModelKey
  label: string
  parameters: string
  modelId: string
  revision: string
  estimatedDownloadBytes: number
  recommendedMemoryGiB: number
  summary: string
}

const KIB = 1024;
const MIB = KIB ** 2;
const GIB = KIB ** 3;

function formatBinaryUnit(bytes: number, unitBytes: number, suffix: string): string {
  const value = bytes / unitBytes;
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${suffix}`;
}

export const LOCAL_LLM_MODELS = [
  {
    key: 'lite',
    label: 'Lite',
    parameters: '0.8B',
    modelId: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
    revision: 'fafab72d87a9e6be3925b38caf48286d2838f2d0',
    estimatedDownloadBytes: Math.round(0.7 * GIB),
    recommendedMemoryGiB: 4,
    summary: 'Fastest startup and the broadest device compatibility.',
  },
  {
    key: 'standard',
    label: 'Standard',
    parameters: '2B',
    modelId: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
    revision: '2ea7886f48b926aca97de8b0e041ffca7e3ebaa9',
    estimatedDownloadBytes: Math.round(1.6 * GIB),
    recommendedMemoryGiB: 8,
    summary: 'Balanced quality and speed for modern desktops.',
  },
  {
    key: 'quality',
    label: 'Quality',
    parameters: '4B',
    modelId: 'onnx-community/Qwen3.5-4B-ONNX-OPT',
    revision: '57b13b4dce7be073be0df3eaf1c842a6bbb2e0a7',
    estimatedDownloadBytes: Math.round(3.2 * GIB),
    recommendedMemoryGiB: 12,
    summary: 'Best answers in this tool, with the largest download and memory footprint.',
  },
] as const satisfies readonly LocalLlmModel[];

export const LOCAL_LLM_DEFAULT_MODEL_KEY: LocalLlmModelKey = 'standard';
export const LOCAL_LLM_MAX_PROMPT_CHARACTERS = 16_000;
export const LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS = 4_000;
export const LOCAL_LLM_MAX_OUTPUT_CHARACTERS = 100_000;
export const LOCAL_LLM_MAX_ERROR_CHARACTERS = 2_048;
export const LOCAL_LLM_MAX_PROGRESS_FILE_CHARACTERS = 2_048;
export const LOCAL_LLM_MAX_PROGRESS_STATUS_CHARACTERS = 256;
export const LOCAL_LLM_MAX_PROGRESS_FILES = 16;
export const LOCAL_LLM_MIN_NEW_TOKENS = 32;
export const LOCAL_LLM_MAX_NEW_TOKENS = 1_024;
export const LOCAL_LLM_DEFAULT_NEW_TOKENS = 512;
export const LOCAL_LLM_CACHE_NAME = 'it-tools-local-llm-models-v1';
export const LOCAL_LLM_STORAGE_HEADROOM_FACTOR = 1.2;

export function getLocalLlmModel(key: LocalLlmModelKey): LocalLlmModel {
  const model = LOCAL_LLM_MODELS.find(candidate => candidate.key === key);
  if (!model) {
    throw new TypeError('Unknown local LLM model.');
  }
  return model;
}

export function getLocalLlmModelById(modelId: string): LocalLlmModel | undefined {
  return LOCAL_LLM_MODELS.find(model => model.modelId === modelId);
}

export function getLocalLlmModelAssetBasePath(model: LocalLlmModel, baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}assets/local-llm-models/${model.revision}/`;
}

export function formatLocalLlmBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown';
  }
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(1)} GiB`;
  }
  if (bytes >= MIB) {
    return formatBinaryUnit(bytes, MIB, 'MiB');
  }
  if (bytes >= KIB) {
    return formatBinaryUnit(bytes, KIB, 'KiB');
  }
  return `${Math.round(bytes)} B`;
}
