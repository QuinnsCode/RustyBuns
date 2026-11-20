# Charts in code mode with mpljs

Research note, 2026-11-20. The question: should a code-mode program (codeSplitter's `execute`, eqosys's, qCRM's
script runs) be able to draw a chart and hand back a picture, using [ivarvong/mpl](https://github.com/ivarvong/mpl)?
Someone did this for another coding agent ("gave it a codemode charting tool based on the JS port of matplotlib")
and it fits our code mode well.

**Short answer: yes, it's worth a small spike.** The library runs on Workers, needs no network, and its output is
a PNG or SVG. In code mode the program already does the filtering. With a chart, the model gets one picture back
instead of a thousand rows. Three things in our own code mode have to change first. They're listed below.

## What mpljs is

- A TypeScript rewrite of how matplotlib 3.11.2 draws (layout, tickers, text, the Agg rasterizer). It has no
  dependencies, no canvas and no native modules. It runs in Node 24, Chromium and workerd, and CI checks every
  output against real matplotlib pixel for pixel (376 of 376 fixtures).
- The API uses matplotlib's names: `subplots()`, `ax.plot / bar / barh / scatter / hist / errorbar / boxplot /
  fill_between / imshow`, log and date axes, twinx, legends, `tight_layout`. Unknown keywords throw, like matplotlib.
  That's the big win for agents: models already write matplotlib well, so the calls come out right on the first try.
- Output: `fig.toPNGSync({ scale })`, `fig.toSVG()` (it can round coordinates), `fig.pngStream()`, raw RGBA, or a
  JSON scene tree. `toSVG({ interactive: true })` plus a 7 KiB client adds hover tooltips and legend toggles.
- It thins big data the way matplotlib does: a 1,000,000-point line becomes the 142 points matplotlib draws.
- Size (min + gzip): 179 KiB for the default entry with DejaVu Sans built in, 116 KiB for `mpl/core` with no font.
- Not yet supported: pie, violin, stem, stairs, `subplot_mosaic`, general mathtext, constrained layout.
- **Maturity:** version 0.1.0, ISC licence, 6 stars, about 76 commits, all from mid-November 2026. It isn't on npm:
  you install it from GitHub and its `prepare` script builds `dist/`. Bun is not one of its tested runtimes.

## Why it fits code mode

A code-mode program already calls tools, joins and filters their results, and sends back only what it returns.
Charts take that one step further:

1. **Debugging by looking.** Some questions are about the shape of the data: CI times over 200 runs
   (`test-times.json`), a climb's scores round by round, a game's frame times, latency spread, where a
   rate limit kicks in. A program can fetch the rows, plot them and return one image. The model sees the
   trend or the outlier without reading the numbers.
2. **Cheaper.** A Claude image costs about `width × height / 750` tokens, so an 800 × 500 PNG is about 530
   tokens. The same 500 points as JSON cost several thousand. The trade-off: the model reads the shape, not
   exact values. So the program should return the few numbers that matter (max, p95, the outlier's id) next
   to the image.
3. **Artifact charts.** `toSVG()` gives finished SVG text that an artifact page can embed as it is, so the
   model doesn't have to write chart code in the page. An interactive SVG comes with its own hover client. The
   in-session chart tool (easel) and the dataviz palette are still the right choice for a live chart in chat.
   Use mpl when the chart comes out of a program run.

## What has to change on our side

Code mode is built once, in `@rustybuns/util/codemode` (`runProgram`, `wrap`). codeSplitter and eqosys only
pass in their own limits. So the change happens in one place.

1. **Pictures need their own way back.** `MAX_BACK` is 20,000 characters, and the reply is a single
   `{ type: "text" }` block (`result()` in `apps/codesplitter/src/mcp.ts`). A base64 PNG doesn't fit there, and
   it shouldn't. Give the program a `chart(fig)` (or `image(png)`) helper that puts the PNG in a separate
   `images` list with its own cap (for example 2 images of 300 KB each). Then `execute` answers with MCP
   `{ type: "image", data, mimeType: "image/png" }` blocks after the text. SVG can stay in the text result when
   it fits.
2. **Load the library as a static import.** A program is a function body that `wrap` writes into one
   module, `program.js`. The local loader's wall (`walled` in `packages/shell-bun/src/bindings/worker-loader.ts`)
   refuses any `import()` in an isolated Worker. So the program can't `await import("mpl")`. Instead,
   `runProgram` takes optional extra `modules`, and `wrap` puts `import * as mpl from "./mpl.js"` at the top
   when charts are on. The edge loader accepts the same `modules` map.
3. **mpl's one call that reaches the machine.** The tracer's `flush(path)` runs `await import('node:fs/promises')`
   (`src/trace.ts`). Our wall would turn the whole bundle away because of that line. So bundle mpl ourselves
   with that path stubbed out, or ask upstream to move the tracer behind its own entry point. Also check
   that the bundle doesn't use `new Function` or `eval`, because the isolated thread removes both.

Also check during the spike:

- **CPU.** codeSplitter gives a program 2,000 ms of CPU and eqosys gives 1,000 ms. Loading about 500 KB of
  JavaScript, plus one Agg render at `scale: 2`, should fit. Measure it in workerd and Bun, because the local
  loader runs programs in a Bun Worker, and Bun isn't one of mpl's tested runtimes. The loader keeps one stub
  per id, so build the id from the program plus the mpl version, and the bundle only parses once per isolate.
- **Getting the library in.** Don't depend on a GitHub URL, because `bun install --frozen-lockfile` doesn't run
  a dependency's `prepare` script. Vendor a built, pinned `dist/` (with mpl's commit sha, `LICENSE` and
  `THIRD_PARTY_NOTICES.md`) as a text module that codeSplitter's build reads. Don't make it a new package
  that other packages depend on.
- **Safety.** It's pure computation, and the program already has no network (`globalOutbound: null`). The
  remaining risk is a large or hostile spec burning CPU. The CPU limit already ends a run like that.

## Suggested spike (one PR, #5402)

1. Vendor a pinned mpl build (DejaVu Sans only, about 179 KiB gzip) with the tracer stubbed out.
2. `runProgram` gets `modules` and an `images` channel. `wrap` passes `mpl` and `chart(fig)` to the program.
3. codeSplitter's `execute` returns image blocks. Update the `INSTRUCTIONS` text to say a program can draw.
4. One journey test through `local()`: a program reads `test-times.json`-shaped rows from a tool, plots them,
   and gets back a valid PNG and a short text result. Measure CPU time in the same test.

eqosys and qCRM get it free by turning it on in their `runProgram` options. Leave them off until codeSplitter
has used it for a while.
