# 🥐 Agent Office, Rusty Buns-ified

> **What it proves:** someone else's Node server (PTYs, WebSockets, a 3D client) becomes one file for Mac and Linux, with nothing forked. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

[Agent Office](https://github.com/AgentSystemLabs/agent-office) (MIT) is the cartoon 3D office where
Claude Code workers sit at desks. Some of Rusty Buns was built in it. This example turns it around:
the office itself, on Bun, as **one file** you can copy to any Mac or Linux box. No Node, no
`npm ci`, nothing compiled on the server.

```sh
cd apps/agent-office
bun run office                 # fetch the pinned release, Bun-ify it, open the office
bun run office:update          # git pull, rebuild, then swap the running office for the new one
bun run office:update -- --watch   # the same, then keep watching like office:mama
bun run office:mama            # run the office; rebuild and swap it when bun, bun.lock or the release move
bun run desktop:build          # dist/agent-office-<os>-<arch>
bun run desktop:build:all      # + darwin-x64, linux-x64, linux-arm64
bun run desktop:smoke          # start that binary on a temp floor, check /__rb/mem sees it and its pty host
```

The swap is a SIGTERM, which upstream treats as a restart: the workers' terminals live in a detached pty host,
so they keep running and the new office shows them with their scrollback. (Ctrl+C is different: it closes the
office and its workers.) A failed pull or build leaves the old office up, and `office:update` leaves alone an
office on the port that isn't this checkout's. One caveat: a new Agent Office release that bumps `PTY_PROTOCOL`
makes the new office stop the old pty host, and Claude workers are then resumed rather than kept.

Then copy `./dist/agent-office-linux-x64` to a server and run it there, with all of Agent Office's own flags.
Like upstream, it listens on `127.0.0.1` behind the office password, so reach it with
`ssh -L 4600:localhost:4600 <server>` and open http://localhost:4600. Don't hand it `--host 0.0.0.0` on a
network you don't trust: the office runs shells and agents as you, and over plain http its password and session
cookie cross the wire in the clear. For HTTPS, voice and teams, follow its README; its `deploy/` scripts
install Node and `npm ci`, and this binary can stand in for that step.

## 📱 From your phone

Agent Office already has a phone view: **`/lite`** is the office without the 3D. It shows every worker and what
it's waiting on, its terminal (with the keys a phone keyboard lacks, so you can read the prompt and answer it), the
📌 issues, 🔀 PRs and 📋 queue boards, and ✨ New task to put a worker at a desk. What it lacks is a way for your phone
to reach the office on your Mac, which listens on `127.0.0.1` only. `office:phone` adds an HTTPS tunnel to it and
prints the link:

```sh
bun run office                       # the office, as usual
bun run office:phone                 # Tailscale: https://<this-mac>.<tailnet>.ts.net/lite
bun run office:phone -- --off        # stop serving it
```

| | Tailscale (default) | Cloudflare Tunnel + Access | Cloudflare quick tunnel (`--public`) |
|---|---|---|---|
| Who can reach the login | your devices on your tailnet | only people Access lets in (e.g. a one-time code to your email) | anyone with the link |
| Setup | Tailscale on the Mac and the phone, HTTPS on in the tailnet (Serve prompts the first time) | `cloudflared`, a domain on Cloudflare, a named tunnel and an Access app | `brew install cloudflared` |
| Link | fixed | fixed, your own domain | new every run |
| Cost | free (personal plan) | free (Zero Trust, up to 50 users) | free |

**Use Tailscale.** Nothing is on the internet, the phone app keeps you connected, and the link never changes.
Cloudflare suits a phone or a teammate you can't put on the tailnet:

```sh
cloudflared tunnel login && cloudflared tunnel create office
cloudflared tunnel route dns office office.example.com
# Zero Trust → Access → Applications: a self-hosted app on office.example.com, allowing your email
bun run office:phone -- --cloudflare --tunnel office --hostname office.example.com
```

The office answers only to names it knows, against DNS rebinding ([`live/hosts.ts`](live/hosts.ts)): localhost, IP
addresses, this Mac's name, `*.ts.net` and `*.trycloudflare.com`. Start it with
`AGENT_OFFICE_ALLOWED_HOSTS=office.example.com` for a named tunnel's hostname; `office:phone` warns when it's missing.

**Passwords.** The tunnel only carries traffic. The office's own sign-in still guards every page and socket. The
link opens `/login?next=/lite`; sign in with the office password once and the session cookie lasts on the phone. Better,
make yourself an account in **☰ → 🔑 Accounts**, then turn the shared password off (upstream's
[Add users](https://github.com/AgentSystemLabs/agent-office#add-users) guide). With Tailscale or Access in
front, that's two locks: the network, and the office. A `--public` quick tunnel leaves only the office's password and
its 10-tries-per-window login limit, and behind a tunnel every visitor shares that limit, so an attacker can lock you
out. Keep quick tunnels short.

Tip: add `/lite` to your phone's home screen and it opens like an app.

## How

Nothing is forked. `scripts/rustybunsify.ts` downloads a pinned release tarball and checks its sha256
(`PINNED` in `scripts/release.ts`; `AGENT_OFFICE_TAG` with `AGENT_OFFICE_SHA256` tries another), installs it with Bun, and patches the copy in `./office`. Every patch fails loudly if its target moves.

| What | Why |
|---|---|
| `@lydell/node-pty` → [`shim/node-pty`](shim/node-pty/index.js) | The native addon spawns under Bun but its shell is hung up at once. ~80 lines over `Bun.spawn({ terminal })` replace it: no node-gyp, no prebuilds, and it survives `--compile`. |
| `@xterm/*` bundle their CJS `main` | Bun's bundler prefers `module`, whose ESM build has no default export. |
| `http/static.js` reads `$AGENT_OFFICE_PUBLIC_DIR` | The 3D client is embedded and unpacked once to `~/.cache/agent-office-rustybuns/<tag>-<content hash>/`, and checked against that hash every start: an edited unpack is replaced. |
| `ptys.js` falls back to `$HOME` as the pty host's cwd | Inside a binary the code dir is the virtual `/$bunfs`. |
| `workers/process.js` points `office-workers` / `office-queue` at the binary | There's no `bin/` on disk to find. |
| [`live/`](live/github.ts) hooks each floor's GitHub boards | Upstream lists issues and PRs every 90s. A worker's own `gh pr merge`, `gh issue close` or `git push` now refreshes the boards within a couple of seconds, and while a floor is busy the office asks GitHub every 10s whether anything changed. That check is a conditional request, so an unchanged answer is a free 304, and the full `gh` lists only run on a change. Open PRs with CI running are watched through their check suites. With `AGENT_OFFICE_WEBHOOKS=1` (needs `gh extension install cli/gh-webhook` and admin on the repo), `gh webhook forward` pushes the repo's issue, PR, review and CI events to a localhost port instead, so changes from anyone, on idle floors too, show within about a second, and the 10s check stands down. GitHub allows one forwarder per repo; if it can't start or drops, the check carries on and it tries again in 10 min. |
| [`live/mem.ts`](live/mem.ts) watches the office's memory | The office and each floor's pty host run the box hosts' `memWatch`: RSS and the JS heap every 5 minutes, with a slope over the last hour, so a leak in a long session shows as a steady +MB/h. The office logs a `[mem]` line; a pty host logs to the floor's `.agent-office/pty-host.log` and leaves its latest numbers in `pty-host-mem.json` there. Signed in, **`/__rb/mem`** returns the office's and every floor's pty host's. `AGENT_OFFICE_MEM_MAX_MB` sets a ceiling: over it, that process writes a V8 heap snapshot to its data dir's `heap/` and exits. |
| [`live/env.ts`](live/env.ts) keeps secrets from the workers | Upstream hands every worker and shell the office's whole environment. Names that look like a secret (`*_TOKEN`, `*_SECRET`, `*_KEY`, anything with `PASSWORD` or `SECRET`, 1Password's `OP_*`) are now dropped, so a `CLOUDFLARE_API_TOKEN` or `GH_TOKEN` exported in the shell that started the office never reaches an agent. The agents' own sign-ins (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `CURSOR_API_KEY` and the like) still pass. The office logs the names it held back once, as `[env] kept from the workers: …`. `AGENT_OFFICE_ENV_PASS=GH_TOKEN,…` lets other names through, e.g. a `GH_TOKEN` on a machine whose `gh` has no other login. |
| [`triage/`](triage) lets agents triage the office | The office's memory, CPU profiles and heap snapshots as tools: **`mem_stats`**, **`take_cpu_profile`**, **`list_profiles`**, **`read_profile`** and **`heap_snapshots`**. They answer in text an agent can read: the hottest functions by self and total time, with the stack under each, and the MB/h slope with the hours left to the ceiling. The `.cpuprofile` itself stays a file for DevTools or speedscope. Workers get them in the office's MCP server, and only `take_cpu_profile` asks first. An agent in the browser gets them from the office page over WebMCP (`navigator.modelContext`), using the signed-in session. Behind them are `/__rb/mem`, `/__rb/prof` (POST `?s=N`), `/__rb/prof/<id>` and `/__rb/heap`. These need a sign-in, or a worker's own token on the hook port. |
| [`icons/`](icons/index.ts) loads ahead of every page | Its emoji become [Lucide](https://lucide.dev) icons: inline SVG in the DOM, and on canvas (boards, name tags, bubbles) drawn in the emoji's own space. Which icon stands in for which emoji is [`icons/emoji.ts`](icons/emoji.ts); one left out stays an emoji. |
| [`queue/`](queue/index.ts) adds a search box to the 📋 queue | Between ✅ Finished and Clear. It matches each finished task's title, prompt, worker, branch and PR, and the linked issue's title, body and labels, which it reads off the office's own socket messages. |
| [`clock/`](clock/index.ts) puts the time on the 📌 issues and 🔀 PR boards | Their "Updated just now" reads "11:12 PM PDT · Updated just now": when the board last heard from GitHub, in the zone picked under ⚙️ Settings › You › Time zone (kept in that browser; Automatic follows the browser's). The board's line is patched in the client chunk it lives in, which then gets a new name, as do the files that import it, since the hashed chunks are served as immutable. |
| [`codesplitters/`](codesplitters/index.ts) puts [codeSplitters](../codesplitters) by the boards | Off until ⚙️ Settings › You › codeSplitters turns it on (kept in that browser), with the repo as `owner/name`. Then each of the 📌 issues, 📋 queue and 🔀 PR boards gets the codeSplitters mark beside it: a tile on the wall, a badge on its /lite tab. A blue dot on the mark, and on the tab's favicon, says its twin has news you haven't seen: a check failing on main, a coding-agent run, a branch opened or merged. Click the mark to open the repo there and clear its dot. The office asks codeSplitters (`/__rb/codesplitters`, signed in), so the token stays on your machine: `CODESPLITTERS_URL` and `CODESPLITTERS_TOKEN`, else what `codesplitters login` saved, else the desktop app if it's running, else the live site. With none of those, a running desktop app is found by itself (it leaves its URL and launch token in `~/.codesplitters/desktop.json` while it runs); `CODESPLITTERS_URL` with the `?token=` URL that `RB_NO_BROWSER=1` prints still works. |
| [`workers.json`](scripts/hooktokens.ts) keeps hashes of the hook tokens | Upstream saves every worker's hook token there, and every worker runs as you, so any one could read it and call the hook port as another (#642). Now it keeps a sha256 of each. A worker whose terminal outlives a restart still has its token in its env, and the office checks it against the hash until the worker launches again. The office's session secret and the pty host's token are still on disk: #667. |

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
| Workers → enemies (skeletons, Voidmires, void wolves, the Bound Druid) | [`druids/skin.ts`](druids/skin.ts) |
| The merge gong (the totem's cure spell), the jukebox's Ambiance of the Vale | [`druids/audio.ts`](druids/audio.ts) |
| People → Qoa, and your first-person body | [`druids/people.ts`](druids/people.ts) |
| Druid Panels, loot, the village | [`druids/council.ts`](druids/council.ts) |
| Palms, ivy, vines, grass | [`druids/jungle.ts`](druids/jungle.ts), all procedural and instanced (hippo-tycoon's palms, the game's grass blade) |
| Colours, moss, fire, fireflies, the game's props | [`druids/forest.ts`](druids/forest.ts), [`druids/palette.ts`](druids/palette.ts) |
| What's on the walls | [`druids/room.ts`](druids/room.ts), from Agent Office's `shared/layout.js` |
| KTX2 textures | [`druids/loader.ts`](druids/loader.ts), with three's Basis transcoder at `/druids/basis/` |
| The models and sounds | the live game's `/non_repo/models/` and `/non_repo/sfx/`, fetched into `.cache/druids/`, never committed |

Three one-line hooks go into the client bundle: the worker and person constructors push themselves onto
`globalThis.__rbWorkers` / `__rbPeople`, and the per-frame update calls everything on `__rbOfficeTicks` once the sky
has set the lights. That last one goes in for either skin, since the codeSplitters tiles hang off it too. The patched bundle gets a new name, since the original is served as immutable. If a model fails to load, that
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
