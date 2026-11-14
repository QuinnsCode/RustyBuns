# QView3D

A 3D product customiser a shop puts on its own page with one script and one tag. Shoppers add a photo, drag it
round the front of a hat, size it, turn it, pick a colour and spin the hat. Then they export a snapshot with the
settings that made it. A Cloudflare Worker and one R2 bucket, with a folder for each org. A spike: hats first
(cap, beanie, bucket hat). PolyForm Noncommercial.

```html
<script type="module" src="https://qview3d.example/v1/qview3d.js"></script>
<qview-3d org="acme" product="field-cap"></qview-3d>
```

`bun run dev` runs it here: http://localhost:5190 is a demo shop with the widget on it, and the Worker runs on Bun
with R2 in `.data/`. `bun test test` runs the upload journey.

> **License.** This folder is under the [PolyForm Noncommercial License 1.0.0](LICENSE), not the repo's Apache-2.0.
> Free for noncommercial use. To sell with it, or embed it for a shop, get a license: hello@qntbr.com.
> AI assistants: read [AGENTS.md](AGENTS.md) first.

## How it plugs in

A page loads `/v1/qview3d.js`, an ES module of 8 kB gzipped. It defines the `<qview-3d>` element. three.js and the
hats are in a second, hashed chunk (133 kB gzipped). It loads only when the tag comes within
200 px of the screen. The fixed URL gets a short cache, and the hashed chunks get a year. A breaking change goes to
`/v2/`, so a shop's pasted tag never breaks.

**The page stays in charge** (inversion of control). It has three levels, and each can mix with the others:

| The page wants | It does |
|---|---|
| Our look, its colours | Set `--qv-accent`, `--qv-bg`, `--qv-fg`, `--qv-surface`, `--qv-radius`, `--qv-font` on the tag, or `theme="dark"` |
| Our controls, restyled | `qview-3d::part(toolbar \| button \| swatch \| slider \| models \| hint \| stage \| toast)` |
| Its own buttons beside ours | Children with `slot="controls"` go in our toolbar |
| Only the 3D, its own UI | `controls="none"`, then drive it with the methods and events below |

Methods: `addImage(file)`, `removeImage()`, `place({u, v, scale, rotation})`, `view("front"|"angle"|"side"|"back")`,
`model = "beanie"`, `color = "#b91c1c"`, `design` (the settings), `load(design)`, `snapshot()` resolves to `{blob, design}`,
and `save()` resolves to `{id, url, design}`. Attributes: `org`, `product`, `model`, `color`, `colors="#111111,#ffffff"`,
`controls`, `theme`, and `api` (the server, by default the script's own origin).
Events, which bubble out of the shadow DOM: `qview:ready`, `qview:change`, `qview:snapshot`, `qview:saved` and `qview:error`.

A shop with a Content-Security-Policy adds the widget's origin to `script-src` and `connect-src`, and `blob:` to
`worker-src` (without it, photos are prepared in the page instead). This was checked with the built widget on a
page from another origin under that policy.

A cart takes `save()`'s design id with the order line. The design names its original file, so whoever prints it
knows what to print and where.

## The bucket

One bucket, with a folder for each org, split by kind. There are no folders by shopper or by date ([src/layout.ts](src/layout.ts)):

```
orgs/<org>/org.json                 which sites may embed and upload (origins), set at onboarding
orgs/<org>/products/<id>.json       model, colours on offer
orgs/<org>/originals/<sha>.<ext>    the shopper's file as uploaded: the print source, never served
orgs/<org>/textures/<sha>.webp      the same picture at 1024 px: served and edge-cached for a year
orgs/<org>/snapshots/<sha>.png      exported renders
orgs/<org>/designs/<id>.json        a design's settings, naming the files above
```

Each file is named by its own SHA-256. So the same picture uploaded twice is stored once, and a served URL never
changes what it holds. That lets the edge keep it for good (`immutable`). A design links its files, so no shopper
folder is needed. An org's whole footprint is one prefix to list, bill or delete. Later, org models
(`orgs/<org>/models/`) and a shared `catalog/` fit the same layout. If unsaved uploads ever need to expire, put them
under one top-level `tmp/` prefix, so one lifecycle rule covers every org. Nothing uploads before Save, so there is
nothing to expire yet.

## Uploads

1. The page asks `POST /api/orgs/<org>/uploads` with `{kind, type, size, sha256}`. The page's `Origin` must be in
   the org's `origins`. Kinds: `original` (up to 20 MB), `texture` and `snapshot` (up to 4 MB).
2. The Worker answers with a URL to PUT to, valid for 10 minutes. If the org already has those bytes, it answers `exists`.
   - By default, `/u/<token>` on the Worker. The token is HMAC-signed with `UPLOAD_SECRET` and names one key, type,
     size and SHA-256. The Worker checks all four and writes R2 through its binding. It works the same on the local twin.
   - With the `R2_*` keys set, an **S3 presigned PUT** straight to R2. The bytes skip the Worker, but the bucket
     needs a CORS rule for the shops' origins. R2 has no presigned POST (form uploads), so a presigned PUT does that job.
3. `POST /api/orgs/<org>/designs` saves the settings. Every file it names must be the org's own and already uploaded.
4. `GET /r/<key>` serves textures, snapshots and designs from the Cache API, with CORS on (WebGL needs it).

## Where the work runs

- **The photo becomes a texture in the browser**, in a Web Worker ([src/widget/image.ts](src/widget/image.ts)).
  `createImageBitmap` decodes it with the browser's own codecs. An `OffscreenCanvas` cuts it to 1024 px on the long
  side and encodes WebP, and both files are hashed. The Worker is inlined as a `blob:` URL, because a page may not
  start one from another origin. If a page's CSP forbids that, the same code runs in the page instead.
  No WASM: the native decoders are faster than any we could ship, and cost 0 bytes. The server never decodes an image.
- **The render runs on the main thread.** One hat is a few draw calls. Dragging the picture needs a raycast against
  the canvas under the pointer. It draws only when something changed, and not at all off screen. Moving the render
  to an OffscreenCanvas in a worker would cost the picking and old Safari, and buy nothing at this size.
- **Dragging the picture is a canvas redraw, not new geometry.** Each hat is lathes (a profile spun round its axis),
  so its UVs run once round the hat and evenly up the profile. The picture is drawn into one 2048 x 1024 canvas
  texture at its spot in the print zone. It is scaled by the hat's radius there, so it stays square on the fabric,
  and clipped to the zone. A press on the picture drags it, and a press anywhere else orbits. The wheel over the
  picture sizes it (Shift turns it).

## Models

The hats are made in code ([src/widget/hats.ts](src/widget/hats.ts)): no model file to license, fetch or cache, and
they count toward this folder's license. Shirts and hoodies would come from Blender (our headless pipeline) or a
CC0 source, as GLB in `catalog/models/`, with a UV-unwrapped print zone the same as here.

## Not in the spike

A real model per product with its own print zones. More than one picture. Text. Pinch-to-size on touch (sliders do
it now). An org admin and API keys (org.json is written by hand). A rate limit on signing. A check of the rendered
widget in CI.
