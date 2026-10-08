# Hippo Tycoon: build plan

A small, original arcade game that ships as a Rusty Buns example: **four angry, greedy tycoon hippos around a pan of oil, each trying to chomp the most oil drops.** The hippos got hooked on the lifestyle oil money bought them, and they are absolutely not cute about it. It exists to show people the whole Rusty Buns story (Cloudflare-first app, same code as a desktop binary, LAN party mode, deploy anywhere) without any of the owner's private game content.

Lives at `apps/hippo-tycoon/` in the RustyBuns repo. Pure TypeScript (Rust is an optional later milestone).

(Concept history: this started as "Drip Derby", cartoon cars eating oil drops. The mechanic, architecture, modes and milestones are unchanged; the cast and the look are new.)

## 0. Hard rules

- **IP, ours.** Do not copy anything from `druids-curse-votv`'s game content: no names, lore, scenes, dialog, art, fonts, shaders, constants, assets. Copy *architecture patterns only* (listed in §4, rewritten small, not pasted wholesale).
- **IP, theirs.** The core mechanic (slide, lunge to eat, drops bouncing in a tray) is fine. The look and the names must be our own:
  - Do **not** use the name "Hungry Hungry Hippos", or Hasbro's board look: no four coloured plastic hippos around a white marble tray, no lever-tail press.
  - Do **not** do a Monopoly-man look: no top hat + monocle + white moustache combination (and no top hats at all, to stay clear).
  - Original character names only (below). Original look: dark oil pan, gaudy derrick offices, tycoon bling.
- **No binary assets.** Hippos, offices, arena and drops are built from three.js primitives in code. Sounds are WebAudio-synthesised (grunts, bellows, chomps). Nothing to license.
- **Small files.** druids-curse's pain was 2000+ line god-files. Keep every file under ~400 lines; split by concern.
- **Sim purity.** `src/sim/**` has no DOM, no `console.*`, no `Date.now`/`Math.random` (seeded RNG only), no imports outside `src/sim`. Same input sequence + seed = same state, bit for bit.

## 1. The game

**Board.** A round oil pan arena seen from above, slightly tilted (iso-ish camera). Four gaudy little "offices" (a derrick, a brass nameplate, a neon dollar sign) at N/E/S/W. Each seat is a tycoon hippo sitting in its office mouth.

**The cast (seats 0..3, south first).** Names are original; personality comes from build, colour and bling, all primitives:
- **Baron Gulpington**: big and round, purple pinstripe suit, a gold crown-shaped hard hat, a chunky gold chain, a pinky ring on every pinky. Bellows like a tuba.
- **Crude Carl**: tall, narrow, mirrored shades, money-green suit and tie, oil-derrick hard hat, a cigar-shaped drop of oil hanging from his lip.
- **Big Barrel Bertha**: widest of the four, oil-barrel-orange jacket, a triple gold chain, gold teeth, huge brows. Deepest grunt.
- **Gusher Gus**: small and wiry, tan, backwards flat cap, gold tooth grill, loud checked jacket. Shrill snort.

Everybody has angry brows. Steam puffs from the ears when sputtering. They snarl (brows drop, teeth show) when someone else eats a gold drop.

**Hippos.** A hippo can:
- **Slide**: shuffle left/right along their lip (short rail, ~60° of arc).
- **Gulp**: a huge jaw-chomp lunge forward into the arena, then haul back. Anything in the jaws at the chomp's peak is eaten. Gulp has a short cooldown (~350 ms) so mashing works but timing matters.
- **Bellow**: an angry roar. Cosmetic, plus it's the "ready" button in the lobby.

**Drops (the marbles).** Spawned from a central "drip" pipe, bouncing around the pan with friction and wall bounces.
- **Good: oil drop** (black, glossy). +1. Most common.
- **Great: premium gold drop** (golden, faster, sparkles). +3. Rare, appears in bursts. The hippos go feral for it.
- **Bad**: eating one hurts:
  - **Sludge** (brown, lumpy): −1, and the hippo chokes and coughs smoke: **sputter** (slide and gulp disabled 1 s).
  - **Nail/bolt** (grey, spiky): −2 and a **sore jaw** (slide speed halved 3 s).
  - **Water drop** (blue): no points, your next gulp is a dud ("Watered down!").
- **Slick**: a gold drop that isn't eaten within ~6 s splatters into an oil slick that makes drops near it skate faster. Keeps the board lively.

**Round.** 60 s (configurable 30/60/90). Drip rate ramps up over time; the last 10 s is "Overflow!" (2× spawn, more golds, more nails). The richest hippo wins; ties share. Score is shown as net worth in $ millions (1 point = $1M, a ticker that rolls up); the podium crowns the richest hippo, then "Rematch" (same seats) or "Lobby".

**Tuning knobs** live in one `src/sim/rules.ts` table so they can be balanced without hunting.

## 2. Modes and seats

Always four seats. **Any empty seat is filled by an AI hippo.** A human joining takes over a bot seat; a human leaving hands the seat back to a bot mid-round (net worth kept).

| Mode | How | Authority |
|---|---|---|
| Solo | 1 human + 3 bots | local sim (LocalDriver) |
| Couch | 2–4 humans on one machine (keyboard split + gamepads), bots fill the rest | local sim |
| LAN party | Desktop host opens the lobby (Rusty Buns `guests`), friends join from their own desktop build or browser by IP + join code | host's world (in-process DO) |
| Online | Room code on Cloudflare: `/ws?room=ABCD` → one Durable Object per room | the room DO |

Couch + network can mix: a LAN guest machine can bring 2 couch players (one socket, two seats). Optional; do it last.

**Controls.** P1: A/D slide, W or Space gulp, Q bellow. P2: ←/→ slide, ↑ or Enter gulp, / bellow. Gamepads: left stick/d-pad slide, A gulp, B bellow. Touch (browser): drag to slide, tap to gulp.

**AI hippos** (input-only, like druids-curse's controllers: they produce the same `Input` a human does and never touch positions).
- Each bot looks at drops heading into its jaws' reach, predicts arrival tick, slides to intercept, gulps on time.
- Personality per bot: reaction delay, aim error, greed (chases golds), caution (avoids bad drops; easy bots don't). Difficulty Easy/Normal/Hard sets these.
- Deterministic: bots use seeded RNG so replays and tests are stable.

## 3. Architecture

Same shape as druids-curse, shrunk:

```
apps/hippo-tycoon/
  rustybuns.config.ts        spa desktop + worker + edge, one DO binding
  package.json  tsconfig.json  .gitignore  README.md  PLAN.md
  vite.config.ts             browser/online build -> dist/client
  vite.desktop.config.ts     desktop build -> dist/desktop (rustybuns() plugin)
  index.html
  src/
    sim/                     PURE, deterministic, fixed 30 Hz
      rules.ts               every tuning number
      rng.ts                 seeded PRNG (mulberry32 or similar)
      types.ts               State, Hippo, Drop, Input, Event
      step.ts                step(state, inputs[4]) -> events; ordered: inputs -> hippos -> spawn -> drops physics -> gulp resolve -> effects -> clock
      spawn.ts  physics.ts  gulp.ts  effects.ts
      bots.ts                bot(state, seat, personality, mem, rng) -> Input
    engine/                  PLATFORM-FREE room engine (druids' packages/world pattern)
      ports.ts               EngineCtx / EngineSocket / EngineStorage interfaces
      tickLoop.ts            fixed-step accumulator, catch-up cap, try/catch guard
      match.ts               lobby -> countdown -> playing -> podium, seats, bot fill/takeover (shared by local and net)
      room.ts                sockets <-> match, identity, broadcast, persistence
      wire.ts                PROTO_VERSION, message types, encode/decode
    client/
      driver.ts              SimDriver seam: LocalDriver | NetDriver
      net.ts                 worldSocket wrapper: backoff reconnect, hello/version, ping
      input.ts               keyboard/gamepad/touch -> Input per local player
      render/                three.js WebGL: arena.ts, hippo.ts, drops.ts, fx.ts, camera.ts
      audio.ts               WebAudio synth sfx (grunts, bellows, chomps)
      ui/                    React: Menu, Lobby (seats, codes, LAN host toggle), Hud, Podium
      main.tsx
    worker.ts                Cloudflare entry: assets + /ws?room= -> DO, vouches X-User-Id/Name
    room-do.ts               thin DO shell around engine/room.ts
  packages/desktop/
    world.ts                 thin in-process shell around engine/room.ts (same as room-do minus base class)
    main.tsx  index.html  package.json
  test/
    sim.test.ts  bots.test.ts  wire.test.ts  room.test.ts  replay.test.ts
```

**Authority.** Server-authoritative (room DO or desktop world). Clients send `Input` (tiny), server steps at 30 Hz and broadcasts snapshots at 15–20 Hz, clients interpolate ~100 ms behind. For local modes the client runs `LocalDriver`, which wraps the same `engine/match.ts` the room uses. Pick one path and keep the seam (druids' `SimDriver`) so rendering never knows which.

**Latency honesty.** Gulps are about timing. Add light **local gulp prediction**: animate your own hippo's chomp immediately on keypress (cosmetic), the server decides what was eaten. Don't build full rollback.

**Wire.** JSON is fine at this size (4 hippos, ≤40 drops); quantise positions to integers in the encoder. Every frame carries `tick`; control frames carry `seq` (druids-curse had unsequenced scene frames and lost them). `hello` checks `PROTO_VERSION`; mismatch closes with a clear message.

**Persistence.** Keep it minimal (druids' eviction defences were the most fragile part): the room DO persists only `{phase, seats, scores, roundSeed, roundStartTick}` on phase changes. If evicted mid-round, it resumes from the seed by fast-forwarding, or simply restarts the round. Pick the simple one and document it. No D1, no auth, no KV needed for v1.

**Identity.** Online: the worker mints `X-User-Id` (random UUID, stored client-side in localStorage) and `X-User-Name` from the query, the DO trusts only headers. LAN: the Rusty Buns host vouches identity (`worldSocket(url, { join, uid: playerId(), name, v: LAN_VERSION })`). Never trust identity from message bodies.

## 4. What to reuse, and from where

From **a private game** (the owner's own multiplayer project, not in this repo), read for *patterns*, rewrite small:
- its engine ports: the ports idea
- its tick loop: fixed-step loop, catch-up cap, throw guard
- its world Durable Object and desktop world: one engine, two thin shells
- its sim driver: Local vs Network driver seam
- its world socket: reconnect/backoff, close on `pagehide`
- its AI controllers: AI emits input only
- its wire format: PROTO_VERSION + quantisation idea
- its worker's world upgrade handler: identity vouching before the DO
- its desktop entry: no StrictMode (it opens two sockets)

From **RustyBuns** (this repo):
- `apps/fm-daw/` is the closest app shape: spa desktop + `src/worker.ts` exporting the world class for Cloudflare, `src/ui/net.ts` reconnect client, `vite.desktop.config.ts`, tests, README style. **Caveat:** fm-daw sets `builtMain` with `bundle:false` but its vite build only emits `dist/client`. Its deploy path looks untested. For hippo-tycoon either drop `builtMain` so alchemy bundles `src/worker.ts`, or make the worker build real. Verify with `rustybuns plan`.
- LAN: `desktop.guests` in `packages/cli/src/config.ts`; host API `POST /__rb/host` / `GET /__rb/info`; client `worldSocket`/`playerId` from `@rustybuns/shell-bun/client`; docs in `README.md` "Multiplayer on a LAN"; tests in `packages/cli/test/multiplayer.test.ts`. **No existing app uses guests yet. Hippo Tycoon is the first, so expect to find rough edges; fix them in the CLI/shell with tests rather than working around them in the app.**
- In-process DO: `packages/shell-bun/src/bindings/durable-object.ts` supports hibernation handlers, alarms, storage get/put; **no socket tags, no `ctx.storage.sql`**. No world has run a `setInterval` tick under it yet. Test that path explicitly.
- Type checking: `rustybuns build desktop --check` (bun check needs Bun ≥ 1.4.3; falls back to tsc). The build prints a per-step profile table. Include one in the README.

## 5. Milestones (each one a working, tested state; commit per milestone)

1. **Sim + solo, no network.** `src/sim/**`, bots, three.js render, keyboard input, Menu → Solo → Podium in the browser via `vite`. Tests: determinism (same seed+inputs = same hash after 1800 ticks), scoring per drop type, effects (sputter/sore jaw/watered down), cooldowns, bot beats an idle player on Normal.
2. **Couch.** Up to 4 local players, keyboard split + Gamepad API, seat picker in Lobby.
3. **Room engine + desktop world.** `engine/**` with fake ports in tests (join/leave, bot takeover, phase machine, eviction restore). `packages/desktop/world.ts`; `rustybuns build desktop --dev --check` then `run desktop`. The desktop client goes through NetDriver to its own world.
4. **LAN party.** `guests: { max: 4 }`; Lobby gets "Host LAN game" (shows IP:port + join code) and "Join LAN game". Test two desktop instances on one machine (docs say this works). Fix any Rusty Buns guest bugs in `packages/` with tests.
5. **Online.** `src/worker.ts` + `room-do.ts`, room codes, `wrangler dev`/`rustybuns dev` locally, then `rustybuns plan` (must type-check the stack and plan cleanly). **Do not run `rustybuns deploy`. The owner deploys.**
6. **Polish + docs.** Juice (screen shake on gold, snarls, bellow chords), difficulty select, round length select. Add the app to `README.md` Examples table, `EXAMPLES.md` (row + section), `DEMO.md` (cheat sheet, per-app notes, demo order, app count), `apps/hippo-tycoon/README.md` "Run it". Optional CI workflow: one Linux job, `bun test`, `build desktop --target all` (pure TS cross-compiles).
7. **(Stretch) Rust sim twin.** Port `step()` to a Rust crate, `loadNative` with TS fallback, golden test "Rust state hash == TS state hash per tick" like `apps/motion-midi/test/golden.test.ts`. Only if 1–6 are solid.

## 6. Done means

- `bun test` passes in `apps/hippo-tycoon` and at the repo root.
- `rustybuns build desktop --check` builds a binary that plays solo, couch, and hosts a LAN game a second instance can join.
- `vite` browser build plays solo/couch; `rustybuns dev` (or wrangler dev) plays an online room with two browser tabs + bots.
- `rustybuns plan` passes its type check.
- Docs updated; PR opened against `main` (title starts "Hippo Tycoon: ") with a short demo script and the build profile table in the description.
- Report back: what works, what was cut, any Rusty Buns bugs found/fixed, and anything unverified.
