# QView3D

A 3D product customiser a shop puts on its own page with one script and one tag. Shoppers add a photo, drag it
round the front of a hat or over a top's front, back or sleeve, size it, turn it, pick a colour and spin the product.
Then they export a snapshot with the settings that made it. A Cloudflare Worker and one R2 bucket, with a folder for
each org. A spike: hats (cap, beanie, bucket hat) and tops (a tee, a sweater, a hoodie and two tanks on one body form, a
picture on each print zone: front, back and, with sleeves, the left sleeve), plus **samples**: a shop with a product these don't cover uploads photos or a video, and Meshy makes a model
of it the widget can print on. PolyForm Noncommercial.

```html
<script type="module" src="https://qview3d.example/v1/qview3d.js"></script>
<qview-3d org="acme" product="field-cap"></qview-3d>
```

`bun run dev` runs it here: http://localhost:5190 is a demo shop with the widget on it, and
http://localhost:5190/admin.html makes samples (the demo org and its admin key are filled in). The Worker runs on
Bun with R2 and D1 (sqlite) in `.data/`, and a stand-in answers for Meshy, so nothing is billed. `/orgs.html` is the shops page; it signs
in through eqosys, so here it needs a local eqosys (`EQOSYS_URL=http://localhost:<port> bun run dev`). `bun test test`
runs the upload, sample and shop journeys.

> **License.** This folder is under the [PolyForm Noncommercial License 1.0.0](LICENSE), not the repo's Apache-2.0.
> Free for noncommercial use. To sell with it, or embed it for a shop, get a license: hello@qntbr.com.
> AI assistants: read [AGENTS.md](AGENTS.md) first.

## Go live, and hand it to a friend

Settings live in D1: each org's sites, samples and studio, and each product's name, model, colours, print zones and
where a picture lands ([src/settings.ts](src/settings.ts)). Files stay in R2. The deploy runs the D1 migrations, and they
seed the demo org and its hats and tops from [src/demo.ts](src/demo.ts), so a fresh host works with nothing to do by hand.
That public demo keeps no files, so strangers can't fill the bucket. Customising and the snapshot download still work, because they run in the browser.

1. Once: a Password item `upload-secret` in the `qview3d` vault, with a random value in its built-in password field.
2. From `apps/qview3d`: `bun run plan`, read it (a Worker, the `qview3d` bucket and the `qview3d-db` D1 database),
   then `bun run deploy`. It lands at `https://qview3d.<your subdomain>.workers.dev`. The widget's product read sits
   behind the Workers Cache API for a minute, but Cloudflare keeps no cache on `workers.dev`: give it a custom domain
   and shop pages stop waiting on D1.

### Hand someone a sandbox (the quick test)

To let someone try it with their own product before they have a shop, send them one link:

1. Open `/orgs.html` signed in as an owner or admin of QNTBR. Under **Hand off a sandbox**, type who it's for, how many
   samples of their own product Meshy may make (each costs credits, 1 by default) and how many days it lasts (14).
2. **Make the sandbox link** gives a message to paste to them, link included. The link is shown once.
3. They open it. No sign-up: `/try.html` shows their product live (a tee to start), lets them add or change products,
   and gives four ways onto their page: a line for their coding agent (`/v1/embed.md?org=&product=` with their
   sandbox filled in), the web component, an iframe, and a `curl` that writes a product with the sandbox's key.
   **Make a sample from photos** opens `/admin.html` with the key filled in.

A sandbox is an org named `try-<who>-<6 hex>`. Any page may embed it (`*`), and on its end date every route reads it
as unknown. To keep it, they click **Keep this as my shop** on the sandbox page and sign in (below): the products and
sites stay and the end date goes. The routes are in [src/sandboxes.ts](src/sandboxes.ts). `bun run dev` prints a local
sandbox link (`try-local`) to try the page.

### A shop for good

A shop is an eqosys studio, so no keys change hands, and nobody has to wait on you:

1. Your friend signs in to eqosys, makes a studio (Studio tab), then opens `/orgs.html` here and signs in.
2. As the studio's owner or admin, they click **Start my shop** (an org id from the studio's name, which goes in the
   embed tag; they can change it first). It starts with a tee, no samples and no sites, so no page shows it until they
   add theirs. Came from a sandbox? The card says **Keep try-... as this shop** instead. One shop per studio, at most
   50 products. As QNTBR's owner or admin you can still **Make a shop** for any studio, and set its samples.
3. They add products (id, name, kind, colours, which zones print, where a new picture
   lands), **Change** any of them, set their own sites, and copy the embed tag. A save shows on their shop's next page
   load. Their studio's owners and admins can do this; its makers only see it. **New script key** makes an admin key
   for a script (shown once; the org keeps its SHA-256), which writes products and makes samples without signing in.

The routes are in [src/orgs.ts](src/orgs.ts). eqosys puts the person's studios in QView3D's token (`studios` in
eqosys's APPS), and the Worker checks it against eqosys's JWKS.

Then send your friend one line for their coding agent. The demo page has it ready to copy:

> Add the QView3D 3D hat customiser to my product page. Follow https://qview3d.&lt;subdomain&gt;.workers.dev/v1/embed.md

[`/v1/embed.md`](src/embed.ts) (also at `/llms.txt`) is written for an agent. It has the two lines to paste with the
host filled in, how to size and restyle it, the events, the CSP lines, how to check it worked, and the license note
to pass on. The live demo shop is the host's own `/`.

## How it plugs in

A page loads `/v1/qview3d.js`, an ES module of 8 kB gzipped. It defines the `<qview-3d>` element. three.js and the
hats are in a second, hashed chunk (146 kB gzipped). It loads only when the tag comes within
200 px of the screen. A shop's own model adds a third (15 kB, the GLB loader and the decals), loaded only for one. The fixed URL gets a short cache, and the hashed chunks get a year. A breaking change goes to
`/v2/`, so a shop's pasted tag never breaks.

**The page stays in charge** (inversion of control). It has three levels, and each can mix with the others:

| The page wants | It does |
|---|---|
| Our look, its colours | Set `--qv-accent`, `--qv-accent-ink`, `--qv-fg`, `--qv-bg`, `--qv-paper`, `--qv-line`, `--qv-radius`, `--qv-font` on the tag, or `theme="dark"` |
| Our controls, restyled | `qview-3d::part(toolbar \| button \| swatch \| slider \| models \| hint \| keys \| stage \| toast)` |
| Its own buttons beside ours | Children with `slot="controls"` go in our toolbar |
| Only the 3D, its own UI | `controls="none"`, then drive it with the methods and events below |

Methods: `addImage(file, zone?)`, `addText({line, font, color}, zone?)` (a line of text, drawn to a picture; `font` one of sans, serif, mono, bold, script), `setText(words)`, `select(i)`, `raise()`, `lower()`, `removeImage()` (the layer being worked on, `selected`), `place({u, v, scale, rotation})`, `view("front"|"angle"|"side"|"back")`,
`model = "beanie"`, `zone = "back"` (a top's `"front"`, `"back"` or `"left-sleeve"`: where the next picture goes and what `place()` moves), `color = "#b91c1c"`, `design` (the settings: its layers, bottom first, up to 8 pictures and lines of text across the zones), `load(design)`, `snapshot()` resolves to `{blob, design}`,
and `save()` resolves to `{id, url, design}`; `value` is the saved id (below). Attributes: `name`, `org`, `product`, `model`, `color`, `colors="#111111,#ffffff"`,
`controls`, `theme`, and `api` (the server, by default the script's own origin).
A product's `print` (the zones the shop switched on) and `place` (where a new picture lands), set on `/orgs.html`, shape the widget: it offers only those zones, refuses a picture on one switched off, and starts each new picture at `place`.
A shop's own model takes a picture anywhere until the shop marks its `area` on `/admin.html`: put a picture where the print goes, at the size it prints, and click **Use as print area**. Then a new picture starts there, can't be dragged or nudged past the dashed square, and is never wider than it.
Events, which bubble out of the shadow DOM: `qview:ready`, `qview:change`, `qview:snapshot`, `qview:saved` and `qview:error`.

**The default look is codeSplitter's:** ink on white, hairline borders, paper panels, one orange. It is built to
be accessible without the shop doing anything:
- Text and filled buttons pass WCAG AA contrast. The bright orange marks things; the deeper `--qv-accent-ink`
  carries text and fills, since white on the bright one is too faint.
- Every control has a name a screen reader says ("Picture size", "Colour #b91c1c"), a visible focus ring, and a
  target of 32 px or more. Messages go to a polite live region.
- Dragging has a keyboard way (WCAG 2.5.7). Tab to the 3D view, then use the arrows to move the picture, `+` and `-`
  to size it, `[` and `]` to turn it, and Shift with the arrows to spin the product. A hint shows the keys while
  the view has focus.
- Motion stops under `prefers-reduced-motion`, and borders hold in Windows' high-contrast mode.

A shop with a Content-Security-Policy adds the widget's origin to `script-src` and `connect-src`, and `blob:` to
`worker-src` (without it, photos are prepared in the page instead). This was checked with the built widget on a
page from another origin under that policy.

### In the Add to cart form

`<qview-3d name="design">` inside a `<form>` is a form field (a form-associated custom element). On submit it saves
the design (pictures, snapshot, settings), then submits the form again with `design` (the id) and `design-url` (its
`/r/` link), as hidden inputs would. The page's own submit handlers only see that second submit. A change after a
save clears the id (`el.value` is `""` again), so the next submit saves anew; a failed save stops the submit. The demo
shop (`public/index.html`) is built this way: pick the hat, the shirt or the hoodie, a size and a quantity, and Add to
cart puts a line with the design's id on the page. The design names its original file, so whoever prints it knows what
to print and where. Without a form, `save()` gives the same id.

### Script tag first, an iframe when the host won't run scripts

The script tag is the main way: `/v1/qview3d.js` is served by the Worker from the edge, with versioned paths and
hashed chunks cached for a year, so there's no CDN like jsDelivr in between (the code is PolyForm Noncommercial, not
an npm package for anyone to mirror). For a site builder that strips a pasted `<script>` but keeps an `<iframe>`,
`GET /v1/frame?org=<org>&product=<product>` ([src/frame.ts](src/frame.ts)) is the widget alone on a bare page. Its
`frame-ancestors` names only the org's sites, and it posts each `qview:*` event to its parent (`{ source: "qview3d",
type, detail }`) only when the parent's origin is one of them; the parent asks for `save` or `snapshot` the same way.
Both are in [`/v1/embed.md`](src/embed.ts).

### Print files

Whoever fulfils the order pastes the design id (or its `/r/` link) into **Print files** on `/admin.html`, with the
org's admin key. It gets one PNG per print zone: each of its layers' originals (pictures and lines of text, bottom first) at 300 dpi over the zone's real size, on a
clear background, with the dpi written into the file so print software opens it at its real size. A cap's front
(12 x 6 cm) is 1417 x 709 px. The sizes are product data: a product's `zones` (`{ "front": { "w": 12, "h": 6 } }`,
in centimetres) overrides the defaults in `PRINT_CM` (`src/api.ts`). A shop's own model has no default, so its
product must name them. The picture sits as the widget shows it: centred at u across and v up, `scale` of the
zone's width, turned, cut at the zone's edge.

`GET /api/orgs/<org>/designs/<id>/print` (admin key) answers the layout as JSON, and
`GET /api/orgs/<org>/originals/<file>` (admin key) the original, so a script can make them too. The pixels are
drawn in the page, since a Worker has no canvas.

### Webhooks, both ways

A shop wires QView3D into its own tools on any store ([src/hooks.ts](src/hooks.ts)); section 9 of `/v1/embed.md`
walks a shop's coding agent through it.

- **Out.** Under **Webhooks** on `/orgs.html` (or `POST /api/orgs/<org>/hooks` with a script key) a shop adds a URL
  and gets a signing secret, shown once; the org keeps it sealed with AES-GCM under a key made from `UPLOAD_SECRET`.
  Up to 5 a shop. Events are `design.saved` and `order.ready`, one `HookEvent` body (`src/api.ts`), signed like
  Stripe's: `QView3D-Signature: t=<unix>,v1=<HMAC-SHA256 of "<t>.<body>">` ([src/hook-sign.ts](src/hook-sign.ts)).
  A non-2xx or no answer in 10 s is tried again at 1 min, 5 min, 30 min, 2 h and 12 h, then marked failed. The page
  shows the last 20 deliveries and has **Send test**.
- **In.** `POST /api/orgs/<org>/orders` (script key) with `{id, lines: [{design, qty}]}` records the order once, lays
  out each line's print files (the plan above) and fires `order.ready` with their links. Sent again, it answers the
  same order and fires nothing. A Shopify or WooCommerce connector calls this later.

Retries need no Queue or Durable Object: a once-a-minute cron trigger reads due deliveries from D1. Cron triggers
are free on every Workers plan, and a minute's sweep is one indexed D1 read (1,440 a day of the free 5 million).

## The bucket

Settings are rows in D1 ([migrations/](migrations)): `orgs` (sites, admin keys, samples, studio, whether it's the
public demo) and `products` (one JSON row each, checked by the `Product` guard). Files are in one bucket, with a
folder for each org, split by kind. There are no folders by shopper or by date ([src/layout.ts](src/layout.ts)):

```
orgs/<org>/originals/<sha>.<ext>    the shopper's file as uploaded: the print source, never served
orgs/<org>/textures/<sha>.webp      the same picture at 1024 px: served and edge-cached for a year
orgs/<org>/snapshots/<sha>.png      exported renders
orgs/<org>/designs/<id>.json        a design's settings, naming the files above
orgs/<org>/photos/<sha>.<ext>       an admin's photos of the shop's own product, sent to make a sample: never served
orgs/<org>/models/<id>.json         a sample in the making (its Meshy task and progress)
orgs/<org>/models/<id>.glb          the sample model: served and edge-cached for a year
orgs/<org>/scans/<sha>.glb          a sample scanned on the shop's own iPhone: served and edge-cached for a year
orgs/<org>/receipts/<id>.json       a pack of samples the shop paid for: never served
meta/meshy/<yyyy-mm-dd>.json        samples started that day across every org: the ceiling on the Meshy bill
```

Each file is named by its own SHA-256. So the same picture uploaded twice is stored once, and a served URL never
changes what it holds. That lets the edge keep it for good (`immutable`). A design links its files, so no shopper
folder is needed. An org's whole footprint is one prefix to list, bill or delete. A shared `catalog/` of
ready-made models fits the same layout later. If unsaved uploads ever need to expire, put them
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

## Samples: a shop's own product

For a product the hats don't cover (a tumbler, a tote, a koozie), the shop makes a sample on
[admin.html](public/admin.html) ([src/admin.ts](src/admin.ts), [src/samples.ts](src/samples.ts)):

1. **Photos or a video.** Up to 4 photos, or a video from which the page takes 4 frames itself, so the video never
   uploads. Each is cut to a 1600 px JPEG in the browser and sent as kind `photo`. That kind needs the org's admin
   key; org.json keeps only its SHA-256.
2. **Make it.** `POST /api/orgs/<org>/models` sends them to Meshy's multi-image-to-3D (textured, remeshed to about
   30,000 triangles). That takes a minute or two.
3. **Watch it.** The page polls `GET /api/orgs/<org>/models/<id>`. The poll that sees Meshy finish copies the GLB into
   the org's folder (Meshy's links expire) and writes a product for it. Progress lives in R2 beside the model, so
   there is no queue or workflow to keep alive.
4. **Use it.** `<qview-3d org="acme" product="<sample id>">` loads the model. A shop's model keeps its own texture, so
   it has no colour swatches and no hat switcher, and the picture is **projected** onto it (three.js
   `DecalGeometry`) wherever the shopper presses. Meshy's texture map is patches all over, so drawing into it, the
   way the hats work, can't work here.

**Every sample costs Meshy credits**, so three checks stand before one: the admin key, the org's paid allowance
(`samples` in org.json plus the packs it bought, counted against its `models/` folder, `402` when spent), and `MESHY_DAILY` (50) samples a
day across every org (`429`). The Meshy Batch Studio app's price table puts multi-image-to-3D at 5 to 40 credits a
model; check Meshy's current price before turning the real key on. It's a draft: the model guesses at sides the
photos didn't show.

**Shops buy samples in packs** ([src/billing.ts](src/billing.ts)), from the admin page: it shows how many are left
and a button per pack. A paid pack is a receipt in the org's folder; the allowance is org.json's `samples` (set by
hand: a trial, a deal) plus every receipt's, so nothing is read, added to and written back, and Stripe retrying a
webhook still counts once (the receipt is named by the payment). The packs and prices in `PACKS` are placeholders
until #4515 says what a sample costs in Meshy credits. Who takes the money:

- **Stripe Checkout** when `STRIPE_SECRET_KEY` is set: the admin goes to Stripe's page, and Stripe's signed
  `checkout.session.completed` webhook (`POST /api/stripe-webhook`, `STRIPE_WEBHOOK_SECRET`) writes the receipt.
- **The test provider** in `bun run dev` and the tests: the pack is paid at once and nothing is charged.
- **Neither** on a deploy without the Stripe key: buying answers `501` and the page says to ask us.

### A scan from the shop's own iPhone

For an accurate model, at no cost to anyone, the shop scans the product itself. [ios/](ios) is QView3D Scan, a thin
SwiftUI app for an iPhone or iPad with LiDAR (iOS 17): Apple's Object Capture walks the shop round the product
and builds a textured model on the phone. The model comes out as USDZ, which holds USDC that the widget's three.js
can't read, so the app writes it out as a GLB itself (`ScanExport` over ModelIO, then `GLB.write`). It then
uploads it with the admin key, as kind `scan` (`model/gltf-binary`, up to 40 MB), and sends
`POST /api/orgs/<org>/models {name, scan}`. That answers `201` with the product, ready now: no Meshy, so no
allowance or daily ceiling, and nothing to poll. The product is named by the scan's hash, so the same scan sent
twice is one product.

`brew install xcodegen && cd ios && xcodegen` makes the Xcode project. `cd ios && swift test` (full Xcode)
tests the GLB writer and the upload request. Xcode builds go to the builder Mac.

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

The hats and the tops are made in code ([src/widget/hats.ts](src/widget/hats.ts), [src/widget/tops.ts](src/widget/tops.ts)):
no model file to license, fetch or cache, and they count toward this folder's license. A shop's own products come from
samples (above).

The tops are five cuts of one body form (`CUTS` in tops.ts: a crew tee, a crew sweater in a knit, a fleece hoodie with
its hood lying back, a pouch pocket and drawcords, a men's tank and a racerback with a shaped waist). The cloth folds
where it hangs free and only shades a print zone; sleeves grow out of an armhole on the body's side; cuffs, hems and
collars are rib knit or rolled and stitched; inside faces are drawn a shade darker, so a neckline shows cloth.

**On a hanger** (a spike: `display="hanger"`, the demo shop's "On a hanger" button; the default controls don't offer it): a sleeved top starts laid flat and hangs from a
hanger by its shoulders, its own mesh run as cloth (position-based, [src/widget/hanger.ts](src/widget/hanger.ts)) for about
a second when it loads or changes colour, then frozen. Shots before and after: [docs/shots-2026-11-14-range](docs/shots-2026-11-14-range/README.md).

## Not in the spike

Print zones on a shop's own model (the picture goes anywhere on it now). More than one picture. Text. Pinch-to-size
on touch (sliders do it now). Real sample
prices (#4515). A rate limit on signing.
