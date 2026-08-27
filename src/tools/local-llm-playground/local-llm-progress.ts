import type { LocalLlmProgress, LocalLlmProgressFile } from './local-llm.protocol';

const DOWNLOAD_PHASES = new Set(['tokenizer', 'model']);

function phaseOf(status: string): string {
  return status.split(':', 1)[0];
}

function mergeProgress(previous: LocalLlmProgressFile | undefined, next: LocalLlmProgressFile): LocalLlmProgressFile {
  const total = Math.max(previous?.total ?? 0, next.total ?? 0) || undefined;
  const loaded = Math.min(total ?? Number.POSITIVE_INFINITY, Math.max(previous?.loaded ?? 0, next.loaded ?? 0));
  return {
    file: next.file,
    loaded: loaded || next.loaded === 0 ? loaded : undefined,
    progress: Math.max(previous?.progress ?? 0, next.progress ?? 0) || undefined,
    total,
  };
}

export class LocalLlmProgressTracker {
  private phase = '';
  private readonly files = new Map<string, LocalLlmProgressFile>();

  reset(): void {
    this.phase = '';
    this.files.clear();
  }

  update(progress: LocalLlmProgress): LocalLlmProgressFile[] {
    const nextPhase = phaseOf(progress.status);
    if (DOWNLOAD_PHASES.has(nextPhase) && nextPhase !== this.phase) {
      this.phase = nextPhase;
      this.files.clear();
    }

    for (const fileProgress of progress.files ?? []) {
      this.files.set(fileProgress.file, mergeProgress(this.files.get(fileProgress.file), fileProgress));
    }
    if (progress.file) {
      const fileProgress = {
        file: progress.file,
        loaded: progress.loaded,
        progress: progress.progress,
        total: progress.total,
      };
      this.files.set(progress.file, mergeProgress(this.files.get(progress.file), fileProgress));
    }

    return [...this.files.values()];
  }
}

export function localLlmFileProgressPercentage(progress: LocalLlmProgressFile): number | undefined {
  if (progress.loaded !== undefined && progress.total) {
    return Math.min(100, Math.max(0, progress.loaded / progress.total * 100));
  }
  if (progress.progress !== undefined) {
    return Math.min(100, Math.max(0, progress.progress));
  }
  return undefined;
}
