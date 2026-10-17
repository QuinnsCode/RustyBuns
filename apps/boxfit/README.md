# boxFit

Will it fit in the box? Make your shipping boxes, make your products, and boxFit says which box takes
the lot. The part other tools skip: **a box in a box**. Mark a product as one that opens and anything
smaller rides inside it, down as many levels as it goes (the russian doll that shipping software always
misses). Turn "Box in a box" off to see what a tool that treats every product as solid would answer.

Licensed under the QNTBR "This Shit Mine" license ([LICENSE](LICENSE)): read it, run it to evaluate it,
send fixes; don't copy, resell or host it for others. The rest of this repository stays under its own license.

```sh
bun install --frozen-lockfile   # at the repo root, once
cd apps/boxfit
bun run dev                     # http://localhost:5173
bun test test                   # the engine, the paste importer and the Worker, in-process
bun run wasm                    # rebuild the Rust engine (wasm-pack); the output is checked in
bun run deploy                  # secrets through varlock (.env.schema)
```

| Piece | Where | Notes |
| --- | --- | --- |
| Engine | `wasm/src/lib.rs` | `solve(json) -> json`. Six turns per piece, placed at extreme points, largest first; nesting folds small pieces into the boxes that hold them, smallest holder first. "Fits" is always true when it says so; "no" can be a tight arrangement it did not find. Any unit. |
| Page | `src/main.ts`, `src/model.ts` | Two lists and one answer, all in the browser, kept in `localStorage`. Nothing you enter is sent anywhere. |
| Import | `src/model.ts` | Paste or drop a CSV (comma, tab or semicolon): name, length, width, height, quantity; a header line is read by name; `10 x 8 x 4` in one cell works. |
| Sealed engine | `src/seal.ts`, `src/worker.ts` | The wasm ships AES-256-GCM encrypted (`bun run seal` with `ENGINE_KEY` from varlock, then build with `VITE_BOXFIT_SEALED=1`) and opens with the key [artstewengine](../artstewengine/README.md) hands a paid `BOXFIT_LICENSE`. |

A shipping box's size is its inside; a product's is its outside. A product that opens has a wall (Box wall)
taken off each side to make its cavity. Padding is kept between neighbours.
