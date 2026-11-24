# Queng, the Quantum Engine

**One kit to make a web game and ship it to every screen. Players get an account, friends, parties and saves. Makers get an
editor where agents work beside them.**

Queng (say "kweng") is short for Quantum Engine. This guide puts the parts we already have into one picture, names what is still missing,
and gives the order to build it in. It is a plan: each step below is its own PR.

## The picture

Most game makers use three things: an engine to make the game, a store where people buy and play it, and a chat app
where players meet. We have all three. Today they are separate apps and packages, so we name them together here.

| Part | Like | What it does | Where it is |
| --- | --- | --- | --- |
| **Runtime** | the engine itself | draws, moves, sounds and controls the game | `packages/*`, `@rustybuns/util` |
| **eqosys** | a game store and launcher | your account, library, saves, achievements, studios, store listings | [apps/eqosys](apps/eqosys/README.md) |
| **Qollab** | a chat app for players, plus matchmaking | friends online, parties, room codes, seats, spaces with channels, voice | [apps/qollab](apps/qollab/README.md) |
| **codeSplitter** | the editor and source control | the game's code, live line edits, agents on their own copies | [apps/codesplitter](apps/codesplitter/README.md) |
| **Rusty Buns** | the build and export step | one game to a Worker, a desktop file, a server, a phone | [packages/cli](packages/cli), [README](README.md) |

eqosys is who you are, Qollab is who you are with ([VISION.md](apps/eqosys/VISION.md)). The engine adds a third line:
**the runtime is what you play**, and codeSplitter is where you make it.

eqosys's four doors on every app already follow this picture: **Play** (the store), **Keep** (the library), **Make**
(codeSplitter) and **Ship** (Rusty Buns' deploys).

## What each part holds today

### Runtime

Each module is plain TypeScript. A game imports only what it needs. No module runs the game's own world for it.

| Need | Module |
| --- | --- |
| Look and menus | `@rustybuns/ui` (buttons, panels, dialogs, toasts), `@rustybuns/util/skin` (eqosys's chip and toasts in the game's colors) |
| Controls | `@rustybuns/game-controls` (the cog panel: look speed, invert Y, keys), `@rustybuns/util/keys` |
| 3D things | `@rustybuns/models` (shared three.js models), `@rustybuns/rig` (rig any mesh, IK, a hand), `@rustybuns/terrain` (ground) |
| How it draws | `@rustybuns/util/quality` (one quality dial, steps down when frames drop) |
| Sound gear | `@rustybuns/gear` (speakers, levels, power), `@rustybuns/gear/circuit` (pedal and amp circuits) |
| Story | `@rustybuns/util/director` (scenes in the game), `memories` (watch them again), `tutorial` (a first-time coach card) |
| Words and data | `@rustybuns/cms` (a folder of JSON, edited as forms, translated) |
| Online play | `@rustybuns/util/room` (a world Durable Object), `seats`, `matchmaker`, `limits`, `protocol`, `socket` |
| Agents | `@rustybuns/util/commands` and `palette` (one list of commands for a person, a key and WebMCP) |
| Fast paths | `@rustybuns/native` (a Rust library, with a TypeScript path when it is missing) |
| Bug reports | `@rustybuns/util/report` (from inside the game into this repo) |

Run `bun run engine` for the full list with users: every package and util module, one line each, with the apps that
import it (`bun run engine util/eqosys` for one part and all its users, `--json` for the list).

### eqosys (the store side)

Sign-in for every game (`@rustybuns/util/eqosys`, an ES256 token checked by `@rustybuns/util/token`), the library,
saves, achievements, studios (one person, a team or a business), the Studio tab, store listings after a review
([LIBRARY.md](apps/eqosys/LIBRARY.md)), privacy and account delete.

### Qollab (the players side)

One `Hub` per player (friends, presence, notes), one `Party` per room code, one `Space` per group with text and voice
channels, cloud saves, and Qlave for the audio ([QOLLAB.md](apps/eqosys/QOLLAB.md)). A game drops in the lobby and spaces
panels (`@rustybuns/util/lobby`, `spaces`) and keeps its own world and ticks.

### codeSplitter (the editor side)

A game's repo, where people and agents edit the same files at once. New game on the Studio tab makes a repo from the
starter, and the Make door opens it.

### Rusty Buns (the ship side)

`rustybuns.config.ts`: one config to a Cloudflare Worker, a desktop file and a server, with plans that show the price first.
The Ship door on eqosys reads real deploys.

## What every Q game has

[apps/starter-game](apps/starter-game/README.md) is the reference game: `bun run new-game <id>` copies it. Every Q game
has these parts:

1. **A handle on `window`** with a `state()`, and a row in `HANDLES` (`scripts/probe.ts`). Then `bun run probe` reads it.
2. **Commands** (`addCommands`, `howToPlay`): one list for the palette, keys and WebMCP.
3. **eqosys sign-in**, with guest play when no account is needed.
4. **A Qollab party** for "With friends", with the shared lobby panel.
5. **A test that plays one round** through the running game.

A 3D game also has the quality dial and the cog Controls panel. A game with a story uses the director and tutorial.

## What is missing

These are the gaps between "parts" and "an engine". Each one is small enough for one worker.

| Gap | Why it matters | Proposed fix |
| --- | --- | --- |
| **One list of the parts** | A new game, or an agent, finds the runtime by grep. The parts are spread over 16 packages and 44 util modules. | `bun run engine`: each part with its one-line doc, and which games use it (read from their imports). This guide's tables come from that list, not by hand. |
| **A check of the game contract** | "Every Q game has" above is a promise nothing checks. | `bun run engine check <app>`: the handle and its `HANDLES` row, commands, sign-in, party, a round test. Each line passes or fails with the fix. |
| **A shared game loop** | 22 apps write their own `requestAnimationFrame` loop. Each one has its own fixed step, pause when hidden and catch-up. | `@rustybuns/util/loop`: a plain fixed-step loop (no Effect: it runs every frame) that pauses when the tab is hidden and feeds the quality dial. The starter uses it first, then other games when they change. |
| **Play beside the code** | In codeSplitter you edit a game but run it somewhere else. | A preview pane in codeSplitter that runs the repo's game and reads its `state()`. |
| **Qollab without eqosys** | Other developers cannot use the players side with their own sign-in yet. | [#3978](https://github.com/QuinnsCode/RustyBuns/issues/3978) (open). |

## Rules that stay

- **A game owns its world.** The sim, ticks and save shape stay in `apps/<game>`. The engine gives the parts around them.
- **No new package-to-package dependencies.** CI installs each app on its own, and a new link between packages breaks
  that install. So there is no `@rustybuns/engine` package that wraps the others. The engine is the name, the list and
  the check, and a game imports each part directly.
- **Licenses stay as they are.** The runtime, the eqosys client and the Rusty Buns CLI are Apache-2.0. eqosys and Qollab
  are PolyForm Noncommercial ([apps/eqosys/LICENSE](apps/eqosys/LICENSE)): a commercial game uses the hosted eqosys or
  brings its own accounts.
- **Cut before you add.** When two games have the same helper, move it into the runtime and delete both copies in the
  same PR ([AGENTS.md](AGENTS.md#cut-before-you-add)).

## Build order

1. This guide.
2. `bun run engine`: the list of parts and who uses them.
3. `bun run engine check <app>`, run on the starter and on the games in the owner's S and A tiers (`bun run bridge`).
4. `@rustybuns/util/loop`, in the starter first.
5. The preview pane in codeSplitter.
6. Qollab with a developer's own sign-in ([#3978](https://github.com/QuinnsCode/RustyBuns/issues/3978)).
