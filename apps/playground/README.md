# Playground

One static page that lists every app with a way to try it: **Play** where there is a live browser build, **Download** where there is a desktop release, **Source** always. The list is `public/apps.json`; add a line when an app goes live.

```bash
bun run dev       # the page on localhost
bun run deploy    # your Cloudflare account, static assets only
```

It is assets only, no Worker code, so it bills nothing past the free static tier.

## Putting an app on it

A browser app with no host needs a `wrangler.jsonc` with `"assets": { "directory": "<its dist>" }` and a `deploy` script (`splat-spray` and `hello-world` are the smallest). Deploy it, then add its `play` URL to `apps.json`. Apps that need their desktop host (`tscircuit-desktop`, `meshy-studio`) or a generated `.rustybuns/` (`fm-daw`, `hippo-tycoon`, `auto-rig`, `splat-rooms`, `motion-midi`) take more work first.

## Look

Brawler type, codeSplitter's paper buttons and orange, and eqosys's day-and-night sky behind it. The sky is baked into `public/index.html` between the `sky` markers; after changing `apps/eqosys/src/app/Sky.tsx`, run `bun run sky` to refresh it.
