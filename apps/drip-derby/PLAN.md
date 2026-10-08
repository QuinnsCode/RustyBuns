# Drip Derby: build plan

A small, original arcade game that ships as a Rusty Buns example: **hungry-hungry-hippos, but the hippos are cartoon cars and the marbles are oil drops.** It exists to show people the whole Rusty Buns story (Cloudflare-first app, same code as a desktop binary, LAN party mode, deploy anywhere) without any of the owner's private game content.

Lives at `apps/drip-derby/` in the RustyBuns repo. Pure TypeScript (Rust is an optional later milestone).

## 0. Hard rules

- **IP, ours.** Do not copy anything from `druids-curse-votv`'s game content: no names, lore, scenes, dialog, art, fonts, shaders, constants, assets. Copy *architecture patterns only* (listed in §4, rewritten small, not pasted wholesale).
- **IP, theirs.** "Like the movie Cars" is the vibe, not the content. No Pixar/Disney names, characters, logos, fonts, or the signature eyes-in-the-windshield face. Cars get personality from shape, colour, horn sound, and a headlight "blink". Original names only (e.g. Gasket, Dipstick, Lugnut, Sprocket, Torque, Chassis, Valve, Piston).
- **No binary assets.** Cars, arena and drops are built from three.js primitives in code. Sounds are WebAudio-synthesised (engine rev, gulp, horn). Nothing to license.
- **Small files.** druids-curse's pain was 2000+ line god-files. Keep every file under ~400 lines; split by concern.
- **Sim purity.** `src/sim/**` has no DOM, no `console.*`, no `Date.now`/`Math.random` (seeded RNG only), no imports outside `src/sim`. Same input sequence + seed = same state, bit for bit.

## 1. The game

**Board.** A round oil-pan arena seen from above, slightly tilted (iso-ish camera). Four garages at N/E/S/W. Each seat is a car parked in its garage mouth.

**Cars (the hippos).** A car can:
- **Slide** left/right along its garage lip (short rail, ~60° of arc).
- **Gulp**: lunge forward into the arena with the fuel-cap/front scoop open, then snap back. Anything in the scoop zone at the gulp's peak is eaten. Gulp has a short cooldown (~350 ms) so mashing works but timing matters.
- **Honk**: cosmetic, plus it's the "ready" button in the lobby.

**Drops (the marbles).** Spawned from a central "drip" pipe, bouncing around the pan with friction and wall bounces.
- **Good: oil drop** (black, glossy). +1. Most common.
- **Great: premium gold drop** (golden, faster, sparkles). +3. Rare, appears in bursts.
- **Bad**: eating one hurts:
  - **Sludge** (brown, lumpy): −1 and your car **sputters** (slide and gulp disabled 1 s).
  - **Nail/bolt** (grey, spiky): −2 and **flat tyre** (slide speed halved 3 s).
  - **Water drop** (blue): no points, your next gulp is a dud ("engine flooded").
- **Slick**: a gold drop that isn't eaten within ~6 s splatters into an oil slick that makes drops near it skate faster. Keeps the board lively.

**Round.** 60 s (configurable 30/60/90). Drip rate ramps up over time; the last 10 s is "Overflow!" (2× spawn, more golds, more nails). Highest score wins; ties share. Show a podium, then "Rematch" (same seats) or "Lobby".

**Tuning knobs** live in one `src/sim/rules.ts` table so they can be balanced without hunting.

## 2. Modes and seats

Always four seats. **Any empty seat is filled by an AI driver.** A human joining takes over a bot seat; a human leaving hands the seat back to a bot mid-round (score kept).

| Mode | How | Authority |
|---|---|---|
| Solo | 1 human + 3 bots | local sim (LocalDriver) |
| Couch | 2–4 humans on one machine (keyboard split + gamepads), bots fill the rest | local sim |
| LAN party | Desktop host opens the lobby (Rusty Buns `guests`), friends join from their own desktop build or browser by IP + join code | host's world (in-process DO) |
| Online | Room code on Cloudflare: `/ws?room=ABCD` → one Durable Object per room | the room DO |

Couch + network can mix: a LAN guest machine can bring 2 couch players (one socket, two seats). Optional; do it last.

**Controls.** P1: A/D slide, W or Space gulp, Q honk. P2: ←/→ slide, ↑ or Enter gulp, / honk. Gamepads: left stick/d-pad slide, A gulp, B honk. Touch (browser): drag to slide, tap to gulp.

**AI drivers** (input-only, like druids-curse's controllers: they produce the same `Input` a human does and never touch positions).
- Each bot looks at drops heading into its scoop zone, predicts arrival tick, slides to intercept, gulps on time.
- Personality per bot: reaction delay, aim error, greed (chases golds), caution (avoids bad drops; easy bots don't). Difficulty Easy/Normal/Hard sets these.
- Deterministic: bots use the sim's seeded RNG so replays and tests are stable.

## 3. Architecture

Same shape as druids-curse, shrunk:

```
apps/drip-derby/
  rustybuns.config.ts        spa desktop + worker + edge, one DO binding
  package.json  tsconfig.json  .gitignore  README.md  PLAN.md
  vite.config.ts             browser/online build -> dist/client
  vite.desktop.config.ts     desktop build -> dist/desktop (rustybuns() plugin)
  index.html
  src/
    sim/                     PURE, deterministic, fixed 30 Hz
      rules.ts               every tuning number
      rng.ts                 seeded PRNG (mulberry32 or similar)
      types.ts               State, Car, Drop, Input, Event
      step.ts                step(state, inputs[4]) -> events; ordered: inputs -> cars -> spawn -> drops physics -> gulp resolve -> effects -> clock
      spawn.ts  physics.ts  gulp.ts  effects.ts
      bots.ts                bot(state, seat, personality, rng) -> Input
    engine/                  PLATFORM-FREE room engine (druids' packages/world pattern)
      ports.ts               EngineCtx / EngineSocket / EngineStorage interfaces
      tickLoop.ts            fixed-step accumulator, catch-up cap, try/catch guard
      room.ts                seats, lobby -> countdown -> playing -> podium, bot fill/takeover, broadcast
      wire.ts                PROTO_VERSION, message types, encode/decode
    client/
      driver.ts              SimDriver seam: LocalDriver | NetDriver
      net.ts                 worldSocket wrapper: backoff reconnect, hello/version, ping
      input.ts               keyboard/gamepad/touch -> Input per local player
      render/                three.js WebGL: arena.ts, car.ts, drops.ts, fx.ts, camera.ts
      audio.ts               WebAudio synth sfx
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

**Authority.** Server-authoritative (room DO or desktop world). Clients send `Input` (tiny), server steps at 30 Hz and broadcasts snapshots at 15–20 Hz, clients interpolate ~100 ms behind. For local modes the same `room.ts` runs in-browser with fake ports, or the client just runs `LocalDriver` stepping `sim` directly. Pick one path and keep the seam (druids' `SimDriver`) so rendering never knows which.

**Latency honesty.** Gulps are about timing. Add light **local gulp prediction**: animate your own car's lunge immediately on keypress (cosmetic), the server decides what was eaten. Don't build full rollback.

**Wire.** JSON is fine at this size (4 cars, ≤40 drops); quantise positions to integers in the encoder. Every frame carries `tick`; control frames carry `seq` (druids-curse had unsequenced scene frames and lost them). `hello` checks `PROTO_VERSION`; mismatch closes with a clear message.

**Persistence.** Keep it minimal (druids' eviction defences were the most fragile part): the room DO persists only `{phase, seats, scores, roundSeed, roundStartTick}` on phase changes. If evicted mid-round, it resumes from the seed by fast-forwarding, or simply restarts the round. Pick the simple one and document it. No D1, no auth, no KV needed for v1.

**Identity.** Online: the worker mints `X-User-Id` (random UUID, stored client-side in localStorage) and `X-User-Name` from the query, the DO trusts only headers. LAN: the Rusty Buns host vouches identity (`worldSocket(url, { join, uid: playerId(), name, v: RB_VERSION })`). Never trust identity from message bodies.

## 4. What to reuse, and from where

From **druids-curse-votv** (`/Users/ryanquinn/agent-office/QuinnsCode/druids-curse-votv`), read for *patterns*, rewrite small:
- `packages/world/src/enginePorts.ts`: the ports idea
- `packages/world/src/tickLoop.ts`: fixed-step loop, catch-up cap, throw guard
- `src/durableObjects/WorldDurableObject.ts` + `packages/desktop/world.ts`: one engine, two thin shells
- `src/app/game/net/simDriver.ts`: Local vs Network driver seam
- `src/app/game/net/worldSocket.ts`: reconnect/backoff, close on `pagehide`
- `packages/sim/src/controllers.ts`: AI emits input only
- `packages/sim/src/wire.ts`: PROTO_VERSION + quantisation idea
- `src/worker.tsx` `handleWorldUpgrade`: identity vouching before the DO
- `packages/desktop/main.tsx`: no StrictMode (it opens two sockets)

From **RustyBuns** (this repo):
- `apps/fm-daw/` is the closest app shape: spa desktop + `src/worker.ts` exporting the world class for Cloudflare, `src/ui/net.ts` reconnect client, `vite.desktop.config.ts`, tests, README style. **Caveat:** fm-daw sets `builtMain` with `bundle:false` but its vite build only emits `dist/client`. Its deploy path looks untested. For drip-derby either drop `builtMain` so alchemy bundles `src/worker.ts`, or make the worker build real. Verify with `rustybuns plan`.
- LAN: `desktop.guests` in `packages/cli/src/config.ts`; host API `POST /__rb/host` / `GET /__rb/info`; client `worldSocket`/`playerId` from `@rustybuns/shell-bun/client`; docs in `README.md` "Multiplayer on a LAN"; tests in `packages/cli/test/multiplayer.test.ts`. **No existing app uses guests yet. Drip Derby is the first, so expect to find rough edges; fix them in the CLI/shell with tests rather than working around them in the app.**
- In-process DO: `packages/shell-bun/src/bindings/durable-object.ts` supports hibernation handlers, alarms, storage get/put; **no socket tags, no `ctx.storage.sql`**. No world has run a `setInterval` tick under it yet. Test that path explicitly.
- Type checking: `rustybuns build desktop --check` (bun check needs Bun ≥ 1.4.3; falls back to tsc). The build prints a per-step profile table. Include one in the README.

## 5. Milestones (each one a working, tested state; commit per milestone)

1. **Sim + solo, no network.** `src/sim/**`, bots, three.js render, keyboard input, Menu → Solo → Podium in the browser via `vite`. Tests: determinism (same seed+inputs = same hash after 1800 ticks), scoring per drop type, effects (sputter/flat/flooded), cooldowns, bot beats an idle player on Normal.
2. **Couch.** Up to 4 local players, keyboard split + Gamepad API, seat picker in Lobby.
3. **Room engine + desktop world.** `engine/**` with fake ports in tests (join/leave, bot takeover, phase machine, eviction restore). `packages/desktop/world.ts`; `rustybuns build desktop --dev --check` then `run desktop`. The desktop client goes through NetDriver to its own world.
4. **LAN party.** `guests: { max: 4 }`; Lobby gets "Host LAN game" (shows IP:port + join code) and "Join LAN game". Test two desktop instances on one machine (docs say this works). Fix any Rusty Buns guest bugs in `packages/` with tests.
5. **Online.** `src/worker.ts` + `room-do.ts`, room codes, `wrangler dev`/`rustybuns dev` locally, then `rustybuns plan` (must type-check the stack and plan cleanly). **Do not run `rustybuns deploy`. The owner deploys.**
6. **Polish + docs.** Juice (screen shake on gold, tyre-squeal on flat, horn chords), difficulty select, round length select. Add the app to `README.md` Examples table, `EXAMPLES.md` (row + section), `DEMO.md` (cheat sheet, per-app notes, demo order, app count), `apps/drip-derby/README.md` "Run it". Optional CI workflow: one Linux job, `bun test`, `build desktop --target all` (pure TS cross-compiles).
7. **(Stretch) Rust sim twin.** Port `step()` to a Rust crate, `loadNative` with TS fallback, golden test "Rust state hash == TS state hash per tick" like `apps/motion-midi/test/golden.test.ts`. Only if 1–6 are solid.

## 6. Done means

- `bun test` passes in `apps/drip-derby` and at the repo root.
- `rustybuns build desktop --check` builds a binary that plays solo, couch, and hosts a LAN game a second instance can join.
- `vite` browser build plays solo/couch; `rustybuns dev` (or wrangler dev) plays an online room with two browser tabs + bots.
- `rustybuns plan` passes its type check.
- Docs updated; PR opened against `main` with a short demo script and the build profile table in the description.
- Report back: what works, what was cut, any Rusty Buns bugs found/fixed, and anything unverified.
