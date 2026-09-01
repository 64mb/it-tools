# Resolved Engineering State

The approved correctness, security, delivery, persistence, and performance
work is complete as of 2026-09-02.

- Production dependency audit has no known advisory in the approved graph.
- Scoped transitive overrides keep the browser-only Transformers dependency's
  unused Node branches on `sharp` 0.35.0 and `adm-zip` 0.6.0; composerize uses
  security-fixed `deepmerge-ts` 8.0.2 with its conversion tests retained.
- Crypto, YAML, i18n, Ajv, forge/PKI, nginx, and container concerns were fixed or
  replaced with bounded browser-local implementations and executable gates.
- Registry generation keeps routes lazy and preserves each tool's individual
  icon; category-wide icon substitution is explicitly a regression.
- Large transforms and sensitive operations have bounded worker lifecycles.
- Local LLM parallel downloads render one monotonic bar per file instead of
  interleaving aggregate and per-file percentages. Its pinned q4 artifacts are
  served same-origin only; Transformers.js remote fallback is disabled and a
  focused browser regression rejects Hugging Face runtime traffic.
- QR image reading and OTP camera-frame decoding prefer the native
  `BarcodeDetector` where available and use a bounded, lazy local worker
  fallback in Firefox. The shared reader retains file, pixel, payload, result,
  explicit-permission, five-minute teardown, and media-track cleanup bounds.
  Standalone remains native-only because its target CSP denies workers.
- The release dependency graph pins `browserslist` 4.28.7 so the production
  audit remains free of the advisories affecting earlier transitive versions.
- Root, subpath, reverse-proxy, security-header, PWA, Firefox, WebKit, Chromium,
  and Long Task coverage exists in the repository.
- Storage migrations, quota failure, rollback, and stale-cache cleanup are
  tested; sensitive content is not persisted by default.
- The DataLens standalone sandbox renders explicit router-link menu items with
  unique SVG icons, never touches opaque-origin storage, and executes embedded
  worker programs without violating `worker-src 'none'`. All 48 included worker
  clients now have an inventory-checked core-operation smoke in Chromium,
  Firefox, and WebKit.

Do not resurrect historical upstream issue/PR dumps as a backlog. Reproduce a
new defect locally, add a failing regression test, and record only unresolved
work in `TODO.md`.
