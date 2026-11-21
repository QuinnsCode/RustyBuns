# Charts in code mode with mpljs

Research note, 2026-11-20. The question: should a code-mode program (codeSplitter's `execute`, eqosys's, qCRM's
script runs) be able to draw a chart, using [ivarvong/mpl](https://github.com/ivarvong/mpl)? Someone did this for
another coding agent ("gave it a codemode charting tool based on the JS port of matplotlib"), and it fits our
code mode well.

**Short answer: yes, it's worth a small spike (#5402).** A chart is just code. The program draws it in its sandbox
with mpl, then calls a `save_chart` tool that puts the PNG or SVG in R2 and answers with a signed link. The same
program can run when an agent asks for it, on an event, or on a cron (Cron Swanson). The link goes into an artifact,
a PR or a dashboard. The picture is for people. The model doesn't need to see it, because the program already has
the numbers and can work out the max, p95 or the outlier in code.

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
- `ax.pie` landed on 2026-11-20 (ivarvong/mpl#85, 426 of 426 fixtures pixel-exact by then). Our Thanksgiving thank-you,
  a pie of mpl's own chart types drawn with it: [mpl-pie/](mpl-pie/README.md).
- Not yet supported: violin, stem, stairs, `subplot_mosaic`, general mathtext, constrained layout.
- **Maturity:** version 0.1.0, ISC licence, 6 stars, about 76 commits, all from mid-November 2026. It isn't on npm:
  you install it from GitHub and its `prepare` script builds `dist/`. Bun is not one of its tested runtimes.

## Why it fits code mode

- **The chart is code.** Models already write matplotlib well, so the mpl calls come out right on the first try.
  The program fetches the rows with tools, filters them, plots them and saves the result. Only a short answer
  and a link come back to the model.
- **Run it anywhere.** The program doesn't care what starts it: an agent's `execute`, an event or a cron job.
  A dashboard chart is just a saved program that runs every hour.
- **Artifact charts for cheap.** An artifact page shows the chart with `<img src="<signed link>">`, so the model
  doesn't write chart code in the page. A `toSVG({ interactive: true })` file adds hover tooltips if a page wants
  them. The in-session chart tool (easel) and the dataviz palette are still the right choice for a live chart in chat.

## Why a tool, not a pre-signed upload URL

A program runs with no network (`globalOutbound: null`). That's on purpose, so code an agent writes can't send
data anywhere, and it means the program can't PUT to a pre-signed URL itself. The code-mode way out of the sandbox
is a tool call, so `save_chart` does the upload on the server's side of the wall. A pre-signed GET URL is still
the right way to hand the link out: charts from a private repo stay private, and the link expires.

## The design

1. **mpl in the sandbox.** A program is a function body that `wrap` (`@rustybuns/util/codemode`) writes into
   one module, `program.js`. The local loader's wall (`walled` in `packages/shell-bun/src/bindings/worker-loader.ts`)
   refuses any `import()` in an isolated Worker, so the program can't `await import("mpl")`. Instead, `runProgram`
   takes optional extra `modules`, and `wrap` puts `import * as mpl from "./mpl.js"` at the top when charts are
   on. The edge loader accepts the same `modules` map.
2. **mpl's one call that reaches the machine.** The tracer's `flush(path)` runs `await import('node:fs/promises')`
   (`src/trace.ts`). Our wall would turn the whole bundle away because of that line. So bundle mpl ourselves
   with that path stubbed out, or ask upstream to move the tracer behind its own entry point. Also check
   that the bundle doesn't use `new Function` or `eval`, because the isolated thread removes both.
3. **`save_chart({ name, png | svg })`.** A normal codeSplitter tool, so it goes through the existing bridge and
   the caller's token, scope and rate limits. It writes to a new R2 bucket under the token's account and answers
   `{ url, expires }` with a signed GET link (7 days).
   - The bucket gets a lifecycle rule that deletes charts after 7 days, which keeps it in R2's free tier.
   - Cap a chart at about 300 KB. The PNG crosses the bridge as base64 in the tool's arguments, so check the
     argument size limit fits that.
   - A program's text answer stays under `MAX_BACK` (20,000 characters) as now. Nothing about MCP replies changes.

Also check during the spike:

- **CPU.** codeSplitter gives a program 2,000 ms of CPU and eqosys gives 1,000 ms. Loading about 500 KB of
  JavaScript, plus one Agg render at `scale: 2`, should fit. Measure it in workerd and Bun, because the local
  loader runs programs in a Bun Worker, and Bun isn't one of mpl's tested runtimes. The loader keeps one stub
  per id, so build the id from the program plus the mpl version, and the bundle only parses once per isolate.
- **Getting the library in.** Don't depend on a GitHub URL, because `bun install --frozen-lockfile` doesn't run
  a dependency's `prepare` script. Vendor a built, pinned `dist/` (with mpl's commit sha, `LICENSE` and
  `THIRD_PARTY_NOTICES.md`) as a text module that codeSplitter's build reads. Don't make it a new package
  that other packages depend on.
- **Safety.** It's pure computation, and the program has no network. The remaining risk is a large or hostile
  spec burning CPU, and the CPU limit already ends a run like that. A saved chart can only be read through its
  signed link.

## Suggested spike (one PR, #5402)

1. Vendor a pinned mpl build (DejaVu Sans only, about 179 KiB gzip) with the tracer stubbed out.
2. `runProgram` takes extra `modules`, and `wrap` gives the program `mpl` when charts are on.
3. The R2 bucket (with its 7-day rule) and the `save_chart` tool with signed links. Update `INSTRUCTIONS` to say a
   program can draw and save a chart.
4. One journey test through `local()`: a program reads `test-times.json`-shaped rows from a tool, plots them, calls
   `save_chart`, and the link it gets back serves a valid PNG. Measure CPU time in the same test.

Running a saved chart program on a cron or an event comes after, through Cron Swanson. eqosys and qCRM get mpl
by turning it on in their `runProgram` options. Leave them off until codeSplitter has used it for a while.
