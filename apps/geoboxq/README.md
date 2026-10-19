# GeoBoxQ

Will it fit in the box? Make your shipping boxes, make your products, and GeoBoxQ says which box takes
the lot. The part other tools skip: **a box in a box**. Mark a product as one that opens and anything
smaller rides inside it, down as many levels as it goes (the russian doll that shipping software always
misses). Turn "Box in a box" off to see what a tool that treats every product as solid would answer.

Licensed under the QNTBR "This Shit Mine" license ([LICENSE](LICENSE)): read it, run it to evaluate it,
send fixes; don't copy, resell or host it for others. The rest of this repository stays under its own license.

```sh
bun install --frozen-lockfile   # at the repo root, once
cd apps/geoboxq
bun run dev                     # http://localhost:5173
bun run build && bun run serve  # the same Worker code on a plain Bun server, :8787 (Railway, AWS, a box under a desk)
bun run stress                  # 2000 mixed requests at a local server; add --storm for an error storm (no cloud, no bill)
bun test test                   # the engine, the paste importer and the Worker, in-process
bun run wasm                    # rebuild the Rust engine (wasm-pack); the output is checked in
bun run deploy                  # secrets through varlock (.env.schema)
```

| Piece | Where | Notes |
| --- | --- | --- |
| Engine | `wasm/src/lib.rs` | `solve(json) -> json`. Six turns per piece, placed at extreme points, largest first; nesting folds small pieces into the boxes that hold them, smallest holder first. "Fits" is always true when it says so. Orders of seven pieces or fewer that the heuristic can't place get an exhaustive search, so "no" is exact there (axis-aligned, no tilting); bigger orders can still be a tight arrangement it did not find. Any unit. |
| Page | `src/main.ts`, `src/model.ts` | Two lists and one answer, all in the browser, kept in `localStorage`. Nothing you enter is sent anywhere. |
| Builder | `src/viz.ts` | Type a size and the row draws it: a dot at 0 0 0, a line, a rectangle, a box. Tick "opens" and it is hollowed out; the room inside defaults to half an inch of wall (1.25 cm) and is yours to edit. Any float works. |
| Animation | `src/viz.ts`, `src/main.ts` | The packed box as an isometric scene, filled a piece at a time with the holders as glass: play, loop or scrub, in five themes (Kraft, Neon, Mint, Ocean, Candy). |
| API | `src/worker.ts` | `POST /api/solve` with `{ boxes, items, pad? }`, answered with the smallest box that fits and the nesting as a tree. Bodies over 256 KB, over 400 pieces or over 30 boxes get a 4xx. For a Shopify wrapper to call. |
| Shipper link | `src/rates.ts`, `src/worker.ts` | `POST /api/rates` with `{ box: {l,w,h,unit?}, weight?, from, to }` asks the aggregator at `RATES_URL` (key `RATES_KEY`, both optional secrets) and answers `{ rates }` cheapest first. Vendor-neutral: the endpoint takes `{ parcel, from, to }` and returns `{ rates: [{ carrier, service, amount, currency, days? }] }`. Unset: 501. |
| Failover | `src/front.ts`, `Dockerfile`, `railway.json` | Cloudflare is primary, Railway second, an AWS container (same `Dockerfile`) only when both are down. `HOSTS=cf,railway,aws bun src/front.ts` sends each request to the first host whose `GET /api/health` answers (probe cached 10 s, 2 s timeout). Run it off Cloudflare. Config only: nothing is deployed until the owner does. |
| Stress | `scripts/stress.ts` | Local load and error-storm run against `src/serve.ts`: req/s, latency percentiles, status counts, memory; exits 1 on any 5xx. On a laptop: about 4,800 mixed req/s and 22,000 storm req/s, no 5xx. |
| Baxter the Boxer | `src/baxter.ts` | Opt-in (tick "Baxter"). Remembers the product shapes you pack, turned so the longest side leads, and suggests up to three box sizes that would hold them, skipping any an existing box already takes snugly. Kept in this browser only (`geoboxq:baxter`); no database, no calls, no price. "Forget" empties him and turns him off. |
| Import | `src/model.ts` | Paste or drop a CSV (comma, tab or semicolon): name, length, width, height, quantity; a header line is read by name. Reads a Shopify product export (variant lines take the product title; size columns or metafields) and a carrier box chart (`11-5/8" x 8 x 3`, `Medium Box 1: 13 x 11 x 3.5`). |
| Sealed engine | `packages/seal`, `src/worker.ts` | The wasm ships AES-256-GCM encrypted (`bun run seal` with `ENGINE_KEY` from varlock, then build with `VITE_GEOBOXQ_SEALED=1`) and opens with the key [artstewengine](../artstewengine/README.md) hands a paid `GEOBOXQ_LICENSE`. |

A shipping box's size is its inside; a product's is its outside. A product that opens has room inside (half an inch of wall assumed, editable). Padding is kept between neighbours, not against walls.
