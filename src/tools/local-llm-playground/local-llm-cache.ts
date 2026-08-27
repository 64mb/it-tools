import {
  LOCAL_LLM_CACHE_NAME,
  LOCAL_LLM_STORAGE_HEADROOM_FACTOR,
  type LocalLlmModel,
} from './local-llm.models';

const CACHE_MARKER_PATH = '/__it_tools_local_llm_cache_v1__/';

export interface LocalLlmCapabilities {
  cacheAvailable: boolean
  deviceMemoryGiB?: number
  freeStorageBytes?: number
  secureContext: boolean
  storageEstimateAvailable: boolean
  storageSufficient?: boolean
  webGpuAvailable: boolean
}

export interface LocalLlmCacheState {
  complete: boolean
  entryCount: number
}

interface CachedModelMarker {
  schemaVersion: 1
  modelId: string
  completedAt: string
}

interface NavigatorWithOptionalCapabilities extends Navigator {
  deviceMemory?: number
  gpu?: unknown
}

function markerUrl(modelId: string): string {
  return new URL(`${CACHE_MARKER_PATH}${encodeURIComponent(modelId)}`, globalThis.location.origin).href;
}

function belongsToModel(requestUrl: string, modelId: string): boolean {
  try {
    return decodeURIComponent(requestUrl).includes(`/${modelId}/`);
  }
  catch {
    return requestUrl.includes(modelId);
  }
}

export async function inspectLocalLlmCapabilities(model: LocalLlmModel): Promise<LocalLlmCapabilities> {
  const extendedNavigator = globalThis.navigator as NavigatorWithOptionalCapabilities;
  const cacheAvailable = typeof globalThis.caches !== 'undefined';
  const storageEstimate = await extendedNavigator.storage?.estimate?.().catch(() => undefined);
  const freeStorageBytes = storageEstimate?.quota !== undefined && storageEstimate.usage !== undefined
    ? Math.max(0, storageEstimate.quota - storageEstimate.usage)
    : undefined;

  return {
    cacheAvailable,
    deviceMemoryGiB: extendedNavigator.deviceMemory,
    freeStorageBytes,
    secureContext: globalThis.isSecureContext,
    storageEstimateAvailable: freeStorageBytes !== undefined,
    storageSufficient: freeStorageBytes === undefined
      ? undefined
      : freeStorageBytes >= model.estimatedDownloadBytes * LOCAL_LLM_STORAGE_HEADROOM_FACTOR,
    webGpuAvailable: extendedNavigator.gpu !== undefined,
  };
}

export async function isLocalLlmModelCached(modelId: string): Promise<boolean> {
  return (await inspectLocalLlmModelCache(modelId)).complete;
}

export async function inspectLocalLlmModelCache(modelId: string): Promise<LocalLlmCacheState> {
  if (typeof globalThis.caches === 'undefined') {
    return { complete: false, entryCount: 0 };
  }
  try {
    if (!await globalThis.caches.has(LOCAL_LLM_CACHE_NAME)) {
      return { complete: false, entryCount: 0 };
    }
    const cache = await globalThis.caches.open(LOCAL_LLM_CACHE_NAME);
    const requests = await cache.keys();
    const entryCount = requests.filter(request => (
      request.url === markerUrl(modelId) || belongsToModel(request.url, modelId)
    )).length;
    return {
      complete: Boolean(await cache.match(markerUrl(modelId))),
      entryCount,
    };
  }
  catch {
    return { complete: false, entryCount: 0 };
  }
}

export async function markLocalLlmModelCached(modelId: string): Promise<void> {
  if (typeof globalThis.caches === 'undefined') {
    return;
  }
  const marker: CachedModelMarker = {
    completedAt: new Date().toISOString(),
    modelId,
    schemaVersion: 1,
  };
  const cache = await globalThis.caches.open(LOCAL_LLM_CACHE_NAME);
  await cache.put(markerUrl(modelId), new Response(JSON.stringify(marker), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

export async function deleteLocalLlmModelCache(modelId: string): Promise<number> {
  if (typeof globalThis.caches === 'undefined') {
    return 0;
  }
  const cache = await globalThis.caches.open(LOCAL_LLM_CACHE_NAME);
  const requests = await cache.keys();
  const targets = requests.filter(request => (
    request.url === markerUrl(modelId) || belongsToModel(request.url, modelId)
  ));
  const results = await Promise.all(targets.map(request => cache.delete(request)));
  return results.filter(Boolean).length;
}
