# Demoing the Rusty Buns apps locally

Everything below runs from a clone of the repo. All eight apps live in `apps/`.

## One-time setup

```sh
bun install                      # repo root; re-run after pulling
rustup target add wasm32-unknown-unknown   # only for fm-daw's Rust engine
```

- **Bun 1.4+** is required. **Rust (cargo)** is required for tscircuit-desktop. For the other apps it is optional: they fall back to TypeScript without it.
- `RB_NO_BROWSER=1` prints the desktop URL instead of opening a browser.
- First launch of a built binary on macOS: it is unsigned, so right-click → Open, or `xattr -d com.apple.quarantine <file>`.

## The standard launch

Most apps use the same two steps (`desktop:dev` is just these chained):

```sh
cd apps/<app>
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
```

Ship a single binary instead: `bunx rustybuns build desktop` → `dist/<app>-<os>-<arch>`.

## Cheat sheet

| App | What it is | Best for demoing | Launch (from `apps/<app>`) |
|---|---|---|---|
| **tscircuit-desktop** | tscircuit (React for electronics) as a desktop app: board preview, checks, Gerber/BOM export | "A heavy real-world Vite app as one binary" | `bun native/build.ts` (required), then `bun run desktop:dev` |
| **fm-daw** | FM groovebox: 5 drums, 3 synths, step grid, piano roll, MIDI/keyboard recording | Rust vs TypeScript engine, switchable mid-groove; project saved to sqlite | `bun run build:native` (optional), then `bun run desktop:dev` |
| **motion-midi** | A synth written in Rust and TS; renders a song and plays it | Rust-vs-TS speed ("Compare engines") | `bun run build:native` (optional), then standard launch |
| **splat-desktop** | SuperSplat 3D Gaussian-splat editor with a folder-based scene library | Big files served from disk, "your files stay local" | `bun run desktop:dev` |
| **splat-rooms** | Splat hunting game plus an InteriorGS room/object browser | A game that runs on the same stack | `bun scripts/fetch-scenes.ts` (needs `HF_TOKEN`), then standard launch |
| **splat-spray** | "I spy" game in a dark generated splat room (Three.js + Spark) | Zero-asset game; the easiest visual demo | `bun run dev` (browser) or `bun run desktop:dev` |
| **spa-example** | RWSDK app on the desktop: world Durable Object, D1 and KV on sqlite | Cloudflare bindings running on a laptop; LAN multiplayer host | See notes below |
| **example** | Worker-mode test app plus a probe of the sample Rust crate | Worker bundle under Bun | `bun run desktop` |

## Per-app notes

### tscircuit-desktop
```sh
cd apps/tscircuit-desktop
bun native/build.ts          # required: the build stops without it
bun run desktop:dev
```
Open a folder of boards (sample boards are in `fixtures/`). Click **Compare engines** to watch Rust native, Rust wasm and TypeScript run on the same board. This app needs cargo to build. If you skip `bun native/build.ts`, the build fails with `native crate(s) not built: tsci_analysis`.

### fm-daw
```sh
cd apps/fm-daw
bun run build:native         # optional, needs rustup
bun run desktop:dev
```
**Turn your speakers down first.** Record from the computer keyboard or a MIDI keyboard, quantize, and flip the engine selector while the groove plays. The browser-only `bun run dev` needs `.rustybuns/vite.ts`, which only `rustybuns build desktop` writes. Run the desktop build once first, or you will get `Could not resolve "./.rustybuns/vite"`. Saving is disabled in the browser.

### motion-midi
```sh
cd apps/motion-midi
bun run build:native
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
bun run bench 1 4 8          # optional: CLI benchmark, Rust 1.6x to 5x faster
```
Hit **Render and play**, then open **Compare engines**.

### splat-desktop
```sh
cd apps/splat-desktop
bun scripts/make-test-splat.ts ~/Splats/ring.ply    # makes a small test scene
bun run desktop:dev          # first run fetches and builds SuperSplat (a minute or two)
```
Open the folder you put scenes in. Needs WebGPU: use Chrome or Edge (it opens as an app window), or recent Safari.

### splat-rooms
```sh
cd apps/splat-rooms
bun scripts/fetch-scenes.ts --list     # what you have
bun scripts/fetch-scenes.ts --next 3   # download scenes
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
```
Scenes come from the gated [InteriorGS](https://huggingface.co/datasets/spatialverse/InteriorGS) dataset. Accept its terms, then set `HF_TOKEN` (or `~/.cache/huggingface/token`). They land in `~/Documents/SplatRooms/` (override with `SPLAT_ROOMS_DIR`). A labels-only folder still opens in the room browser. Menu: **Quick hunt**, **Choose a room**, **Room browser**. In a hunt, drag to look, **Space** fires, **Shift-Space** sprays, **P** then click to pick, **Esc** pauses. Real-GPU framerates are the least-verified part, so rehearse on the demo machine.

### splat-spray
```sh
cd apps/splat-spray
bun run dev                  # browser, hot reload
bun run desktop:dev          # desktop
bun test
```
Hold the left button to scan, right-drag to look, **Shift-click** to pick, **Space** for the next round. The easiest demo: it needs no downloads.

### spa-example
There is no `rustybuns.config.ts` or `desktop` script in this folder, so it is the least turnkey app. Before the demo, try `bunx rustybuns init` followed by the standard launch, and rehearse it. This is also the app to show LAN multiplayer with:

- Set `desktop: { mode: "spa", guests: { max: 8 } }` in the config.
- The host UI calls `POST /__rb/host` with `{ listen: { hostname: "0.0.0.0" }, join: "<passphrase>" }`.
- Guests connect via `worldSocket("http://<host-ip>:<port>/ws", { join, uid, name, v })`. The build version must match the host's, or the guest gets `409 version_mismatch`.

See "Multiplayer on a LAN" in the root `README.md`.

### example
```sh
cd apps/example
bun run desktop
```
The framework's worker-mode test app (D1, KV and a Durable Object under Bun). The Rust probe is `native-probe.ts`, which loads `native/crates/rb_hello`.

## Suggested demo order (about 10 minutes)

1. **splat-spray**: instant, visual, zero setup.
2. **fm-daw**: audio, and the Rust/TS switch mid-groove.
3. **tscircuit-desktop**: a big real app shipped as one file, with **Compare engines**.
4. **splat-desktop** or **splat-rooms**: 3D scenes read from local disk.
5. **spa-example**: Cloudflare bindings and LAN multiplayer, if there is time.

## Troubleshooting

- **Rust engine missing**: expected without cargo. The app switches to TypeScript with identical output.
- **Port or URL**: the host picks a random port on `127.0.0.1`, with a per-launch token in the URL. Use `--listen host:port` or `RB_LISTEN` to pin it.
- **Data**: each app stores its data in `~/.<app-name>/`. Delete that folder to reset.
- **Cloud and box deploys** (`plan`, `deploy`, `build box`) are not needed for local demos. See `GETTING_STARTED.md`.
