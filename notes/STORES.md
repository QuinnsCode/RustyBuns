# Steam and the iOS App Store

Decided with the owner on 2026-10-30. The work is split into issues, one per platform lane and one per app
(links at the bottom), so a worker can take one lane and one app at a time.

## The shape

One pure Rust core per app where there is one (state, `step()`, rules: no I/O, no clock, seeded RNG), built three ways:

```
crates/<app>_core      pure Rust
  ├─ wasm             → web page and Cloudflare edge   (hippo_sim, geoboxq, qcrm already do this)
  ├─ cdylib           → desktop over bun:ffi           (packages/native already does this)
  └─ staticlib+UniFFI → iOS .xcframework → Swift        (new)
```

Each platform draws with its own renderer: three.js on the web and on Steam, SwiftUI with RealityKit or SceneKit on iOS.
All of them draw the same state.

## iOS (iPhone and iPad)

- **Native shell, online only.** A SwiftUI app in `apps/<app>/ios/` that talks to the app's edge API. It doesn't wrap
  the website in a WKWebView, which guideline 4.2 ("beyond a repackaged website") rejects most often.
- **Edge first, then onto the phone.** The first build only renders what the edge sends. Moving more of the app into
  the binary later is an ordinary App Store update.
- **What App Review checks:**
  - the backend is up and a demo account works during review (2.1)
  - a real offline screen
  - in-app account deletion when the app makes accounts (5.1.1(v))
  - Sign in with Apple, or an equivalent private-email option, once eqosys offers Google or GitHub (4.8)
  - In-App Purchase for any digital unlock (3.1.1)
  - for typed names that strangers see: a name filter, Report and Block (1.2)
- **Old builds keep working.** The edge speaks a protocol version and keeps a minimum supported version. A client
  older than that floor gets an "Update to keep playing" screen, never a broken game.
- **Order:** Park Hide & Seek, then Hippo Tycoon, then qCRM.

## Steam

- **Bundled Chromium window,** either Electron or Electrobun with its bundled CEF. Tauri's WebKitGTK on Linux
  (Steam Deck) has weak WebGL, and the Steam overlay doesn't hook reliably into system webviews. The Steam API
  goes through steamworks.js.
- **Pilot:** Hippo Tycoon. Its rules and sim are already Rust. Couch play gives Remote Play Together, and every
  asset is generated in code.
- **Calendar:** after the $100 Steam Direct fee there's a 30-day wait before release, the store page must show
  "Coming Soon" for at least 2 weeks, and both the page and the build get reviewed.

Agent Office isn't headed for either store.

## Versions and releases

- **One version per app across every store,** using the tags `desktop-drop.yml` already reads:
  - `<app>-v1.3.0-beta.2` goes to TestFlight, the Steam `beta` branch and the hidden R2 drop
  - `<app>-v1.3.0` goes to App Store review, the Steam default branch and a GitHub Release
- **Cadence:** betas go out any time; stable ships on a monthly train per app, after a manual-run taste check.
- **Where it runs:** store builds run in GitHub CI behind the `drops` environment approval, and the secrets stay
  there. A builder-Mac control plane, where the builder taps in to take a job and taps out to hand it back to
  GitHub, is its own track.

## Issues
- Plan and order: [#2875](https://github.com/QuinnsCode/RustyBuns/issues/2875)
- Lanes:
  - iOS shell, xcframework and TestFlight: [#2876](https://github.com/QuinnsCode/RustyBuns/issues/2876)
  - Steam shell and SteamPipe: [#2877](https://github.com/QuinnsCode/RustyBuns/issues/2877)
  - edge protocol versions: [#2878](https://github.com/QuinnsCode/RustyBuns/issues/2878)
  - eqosys account deletion and Sign in with Apple: [#2879](https://github.com/QuinnsCode/RustyBuns/issues/2879)
  - builder-Mac control plane: [#2880](https://github.com/QuinnsCode/RustyBuns/issues/2880)
- Apps:
  - Park Hide & Seek on iOS: [#2881](https://github.com/QuinnsCode/RustyBuns/issues/2881)
  - Hippo Tycoon on Steam: [#2882](https://github.com/QuinnsCode/RustyBuns/issues/2882)
  - Hippo Tycoon on iOS: [#2883](https://github.com/QuinnsCode/RustyBuns/issues/2883)
  - qCRM on iOS: [#2884](https://github.com/QuinnsCode/RustyBuns/issues/2884)
- Owner's hands:
  - Steamworks sign-up and fee: [#2885](https://github.com/QuinnsCode/RustyBuns/issues/2885)
  - App Store Connect records and upload key: [#2886](https://github.com/QuinnsCode/RustyBuns/issues/2886)
