<script setup lang="ts">
import {
  type LocalLlmCapabilities,
  deleteLocalLlmModelCache,
  inspectLocalLlmCapabilities,
  inspectLocalLlmModelCache,
  markLocalLlmModelCached,
} from './local-llm-cache';
import {
  LOCAL_LLM_DEFAULT_MODEL_KEY,
  LOCAL_LLM_DEFAULT_NEW_TOKENS,
  LOCAL_LLM_MAX_NEW_TOKENS,
  LOCAL_LLM_MAX_PROMPT_CHARACTERS,
  LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS,
  LOCAL_LLM_MIN_NEW_TOKENS,
  LOCAL_LLM_MODELS,
  type LocalLlmModelKey,
  formatLocalLlmBytes,
  getLocalLlmModel,
} from './local-llm.models';
import { LocalLlmError, type LocalLlmProgress } from './local-llm.protocol';
import {
  LocalLlmProgressTracker,
  localLlmFileProgressPercentage,
} from './local-llm-progress';
import { createLocalLlmWorkerClient } from './local-llm.worker-client';
import { useCopy } from '@/composable/copy';

const modelOptions = LOCAL_LLM_MODELS.map(model => ({
  label: `${model.label} · ${model.parameters}`,
  value: model.key,
}));
const selectedModelKey = ref<LocalLlmModelKey>(LOCAL_LLM_DEFAULT_MODEL_KEY);
const systemPrompt = ref('You are a concise and accurate assistant.');
const prompt = ref('');
const output = ref('');
const maxNewTokens = ref<number | null>(LOCAL_LLM_DEFAULT_NEW_TOKENS);
const capabilities = ref<LocalLlmCapabilities>();
const cached = ref(false);
const cachedEntryCount = ref(0);
const status = ref('Checking browser capabilities…');
const error = ref('');
const progress = ref<LocalLlmProgress>();
const progressFiles = ref<LocalLlmProgress['files']>([]);
const isLoading = ref(false);
const isGenerating = ref(false);
const isDeleting = ref(false);
const loadedModelId = ref<string>();
const client = createLocalLlmWorkerClient();
const progressTracker = new LocalLlmProgressTracker();
let capabilityRevision = 0;
let cachedBeforeCurrentLoad = false;

const selectedModel = computed(() => getLocalLlmModel(selectedModelKey.value));
const isBusy = computed(() => isLoading.value || isGenerating.value || isDeleting.value);
const hasCachedEntries = computed(() => cachedEntryCount.value > 0);
const isLoaded = computed(() => loadedModelId.value === selectedModel.value.modelId);
const outputTokenLimit = computed(() => maxNewTokens.value ?? LOCAL_LLM_DEFAULT_NEW_TOKENS);
const inputError = computed(() => {
  if (!prompt.value.trim()) {
    return 'Enter a prompt before generating.';
  }
  if (prompt.value.length > LOCAL_LLM_MAX_PROMPT_CHARACTERS) {
    return `Prompt is limited to ${LOCAL_LLM_MAX_PROMPT_CHARACTERS.toLocaleString('en-US')} characters.`;
  }
  if (systemPrompt.value.length > LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS) {
    return `System instructions are limited to ${LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS.toLocaleString('en-US')} characters.`;
  }
  if (!Number.isSafeInteger(maxNewTokens.value)
    || outputTokenLimit.value < LOCAL_LLM_MIN_NEW_TOKENS
    || outputTokenLimit.value > LOCAL_LLM_MAX_NEW_TOKENS) {
    return `Maximum output must be between ${LOCAL_LLM_MIN_NEW_TOKENS} and ${LOCAL_LLM_MAX_NEW_TOKENS} tokens.`;
  }
  return '';
});
const loadBlockedReason = computed(() => {
  if (!capabilities.value) {
    return 'Browser capability check is still running.';
  }
  if (!capabilities.value.secureContext) {
    return 'WebGPU requires a secure context (HTTPS or localhost).';
  }
  if (!capabilities.value.webGpuAvailable) {
    return 'WebGPU is not available in this browser or is disabled.';
  }
  if (!cached.value && capabilities.value.storageSufficient === false) {
    return `The browser reports less than the recommended ${formatLocalLlmBytes(selectedModel.value.estimatedDownloadBytes * 1.2)} of free storage.`;
  }
  return '';
});
const progressLabel = computed(() => {
  const value = progress.value;
  if (!value) {
    return '';
  }
  const phase = value.status.startsWith('tokenizer') ? 'Tokenizer' : value.status.startsWith('model') ? 'Model weights' : 'Runtime';
  return phase;
});
const memoryWarning = computed(() => {
  const deviceMemory = capabilities.value?.deviceMemoryGiB;
  if (deviceMemory === undefined || deviceMemory >= selectedModel.value.recommendedMemoryGiB) {
    return '';
  }
  return `This browser reports ${deviceMemory} GiB of device memory; ${selectedModel.value.label} is intended for about ${selectedModel.value.recommendedMemoryGiB} GiB or more.`;
});

async function refreshCapabilities(): Promise<void> {
  const revision = ++capabilityRevision;
  capabilities.value = undefined;
  error.value = '';
  const model = selectedModel.value;
  const [nextCapabilities, nextCache] = await Promise.all([
    inspectLocalLlmCapabilities(model),
    inspectLocalLlmModelCache(model.modelId),
  ]);
  if (revision !== capabilityRevision) {
    return;
  }
  capabilities.value = nextCapabilities;
  cached.value = nextCache.complete;
  cachedEntryCount.value = nextCache.entryCount;
  status.value = nextCache.complete
    ? `${model.label} was downloaded previously and can be loaded from the browser cache.`
    : nextCache.entryCount > 0
      ? `${model.label} has a partial local download. Load will resume missing files.`
      : `Ready to download ${model.label} after your confirmation.`;
}

function startCapabilityRefresh(): void {
  refreshCapabilities().catch((caught) => {
    error.value = describeError(caught, 'Browser capabilities could not be checked.');
    status.value = 'Capability check failed.';
  });
}

watch(selectedModelKey, startCapabilityRefresh);
onMounted(startCapabilityRefresh);

function describeError(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim() ? caught.message : fallback;
}

async function loadModel(): Promise<void> {
  if (loadBlockedReason.value) {
    error.value = loadBlockedReason.value;
    return;
  }
  isLoading.value = true;
  error.value = '';
  progress.value = undefined;
  progressTracker.reset();
  progressFiles.value = [];
  cachedBeforeCurrentLoad = cached.value;
  status.value = cached.value
    ? `Loading ${selectedModel.value.label} from local cache…`
    : `Downloading and loading ${selectedModel.value.label}…`;
  try {
    const result = await client.load(selectedModel.value, (nextProgress) => {
      progress.value = nextProgress;
      progressFiles.value = progressTracker.update(nextProgress);
    });
    try {
      await markLocalLlmModelCached(selectedModel.value.modelId);
    }
    catch {
      // The weights can still be available even when the small marker write fails.
    }
    const cacheState = await inspectLocalLlmModelCache(selectedModel.value.modelId);
    cached.value = cacheState.complete;
    cachedEntryCount.value = cacheState.entryCount;
    loadedModelId.value = client.currentModelId;
    status.value = `${selectedModel.value.label} is ready on WebGPU. Loaded in ${(result.elapsedMs / 1_000).toFixed(1)} s.`;
  }
  catch (caught) {
    if (caught instanceof LocalLlmError && caught.code === 'cancelled') {
      status.value = caught.message;
      if (!cachedBeforeCurrentLoad) {
        await deleteLocalLlmModelCache(selectedModel.value.modelId).catch(() => 0);
        cached.value = false;
        cachedEntryCount.value = 0;
      }
    }
    else {
      error.value = describeError(caught, 'The model could not be loaded.');
      status.value = 'Model loading failed.';
      const cacheState = await inspectLocalLlmModelCache(selectedModel.value.modelId);
      cached.value = cacheState.complete;
      cachedEntryCount.value = cacheState.entryCount;
    }
  }
  finally {
    loadedModelId.value = client.currentModelId;
    isLoading.value = false;
    progress.value = undefined;
    progressFiles.value = [];
  }
}

async function generate(): Promise<void> {
  if (inputError.value) {
    error.value = inputError.value;
    return;
  }
  isGenerating.value = true;
  error.value = '';
  output.value = '';
  status.value = `Generating with ${selectedModel.value.label} locally…`;
  try {
    const result = await client.generate({
      maxNewTokens: outputTokenLimit.value,
      prompt: prompt.value,
      systemPrompt: systemPrompt.value,
    }, (fragment) => {
      output.value += fragment;
    });
    output.value = result.output;
    const seconds = Math.max(0.001, result.elapsedMs / 1_000);
    const speed = result.tokenCount / seconds;
    status.value = result.cancelled
      ? `Generation stopped after ${result.tokenCount} tokens.`
      : `Generated ${result.tokenCount} tokens in ${seconds.toFixed(1)} s (${speed.toFixed(1)} tokens/s).`;
  }
  catch (caught) {
    if (caught instanceof LocalLlmError && caught.code === 'cancelled') {
      status.value = caught.message;
    }
    else {
      error.value = describeError(caught, 'Text generation failed.');
      status.value = 'Generation failed.';
    }
  }
  finally {
    loadedModelId.value = client.currentModelId;
    isGenerating.value = false;
  }
}

function stopGeneration(): void {
  status.value = 'Stopping generation…';
  client.cancelGeneration();
}

function cancelLoad(): void {
  client.cancelLoad();
}

function unloadModel(): void {
  client.unload();
  loadedModelId.value = undefined;
  status.value = `${selectedModel.value.label} was unloaded from GPU memory. Cached files remain available.`;
}

async function deleteCachedModel(): Promise<void> {
  const model = selectedModel.value;
  isDeleting.value = true;
  error.value = '';
  if (isLoaded.value) {
    client.unload();
    loadedModelId.value = undefined;
  }
  try {
    const deletedEntries = await deleteLocalLlmModelCache(model.modelId);
    cached.value = false;
    cachedEntryCount.value = 0;
    await refreshCapabilities();
    status.value = `Removed ${model.label} from the browser cache (${deletedEntries} entries).`;
  }
  catch (caught) {
    error.value = describeError(caught, 'The cached model could not be removed.');
    status.value = 'Cache cleanup failed.';
  }
  finally {
    isDeleting.value = false;
  }
}

function clearText(): void {
  prompt.value = '';
  output.value = '';
  error.value = '';
  status.value = isLoaded.value ? `${selectedModel.value.label} is ready.` : 'Ready.';
}

const { copy } = useCopy({ source: output, text: 'Local model output copied to the clipboard' });

onBeforeUnmount(() => {
  ++capabilityRevision;
  client.dispose();
  loadedModelId.value = undefined;
  prompt.value = '';
  systemPrompt.value = '';
  output.value = '';
});
</script>

<template>
  <div class="c-tool-workbench c-tool-stack">
    <c-alert title="Private by default, with one explicit download">
      Prompts and responses stay in memory and are never saved. Selecting Load downloads pinned Qwen3.5 model files from this IT Tools server and stores them in a dedicated browser cache that you can remove here. The browser never contacts Hugging Face or a model API at runtime.
    </c-alert>

    <c-card class="c-tool-panel" title="Local model">
      <c-buttons-select
        v-model:value="selectedModelKey"
        :options="modelOptions"
        :disabled="isBusy || isLoaded"
        label="Model tier"
        label-position="top"
      />
      <div class="model-summary" mt-3 data-test-id="local-llm-model-summary">
        <strong>{{ selectedModel.label }} · Qwen3.5 {{ selectedModel.parameters }}</strong>
        <span>{{ selectedModel.summary }}</span>
        <span>Approx. text-only q4 download: {{ formatLocalLlmBytes(selectedModel.estimatedDownloadBytes) }} · recommended memory: {{ selectedModel.recommendedMemoryGiB }} GiB.</span>
        <span>Cache: {{ cached ? 'complete' : hasCachedEntries ? `partial (${cachedEntryCount} entries)` : capabilities?.cacheAvailable ? 'not downloaded' : 'unavailable; this tab would download again' }}.</span>
        <span v-if="capabilities?.freeStorageBytes !== undefined">Browser-reported free storage: {{ formatLocalLlmBytes(capabilities.freeStorageBytes) }}.</span>
      </div>

      <c-alert v-if="loadBlockedReason" title="Model cannot be loaded" mt-3 data-test-id="local-llm-preflight-error">
        {{ loadBlockedReason }} Try a current Chromium-based browser with WebGPU enabled.
      </c-alert>
      <c-alert v-else-if="memoryWarning" title="Device may be too small" mt-3 data-test-id="local-llm-memory-warning">
        {{ memoryWarning }} Loading can still fail if the GPU cannot allocate the model.
      </c-alert>

      <div v-if="isLoading" class="download-progress" mt-3>
        <strong>{{ progressLabel || 'Preparing the local runtime…' }}</strong>
        <div v-if="progressFiles?.length" class="download-files">
          <div v-for="fileProgress in progressFiles" :key="fileProgress.file" class="download-file">
            <div class="download-file-label">
              <span>{{ fileProgress.file.split('/').at(-1) }}</span>
              <span v-if="fileProgress.loaded !== undefined && fileProgress.total !== undefined">
                {{ formatLocalLlmBytes(fileProgress.loaded) }} / {{ formatLocalLlmBytes(fileProgress.total) }}
              </span>
            </div>
            <div
              class="download-file-track"
              :class="{ 'is-indeterminate': localLlmFileProgressPercentage(fileProgress) === undefined }"
              role="progressbar"
              :aria-label="`Download progress for ${fileProgress.file}`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="localLlmFileProgressPercentage(fileProgress)"
            >
              <div
                class="download-file-fill"
                :style="localLlmFileProgressPercentage(fileProgress) === undefined
                  ? undefined
                  : { '--download-progress': `${localLlmFileProgressPercentage(fileProgress)}%` }"
              />
            </div>
          </div>
        </div>
        <div v-else class="download-file-track is-indeterminate" role="progressbar" aria-label="Preparing model download">
          <div class="download-file-fill" />
        </div>
      </div>

      <div class="c-task-actions" mt-3>
        <c-button
          v-if="!isLoaded"
          type="primary"
          :disabled="Boolean(loadBlockedReason) || isBusy"
          data-test-id="local-llm-load"
          @click="loadModel"
        >
          {{ isLoading ? 'Loading…' : cached ? `Load ${selectedModel.label} from cache` : hasCachedEntries ? `Resume and load ${selectedModel.label}` : `Download and load ${selectedModel.label}` }}
        </c-button>
        <c-button v-if="isLoading" type="warning" data-test-id="local-llm-cancel-load" @click="cancelLoad">
          Cancel download
        </c-button>
        <c-button v-if="isLoaded" :disabled="isGenerating" data-test-id="local-llm-unload" @click="unloadModel">
          Unload from GPU
        </c-button>
        <c-button :disabled="!hasCachedEntries || isBusy" data-test-id="local-llm-delete-cache" @click="deleteCachedModel">
          Remove cached {{ selectedModel.label }}
        </c-button>
      </div>
    </c-card>

    <c-input-text
      v-model:value="systemPrompt"
      label="System instructions (optional)"
      :maxlength="LOCAL_LLM_MAX_SYSTEM_PROMPT_CHARACTERS"
      test-id="local-llm-system-prompt"
      raw-text multiline :rows="4"
      autocomplete="off"
    />

    <c-input-text
      v-model:value="prompt"
      label="Prompt"
      :maxlength="LOCAL_LLM_MAX_PROMPT_CHARACTERS"
      placeholder="Ask a question or describe a text-generation task"
      test-id="local-llm-prompt"
      raw-text multiline :rows="10"
      autocomplete="off"
    />

    <c-card class="c-tool-panel" title="Generation options">
      <c-field
        label="Maximum output tokens"
        description="Reasoning is disabled to keep latency and output bounded. Generation is deterministic."
      >
        <c-input-number
          v-model:value="maxNewTokens"
          aria-label="Maximum output tokens"
          :min="LOCAL_LLM_MIN_NEW_TOKENS"
          :max="LOCAL_LLM_MAX_NEW_TOKENS"
          :step="32"
          :disabled="isBusy"
        />
      </c-field>
    </c-card>

    <div class="c-task-actions">
      <c-button
        type="primary"
        :disabled="!isLoaded || Boolean(inputError) || isBusy"
        data-test-id="local-llm-generate"
        @click="generate"
      >
        {{ isGenerating ? 'Generating…' : 'Generate locally' }}
      </c-button>
      <c-button v-if="isGenerating" type="warning" data-test-id="local-llm-stop" @click="stopGeneration">
        Stop
      </c-button>
      <c-button :disabled="!output" data-test-id="local-llm-copy" @click="copy()">
        Copy output
      </c-button>
      <c-button :disabled="isBusy || (!prompt && !output)" data-test-id="local-llm-clear" @click="clearText">
        Clear
      </c-button>
    </div>

    <p class="c-task-status" data-test-id="local-llm-status" role="status" aria-live="polite">
      {{ status }}
    </p>
    <c-alert v-if="error" title="Local model error" data-test-id="local-llm-error">
      {{ error }}
    </c-alert>

    <c-input-text
      :value="output"
      label="Generated output"
      placeholder="Generated text will stream here"
      test-id="local-llm-output"
      raw-text multiline readonly :rows="18"
    />
  </div>
</template>

<style scoped>
.model-summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--ui-space-1);
  font-size: 13px;
  line-height: 1.45;
  opacity: 0.8;
}

.download-progress {
  display: grid;
  min-width: 0;
  gap: var(--ui-space-2);
  font-size: 13px;
}

.download-progress strong {
  font-weight: 600;
}

.download-files,
.download-file {
  display: grid;
  min-width: 0;
  gap: var(--ui-space-1);
}

.download-files {
  gap: var(--ui-space-2);
}

.download-file-label {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: var(--ui-space-3);
}

.download-file-label span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.download-file-label span:last-child {
  flex: none;
  opacity: 0.72;
}

.download-file-track {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-focus-color) 16%, transparent);
}

.download-file-fill {
  width: var(--download-progress, 0%);
  height: 100%;
  border-radius: inherit;
  background: var(--ui-focus-color);
  transition: width 180ms ease-out;
}

.download-file:nth-child(4n + 2) .download-file-fill {
  background: #36b9c5;
}

.download-file:nth-child(4n + 3) .download-file-fill {
  background: #42b883;
}

.download-file:nth-child(4n) .download-file-fill {
  background: #e59c45;
}

.download-file-track.is-indeterminate .download-file-fill {
  width: 36%;
  animation: local-llm-progress 1.1s ease-in-out infinite;
}

@keyframes local-llm-progress {
  from { transform: translateX(-110%); }
  to { transform: translateX(310%); }
}

@media (prefers-reduced-motion: reduce) {
  .download-file-fill {
    transition: none;
  }

  .download-file-track.is-indeterminate .download-file-fill {
    animation: none;
    opacity: 0.65;
  }
}
</style>
