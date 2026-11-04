# Screenshot RAG on Cloudflare, with Rust on the pixel path

A plan, not built yet. The question: where does a retrieval stack like the one at the top of
the leaderboard (PixelRAG + Jev) fit Rusty Buns, run on the Cloudflare stack, and give Rust a
job it is actually needed for?

The demo it is for: one small app that runs as a web page and, with one `rustybuns build desktop`,
as a desktop app, with its vector index either on the laptop or in the cloud, and no hosted vector
database bill in either case.

## The pieces

- **PixelRAG** (UC Berkeley, Apache 2.0, [arXiv 2606.28344](https://arxiv.org/abs/2606.28344)) indexes
  pages as screenshots instead of extracted text. It reports up to 18.1% better accuracy than text
  RAG on six benchmarks, and up to 3x fewer tokens when the screenshots are sent at a lower resolution.
  Its reference code is Python.
- **Jev** sits after retrieval: it judges each retrieved candidate against a typed question and
  returns probabilities instead of free text. That is a reranker that can say "none of these".
- **Clef** (`@cf/cloudflare/clef`, Workers AI) does the same job: typed options in, probabilities out,
  billed on input tokens only, and it already reads pictures. Excalibrawl uses it this way
  (`apps/excalibrawl/src/engine/brain.ts`, about $0.0005 a turn on Clef, $0.00003 on Clef Flash).
  So Clef replaces Jev, and the whole stack stays on one Cloudflare bill.
- **Clairic** (`@cf/cloudflare/clairic`, Workers AI, preview) extracts typed fields (dates, amounts,
  estimates with an 80% interval) in one pass with no output tokens. It is the last step: Clef picks
  the tile that answers, Clairic pulls the answer out as data. Weak at chained arithmetic and big
  table sums, so those stay in code.

## Where Rust earns its place

Workers have no canvas and no image codec. A screenshot pipeline on the edge needs to decode a PNG,
cut it into tiles, shrink them (that is where PixelRAG's 3x token saving comes from) and drop
duplicate tiles between crawls. In TypeScript that is slow; in Rust compiled to wasm it is the
"Rust deep" case the README describes, and the same crate runs native over `bun:ffi` on the
desktop and the box.

One crate, `native/crates/rb_pixels`:

1. `tile(png, size, overlap)`: decode, cut into overlapping tiles.
2. `shrink(tile, width)`: the low-resolution copies sent to the model.
3. `dhash(tile)`: a 64-bit perceptual hash, so a re-crawl only embeds tiles that changed.
4. `quantize(vec)` and `hamming_topk(query, codes, k)`: binary-quantized vectors (1 bit a dimension,
   so 1M tiles of 1024 dims is 128 MB) searched by brute-force Hamming distance, then the top few
   hundred rescored in full precision. This is the vector database, and it is a file, not a service:
   - **desktop**: native over `bun:ffi`, the index a file next to the app, works offline;
   - **cloud**: the same crate as wasm in one Durable Object per corpus, codes in its SQLite
     storage or R2. No Vectorize or hosted vector DB needed at mini-demo scale; Vectorize stays the
     swap-in if a corpus outgrows one object.

### One index, every worker searching it

`rb_genome` (`native/crates/rb_genome`) already proves the trick: the same Rust runs as a native
cdylib in Bun workers and as wasm32 with atomics in other workers, all on one `SharedArrayBuffer`.
The index uses that layout. The quantized codes sit in one shared buffer, written once, and N workers
each search a slice with `hamming_topk`. The results merge into one top-k. Nothing is copied.

- **Desktop / box**: Bun workers call the native crate over `bun:ffi`, and wasm workers can join
  the same buffer. This is where the fan-out is fastest.
- **Browser**: Web Workers running the wasm build, on a cross-origin-isolated page (COOP/COEP
  headers, which `SharedArrayBuffer` needs). The index runs client-side and costs nothing per query.
- **Cloudflare Worker / Durable Object**: there are no threads in an isolate, so the search runs as a
  single-threaded wasm scan. It is the same crate and gives the same answer, just slower. That is
  fine at demo scale.

The demo shows one picker: index on this laptop (native, every core), in this tab (wasm workers) or
in the cloud (Durable Object), with the same results and timings side by side.

Per the house rule, it gets a TypeScript twin that gives the same answer, and a race between the two
before anything depends on it.

## The flow

```
crawl (Browser Rendering screenshot) -> R2
  -> rb_pixels: tile, shrink, dhash (skip unchanged)
  -> image embedding -> rb_pixels quantize -> index (file on desktop, Durable Object on the web)
ask: question -> embedding -> hamming_topk -> top-k tiles
  -> Clef: "does this tile answer it?" probabilities per tile (the Jev step), "none" allowed
  -> Clairic: typed answer out of the winning tile
  -> optional: a text model writes the reply
```

## Open questions to check before building

- Which image embedding model runs on Workers AI for the tiles, or does embedding run on the box.
- Whether Clairic takes images or only text (Clef does take them).
- The cost of a query at k = 10 tiles, priced before any deploy.

## First cut options

- **A. The Rust crate alone**: `rb_pixels` (tile, shrink, dhash, quantize, hamming_topk) with its TS
  twin and the race. Small, shows the Rust case, no cloud spend.
- **B. A + the mini demo app** (`apps/pixel-rag`): drop in screenshots, ask a question, see the
  tiles Clef ranked and the answer Clairic pulled out, behind a budget guard. Runs as a web page and
  as a desktop build from the same code; index local on desktop. This is the one to show.
- **C. B deployed**: the web build on Workers with the index in a Durable Object, Browser Rendering
  for crawls. Priced first.
