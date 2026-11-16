# From a web app to an iPhone: the happy paths

The spike in [#4687](https://github.com/QuinnsCode/RustyBuns/issues/4687): how a RustyBuns web app gets onto an iPhone
without a rewrite. The store plan (a native SwiftUI client per app) is in [STORES.md](STORES.md); this page is the
cheaper roads that come before it.

## Path 1: Add to Home Screen (done for Hippo Tycoon)

The deployed page, plus three things the phone looks for:

- **A web manifest**: the name under the icon, "open full screen", the colours of the splash.
- **Home-screen icons**: PNGs at 180 px (iOS), 192 px and 512 px.
- **A service worker**: keeps a copy of every built file, so the game opens and plays with no signal.

`@rustybuns/cli/installable` is a vite plugin that adds all three to a browser build. The app gives a name, a
background colour and an icon, drawn in code one pixel at a time (no image file in the repo):

```ts
import { installable } from "@rustybuns/cli/installable";
plugins: [installable({ name: "Hippo Tycoon", background: "#08100d", icon: (u, v) => [r, g, b] })]
```

How the worker behaves:

- **A page load asks the network first.** A new deploy shows up on the next visit, as before.
- **With no network, the kept copy answers.** Solo and couch Hippo Tycoon run fully in the page (the Rust sim as
  wasm), so they play in airplane mode.
- **Anything not in the build goes to the network.** The `/ws` socket for online rooms is never cached.
- **A new build makes a new cache.** Its name is a hash of every file, and the old one is deleted when the new
  worker takes over.

Put it only in the browser build's vite config. A desktop build serves its page from the binary and needs none of it.

No Mac, no App Store review, no developer account. The phone check is
[#4716](https://github.com/QuinnsCode/RustyBuns/issues/4716) (MANUAL RUN).

## Path 2: the built page inside a small Swift app

[`native/ios`](../native/ios/README.md) is already a SwiftUI app that shows a deployed URL full screen in a
`WKWebView`. Next is to put the built page inside the app, so it opens with no network and has more than a
website to show App Review (guideline 4.2):

- Copy `dist/client` into the app bundle and serve it through a `WKURLSchemeHandler` (`app://hippo/`), so the
  page's own requests (`/hippo_sim.wasm`, fonts, sounds) come from the bundle with the right content types.
- The online rooms still go to the edge over `wss://`.

That, and the speed check (frame time and sim step in the shell vs Safari vs desktop Chrome), is
[#4717](https://github.com/QuinnsCode/RustyBuns/issues/4717). Its result decides `rustybuns build ios`: go, or path 1 is enough.

**An app whose backend must run on the phone** (D1, KV, `/api` routes, not just a socket to the edge) needs one
adapter more: the Workers `fetch()` code in a Web Worker behind a fetch shim, D1 on SQLite built to wasm, KV on
IndexedDB. Hippo Tycoon doesn't need it (solo has no backend). That is
[#4718](https://github.com/QuinnsCode/RustyBuns/issues/4718), for qCRM or another D1 app.

## Path 3: native SwiftUI

A full rewrite of every screen. Only for an app that must feel fully native; [STORES.md](STORES.md) has that plan.

## What we know

- **Speed.** `WKWebView` has the same engine as Safari: the JIT, WebAssembly, WebGL2, and WebGPU on recent iOS.
- **Don't run a backend in a bare JavaScriptCore context.** Apple turns its JIT off for apps, and it has no
  WebAssembly. Park Hide & Seek's offline `room.js` gets away with it because the room is small and turn-based.
- **Rust over `bun:ffi` does not load on iOS.** The same crate builds to wasm instead.
- **WebKit gaps to check per app:** `SharedArrayBuffer` needs cross-origin isolation headers, there is no Web MIDI,
  and WebGPU depends on the iOS version. `scripts/phone-smoke.ts` already checks each app's layout at phone sizes.
- **App Review 4.2** is the main risk for path 2. Bundled offline files help; native touches (eqosys sign-in
  through RustyBunsKit, haptics, the share sheet) help more.
