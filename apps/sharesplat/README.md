# ShareSplat

> **What it proves:** a phone camera, a guided shot list and a Gaussian splat viewer are enough for a seller to get a 3D product spin onto a store page. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

**Live:** https://sharesplat.notryanquinn.workers.dev · on [eqosys](https://eqosys.qntbr.com)

## Use it

**What it is:** turn photos of a product into a 3D model that spins on your shop page.

**Use:** https://sharesplat.notryanquinn.workers.dev (`?demo=1` shows a sample box spinning)

**How to use:** pick a plan and take the photos it asks for, all the way round the product.
Then drop in a 3D file to see it spin, press the scissors to cut away the table and stray bits, and the cloud to put it
online. Copy the code it gives you onto your product page, or add the ShareSplat block in your Shopify theme.

**Account:** not needed to take photos or view a model; your photos stay on your device. Putting a model online needs an eqosys sign-in.

A seller (a Shopify store, a drop shipper, someone shipping through a CRM) photographs a product with a phone and gets back a 3D model that spins on the product page. This first cut is the two ends of that pipeline: **guided capture** and **the viewer and embed**. The middle (turning photos into a splat) is the next step, below.

## Does splatting work on objects, or only rooms?

It works well on objects. Splats reconstruct whatever the photos saw, so a product on a turntable is an easier capture than a room: small, evenly lit, and easy to walk all the way round. The catch is the photo count:

| Photos | What you get | How |
|---|---|---|
| **6** (front, back, sides, top, bottom) | A *guess*. An image-to-3D model fills in what it can't see. Looks fine in a thumbnail, wrong up close. Mesh (GLB/USDZ), so Shopify's native 3D block takes it. | Multi-image to 3D APIs (Meshy, Tripo, Hunyuan3D, TRELLIS). [Meshy Batch Studio](../meshy-studio/README.md) already calls one. |
| **60 to 100**, or a 30 s video | A faithful Gaussian splat: real textures, labels, gloss and fuzz. Needs a splat viewer on the page. | Splat training on a GPU ([Brush](https://github.com/ArthurBrussee/brush), gsplat, or a hosted trainer). |

So both plans are in the app. Six sides is the quick upsell; Orbit is the real thing.

Hard cases for any method: shiny metal, glass, and plain white boxes (nothing for the photos to line up on). A patterned mat under the product fixes the last one.

## What's in it

- **Take the photos.** Pick a plan (*Six sides*, or *All the way round*: 72 in rings); a dial shows every shot as a dot, the next one in orange. *Take a photo* opens the phone camera; *Add many* takes many photos (or a video) at once. It says when a ring is thin or there is a gap wider than 45° round the product (`src/shots.ts`), because a gap is a hole in the model.
- **Your 3D view.** *See an example* loads the built-in carton. Drop a `.ply`, `.spz`, `.sog` or `.splat` (or `?src=<url>`) and it turns on a studio-white turntable, framed to fit whatever shape the page is. Rendered with [Spark](https://github.com/sparkjsdev/spark) on three.js.
- **Clean it up** (the scissors). A raw capture is mostly table and background. `src/clean.ts` slices the splats into thin layers by height: the product is the run of dense layers whose footprint stays narrow, the table is the dense layer under it that is suddenly far wider, and floaters are too sparse to make a layer dense. Faint and huge splats (the trainer painting the background) go first. What is left is shown, and is what goes online. A capture that is already clean keeps every point.
- **Put it online** (the cloud). Sign in with eqosys (a small window), and the page sends the cleaned model as an `.spz` to the Worker (`src/worker.ts`), which keeps it in R2 and answers with the product's one URL, `/p/<id>`: the spinning product alone. The id is the file's hash, so the same file is the same product. Each seller has up to 20 products online, 50 MB each (`src/api.ts`); `DELETE /api/splats/<id>` takes one down.
- **Put it on a product page.** The app writes the `<iframe>` to paste into a Shopify product description, or use the theme block below.
- **Shopify block** (`shopify/`). A theme app block, *ShareSplat 3D spin*, with one setting, the product link. Connect that setting to a product metafield in the theme editor and every product shows its own spin; a product with no link shows nothing, so the theme's own media stays. The app reads no store data and asks for no scopes. `shopify app deploy` from `shopify/` publishes it once `client_id` is filled in from the Partner dashboard.
- `?demo=1` loads a built-in carton so the viewer can be seen without a capture.

Photos stay in the page; only a model you put online is uploaded.

## Next

1. **Train.** Send the photos (or a video) to a splat trainer and bring back the `.spz`: Brush on the [builder Mac](../../MAC_SETUP.md) to start, a hosted GPU later. Six-sides goes to an image-to-3D API instead. Pricing to settle before it goes hosted: GPU minutes per capture.
2. **GLB fallback.** A mesh beside the splat for Shopify's native 3D and AR (splat-to-mesh, or the image-to-3D mesh from Six sides).

## Names

Checked 2026-11-03. `splatshare.com` is registered (2023, parked). `sharesplat.com`, `splatsharable.com`, `splatshareable.com` and `splatshare.io` were unregistered; `splatshare.app` and `sharesplat.app` had no DNS. A browser tool called *GSplat Share* exists for sharing splat links, so "SplatShare" sits close to it. ShareSplat is the working name.

## Run it

```
cd apps/sharesplat
bun run dev          # then open /?demo=1 (the page; Put it online needs the Worker)
bun test ./test      # clean.test.ts cuts a synthetic capture; host.test.ts walks the Worker with R2 on disk
```

`bun run probe sharesplat "/?demo=1"` prints the page's state (`shareSplat.state()`: the capture, the splat count, what the clean-up cut, where it went online); `--js "shareSplat.clean()"` presses the scissors.

Deploying: the bucket is made once (`bunx wrangler r2 bucket create sharesplat`), then `bun run deploy`.
