# 🥐 Rusty Buns

**Write a web app once. Ship it as a desktop binary, a Cloudflare Worker and a Linux server.**

No rewrite. No second codebase. No new language.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>: one file, double-click it
pnpm exec rustybuns deploy              # Cloudflare, plus a Hetzner or Railway box
```

That's the whole product. Rusty Buns is a dev dependency: it never edits `src/` and never ships in your bundle.

> **Alpha, `0.1.8`.** Desktop works on macOS and Linux. The Cloudflare deploy is verified end to end. The Railway and Hetzner boxes are verified live.

## The idea in one paragraph

Every app is five things: **http, comms, storage, memory, identity**. Cloudflare already gave them good, small shapes: a `fetch` handler, Durable Objects, D1, KV, R2. Rusty Buns gives every one of those a local twin (sqlite and the filesystem) and runs your `fetch` handler under Bun. Once your app runs on a laptop that way, it runs on any Linux box too, and the cloud deploy is generated from the same binding list. Three targets, one config, nothing to drift.

```
                  rustybuns.config.ts
       ┌───────────────────┼────────────────────┐
    desktop              edge                  box
  Bun + sqlite      Worker + D1/KV/R2/DO    Bun + sqlite on a volume
  one binary        your vite build         Railway or Hetzner
```

## The questions everyone asks

### Why not Electron?

Electron makes you write two programs (a Node main process and a renderer) that talk over IPC, and it ships a whole Chromium with every app. Your backend is Node glued to a window, so it can't go to the edge, and moving it to a server is a rewrite.

Rusty Buns has no main process. Your backend is a plain `fetch` handler, the same one Cloudflare runs. On a laptop it serves your page to the Chrome you already have. On a server it serves it to everyone.

### Why not Tauri?

Tauri is lighter, but your backend becomes Rust commands, and your UI runs in whatever webview the OS has: WebKit on macOS and Linux, WebView2 on Windows, each with its own gaps (WebGPU, codecs, audio). So you now test three browsers and maintain a Rust backend that also can't go to the edge.

Rusty Buns keeps the backend in TypeScript and renders in real Chrome, so `SharedArrayBuffer`, WebGPU, AudioWorklets and Web MIDI just work. Rust is still there, as an opt-in for the hot path, never a requirement.

### Why Bun?

Because Bun is the one runtime that has every piece built in:

| Bun gives us | So you get |
|---|---|
| `bun build --compile` | one self-contained file per OS, cross-compiled from one machine |
| `bun:sqlite` | D1, KV and Durable Object storage on a laptop, with no database to install |
| `Bun.serve` with WebSockets | Durable Objects with hibernating sockets, in-process |
| `bun:ffi` | Rust cdylibs called directly, nanosecond calls, with a TypeScript fallback |
| `Bun.spawn` with a terminal | real PTYs without node-gyp (see [agent-office](apps/agent-office/README.md)) |
| TypeScript with no build step, `bun test`, `bun check` | a typecheck in ~60ms and a full desktop build in under a second |

Your users never install Bun. It's inside the binary.

### Why Rust, then?

Only when TypeScript isn't fast enough. Every Rust engine in this repo ships with a TypeScript twin that gives the same answer, and the app falls back to it if Rust can't load. Several examples race the two side by side so you can see what Rust buys you before you commit to it.

### What's the catch?

Honestly:

- **No native menus, tray, installers, signing or auto-update yet.** If you need a native-feeling window today, use Electron or Tauri.
- **The binary is about 60 to 110 MB**, depending on the app, because Bun is inside it. It's one file with no install step, but it isn't small.
- **It renders in the user's Chrome** (or default browser), not a bundled one.

If what you have is a web app with a backend, and you want it on a laptop, on the edge *and* on a server, nothing else does all three from one codebase.

## Why this is built for the agentic era

Coding agents are now writing most of the code. Rusty Buns is shaped for how they work best:

- **One language, top to bottom.** TypeScript in the page, the backend, the config and the deploy. No IPC bridge, no Rust command layer, no YAML. Agents are best at TypeScript, so they stay in it.
- **One file to reason about.** `rustybuns.config.ts` is the only file you own. The host, the wrangler config and the infrastructure are all generated from it, so an agent changes one line and the rest follows.
- **The whole stack runs locally.** sqlite stands in for every cloud binding, so an agent can boot, test and break the real app with no cloud account and no bill.
- **The app is a web page, so an agent can see it.** It renders in Chrome, which agents already drive: click, screenshot, read the console. No custom harness for a native window.
- **The loop is fast.** `bun check` typechecks in milliseconds and a desktop build takes about a second. Agents iterate dozens of times; each loop should be cheap.
- **Guard rails before anything costs money.** `plan` typechecks the generated stack and shows the diff. `deploy` refuses to run without a plan for that exact config, then asks. The compiler catches an agent's mistake before a server exists.
- **Agents get keys you can take back (experimental).** Set `experimental.wheel` to `"agent"` and a test stack mints its own secrets on create and drops them on destroy, so CI and agents can spin stacks up as often as they like with nothing to rotate. Set it to `"human"` and prod secrets come from 1Password behind your Touch ID. Either way a committed `.env.schema` lists every secret by name, never value, so any machine or agent knows what's needed. See [REFERENCE.md](REFERENCE.md#who-holds-the-keys-experimental).
- **Rust without risk.** An agent can write the Rust engine and prove it matches the TypeScript one, sample by sample, and the TypeScript path keeps working if it doesn't.
- **Leaving is a `git rm`.** Everything you adopt is a shape Cloudflare already standardized. No lock-in for you or your agent to untangle later.

It's not theory. Nearly every commit in this repo is co-authored by Claude Code, some of them written at desks in [Agent Office](apps/agent-office/README.md), which is itself one of the examples below.

## See it work

Every example is one codebase that runs as a desktop binary. The multiplayer ones run on Cloudflare from the same code.

| Example | What it proves |
|---|---|
| [hippo-tycoon](apps/hippo-tycoon/README.md) | One game class runs as a Durable Object on Cloudflare and in-process in the binary: solo, couch, LAN party and online rooms |
| [park-hide-seek](apps/park-hide-seek/README.md) | 3D hide and seek on real Yosemite terrain, played by the page, by a LAN host or by the edge; each player is sent only what they can see. [Play it](https://park-hide-seek.notryanquinn.workers.dev) |
| [agent-office](apps/agent-office/README.md) | Someone else's Node server (PTYs, WebSockets, a 3D client) as one binary, nothing forked |
| [tscircuit-desktop](apps/tscircuit-desktop/README.md) | A heavy, real-world Vite app as one file, with a Rust engine up to 22x faster and a TypeScript fallback |
| [fm-daw](apps/fm-daw/README.md) | One Rust crate as wasm in the audio thread and over FFI on the host, bit-identical to the TypeScript engine |
| [auto-rig](apps/auto-rig/README.md) | Auto-rigging a 3D model in Rust and TypeScript with identical output |
| [motion-midi](apps/motion-midi/README.md) | One synth in Rust and in TypeScript, checked sample by sample |
| [splat-desktop](apps/splat-desktop/README.md) | PlayCanvas' SuperSplat editor as a desktop app working on a folder on your disk |
| [splat-rooms](apps/splat-rooms/README.md) | A splat hunting game with a world class and 30 MB scenes streamed from a folder on your disk, never embedded |
| [splat-spray](apps/splat-spray/README.md) | The smallest one: a three.js game with no backend at all, made a desktop app by a ten-line config |
| [example](apps/example/README.md) | A whole Worker (D1, KV, a Durable Object) as a desktop binary in half a second, plus a Rust FFI probe with a TypeScript fallback |
| [spa-example](apps/spa-example/README.md) | Not an app: a slice of a real RWSDK game that the tests use to check `init` reads it right |

**Try one without building anything:** download the desktop binary for [Hippo Tycoon](https://github.com/QuinnsCode/RustyBuns/releases?q=hippo-tycoon-v&expanded=true), [Park Hide & Seek](https://github.com/QuinnsCode/RustyBuns/releases?q=park-hide-seek-v&expanded=true), [Splat Spray](https://github.com/QuinnsCode/RustyBuns/releases?q=splat-spray-v&expanded=true) or [FM Groovebox](https://github.com/QuinnsCode/RustyBuns/releases?q=fm-daw-v&expanded=true). Each is one file for Mac, Windows or Linux. They aren't signed yet, so the first launch takes one Terminal command on a Mac (the release page has it) and a click past SmartScreen on Windows.

Want to run them from source? [EXAMPLES.md](EXAMPLES.md) is two lines per app, no experience needed.

## Get started

You need Bun 1.4+ and an app that builds with `vite build`.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                          # prints what it found; writes one config
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in Chrome, running on a local Bun host with sqlite behind every binding. To go to the cloud:

```sh
pnpm exec rustybuns add deploy     # pinned Alchemy + Effect
pnpm exec rustybuns plan           # creates nothing, shows what would be created
pnpm exec rustybuns deploy         # refuses without a matching plan, then asks
pnpm exec rustybuns destroy        # removes everything it created
```

## Read more

- [GETTING_STARTED.md](GETTING_STARTED.md): the full walkthrough, step by step
- [REFERENCE.md](REFERENCE.md): every command, config key, the host, the Hetzner and Railway boxes, LAN multiplayer, who holds the keys to secrets
- [ADOPTION.md](ADOPTION.md): who it's for, and how to adopt it (and leave)
- [COSTS.md](COSTS.md): what each deploy can bill you for, and how to cap it
- [FRAMEWORKS.md](FRAMEWORKS.md): beyond Vite + React
- [notes/ROADMAP.md](notes/ROADMAP.md): next up are TLS on the box, Fly, installers and signing

## License

Apache-2.0. See [LICENSING.md](LICENSING.md).
