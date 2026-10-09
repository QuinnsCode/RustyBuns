# Demoing Rusty Buns

A presenter's run-through: what to show, in what order, and what to rehearse. How to play each app is in [EXAMPLES.md](EXAMPLES.md).

## Before the demo

```sh
bun install                                   # repo root; re-run after pulling
rustup target add wasm32-unknown-unknown      # only for fm-daw's Rust engine
```

- **Bun 1.4+** is required. **Rust** is required for tscircuit-desktop and optional everywhere else: without it, the apps take their TypeScript path with the same output.
- Every app starts the same way: `cd apps/<app> && bun run desktop:dev`. `bun run desktop:build` makes the one-file binary in `dist/`.
- A built binary is unsigned. On macOS, right-click → Open the first time, or `xattr -d com.apple.quarantine <file>`.

## The run-through (about 15 minutes)

Each step makes one point. Stop whenever the room has it.

1. **splat-spray: "It's just a web app."** No downloads, no backend, ten lines of config, and it's a desktop app. Hold the mouse to scan, Shift-click to pick.
2. **hippo-tycoon: "One codebase, every way to play."** Play Solo for a few seconds. Then build the binary (`bun run desktop:build`), launch it twice, **Host a LAN game** in one and **Join a LAN game** in the other with the address and code it shows. The same game class runs online rooms on Cloudflare. To show that locally: `bun run build && bunx wrangler dev --local`, then **Online room** in two tabs.
3. **fm-daw: "Rust where it pays, TypeScript as the fallback."** **Turn the speakers down first.** Press Space for the demo song, then flip the engine selector while it plays. You can't hear the switch, because the two engines are bit-identical. Build the Rust engine first with `bun run build:native`.
4. **auto-rig: "Rust and TypeScript, same answer."** Drag a hand on the gingerbread man, then **Race the engines**. Try **Fox** (downloads on click). Build Rust first with `bun run build:native`.
5. **tscircuit-desktop: "A big real app, one file."** Run `bun native/build.ts` first; the build stops without it. Open `fixtures/`, then **Compare engines**.
6. **splat-desktop: "Your files stay on your disk."** Make a scene first with `bun scripts/make-test-splat.ts ~/Splats/ring.ply`. The first run fetches and builds SuperSplat (a minute or two), and it needs WebGPU, so use Chrome or Edge.
7. **park-hide-seek: "Each player only gets what they can see."** **Play vs AI**, pick **Night**. For LAN, use two laptops, or two copies on one machine with `RB_LISTEN=127.0.0.1:4411` and `:4412`. Or just open the [live version](https://park-hide-seek.notryanquinn.workers.dev).
8. **agent-office: "Someone else's server, one file."** `bun run office`. Needs someone signed in to Claude Code.

**Rehearse these on the demo machine:** splat-rooms framerates (its scenes need a Hugging Face token: `HF_TOKEN=... bun scripts/fetch-scenes.ts --next 3`), the LAN join between two real laptops, and fm-daw's volume.

## For a developer audience

- **apps/example** builds a whole Worker (D1, KV, a Durable Object) into a binary in about half a second: `cd apps/example && bun run desktop`. `bun native-probe.ts` shows the Rust FFI path and its TypeScript fallback.
- **apps/spa-example** is a fixture, not an app: `bun test packages/cli/test/glue.test.ts` shows `init` reading a real RWSDK app.
- **motion-midi**: `bun run bench 1 4 8` benchmarks Rust against TypeScript in the terminal.
- Runtime detail, including LAN multiplayer, is in [REFERENCE.md](REFERENCE.md#multiplayer-on-a-lan).

## When something goes wrong

- **"Rust engine missing":** expected without cargo. The app uses TypeScript, with identical output.
- **fm-daw `Could not resolve "./.rustybuns/vite"` in the browser:** run `bun run desktop:dev` once first; it writes that file.
- **tscircuit `native crate(s) not built: tsci_analysis`:** run `bun native/build.ts`.
- **Can't find the window:** the host picks a random port on `127.0.0.1` with a token in the URL. `RB_NO_BROWSER=1` prints the URL instead of opening it, and `RB_LISTEN=host:port` pins the port.
- **Reset an app:** delete `~/.<app-name>/`.
- **Deploys** (`plan`, `deploy`, `build box`) aren't needed for any local demo. See [GETTING_STARTED.md](GETTING_STARTED.md).
