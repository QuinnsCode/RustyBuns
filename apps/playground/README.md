# Playground

One static page that lists every app with a way to try it: **Play** where there is a live browser build, **Download** where there is a desktop release, **Source** always. The list is `public/apps.json`; add a line when an app goes live. Each entry also carries `stage` (1 Sketch, 2 Alpha, 3 Beta, 4 Solid, drawn as a four-pip meter) and `best`, the systems it plays best on (`phone`, `tablet`, `desktop`, `gamepad`), drawn as slow lava-lamp Lucide icons. Once an app is on the App Store, add its listing as `store` and the phone icon becomes a store link; `note` replaces "Coming soon" on an app with no play link ("Parked for now"). The order is the page's order: codeSplitter and the games built on it first, then the park games, then the rest of the games, then the tools.

Below the cards, a strip that scrolls sideways shows each framework example rated Fresh, Warm, Day-old or Stale: the framework version it pins against npm's latest (on it, a patch behind, a minor behind, a major behind). `public/frameworks.json` is written by `bun run fresh`; run it after bumping an example, and add a new example to `FRAMEWORKS` in `scripts/fresh.ts`.

```bash
bun run dev       # the page on localhost
bun run deploy    # your Cloudflare account, static assets only
```

It is assets only, no Worker code, so it bills nothing past the free static tier.

## Putting an app on it

A browser app with no host needs a `wrangler.jsonc` with `"assets": { "directory": "<its dist>" }` and a `deploy` script (`splat-spray` and `hello-world` are the smallest). Deploy it, then add its `play` URL to `apps.json`. Apps that need their desktop host (`tscircuit-desktop`, `meshy-studio`) or a generated `.rustybuns/` (`fm-daw`, `hippo-tycoon`, `auto-rig`, `splat-rooms`, `motion-midi`) take more work first.

## Look

Brawler type, paper buttons and orange (the kit's `.ui-btn` from `packages/ui`, themed with `--ui-*` tokens on `main`; `public/ui.js` is that kit bundled by `bun run ui`, rerun it when the kit changes), and eqosys's day-and-night sky behind it. The sky is baked into `public/index.html` between the `sky` markers; after changing `apps/eqosys/src/app/Sky.tsx`, run `bun run sky` to refresh it. Double-clicking the sun or the moon swaps day and night, as on eqosys; that script (`Theme.tsx`) is baked in by the same command.

## Checking screen sizes

`bun run dev`, then `bun run sizes <page url>` (open http://localhost:8800) shows the page at once in real-size frames: iPhone SE, 15 and Pro Max, iPhone Duo (outer and open, both ways), Surface Duo (one screen 540x720 and spanned 1114x720), iPad and laptop. Look at it after any layout change; the list is `SIZES` in `scripts/sizes.ts`.
