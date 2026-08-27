# Performance Contract

## Current baseline

The generated registry contains 134 lazy routes. The accepted normal build on
2026-08-25 measured a 719,149-byte raw / 193,054-byte gzip shell including the
document and a 53-file, 972,710-byte raw / 313,568-byte gzip Workbox payload.
All 430 build budget checks passed with unique tool icons preserved.

The accepted standalone artifact contains 126 tools in one HTML file. It is
7,994,866 bytes (7.62 MiB); the JSON upload envelope `{ "html": ... }` is
7,996,917 bytes. Both are below the strict 10 MiB limit. The build fails if
either measurement exceeds that limit and always removes its intermediate
directory to prevent stale-build reuse. The increase records the exhaustive
standalone-only 48-client compatibility audit and its small XLSX fixture; it
does not enter the normal application build.

Production large-result fixtures for SQL, JSON-to-CSV, JSON Minify, and List
Converter publish bounded previews while Copy/Blob download retains the full
bounded result. The accepted runs observed no Long Task at or above 50 ms.
Emoji search is worker-backed and virtualized. Monaco remains accepted for Text
Diff: the smaller CodeMirror spike lost focus, undo, and history when publishing
async diff results.

Local LLM Playground adds a 23,351-byte raw / 7,960-byte gzip route UI and a
503,343-byte raw / 147,220-byte gzip explicit-action worker; its measured
additional route closure is 607,745/182,692 bytes raw/gzip. Its separate ONNX
Runtime WASM is 23,567,050 bytes raw / 5,699,349 bytes gzip. Neither runtime
asset enters the shell, Workbox precache, or standalone build. The pinned
same-origin q4 mirror is 4.98 GiB total (0.62/1.45/2.91 GiB); one selected tier
downloads only after Load and parallel files render as independent progress
bars. The mirror is copied as separately versioned static delivery data and is
excluded from JS/shell build statistics. On the 2026-08-25
production Chromium run, first client-side route readiness was 171 ms with a
0.0 ms longest observed task and no worker/model request before Load.

## Gates

`.ai/baselines/build-budgets.json` is the sole detailed budget source. It
enforces shell and Workbox totals, a 500 kB default dynamic-entry ceiling, and
narrow rationale-backed exceptions for unavoidable route-owned assets. Generate
fresh measurements with:

```sh
pnpm build
pnpm build:stats
pnpm build:stats:check
pnpm build:standalone
pnpm test:standalone
```

Never update a budget merely to make a failure pass. Record the before/after
raw and gzip sizes, cold-route/result-ready timing, longest observed task, and
PWA impact. New shell work must keep parsers, datasets, tool components, and
heavy editors out of the initial graph.

## Responsiveness rules

- Do not synchronously parse or transform large input on every keystroke.
- Use explicit action above the tool's documented live threshold.
- Bound input, output, amplification, time, messages, and worker lifecycle.
- Show a bounded DOM preview for large results; copy/download the full result.
- Dispose workers, editors, media, observers, timers, and object URLs.
