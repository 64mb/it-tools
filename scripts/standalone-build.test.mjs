import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { inlineStandaloneBundle, isStandaloneWorkerAssetFileName } from './standalone-build-plugin.mjs';
import {
  STANDALONE_EXCLUDED_TOOL_DIRECTORIES,
  generateStandaloneToolRegistry,
} from './standalone-build-config.mjs';

test('covers every included worker client in the standalone CSP audit', () => {
  const toolsDirectory = resolve('src/tools');
  const excluded = new Set(STANDALONE_EXCLUDED_TOOL_DIRECTORIES);
  const expected = readdirSync(toolsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !excluded.has(entry.name))
    .filter(entry => readdirSync(resolve(toolsDirectory, entry.name), { withFileTypes: true })
      .some(file => file.isFile()
        && file.name.endsWith('worker-client.ts')
        && readFileSync(resolve(toolsDirectory, entry.name, file.name), 'utf8').includes('new Worker(')))
    .map(entry => entry.name)
    .sort();
  const auditSource = readFileSync(resolve('src/standalone-worker-audit.ts'), 'utf8');
  const actual = [...auditSource.matchAll(/\bid: '([^']+)'/gu)].map(match => match[1]).sort();

  assert.equal(new Set(actual).size, actual.length, 'Standalone worker audit case IDs must be unique.');
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 48);
});

test('distinguishes emitted worker scripts from worker-client lazy chunks', () => {
  assert.equal(isStandaloneWorkerAssetFileName('assets/file-hash.worker-f7b2a459.js'), true);
  assert.equal(isStandaloneWorkerAssetFileName('assets/file-hash.worker-client-982092e4.js'), false);
  assert.equal(isStandaloneWorkerAssetFileName('assets/not-a-worker.js'), false);
});

test('generates a standalone-only registry without the reviewed heavyweight routes', async () => {
  assert.deepEqual(STANDALONE_EXCLUDED_TOOL_DIRECTORIES, [
    'camera-recorder',
    'dns-over-https-query',
    'local-encrypted-otp-vault',
    'mermaid-diagram',
    'offline-geoip-inspector',
    'pdf-signature-checker',
    'text-diff',
  ]);
  const root = mkdtempSync(resolve(tmpdir(), 'it-tools-standalone-registry-test-'));
  const { count, output } = await generateStandaloneToolRegistry({
    outputPath: resolve(root, 'index.ts'),
  });
  assert.equal(count, 126);
  for (const directory of STANDALONE_EXCLUDED_TOOL_DIRECTORIES) {
    assert.doesNotMatch(output, new RegExp(`\\./${directory}/`));
  }
});

test('embeds entry, CSS, workers, public icons, and figlet fonts into one HTML asset', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'it-tools-standalone-test-'));
  const publicDirectory = resolve(root, 'public');
  const fontsDirectory = resolve(root, 'fonts');
  mkdirSync(publicDirectory);
  mkdirSync(fontsDirectory);
  writeFileSync(resolve(publicDirectory, 'favicon.png'), Buffer.from([1, 2, 3]));
  writeFileSync(resolve(fontsDirectory, 'Standard.flf'), 'font source');

  const bundle = {
    'index.html': { fileName: 'index.html', source: '<html><head><link rel="icon" href="favicon.png"><link rel="stylesheet" href="style.css"></head><body><script type="module" src="index.js"></script></body></html>', type: 'asset' },
    'index.js': { code: 'new Worker(new URL("worker-abcd1234.js",self.location));', fileName: 'index.js', isEntry: true, type: 'chunk' },
    'style.css': { fileName: 'style.css', source: 'body{color:red}', type: 'asset' },
    'worker-abcd1234.js': { fileName: 'worker-abcd1234.js', source: 'self.postMessage("ready")', type: 'asset' },
  };

  assert.equal(inlineStandaloneBundle(bundle, { fontsDirectory, publicDirectory }), true);
  assert.deepEqual(Object.keys(bundle), ['it-tools.html']);
  const html = String(bundle['it-tools.html'].source);
  assert.match(html, /<style>body\{color:red\}<\/style>/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /DecompressionStream/);
  assert.match(html, /\(0,eval\)\(source\)/);
  assert.doesNotMatch(html, /import\(moduleUrl\)/);
  assert.doesNotMatch(html, /font source/);
  const payload = html.match(/const encoded='([^']+)'/)?.[1];
  assert.ok(payload);
  const source = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
  assert.match(source, /data:text\/javascript;base64,/);
  assert.match(source, /class InlineWorker/);
  assert.match(source, /font source/);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:\.\/)?(?:index|style|worker)/);
});
