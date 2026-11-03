# ShareSplat

> **What it proves:** a phone camera, a guided shot list and a Gaussian splat viewer are enough for a seller to get a 3D product spin onto a store page. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

**Live:** https://sharesplat.notryanquinn.workers.dev · on [eqosys](https://eqosys.qntbr.com)

A seller (a Shopify store, a drop shipper, someone shipping through a CRM) photographs a product with a phone and gets back a 3D model that spins on the product page. This first cut is the two ends of that pipeline: **guided capture** and **the viewer and embed**. The middle (turning photos into a splat) is the next step, below.

## Does splatting work on objects, or only rooms?

It works well on objects. Splats reconstruct whatever the photos saw, so a product on a turntable is an easier capture than a room: small, evenly lit, and easy to walk all the way round. The catch is the photo count:

| Photos | What you get | How |
|---|---|---|
| **6** (front, back, sides, top, bottom) | A *guess*. An image-to-3D model fills in what it can't see. Looks fine in a thumbnail, wrong up close. Mesh (GLB/USDZ), so Shopify's native 3D block takes it. | Multi-image to 3D APIs (Meshy, Tripo, Hunyuan3D, TRELLIS). [Meshy Batch Studio](../meshy-studio/README.md) already calls one. |
| **60 to 100**, or a 30 s video | A faithful Gaussian splat: real textures, labels, gloss and fuzz. Needs a splat viewer on the page. | Splat training on a GPU ([Brush](https://github.com/ArthurBrussee/brush), gsplat, or a hosted trainer). |

So both plans are in the app. Six sides is the quick upsell; Orbit is the real thing.

Hard cases for any method: shiny metal, glass, and plain white boxes (nothing for the photos to line up on). A patterned mat under the product fixes the last one.

## What's in this cut

- **Shoot it.** Pick a plan; a dial shows every shot as a dot, the next one in orange. *Take next* opens the phone camera; *Add a batch* takes many photos (or a video) at once. It says when a ring is thin or there is a gap wider than 45° round the product (`src/shots.ts`), because a gap is a hole in the model.
- **Spin it.** Drop a `.ply`, `.spz`, `.sog` or `.splat` (or `?src=<url>`) and it turns on a studio-white turntable, framed to fit whatever shape the page is. Rendered with [Spark](https://github.com/sparkjsdev/spark) on three.js.
- **Put it on a product page.** `?embed=1&src=<url>` is just the spinning product; the app writes the `<iframe>` to paste into a Shopify product description.
- `?demo=1` loads a built-in carton so the viewer can be seen without a capture.

Photos stay in the page for now; nothing is uploaded.

## Next

1. **Train.** Send the photos (or a video) to a splat trainer and bring back the `.spz`: Brush on the [builder Mac](../../MAC_SETUP.md) to start, a hosted GPU later. Six-sides goes to an image-to-3D API instead.
2. **Clean.** Cut the table and floaters out (the background is the bulk of a raw capture); [Splat desktop](../splat-desktop/README.md) has the editor.
3. **Host.** Store the `.spz` and serve the embed from a Worker with R2, one URL per product.
4. **Sell it.** A Shopify app block in place of the pasted iframe, and a GLB fallback for Shopify's native 3D and AR.

## Names

Checked 2026-11-03. `splatshare.com` is registered (2023, parked). `sharesplat.com`, `splatsharable.com`, `splatshareable.com` and `splatshare.io` were unregistered; `splatshare.app` and `sharesplat.app` had no DNS. A browser tool called *GSplat Share* exists for sharing splat links, so "SplatShare" sits close to it. ShareSplat is the working name.

## Run it

```
cd apps/sharesplat
bun run dev          # then open /?demo=1
bun test ./test
```

`bun run probe sharesplat "/?demo=1"` prints the page's state (`shareSplat.state()`).
