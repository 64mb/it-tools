# Approved Work

## Active approved work

There is no active feature or maintenance backlog. Firefox QR decoding and
explicit camera-frame capture were completed with a shared native-first local
fallback and regression coverage. No unrelated feature work is approved.

The approved Local LLM Playground remains implemented in the normal build with
Lite 0.8B, Standard 2B, and Quality 4B; Max, vision, automatic downloads, PWA
precaching, and standalone inclusion are deliberately absent. The three
approved q4 tiers are mirrored same-origin from pinned revisions; runtime
Hugging Face fallback is prohibited.

Do not invent additional tools or revive removed upstream lists.

Future work begins only from an explicit user request or a locally reproduced
regression. Before implementation, record the narrow scope here, including any
intentional upstream adaptation that requires approval.

## Maintenance definition of done

```sh
pnpm lint
pnpm typecheck
pnpm exec vitest run --environment jsdom
pnpm build
pnpm build:stats:check
pnpm test:e2e --project=chromium --reporter=line
```

Run Firefox/WebKit, container, subpath, security, and focused performance gates
when the change touches those surfaces. Keep routes lazy, unique tool icons,
privacy defaults, worker limits/cancellation, and build budgets intact.

## Upstream adaptations

No upstream application code or design is approved for adaptation. The local
implementation consumes exact Apache-2.0 `@huggingface/transformers` 4.2.0 and
the three fixed Qwen3.5 ONNX model repositories; integration code and UI remain
local-fork work. Firefox QR compatibility uses exact MIT `qr-scanner` 1.4.2 as
a lazy normal-build dependency; the integration and UI remain local-fork work.
