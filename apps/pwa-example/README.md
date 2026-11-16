# Pocket Dice (PWA example)

> **What it proves:** one web page can become an Android app with no Android code. Pocket Dice is a Progressive Web App (PWA): a TypeScript page, a Rust dice roller compiled to WebAssembly, a service worker that keeps it all on the phone, and a manifest that lets Chrome on Android install it. One of the [Rusty Buns](../../README.md) examples.

## Run it

```
cd apps/pwa-example
bun run dev          # the page, hot reloading (no service worker in dev)
bun run preview      # the built app with its service worker, as the phone gets it
bun run deploy       # to Cloudflare (workers.dev gives the HTTPS that installing needs)
```

## Put it on an Android phone

1. Deploy it (`bun run deploy`) and open the `https://pwa-example.<you>.workers.dev` link in Chrome on the phone.
2. Tap **Install app** (on the page, or in Chrome's menu). Chrome builds a WebAPK: a real app in the launcher and the app drawer, opening full screen with no address bar.
3. Turn on airplane mode and open it. It still rolls.

That is an Android app with no Play Store step. Putting it in the Play Store is one more wrapper, a Trusted Web Activity (TWA): [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) reads the live manifest and builds a signed `.aab`, and the site serves `/.well-known/assetlinks.json` with that signing key's fingerprint so Android trusts the app to show the page full screen. That part is not built yet.

## How it fits together

| Piece | File | What it does |
| --- | --- | --- |
| The page | `src/main.ts`, `index.html`, `src/style.css` | Pick dice and sides, tap Roll. Each roll is a seed, so `?seed=7&n=3&d=20` rolls the same dice on any phone (the Share button). The last eight rolls stay on the phone. |
| The roller, in Rust | `wasm/src/lib.rs` → `src/dice.wasm` | mulberry32 with three exports and numbers in and out: 370 bytes, no wasm-bindgen, no glue, loaded with one `WebAssembly.instantiate`. |
| The roller, in TS | `src/roller.ts` | `mulberry32` from `@rustybuns/util`, step for step the same as the Rust. It is the reference the test checks against and the fallback when the wasm won't load. |
| Offline | `src/sw.ts`, `scripts/precache.ts` | A thirty-line Vite plugin lists the build's files and a hash of them into the service worker. Install caches them all; a deploy changes the hash, so the phone takes the new build on its next launch. No PWA plugin dependency. |
| Installable | `public/manifest.webmanifest`, `public/icons/` | Name, colours, standalone display, and the 192 and 512 PNG icons (plus a maskable one) Android asks for. `bun run icons` draws them. |
| Hosting | `wrangler.jsonc`, `public/_headers` | Static Workers assets, no Worker code. `sw.js` and the manifest go out with `no-cache` so an update is never stuck behind a cached copy. |

The same split as Mythic Masters' fight sim: the TS is the source of truth and the fallback, the Rust is a raw wasm module checked in next to it, and CI never compiles Rust.

## Changing the Rust

```
bun run wasm                          # cargo build --target wasm32-unknown-unknown, copy to src/dice.wasm
cd wasm && cargo test                 # the Rust's own tests (its first numbers match @rustybuns/util)
```

Needs `rustup target add wasm32-unknown-unknown` once. With the builder valve shut, build on the builder and write the result here:
`bun run builder run apps/pwa-example bun scripts/wasm.ts --b64`, save the base64 line to a file, then `bun scripts/wasm.ts --from <file>`.

## Tests

`test/app.test.ts` builds the app, serves it, and opens it in headless Chrome at phone size. Chrome's own installability check must find nothing wrong, the service worker must take the page over, and a roll must come from the wasm and match the TS. Then the server stops and a shared link loads from the cache alone. `bun run probe pwa-example --url <preview url>` reads `pocketDice.state()`.
