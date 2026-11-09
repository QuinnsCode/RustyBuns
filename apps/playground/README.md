# Playground

One static page that lists every app with a way to try it: **Play** where there is a live browser build, **Download** where there is a desktop release, **Source** always. The list is `public/apps.json`; add a line when an app goes live. Each entry also carries `stage` (1 Sketch, 2 Alpha, 3 Beta, 4 Solid, drawn as a four-pip meter) and `best`, the systems it plays best on (`phone`, `tablet`, `desktop`, `gamepad`), drawn as slow lava-lamp Lucide icons. Once an app is on the App Store, add its listing as `store` and the phone icon becomes a store link; `note` replaces "Coming soon" on an app with no play link ("Parked for now"), and `soon: true` holds a deployed app back as coming soon (no Play link here or in the README) until the owner says it is ready. `group` says where it sits: `gateway` (codeSplitter and eqosys, the thin bright strip across the top), `games` (the eqosys game suite) or `apps` (the app suite); each game and app is a full-width row, its screenshot beside its words, and the order inside a group is the file's order. A menu down the left (search, Surprise me, a link per section with its count), laid out as eqosys's home lays out its own, becomes a pane over the list on a phone.

**Live:** https://rustybuns-playground.notryanquinn.workers.dev · on [eqosys](https://eqosys.qntbr.com)

Below the cards, a strip that scrolls sideways shows each framework example rated Fresh, Warm, Day-old or Stale: the framework version it pins against npm's latest (on it, a patch behind, a minor behind, a major behind). `public/frameworks.json` is written by `bun run fresh`; run it after bumping an example, and add a new example to `FRAMEWORKS` in `scripts/fresh.ts`.

```bash
bun run dev       # the page on localhost
bun run deploy    # your Cloudflare account, static assets only
```

It is assets only, no Worker code, so it bills nothing past the free static tier. Visits are counted on eqosys instead: the page sends a beacon to `eqosys.qntbr.com/api/visit` when it opens and on the first tap, key or scroll (not from localhost), and the super admin reads them on eqosys's Visitors tab.

## Putting an app on it

A browser app with no host needs a `wrangler.jsonc` with `"assets": { "directory": "<its dist>" }` and a `deploy` script (`splat-spray` and `hello-world` are the smallest). Deploy it, then add its `play` URL to `apps.json`. An app with "use server" actions (`fm-daw`, `auto-rig`, `splat-rooms`, `motion-midi`) runs `rustybuns boundary` before its `vite build`, so those actions become proxies that fail on the web and the page falls back. Those and `mythic-masters` and `hippo-tycoon` deploy through `rustybuns`: in the app's folder, `bunx rustybuns plan`, then `bun run deploy`. Each pins its Worker's name (`targets.edge.workerName`), so the URL is `<app>.<subdomain>.workers.dev`. Apps that need their desktop host (`tscircuit-desktop`, `meshy-studio`) take more work first.

## Look

Brawler type, paper buttons and orange (the kit's `.ui-btn` from `packages/ui`, themed with `--ui-*` tokens on `main`; `public/ui.js` is that kit bundled by `bun run ui`, rerun it when the kit changes), and eqosys's day-and-night sky behind it. The sky is baked into `public/index.html` between the `sky` markers; after changing `apps/eqosys/src/app/Sky.tsx`, run `bun run sky` to refresh it. A System / Day / Night switch sits top right (and double-clicking the sun or the moon swaps day and night), as on eqosys; its script and buttons (`Theme.tsx`) are baked in by the same command. Each card carries the screenshot eqosys shows for that app: `bun run shots` copies `apps/eqosys/public/cards/<app>.jpg` into `public/shots/`, and an app with none just has no picture.

## Checking screen sizes

`bun run dev`, then `bun run sizes <page url>` (open http://localhost:8800) shows the page at once in real-size frames: iPhone SE, 15 and Pro Max, iPhone Duo (outer and open, each both ways), iPad and laptop. Look at it after any layout change; the list is `SIZES` in `scripts/sizes.ts`.
