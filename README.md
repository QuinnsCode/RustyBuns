# 🥐 Rusty Buns

**Your web app, shipped as a native binary, with a server you can move anywhere.**

> Status: alpha, slice 2. Desktop path verified on Linux; Alchemy generation not yet run against a live account. Details in [STATUS.md](STATUS.md).

Write TypeScript. Opt into Rust when something is slow. Reuse the React you already have. Put the server wherever you want it.

*(Or Patina Dog, if the bakery lawyers show up. 🐕)*

---

## 🧭 The idea in one breath

Bun beside the browser. Rust behind either one when you opt in. React reused as is. A server that runs next to you, in a container, or on the edge, and the client can't tell the difference.

---

## 🦀 Why not Tauri

I wanted it to work. Small binary, fast, everyone recommends it. Three things stopped me.

**You have to write Rust.** The backend is Rust, period. My web team can't touch it, and every small change is a Rust compile. I wanted Rust where it matters and TypeScript everywhere else. Tauri makes it the other way around.

**The webview is whatever the OS has.** WebKitGTK on Linux, WebView2 on Windows, Safari's WebKit on Mac. For a form app that's fine. For WebGPU, SharedArrayBuffer, gamepad, or audio, it's a lottery. The user's own Chrome is newer than anything Tauri hands me.

**The backend can't leave the desktop.** A Tauri core is tied to the window. When I needed the same logic in a container or on the edge, there was no path. You write it twice.

> 🤝 Tauri still wins on bundle size, sandboxing, native menus, and mobile. If you need those, use it.

---

## ⚡ Why not Electron

Electron is the safe pick. I still didn't use it.

**You ship a browser.** 150 to 250 MB of Chromium, a second engine in memory, and a full Chromium download on every update. The user already has a browser, and it's probably newer.

**The backend is Node, stuck in the window.** Same problem as Tauri. It can't be lifted out and run somewhere else. And Node's WebSocket stack is slower than Bun's at the one thing my server does all day.

**Rust is a tax.** napi-rs, electron-rebuild, ABI matching per Electron version, breaks on every upgrade. `bun:ffi` is open a library and call it.

**Two protocols.** One for IPC in the window, another for the network. I wanted one WebSocket that works whether the server is next to you or across an ocean.

> 🤝 Electron still wins on deterministic rendering, native window features, installers, and fifteen years of answered bugs. If your app is mostly a window, use it.

---

## 💭 What I actually wanted

I just want to write TypeScript.

And when something is slow, I want to write fast code for that one part and not change anything else.

That's it. That's the whole requirement. Here's how the pieces line up to give me that.

### 🍞 Bun
It's the runtime, but it's also everything around the runtime that used to be twelve packages. SQLite, SQL, WebSockets, static serving, image processing, cron, a test runner, a bundler, and compile to a single binary. And it's written in Rust now with a native FFI, so calling into a Rust library is cheap. So why shouldn't I?

### 🌐 The browser
I already have an offline internet browser on every machine I'd ship to. If I open a tab pointed at my local Bun server, every React component I already wrote just works. No rewrite, no webview, no wrapper.

### 🧵 Web workers
If I have the browser, I have workers. That's where compute goes to get off the main thread. Rust compiled to WASM runs there too.

### 🦀 Rust, when I choose
In the browser as WASM in a worker. On the server as a native library behind `bun:ffi`. Same crate, two targets, and only for the functions that need it.

### 🚀 Eject anything
The server is a plain Bun process. Run it next to the browser for single player. Put it in a container for multiplayer. Put it on the edge for persistence. The client doesn't know the difference because it always talks WebSocket.

So why not unite all of it?

*🎙️ rusty buns, whispered, tapping gently on the microphone*

---

## 🗺️ Where the server lives

| Target | What it's for | Storage |
|---|---|---|
| 💻 Beside the browser | Single player, offline, desktop binary | `bun:sqlite` |
| 📦 In a container | Multiplayer, beefy box, Hetzner/Fly/anything | Postgres via `Bun.SQL` |
| 🌍 On the edge | Global persistence | Cloudflare Durable Object + D1 |

Same engine. Same ports. Same WebSocket. The deploy target is a config choice, not an architecture decision.

---

## 🔗 How the pieces talk

Three buses, picked by where the two sides live.

| Between | Bus | Notes |
|---|---|---|
| 🧵 Threads in one process | `SharedArrayBuffer` + `Atomics` | Works in the browser tab (workers + WASM) and in Bun (workers + Rust via `bun:ffi` pointers). Zero copy. |
| 🌐 Browser and server | WebSocket | The browser's only door. Binary frames, same protocol whether the server is local or remote. |
| 📦 Server and server | TCP, UDP, Unix socket | Bun to Bun, Bun to a Rust sidecar, box to box. No browser in the way, so no WebSocket needed. |

The engine doesn't care which one carried the bytes. A socket is anything with `send` and `close`, so a browser over WebSocket and a headless bot over TCP sit in the same list.

---

## 🎁 What you can buy

Three SKUs. Each is a fixed-scope deliverable with a named artifact at the end.

### 🖥️ SKU 1: Desktop Binary

**For:** anyone with a React/Vite app who wants a downloadable product without Electron.

**Deliverables:**
- Signed, notarized installers for macOS (arm64/x64), Windows, Linux. One `bun build --compile` matrix, frontend embedded via `--asset`
- Launcher: opens in the user's Chrome in `--app` mode with your icon; server lifecycle bound to the launcher (`--no-orphans`); single-instance lock; per-launch auth token
- Local persistence on `bun:sqlite`; offline by default
- Auto-update channel (manifest + signed delta downloads)
- CI pipeline that produces all three platforms on tag

**What you get:** a `.dmg`, `.msi`, `.AppImage`, and a release pipeline you own.

### 🔌 SKU 2: Portable Backend

**For:** teams who want single-player and multiplayer, or laptop and cloud, to be the same code.

**Deliverables:**
- Your domain logic refactored behind the ports contract (`Ctx` / `Socket` / `Storage` / `Reporter`). Platform-free core
- Three shells, all passing the same test suite: local (SKU 1), Docker, Cloudflare Durable Object
- `Bun.SQL` adapters: SQLite local, Postgres in the box, D1 on the edge. One query layer
- Graceful drain on deploy, memory-pressure eviction, Redis pub/sub when you need more than one box
- Binary WebSocket protocol with backpressure handling; load test report at N clients × tick rate

**What you get:** `docker compose up` and a `wrangler deploy` of the same engine that ships in the desktop build.

### 🏎️ SKU 3: Native Acceleration

**For:** the app that has a hot path TS can't hold. Inference, media, data, physics.

**Deliverables:**
- Profile first: a `--cpu-prof-md` report identifying the actual hot functions (you get the report either way)
- Rust crate behind `bun:ffi` for the server-side hot path, or a `wasm-bindgen` worker for the client-side one, with capability negotiation so the app degrades cleanly where the native path is absent
- Drop-in reference modules: local LLM / whisper inference, image pipeline (`Bun.Image` first, Rust when it isn't enough), columnar data via Polars / DuckDB, vector search
- Cross-platform cdylib build matrix + a memory-ownership contract, documented

**What you get:** the same app, 10 to 50× faster on the one thing that was slow, and a doc explaining who owns every pointer.

---

## 🙅 What this is not

No console targets. No pixel-identical rendering across browsers. No native menus, tray, or dialogs. No mobile. That's the trade, and it's why it costs a fraction of a native rebuild.

---

## 🧁 The three sentences

1. You keep your web app and your web team. Nothing is rewritten.
2. One codebase becomes a desktop binary, a Docker container, and an edge deployment. Same server, three targets.
3. When something's slow, we drop that one function into Rust. Nothing else changes.

---

## 🛠️ Run it

```
bun install && bun test
cd apps/example
bun ../../packages/cli/src/index.ts init
bun ../../packages/cli/src/index.ts build desktop
./dist/druids-curse
```

Licensed Apache-2.0. See [LICENSING.md](LICENSING.md) for the stack rule.

---

<p align="center"><sub>🥐 made with Bun, seasoned with Rust, served in your browser</sub></p>
