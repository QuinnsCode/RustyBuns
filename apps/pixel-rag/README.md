# Pixel RAG

> **What it proves:** one Rust index, one shared memory, every worker. Web or desktop. No vector DB bill. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Click pic. Find same.

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
| Add | Drop your own screenshots. |
| Race | 1M codes. Wasm, TS, native. Who fast? Same answer? |

## How

- Screenshot: 160 px tiles. Each tile: 1024 numbers, then 1024 bits (`native/crates/pixel_rag`).
- Index: the bits, in one `SharedArrayBuffer`. Workers each scan a slice. Nothing copied.
- Tab: Rust wasm in Web Workers. Desktop: Rust over `bun:ffi` in Bun workers. Same memory.
- `src/engine/twin.ts`: the TypeScript twin. Same bits (`test/engine.test.ts`).
- Web needs cross-origin isolation: `public/_headers`, `vite.config.ts`. Desktop host sends it.

One Mac, 1M codes, top 10: wasm 1 thread ~9 ms, 4 wasm workers ~2.5 ms, 4 native ~1.3 ms, 4 TS ~20 ms.

`bun run probe pixel-rag` reads `pixelRag.state()`.
