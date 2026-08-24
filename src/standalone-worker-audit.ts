interface DisposableClient {
  dispose: () => void
}

export interface StandaloneWorkerAuditResult {
  id: string
  elapsedMs: number
  error?: string
}

export interface StandaloneWorkerAuditReport {
  expected: number
  passed: number
  failed: number
  results: StandaloneWorkerAuditResult[]
}

interface StandaloneWorkerAudit {
  caseIds: readonly string[]
  runAll: () => Promise<StandaloneWorkerAuditReport>
}

interface AuditCase {
  id: string
  run: () => Promise<unknown>
}

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
-----END PUBLIC KEY-----`;

const SAML_REQUEST = 'PHNhbWxwOkF1dGhuUmVxdWVzdCB4bWxuczpzYW1scD0idXJuOm9hc2lzOm5hbWVzOnRjOlNBTUw6Mi4wOnByb3RvY29sIiBJRD0iX2FiYyIgVmVyc2lvbj0iMi4wIiBJc3N1ZUluc3RhbnQ9IjIwMjYtMDgtMTZUMDA6MDA6MDBaIj48c2FtbDpJc3N1ZXIgeG1sbnM6c2FtbD0idXJuOm9hc2lzOm5hbWVzOnRjOlNBTUw6Mi4wOmFzc2VydGlvbiI+aHR0cHM6Ly9pZHAuZXhhbXBsZTwvc2FtbDpJc3N1ZXI+PC9zYW1scDpBdXRoblJlcXVlc3Q+';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function runWithClient<T extends DisposableClient>(client: T, task: (value: T) => Promise<unknown>): Promise<unknown> {
  try {
    return await task(client);
  }
  finally {
    client.dispose();
  }
}

const cases: AuditCase[] = [
  {
    id: 'aes-gcm-envelope',
    run: async () => {
      const { AesEnvelopeWorkerClient } = await import('./tools/aes-gcm-envelope/aes-gcm-envelope.worker-client');
      return runWithClient(new AesEnvelopeWorkerClient(), client => client.run({ operation: 'encrypt-text', passphrase: 'standalone audit passphrase', text: 'audit' }));
    },
  },
  {
    id: 'argon2id-hash-verify',
    run: async () => {
      const { Argon2idWorkerClient } = await import('./tools/argon2id-hash-verify/argon2id.worker-client');
      return runWithClient(new Argon2idWorkerClient(), client => client.run({ operation: 'hash', password: 'audit', salt: new Uint8Array(16).fill(9), memoryKiB: 32, iterations: 1, parallelism: 1, hashLength: 16 }));
    },
  },
  {
    id: 'bcrypt',
    run: async () => {
      const { BcryptWorkerClient } = await import('./tools/bcrypt/bcrypt.worker-client');
      return runWithClient(new BcryptWorkerClient(), client => client.run({ operation: 'hash', value: 'audit', rounds: 4 }));
    },
  },
  {
    id: 'certificate-inspector',
    run: async () => {
      const { createCertificateInspectorWorkerClient } = await import('./tools/certificate-inspector/certificate-inspector.worker-client');
      return runWithClient(createCertificateInspectorWorkerClient(), client => client.run({ source: PUBLIC_KEY }));
    },
  },
  {
    id: 'crontab-generator',
    run: async () => {
      const { createCronWorkerClient } = await import('./tools/crontab-generator/cron-next-runs.worker-client');
      return runWithClient(createCronWorkerClient(), client => client.run({ expression: '0 * * * *', dialect: 'unix', timeZone: 'UTC', afterIso: '2026-01-01T00:00:00.000Z', count: 2 }));
    },
  },
  {
    id: 'developer-text-workspace',
    run: async () => {
      const { createDeveloperTextWorkerClient } = await import('./tools/developer-text-workspace/developer-text-workspace.worker-client');
      return runWithClient(createDeveloperTextWorkerClient(), client => client.run({ operation: 'folder-tree', source: 'src/main.ts\nsrc/App.vue', find: '', replacement: '', regex: false, caseSensitive: true }));
    },
  },
  {
    id: 'devops-config-workspace',
    run: async () => {
      const { createDevopsConfigWorkerClient } = await import('./tools/devops-config-workspace/devops-config-workspace.worker-client');
      return runWithClient(createDevopsConfigWorkerClient(), client => client.run({ mode: 'properties-to-yaml', source: 'server.port=8080', format: 'yaml', path: '', prefix: '' }));
    },
  },
  {
    id: 'devops-secret-helper',
    run: async () => {
      const { createDevopsSecretWorkerClient } = await import('./tools/devops-secret-helper/devops-secret-helper.worker-client');
      return runWithClient(createDevopsSecretWorkerClient(), client => client.run({ operation: 'vault-encrypt', source: 'secret', password: 'password', username: '', cost: 10, vaultId: '' }));
    },
  },
  {
    id: 'docker-run-to-docker-compose-converter',
    run: async () => {
      const { DockerConverterWorkerClient } = await import('./tools/docker-run-to-docker-compose-converter/docker-converter.worker-client');
      return runWithClient(new DockerConverterWorkerClient(), client => client.run({ direction: 'run-to-compose', source: 'docker run --name web -p 8080:80 nginx:1.27' }));
    },
  },
  {
    id: 'ed25519-key-workspace',
    run: async () => {
      const { Ed25519WorkerClient } = await import('./tools/ed25519-key-workspace/ed25519-key-workspace.worker-client');
      return runWithClient(new Ed25519WorkerClient(), client => client.run({ comment: 'standalone-audit' }));
    },
  },
  {
    id: 'emoji-picker',
    run: async () => {
      const { createEmojiSearchWorkerClient } = await import('./tools/emoji-picker/emoji-picker.worker-client');
      return runWithClient(createEmojiSearchWorkerClient(), client => client.search('rocket'));
    },
  },
  {
    id: 'file-hash',
    run: async () => {
      const { FileHashWorkerClient } = await import('./tools/file-hash/file-hash.worker-client');
      return runWithClient(new FileHashWorkerClient(), client => client.run({ file: new Blob(['audit']), algorithms: ['SHA-256', 'MD5'] }));
    },
  },
  {
    id: 'hash-text',
    run: async () => {
      const { createHashTextWorkerClient } = await import('./tools/hash-text/hash-text.worker-client');
      return runWithClient(createHashTextWorkerClient(), client => client.run({ encoding: 'Hex', source: 'audit' }));
    },
  },
  {
    id: 'hmac-generator',
    run: async () => {
      const { createHmacWorkerClient } = await import('./tools/hmac-generator/hmac-generator.worker-client');
      return runWithClient(createHmacWorkerClient(), client => client.run({ message: 'audit', key: 'secret', algorithm: 'SHA256', keyEncoding: 'text', outputEncoding: 'Hex' }));
    },
  },
  {
    id: 'html-wysiwyg-editor',
    run: async () => {
      const { HtmlFormatWorkerClient } = await import('./tools/html-wysiwyg-editor/html-wysiwyg-editor.worker-client');
      return runWithClient(new HtmlFormatWorkerClient(), client => client.run({ html: '<main><p>Audit</p></main>' }));
    },
  },
  {
    id: 'image-metadata-remover',
    run: async () => {
      const { ImageMetadataWorkerClient } = await import('./tools/image-metadata-remover/image-metadata-remover.worker-client');
      return runWithClient(new ImageMetadataWorkerClient(), client => client.run({ file: new Blob([bytesFromBase64(TINY_PNG)], { type: 'image/png' }) }));
    },
  },
  {
    id: 'json-code-generator',
    run: async () => {
      const { createJsonCodeWorkerClient } = await import('./tools/json-code-generator/json-code-generator.worker-client');
      return runWithClient(createJsonCodeWorkerClient(), client => client.run({ source: '{value: 1}', comparison: '', target: 'schema', rootName: 'Root' }));
    },
  },
  {
    id: 'json-diff',
    run: async () => {
      const { JsonDiffWorkerClient } = await import('./tools/json-diff/json-diff.worker-client');
      return runWithClient(new JsonDiffWorkerClient(), client => client.run({ alignArrays: true, left: '{"value":1}', onlyShowDifferences: false, right: '{"value":2}' }));
    },
  },
  {
    id: 'json-repair-query',
    run: async () => {
      const { createJsonWorkspaceWorkerClient } = await import('./tools/json-repair-query/json-repair-query.worker-client');
      return runWithClient(createJsonWorkspaceWorkerClient(), client => client.run({ operation: 'repair', source: '{value:1,}', query: '$' }));
    },
  },
  {
    id: 'json-schema-validator',
    run: async () => {
      const { JsonSchemaWorkerClient } = await import('./tools/json-schema-validator/json-schema-validator.worker-client');
      return runWithClient(new JsonSchemaWorkerClient(), client => client.run({ schemaSource: '{"type":"object"}', instanceSource: '{}', draft: 'draft2020' }));
    },
  },
  {
    id: 'json-to-csv',
    run: async () => {
      const { createJsonToCsvWorkerClient } = await import('./tools/json-to-csv/json-to-csv.worker-client');
      return runWithClient(createJsonToCsvWorkerClient(), client => client.run({ source: '[{"name":"Ada"}]' }));
    },
  },
  {
    id: 'json-to-toml',
    run: async () => {
      const { createJsonConverterWorkerClient } = await import('./tools/json-to-toml/json-converter.worker-client');
      return runWithClient(createJsonConverterWorkerClient(), client => client.run({ conversion: 'json-to-toml', source: '{"value":1}' }));
    },
  },
  {
    id: 'json-viewer',
    run: async () => {
      const { JsonWorkerClient } = await import('./tools/json-viewer/json-viewer.worker-client');
      return runWithClient(new JsonWorkerClient(), client => client.run({ operation: 'format', source: '{"value":1}', indentSize: 2, sortKeys: false, mode: 'strict' }));
    },
  },
  {
    id: 'list-comparison',
    run: async () => {
      const { createListComparisonWorkerClient } = await import('./tools/list-comparison/list-comparison.worker-client');
      return runWithClient(createListComparisonWorkerClient(), client => client.run({ left: 'a\nb', right: 'b\nc', mode: 'set', trimItems: true, ignoreCase: false, ignoreEmpty: true }));
    },
  },
  {
    id: 'list-converter',
    run: async () => {
      const { createListConverterWorkerClient } = await import('./tools/list-converter/list-converter.worker-client');
      return runWithClient(createListConverterWorkerClient(), client => client.run({ source: 'a\nb', options: { itemPrefix: '', itemSuffix: '', keepLineBreaks: false, listPrefix: '', listSuffix: '', lowerCase: false, removeDuplicates: true, reverseList: false, separator: ', ', sortList: null, trimItems: true } }));
    },
  },
  {
    id: 'local-file-inspector',
    run: async () => {
      const { FileInspectorWorkerClient } = await import('./tools/local-file-inspector/local-file-inspector.worker-client');
      return runWithClient(new FileInspectorWorkerClient(), client => client.run({ file: new Blob(['audit']) }));
    },
  },
  {
    id: 'mac-address-lookup',
    run: async () => {
      const { OuiWorkerClient } = await import('./tools/mac-address-lookup/mac-address-lookup.worker-client');
      return runWithClient(new OuiWorkerClient(), client => client.lookup({ operation: 'lookup', prefix: '203706' }));
    },
  },
  {
    id: 'markdown-diff',
    run: async () => {
      const { createMarkdownDiffWorkerClient } = await import('./tools/markdown-diff/markdown-diff.worker-client');
      return runWithClient(createMarkdownDiffWorkerClient(), client => client.run({ left: '# Old', right: '# New', granularity: 'line' }));
    },
  },
  {
    id: 'markdown-table-generator',
    run: async () => {
      const { createMarkdownTableWorkerClient } = await import('./tools/markdown-table-generator/markdown-table-generator.worker-client');
      return runWithClient(createMarkdownTableWorkerClient(), client => client.run({ source: 'A,B\n1,2', delimiter: 'comma', firstRowHeader: true, trimCells: true, alignmentPattern: 'left,right' }));
    },
  },
  {
    id: 'markdown-to-html',
    run: async () => {
      const { createMarkdownWorkerClient } = await import('./tools/markdown-to-html/markdown-to-html.worker-client');
      return runWithClient(createMarkdownWorkerClient(), client => client.run({ source: '# Audit' }));
    },
  },
  {
    id: 'math-evaluator',
    run: async () => {
      const { createMathWorkerClient } = await import('./tools/math-evaluator/math-evaluator.worker-client');
      return runWithClient(createMathWorkerClient(), client => client.run({ expression: '2 + 2' }));
    },
  },
  {
    id: 'mock-data-generator',
    run: async () => {
      const { createMockDataWorkerClient } = await import('./tools/mock-data-generator/mock-data-generator.worker-client');
      return runWithClient(createMockDataWorkerClient(), client => client.run({ seed: 'standalone-audit', count: 2, profile: 'identifiers', format: 'json' }));
    },
  },
  {
    id: 'openapi-inspector',
    run: async () => {
      const { createOpenApiWorkerClient } = await import('./tools/openapi-inspector/openapi-inspector.worker-client');
      return runWithClient(createOpenApiWorkerClient(), client => client.run({ source: '{"openapi":"3.1.0","info":{"title":"Audit","version":"1"},"paths":{}}' }));
    },
  },
  {
    id: 'parquet-reader',
    run: async () => {
      const [{ ParquetReaderWorkerClient }, { parquetFixture }] = await Promise.all([import('./tools/parquet-reader/parquet-reader.worker-client'), import('./tools/parquet-reader/parquet-reader.fixtures')]);
      return runWithClient(new ParquetReaderWorkerClient(), client => client.run({ kind: 'inspect', file: parquetFixture('plain') }));
    },
  },
  {
    id: 'pkcs12-pem-workspace',
    run: async () => {
      const { createPkcs12PemWorkerClient } = await import('./tools/pkcs12-pem-workspace/pkcs12-pem-workspace.worker-client');
      return runWithClient(createPkcs12PemWorkerClient(), client => client.run({ kind: 'pem', source: PUBLIC_KEY }));
    },
  },
  {
    id: 'regex-tester',
    run: async () => {
      const { RegexWorkerClient } = await import('./tools/regex-tester/regex-tester.worker-client');
      return runWithClient(new RegexWorkerClient(), client => client.run({ operation: 'match', pattern: 'a+', text: 'aaa', flags: 'g' }));
    },
  },
  {
    id: 'rsa-key-pair-generator',
    run: async () => {
      const { RsaWorkerClient } = await import('./tools/rsa-key-pair-generator/rsa-key-pair-generator.worker-client');
      return runWithClient(new RsaWorkerClient(), client => client.run({ bits: 2048 }));
    },
  },
  {
    id: 'saml-enterprise-inspector',
    run: async () => {
      const { createSamlInspectionWorkerClient } = await import('./tools/saml-enterprise-inspector/saml-enterprise-inspector.worker-client');
      return runWithClient(createSamlInspectionWorkerClient(), client => client.run({ source: SAML_REQUEST, binding: 'auto' }));
    },
  },
  {
    id: 'sensitive-data-masker',
    run: async () => {
      const { createSanitizerWorkerClient } = await import('./tools/sensitive-data-masker/sensitive-data-masker.worker-client');
      return runWithClient(createSanitizerWorkerClient(), client => client.run({ source: '{"password":"secret"}', mode: 'json', maskEmails: false, maskIpAddresses: false }));
    },
  },
  {
    id: 'sql-prettify',
    run: async () => {
      const { createSqlWorkerClient } = await import('./tools/sql-prettify/sql-prettify.worker-client');
      return runWithClient(createSqlWorkerClient(), client => client.run({ source: 'select a from t', options: { indentStyle: 'standard', keywordCase: 'upper', language: 'sql', tabulateAlias: true, useTabs: false } }));
    },
  },
  {
    id: 'tabular-data-inspector',
    run: async () => {
      const { createTabularDataWorkerClient } = await import('./tools/tabular-data-inspector/tabular-data-inspector.worker-client');
      return runWithClient(createTabularDataWorkerClient(), client => client.run({ source: 'a,b\n1,2', delimiter: 'comma', firstRowHeader: true, trimCells: false, outputFormat: 'inspect', emptyCellMode: 'empty-string', protectSpreadsheetFormulas: true }));
    },
  },
  {
    id: 'text-statistics',
    run: async () => {
      const { TextStatisticsWorkerClient } = await import('./tools/text-statistics/text-statistics.worker-client');
      return runWithClient(new TextStatisticsWorkerClient(), client => client.run({ source: 'one two three' }));
    },
  },
  {
    id: 'toml-to-json',
    run: async () => {
      const { createTomlConverterWorkerClient } = await import('./tools/toml-to-json/toml-converter.worker-client');
      return runWithClient(createTomlConverterWorkerClient(), client => client.run({ conversion: 'toml-to-json', source: 'value = 1' }));
    },
  },
  {
    id: 'xlsx-reader',
    run: async () => {
      const [{ XlsxReaderWorkerClient }, { createStandaloneXlsxFixture }] = await Promise.all([import('./tools/xlsx-reader/xlsx-reader.worker-client'), import('./tools/xlsx-reader/xlsx-reader.standalone-fixture')]);
      return runWithClient(new XlsxReaderWorkerClient(), client => client.run({ kind: 'inspect', file: createStandaloneXlsxFixture() }));
    },
  },
  {
    id: 'xml-formatter',
    run: async () => {
      const { createXmlWorkerClient } = await import('./tools/xml-formatter/xml-formatter.worker-client');
      return runWithClient(createXmlWorkerClient(), client => client.run({ collapseContent: true, indentSize: 2, source: '<root><value>1</value></root>' }));
    },
  },
  {
    id: 'xml-to-json',
    run: async () => {
      const { createXmlDataConverterWorkerClient } = await import('./tools/xml-to-json/xml-data-converter.worker-client');
      return runWithClient(createXmlDataConverterWorkerClient(), client => client.run({ conversion: 'xml-to-json', source: '<message>hello</message>' }));
    },
  },
  {
    id: 'yaml-to-toml',
    run: async () => {
      const { createYamlConverterWorkerClient } = await import('./tools/yaml-to-toml/yaml-converter.worker-client');
      return runWithClient(createYamlConverterWorkerClient(), client => client.run({ conversion: 'yaml-to-toml', source: 'value: 1' }));
    },
  },
  {
    id: 'yaml-viewer',
    run: async () => {
      const { YamlWorkerClient } = await import('./tools/yaml-viewer/yaml-viewer.worker-client');
      return runWithClient(new YamlWorkerClient(), client => client.run({ operation: 'format', source: 'value: 1', indentSize: 2, sortKeys: false }));
    },
  },
];

async function runAll(): Promise<StandaloneWorkerAuditReport> {
  const results: StandaloneWorkerAuditResult[] = [];
  for (const auditCase of cases) {
    const startedAt = performance.now();
    try {
      await auditCase.run();
      results.push({ id: auditCase.id, elapsedMs: performance.now() - startedAt });
    }
    catch (error) {
      results.push({
        id: auditCase.id,
        elapsedMs: performance.now() - startedAt,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }
  const failed = results.filter(result => result.error).length;
  return { expected: cases.length, passed: cases.length - failed, failed, results };
}

export const standaloneWorkerAudit: StandaloneWorkerAudit = {
  caseIds: cases.map(auditCase => auditCase.id),
  runAll,
};
