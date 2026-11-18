# Exact vs Rusty Buns: what it is, where we differ, what to take

Read 2026-11-17 from [expo/exact](https://github.com/expo/exact)'s README (created 2026-11-02, about 4,600 stars,
MIT, mostly Rust, pre-1.0 with no release). Re-read it before acting on this; it says it changes daily.

**Short answer: not a rival, a neighbour.** Exact is a UI framework: one app, drawn natively on each OS. Rusty Buns
is a meta-framework under the frameworks you already use: one backend, moved between the desktop, the edge and a
server. They meet in one place, the way an agent runs and checks an app, and there Exact has two ideas worth taking.

## What Exact is

- You write the view in **Contract**, a small language of its own: views, state, actions, with CSS's layout and
  property names. It does no I/O. Data comes from **TypeScript or Rust** behind one typed seam, or from an HTTP
  read declared in Contract. Every answer is checked against the shape Contract declared.
- The compiler turns Contract into a *plan* (tables and bytecode). On the web that is one ES module over a runtime of
  about 20 KB that writes DOM and CSS. On macOS and iOS a Rust runner (Taffy for layout) drives AppKit and UIKit with
  the system's own controls. Linux, Android and Windows are painted by Exact itself (vello or tiny-skia).
- No webview and no JS bridge in the UI. TypeScript runs on Hermes on native hosts, after the first frame.
- Agents are a first-class user: one driver (`scripts/agent.mjs`) with ten operations (`tree`, `screenshot`, `tap`,
  `type`, `state`, `layout`, `logs`, `clock`, `prefer`, `perf`) works on every host, and an `app.test.contract`
  written in those operations runs unchanged on each.

## Side by side

| | Exact | Rusty Buns |
|---|---|---|
| What it is | A UI framework and language | A meta-framework over Vite, React, Solid, Elysia, RWSDK and others |
| You write | Contract for the view, TS or Rust for data | Your framework's TypeScript; Rust only for a hot path, always with a TS twin |
| Lock-in | High: a new language, no React components, no RN or Flutter plugins | Low: no Rusty Buns code in `src/`, removed with `git rm` |
| Web | Its own 20 KB runtime on DOM and CSS | Whatever your framework ships |
| Desktop | Native AppKit window; Linux painted | One file per OS, a Bun host, the UI in the user's Chrome (no own window yet) |
| Mobile | iOS native (UIKit), Android early | Not a target; a SwiftUI thin client of the same backend |
| Backend | Not its job: data sources answer the view, with grants for net, files, SQLite, secrets | Its whole job: five primitives (http, comms, storage, memory, identity), Cloudflare shapes with Bun and sqlite twins, one config to Worker, Railway or Hetzner |
| Games, GPU, audio | A game add-on and a wgpu module | Real Chrome, so WebGPU, AudioWorklets, Web MIDI, `SharedArrayBuffer`; Rust through `bun:ffi` or wasm |
| Agent loop | One driver on every host, a clock the agent controls, test scripts that run everywhere | `bun run probe` (headless Chrome, a game's `state()` as JSON), `local()` journeys, Agent Office, builder Mac |
| Maturity | Pre-1.0, no package, from a checkout | Alpha `0.1.12` on npm, deploys tested live |

## Where each one wins

- **Exact** wins when the app must feel like the platform: a native iPhone app and a native Mac app from one source.
  That is the exact case our README hands off ("Mobile is not a target... SwiftUI or Kotlin").
- **Rusty Buns** wins on everything behind the screen: realtime rooms, storage, identity, deploys, and keeping the
  code you already have. It also wins for our games, which need the whole browser, not a declared subset.
- They could stack: an Exact app's data source is plain TypeScript making HTTP calls, so it could be a thin client of
  a Rusty Buns backend, the way our SwiftUI shell is. Not worth building until someone asks for it.

## What to take

1. **The agent owns the clock.** In a driven Exact app, time moves only when the driver says `clock +60000` or
   `clock settle`. Our probe recipes wait on wall time (`await new Promise(r => setTimeout(r, 4000))` in
   `scripts/probe.ts`'s own help), which is slow and flaky on a busy machine. A `--clock` mode for probe that swaps
   `requestAnimationFrame`, `performance.now` and timers for a stepped clock in games that opt in would make game
   checks repeatable. Some games already freeze rAF at a tick by hand for screenshots.
2. **One test script, many hosts.** Exact's test file is a list of driver operations, run the same on web, Mac and
   iOS. Our `local()` journeys run one target at a time. The same journey against the desktop build, the local Bun
   shell and a preview Worker would test our core claim ("the same app runs in three places") directly.
3. **A refusal that says what to do.** Exact's driver refuses a build older than its sources and names the rebuild;
   `contract build --json` gives diagnostics with stable ids. Our guard hook already does this for commands; our
   CLI errors could do it too.
4. **Friction notes.** `exact feedback note "<what happened>"` records one line per stumble, with the commit and the
   last command's exit code, never its output. Dexter mines transcripts for the same signal after the fact; a
   one-line note at the moment is cheaper.

What not to take: a language of our own for the UI. It is what makes Exact's native hosts possible, and it is
exactly the lock-in Rusty Buns is built to avoid.
