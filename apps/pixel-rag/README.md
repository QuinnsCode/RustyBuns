# Pixel RAG

> **What it proves:** one Rust index, one shared memory, every worker. Web or desktop. No vector DB bill. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

**Drop in your screenshots and find the parts that look alike across all of them.** Click a button, a chart or a
logo in one, and it shows every spot in the rest that looks the same. **Drop in photos and click a face**, and it
shows every photo of that person.

It opens with a few made-up web pages from four pretend sites (a shop, a docs site, a news site, a
dashboard), drawn in the page so nothing has to be uploaded. They share the usual parts: nav bars, buttons,
cards, charts, forms. Click a button on the shop page and you get the buttons from the other three.

How, in three steps:

1. Every page is cut into 160 px squares (tiles).
2. Each tile becomes a short fingerprint of its shapes and colours. Tiles that look alike get fingerprints that differ in only a few bits.
3. A click takes that tile's fingerprint, compares it with every other one, and shows the closest.

The name: RAG (retrieval-augmented generation) is how an AI looks things up before it answers, and
the "looking up" is this kind of search. Pixel RAG is that search half, for pictures, running on your
own computer: no paid vector database, no server. Asking in words, with an AI picking the tiles, is next
([#3475](https://github.com/QuinnsCode/RustyBuns/issues/3475)).

The other half is speed: one search engine written in Rust, its fingerprints in one block of memory that
every worker reads at once, the same code in a browser tab and in the desktop app. The Race tab times it
on a million fingerprints.

## Run

```sh
bun install                 # repo root
cd apps/pixel-rag
bun run build:native        # Rust. Skip it: TypeScript runs, same answers.
bun run desktop:dev         # desktop
bun run dev                 # web (run desktop:dev once first)
```

## What

| Thing | Does |
|---|---|
| Find | Click a screenshot. Same-looking tiles come back, from every page. |
| Add | Drop your own screenshots or photos. |
| Faces | Click a face on a photo. Every photo with the same person comes back. The people button loads six public-domain NASA portraits to try it on. |
| Race | Searches 1 million random fingerprints with Rust in the browser (wasm), plain TypeScript and native Rust (desktop). Shows each one's time and checks they find the same matches. |

## How

- Screenshot: 160 px tiles. Each tile: 1024 numbers, then 1024 bits (`native/crates/pixel_rag`).
- Index: the bits, in one `SharedArrayBuffer`. Workers each scan a slice. Nothing copied.
- Tab: Rust wasm in Web Workers. Desktop: Rust over `bun:ffi` in Bun workers. Same memory.
- `src/engine/twin.ts`: the TypeScript twin. Same bits (`test/engine.test.ts`).
- Web needs cross-origin isolation: `public/_headers`, `vite.config.ts`. Desktop host sends it.

### Faces

A face rarely fills one tile, and the same face in other light or at another angle draws different
shapes, so tiles can't find a person. Faces take three steps of their own (`src/faces`), then the same index:

1. Find: YuNet (MIT, 230 KB) gives each face a box and five points (eyes, nose, mouth corners).
2. Fingerprint: the five points line the face up in a 112 px crop, and SFace (Apache 2.0, int8, 9.4 MB) turns it
   into 128 numbers. One person's faces point the same way; strangers' don't.
3. Search: those 128 numbers against 1024 fixed random directions give 1024 bits, which go in the rows after
   the tiles in the same shared index, searched by the same `pr_topk`. The best 64 are rescored by cosine, and
   faces from 0.4 up count as the same person.

Both models run on ONNX Runtime's wasm build in the tab (and the desktop window). It loads with the first photo,
not before. `bun run models` fetches the weights into `public/models` from OpenCV's model zoo, at pinned revisions
with checked hashes. `dev` and `build` run it. Nothing is uploaded or stored: faces live in the page's memory until
it closes. `test/faces.test.ts` runs the real models under Bun on the sample photos.

One Mac, 1M codes, top 10: wasm 1 thread ~9 ms, 4 wasm workers ~2.5 ms, 4 native ~1.3 ms, 4 TS ~20 ms.

`bun run probe pixel-rag` reads `pixelRag.state()`; `pixelRag.samplePhotos()` and `pixelRag.askFace(page, n)` drive the faces.
