# 🥐 Agent Office, Rusty Buns-ified

> **What it proves:** someone else's Node server (PTYs, WebSockets, a 3D client) becomes one file for Mac and Linux, with nothing forked. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

[Agent Office](https://github.com/AgentSystemLabs/agent-office) (MIT) is the cartoon 3D office where
Claude Code workers sit at desks. Some of Rusty Buns was built in it. This example turns it around:
the office itself, on Bun, as **one file** you can copy to any Mac or Linux box. No Node, no
`npm ci`, nothing compiled on the server.

```sh
cd apps/agent-office
bun run office                 # fetch the pinned release, Bun-ify it, open the office
bun run desktop:build          # dist/agent-office-<os>-<arch>
bun run desktop:build:all      # + darwin-x64, linux-x64, linux-arm64
```

Then copy `./dist/agent-office-linux-x64` to a server and run it there, with all of Agent Office's own flags.
Like upstream, it listens on `127.0.0.1` behind the office password, so reach it with
`ssh -L 4600:localhost:4600 <server>` and open http://localhost:4600. Don't hand it `--host 0.0.0.0` on a
network you don't trust: the office runs shells and agents as you, and over plain http its password and session
cookie cross the wire in the clear. For HTTPS, voice and teams, follow its README; its `deploy/` scripts
install Node and `npm ci`, and this binary can stand in for that step.

## How

Nothing is forked. `scripts/rustybunsify.ts` downloads a pinned release tarball and checks its sha256
(`PINNED` in the script; `AGENT_OFFICE_TAG` with `AGENT_OFFICE_SHA256` tries another), installs it with Bun, and patches the copy in `./office`. Every patch fails loudly if its target moves.

| What | Why |
|---|---|
| `@lydell/node-pty` → [`shim/node-pty`](shim/node-pty/index.js) | The native addon spawns under Bun but its shell is hung up at once. ~80 lines over `Bun.spawn({ terminal })` replace it: no node-gyp, no prebuilds, and it survives `--compile`. |
| `@xterm/*` bundle their CJS `main` | Bun's bundler prefers `module`, whose ESM build has no default export. |
| `http/static.js` reads `$AGENT_OFFICE_PUBLIC_DIR` | The 3D client is embedded and unpacked once to `~/.cache/agent-office-rustybuns/<tag>-<content hash>/`. |
| `ptys.js` falls back to `$HOME` as the pty host's cwd | Inside a binary the code dir is the virtual `/$bunfs`. |
| `workers/process.js` points `office-workers` / `office-queue` at the binary | There's no `bin/` on disk to find. |

## 🌴 The Druids Curse jungle

The office is retold as a jungle council from our game, [Druids Curse](https://druids-curse-votv.notryanquinn.workers.dev).
You (and everyone walking around) are **Qoa**; every worker is one of the game's **enemies** at a standing desk: the
witch, goblins, ninjas, zombies, the Void Wolf, Voidmire, Toadmire, the Skeleton and Kaladen. Coding is spellcasting,
tests are a sword slash, done is a victory, waiting on you is a jump, and a worker heading home carries their box.
Palms, ivy and vines take every wall that isn't a board, the TV, a window or a door; the floor is moss and Druids Curse
grass; agent desks are the game's Druid Panels (a lectern per agent, laptops on the slab), the elevator is still the office's own,
loot is strewn everywhere, and the Council Chambers and a village stand outside. First person stays the default and
the camera is Qoa's eyes: look down and you see his body. ⚙️ Settings switches to third person, where you see him run.

| What | Where |
|---|---|
| Who's who, which clip | [`druids/cast.ts`](druids/cast.ts) (pure, tested in `test/druids.test.ts`) |
| Workers → enemies | [`druids/skin.ts`](druids/skin.ts) |
| People → Qoa, and your first-person body | [`druids/people.ts`](druids/people.ts) |
| Druid Panels, loot, the village | [`druids/council.ts`](druids/council.ts) |
| Palms, ivy, vines, grass | [`druids/jungle.ts`](druids/jungle.ts), all procedural and instanced (hippo-tycoon's palms, the game's grass blade) |
| Colours, moss, fire, fireflies, the game's props | [`druids/forest.ts`](druids/forest.ts), [`druids/palette.ts`](druids/palette.ts) |
| What's on the walls | [`druids/room.ts`](druids/room.ts), from Agent Office's `shared/layout.js` |
| KTX2 textures | [`druids/loader.ts`](druids/loader.ts), with three's Basis transcoder at `/druids/basis/` |
| The models | the live game's `/non_repo/models/`, fetched into `.cache/druids/`, never committed |

Three one-line hooks go into the client bundle: the worker and person constructors push themselves onto
`globalThis.__rbWorkers` / `__rbPeople`, and the per-frame update calls `__rbOfficeTick` once the sky has set the
lights. The patched bundle gets a new name, since the original is served as immutable. If a model fails to load, that
worker or person keeps the office's own look. In the browser console, `__rbDruids` and `__rbQoa` show who's who and
what clip they're playing, and `__rbOffice` is the office itself. `AGENT_OFFICE_SKIN=office` builds the plain office; `DRUIDS_CURSE_URL` points at another
build of the game.

The binary has four jobs, picked by its first argument: the office, its pty host (the office re-runs
itself for that, as it does under Node), and the two helper commands workers call.

## Node vs Bun

`bun bench/bench.ts --runs 5` races the installed release on Node against the binary, on the office's
real paths. Medians from an M-series Mac (busy, so read differences under ~15% as noise):

| | Node 22 | Bun 1.4 binary | |
|---|---:|---:|---|
| startup to first page | 590 ms | 466 ms | 1.3x faster |
| office memory, idle | 115 MB | 76 MB | 1.5x less |
| pty host memory, idle | 75 MB | 31 MB | 2.4x less |
| terminal throughput (20 MB of ANSI) | 25 MB/s | 23 MB/s | tie |
| 10 live terminals, full scrollback | 301 MB | 291 MB | tie |

The wins are startup and idle memory. Busy terminals tie because the cost is the office's own JS:
every byte goes through a headless xterm (`bench/parse.mjs` shows it alone at ~20-70 MB/s, the same on both
runtimes), and each terminal keeps ~26 MB of scrollback. That parser is the obvious place for Rust.

## Limits

- macOS and Linux. Bun's PTY is POSIX only, so Windows still needs Node.
- The Linux binaries are cross-compiled from a Mac; the pty host is tested on macOS.
- Not `rustybuns build desktop`: that wraps Vite apps and Workers-shaped handlers, and this is a
  long-running server with terminals. It's the first sample for the planned sidecar mode (FRAMEWORKS.md).
