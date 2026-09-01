# Current Handoff

## State

The final approved product package is implemented. There is no remaining
feature plan. The application is a browser-only static SPA/PWA with 134 lazy
tool routes, generated from per-tool typed metadata. Unique tool icons are a
product requirement and are preserved by the registry generator.

The repository may be intentionally dirty; inspect `git status` and never
overwrite unrelated local-fork work. Do not merge, rebase, or cherry-pick
upstream automatically.

Current checkpoint: the 2026-09-02 Firefox QR maintenance release adds a shared
native-first, local worker fallback for QR files and explicit OTP camera frames
in the normal build. It retains the final approved browser-tool catalog,
persistence/UI/performance work, standalone delivery, and the Local LLM
same-origin model mirror. Standalone deliberately compiles the QR fallback out
because the DataLens CSP denies workers.

## Resume

```sh
corepack enable
pnpm install --frozen-lockfile
git status --short
node scripts/generate-tool-registry.mjs --check
pnpm lint
pnpm typecheck
pnpm exec vitest run --environment jsdom
pnpm build
pnpm build:stats:check
pnpm build:standalone
pnpm test:standalone
```

Use one-shot Vitest; `pnpm test:unit` is currently also one-shot but the explicit
command is unambiguous. Run browser/container/security checks in proportion to
the touched surface.

## Standalone/DataLens

The final artifact is `dist-standalone/it-tools.html`: one 7,996,206-byte file
(7.63 MiB) with 126 tools and no runtime
network resources. `pnpm test:standalone` rebuilds it from current sources and
runs Chromium, Firefox, and WebKit serially.

The DataLens regression test reproduces the supplied HTTPS iframe with
`sandbox="allow-scripts"`, opaque origin, COOP, the injected CSP including
`connect-src 'none'` and `worker-src 'none'`, and disabled downloads. It checks
all 126 menu labels, their SVG icons, denied `localStorage`, `EXPORT`,
`OPEN_URL`, and an empty runtime/network error set. It also runs one valid core
operation through every one of the 48 included worker clients. A source
inventory test fails when an included worker client has no audit case.

The worker compatibility layer must keep Vite worker assets distinct from lazy
chunks whose names contain `.worker-client-`, and it must expose host Web APIs
such as `crypto`, `atob`, and `btoa` as own receiver-safe properties of the
emulated worker scope. These are regression fixes, not optional optimizations.

Do not switch the standalone sidebar back to Naive UI `NMenu`: its AMD render
produced empty `n-menu-item` elements in the real sandbox. The standalone-only
plain router-link menu is intentional; the normal application still uses
`NMenu`. Do not add intermediate-reuse flags to the build—the fresh build and
unconditional cleanup are part of the stale-cache defense.

Local LLM Playground is normal-build-only. It provides fixed Qwen3.5 Lite 0.8B,
Standard 2B, and Quality 4B q4 text models through a lazy Transformers.js 4.2.0
WebGPU worker with explicit download, storage/hardware preflight, streaming,
cancellation, bounds, unload, and scoped cache deletion. Prompts and output are
ephemeral. The 23.6 MB raw inference WASM and 4.98 GiB pinned q4 mirror are
absent from shell, Workbox, and standalone. Runtime requests use only the
same-origin revision path; Hugging Face fallback is disabled. The generated
mirror is intentionally untracked: run `pnpm models:download`, then
`pnpm models:check`, before publishing the normal build. Actual GPU/model
acceptance remains a hardware-manual non-claim.

Green focused gates on 2026-09-02: lint, typecheck, 267 Vitest files / 1,484
tests, production build, all 432 build budgets, a clean production dependency
audit, Chromium/Firefox QR file and OTP camera regressions, WebKit QR file
coverage, and standalone (4 Node + 6 browser tests; 48/48 included worker
paths). The 28-file / 4.98 GiB model mirror completeness check and four
Chromium Local LLM route/privacy/same-origin smokes remain the accepted model
release evidence.
GitHub runs the complete E2E suite in three Chromium shards. Focused Firefox
and WebKit jobs cover the shell, worker-backed conversion, shared QR fallback,
and camera path without treating Chromium-only performance and permission APIs
as portable contracts.
The Orca desktop runtime was unavailable after the documented open retry, so
interactive visual/model acceptance was not claimed.

## Invariants

- Inputs remain local and ephemeral unless a narrow feature explicitly says
  otherwise.
- Tool components, heavy dependencies, datasets, and workers remain lazy.
- Tool metadata lives in `src/tools/<tool>/index.ts`; regenerate, never manually
  edit `src/tools/index.ts`.
- Each tool retains its own icon. Do not replace tool icons with category icons.
- Worker tasks validate envelopes and enforce limits, timeout, cancellation,
  stale-result protection, and physical disposal.
- PWA installs the shell and demand-caches opened lazy assets.
- UI transformers are wide and vertical unless they are actual diff tools.
- `.ai/baselines/build-budgets.json` is executable policy, not historical prose.

## Browser review

Use the existing Orca embedded browser via the `orca-cli` skill and the exact
procedure in `ORCA_BROWSER.md`. Current-source review uses strict
`http://127.0.0.1:8091`; preview uses a freshly built `dist/` at port 5050. Do
not confuse the two or silently switch browser surfaces.
