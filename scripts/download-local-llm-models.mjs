#!/usr/bin/env node

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(repositoryRoot, 'src/tools/local-llm-playground/local-llm-model-assets.json');
const outputRoot = resolve(repositoryRoot, 'public/assets/local-llm-models');
const manifestPath = resolve(outputRoot, '.download-manifest.json');
const selectedKeys = new Set(process.argv.slice(2).filter(argument => !argument.startsWith('--')));
const checkOnly = process.argv.includes('--check');
const concurrency = 2;

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes} B`;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

const catalog = await readJson(catalogPath);
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) {
  throw new TypeError('Unsupported local LLM model asset catalog.');
}

const models = catalog.models.filter(model => selectedKeys.size === 0 || selectedKeys.has(model.key));
if (models.length === 0 || [...selectedKeys].some(key => !catalog.models.some(model => model.key === key))) {
  throw new TypeError(`Select one or more known model tiers: ${catalog.models.map(model => model.key).join(', ')}`);
}

const tasks = models.flatMap(model => model.files.map(file => ({ ...model, file })));
const manifest = await readJson(manifestPath, { schemaVersion: 1, files: {} });

function relativeAssetPath(task) {
  return `${task.revision}/${task.modelId}/${task.file}`;
}

async function verifyTask(task) {
  const relativePath = relativeAssetPath(task);
  const record = manifest.files?.[relativePath];
  const fileStat = await stat(resolve(outputRoot, relativePath)).catch(() => undefined);
  if (!record || record.revision !== task.revision || !fileStat?.isFile() || fileStat.size !== record.bytes || fileStat.size < 1) {
    throw new Error(`Missing or incomplete local model asset: ${relativePath}`);
  }
  return fileStat.size;
}

if (checkOnly) {
  let totalBytes = 0;
  for (const task of tasks) totalBytes += await verifyTask(task);
  process.stdout.write(`local-llm-models: ${tasks.length} files verified (${formatBytes(totalBytes)})\n`);
  process.exit(0);
}

let manifestWrite = Promise.resolve();
async function persistManifest() {
  manifestWrite = manifestWrite.then(async () => {
    await mkdir(outputRoot, { recursive: true });
    const temporaryPath = `${manifestPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporaryPath, manifestPath);
  });
  await manifestWrite;
}

async function downloadTask(task) {
  const relativePath = relativeAssetPath(task);
  try {
    const bytes = await verifyTask(task);
    process.stdout.write(`cached ${relativePath} (${formatBytes(bytes)})\n`);
    return bytes;
  }
  catch {
    // Missing or partial assets are downloaded below.
  }

  const destination = resolve(outputRoot, relativePath);
  const temporaryPath = `${destination}.part`;
  await mkdir(dirname(destination), { recursive: true });
  const existingBytes = (await stat(temporaryPath).catch(() => undefined))?.size ?? 0;
  const url = `https://huggingface.co/${task.modelId}/resolve/${task.revision}/${task.file}`;
  const headers = existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined;
  let response = await fetch(url, { headers, redirect: 'follow' });
  if (response.status === 416 && existingBytes > 0) {
    const remoteBytes = Number(response.headers.get('content-range')?.match(/\*\/(\d+)$/u)?.[1]);
    if (Number.isFinite(remoteBytes) && remoteBytes === existingBytes) {
      await rename(temporaryPath, destination);
      manifest.files ??= {};
      manifest.files[relativePath] = {
        bytes: existingBytes,
        modelId: task.modelId,
        revision: task.revision,
        source: url,
      };
      await persistManifest();
      process.stdout.write(`ready ${relativePath} (${formatBytes(existingBytes)})\n`);
      return existingBytes;
    }
    response = await fetch(url, { redirect: 'follow' });
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const append = existingBytes > 0 && response.status === 206;
  const offset = append ? existingBytes : 0;
  const contentLength = response.headers.get('content-length');
  const responseBytes = contentLength === null ? Number.NaN : Number(contentLength);
  const expectedBytes = Number.isFinite(responseBytes) && responseBytes >= 0 ? offset + responseBytes : undefined;
  process.stdout.write(`download ${relativePath}${append ? ` (resume at ${formatBytes(offset)})` : ''}\n`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(temporaryPath, { flags: append ? 'a' : 'w' }),
  );

  const downloadedBytes = (await stat(temporaryPath)).size;
  if (expectedBytes !== undefined && downloadedBytes !== expectedBytes) {
    throw new Error(`Incomplete download for ${relativePath}: ${downloadedBytes} of ${expectedBytes} bytes`);
  }
  await rename(temporaryPath, destination);
  manifest.files ??= {};
  manifest.files[relativePath] = {
    bytes: downloadedBytes,
    modelId: task.modelId,
    revision: task.revision,
    source: url,
  };
  await persistManifest();
  process.stdout.write(`ready ${relativePath} (${formatBytes(downloadedBytes)})\n`);
  return downloadedBytes;
}

let nextTaskIndex = 0;
let totalBytes = 0;
async function worker() {
  while (nextTaskIndex < tasks.length) {
    const task = tasks[nextTaskIndex++];
    const downloadedBytes = await downloadTask(task);
    totalBytes += downloadedBytes;
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
process.stdout.write(`local-llm-models: ${tasks.length} files ready (${formatBytes(totalBytes)})\n`);
