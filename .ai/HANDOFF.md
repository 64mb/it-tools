# Current Handoff

## State

The final approved product package is implemented. There is no remaining
feature plan. The application is a browser-only static SPA/PWA with 133 lazy
tool routes, generated from per-tool typed metadata. Unique tool icons are a
product requirement and are preserved by the registry generator.

The repository may be intentionally dirty; inspect `git status` and never
overwrite unrelated local-fork work. Do not merge, rebase, or cherry-pick
upstream automatically.

Current checkpoint: branch `feat-ai-research`, base commit
`2530780ffb46bd309172aa21ff38d0881cd45cd1`. The 2026-08-24 standalone worker
compatibility audit is present as uncommitted local work at handoff time; keep
the whole worktree together when committing or transferring it.

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

The final artifact is `dist-standalone/it-tools.html`: one 7,989,122-byte file
(7.62 MiB; 7,991,173-byte JSON upload envelope) with 126 tools and no runtime
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

Green gates for the 2026-08-24 audit: `pnpm test:standalone` (4 Node tests and
6 Playwright tests; 48/48 worker operations in Chromium, Firefox, and WebKit),
`pnpm lint`, `pnpm test:unit` (262 files / 1,466 tests), and `pnpm build`.
The final normal build restored full generated component declarations, including
the camera-specific icons excluded only from standalone.

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
