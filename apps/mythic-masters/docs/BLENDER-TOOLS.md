# Blender tools: what's here, how to run it, what to build next

Mythic Masters has done more Blender work than any other app (beasts, plants, ground textures), so its tools
are listed here. Read this before a model round, so the next round starts from the tools instead of finding them
again. [MODEL-TOOLING.md](MODEL-TOOLING.md) has the beast pipeline's history and art notes. This file covers the
tools and the rules.

**No Blender on the office Mac (the owner's order, 2026-11-23).** Do not start Blender there, or any script
below that starts it, headless included: the Mac was forced off twice that night. Every Blender step goes through
the Blender queue (`bun run blender`, `scripts/blender-queue.ts`, #6007) to the builder Mac (Bob), one job at a time:
the scripts below queue themselves (`await queued()`), `runBlender` refuses to start Blender where `BUILDER_HOST`
is set, and the guard hook turns a direct `blender` away. On 2026-11-23 a `bun run builder run` on Bob did not find
`blender` on its `PATH`: a queue job fails "no Blender on Bob" until it does (or `BLENDER_PATH` points at it).

Blender 5.2 LTS is at `/opt/homebrew/bin/blender` on the office Mac and is on `PATH`. The builder Mac (Bob)
has it too ([MAC_SETUP.md](../../../MAC_SETUP.md)). The beast build runs on 5.2.0 only: 5.2.1 writes other GLB bytes from the same
sheets (#4129), so `beasts.ts` stops on another version and says what to install. Every script starts it through `runBlender` in
`@rustybuns/cli/blender` (`-b --factory-startup --python-exit-code 1`, a failure throws its Traceback lines);
`BLENDER_PATH` picks another Blender. Write a new tool on it, not on `Bun.spawn`.

## The tools, one table

Run them from `apps/mythic-masters`. Everything they write to look at goes in `blender/out/` (gitignored).

| What | Command | Writes | Time |
|---|---|---|---|
| Build beasts (mesh, AO bake, decimate, rig) | `bun run beasts [id ...]` (`--render` is on) | `public/models/<id>.glb`, `<id>.rig.json`, `blender/out/<id>.png` | 1-5 s a beast warm, about 100 s for all 76 |
| Rebuild one beast on save, hot-swap it in the gallery | `bun scripts/beasts.ts --watch <id>` (with `bun run dev` up) | the same | seconds per save, in one warm Blender |
| Silhouette test | `bun scripts/beasts.ts --silhouette <id>` | `blender/out/<id>.silhouette.png` | seconds |
| Rig only (no Blender) | `bun scripts/beasts.ts --rig-only [id ...]` | `<id>.rig.json` | under 1 s |
| Gallery close-ups, 4 x 4 per page | `bun scripts/beasts.ts --shots [page] --as before\|now` | `blender/out/shots/<label>/gallery-<n>.png` | headless Chrome |
| Fresh judge, BEFORE vs NOW | `bun scripts/beasts.ts --judge` (take `--shots --as before` first) | `blender/out/judge.md` for the PR body | about 1 min |
| Grow plants | `bun run flora [id ...] [--render]` | `public/models/flora/<id>.glb` and `<id>-lo.glb` | seconds each |
| Plant variants from seeds | `bun run flora <id> --variants 4` | `blender/out/flora/<id>.variants.png` | seconds |
| Plant lineup by biome | `bun run flora --lineup [biome ...]` | `blender/out/flora/lineup-<biome>.png` | seconds |
| Plant watch | `bun run flora <id> --watch` | GLB plus render on every save | seconds per save |
| Ground textures | `bun run ground [layer ...] [--sheet-only]` | `public/ground-tex/<layer>.jpg`, `.n.jpg`, `blender/out/ground-sheet.png`, checked against a KB budget | per layer |
| Plants, fresh judge | `bun run flora --judge` (take `bun run flora --lineup --as before` first) | `blender/out/judge-flora.md`, every biome's lineup BEFORE vs NOW | about 1 min |
| Ground, fresh judge | `bun run ground --judge` (take `bun run ground --sheet-only --as before` first) | `blender/out/judge-ground.md`, the contact sheet BEFORE vs NOW | about 1 min |
| USDZ for iOS | `bun run usdz mythic-masters` from the repo root; `bun run usdz beasts` for skinned beasts (no Blender) | `dist/ios/mythic-masters/` | per app |
| Warm vs cold, one beast | `bun scripts/warm-blender.ts [id] [--runs 3]` (on Bob: `bun run builder run apps/mythic-masters bun scripts/warm-blender.ts <id>`) | times, memory, and whether every warm GLB is byte for byte the cold one | about 10 s |
| Blender MCP (load, stats, render) | `bun scripts/blender-mcp.ts [--local]`, added to a claude run (below) | nothing: answers text and PNGs | Blender starts on the first call |
| Model diff by picture | `bun apps/codesplitter/scripts/model-review.ts [base] [head] [out.html]` | before and after renders of every changed `.glb` | per GLB |

What you can put in a sheet (`horn`, `tuft`, `skull`, `membrane`, `teeth`, ...) is listed at the top of
`blender/beast.py`. The plant knobs are at the top of `blender/flora.py`, and the ground layers are `LAYERS` in
`blender/ground.py`. Read those headers. Don't read the whole builder.

### In the browser (WebMCP and probe)

- The gallery (`?gallery=<page>`) registers WebMCP tools in `src/gallery-agent.ts`: `beast_list`, `beast_focus`,
  `beast_nudge` (dev only: `dev-beasts.ts` writes the sheet, rebuilds that one beast in a warm Blender it keeps
  open, `bun scripts/beasts.ts --serve`, and hot-swaps it) and
  `beast_silhouette`.
- `bun run probe mythic-masters --js 'mythicMasters.gallery(0)'` reads the game's state with no tab to drive.

## Rules that save a round

- **Builds are deterministic, so trust the diff.** A GLB that didn't change is a stale file, not bad luck. Each
  Blender is pinned to `-t 8` (`BLENDER_THREADS` in `scripts/beasts.ts`, #3238), because the thread count
  changes the decimated mesh. Don't take the pin off, and don't change it to fit more Blenders on a machine.
  Plants and ground never decimate, and come out byte for byte the same at `-t 1` and `-t 8` (checked on three
  plants and two ground layers, #3823), so they need no pin.
- **Several agents on one Mac take turns.** Wrap every headless Chrome or dev-server run in
  `bun scripts/heavy.ts chrome <cmd...>`: one job of a kind runs at a time, under `nice`, and the rest wait.
  One agent working alone doesn't need it.
- **One Blender per core, not all at once.** All 76 at once asked about 26 GB of a 16 GB Mac (126 s). One per
  core (`--jobs`, the default) took 98 s. Build only the sheet you changed.
- **The build is most of the time, not the start.** A single build takes 1-5 s; Blender's start is about 0.8 s
  of it on Bob (#3941). `--watch` is the fast loop. Rebuilding the whole roster is not.
- **Snap steps choose the decimation.** `SNAP_STEPS` in `beasts.ts` tries a fixed list and keeps the first
  result whose rig matches the sheet. When a row says a foot or wing is off, the sheet is the problem.
- **Always use `blender -b --factory-startup --python-exit-code 1`.** Without `--python-exit-code 1`, a Python
  traceback still exits 0 and the build looks fine. Without `--factory-startup`, a user's add-ons change the
  output.
- **Read stdout and stderr at the same time, or Blender hangs** once a pipe fills up (`splat-rooms/rooms/build.ts`).
- **Check the joint count before judging.** A part near the head can change the rigger's joints, and with them
  the gallery's held pose (Tengu, round 7 of MODEL-TOOLING.md).
- **One `limb` takes one material.** Split it at the knee or elbow when the lower leg is painted.
- **The judge varies by about ±1 point.** Use the paired judge (`--shots --as before`, then `--judge`), and
  remember that agent judges score about 2 points above the owner.

## Blender MCP: where it fits

**Ours: `scripts/blender-mcp.ts`, three named calls, no Python (#3941).** It speaks MCP on stdio on the
office Mac and forwards each call to a warm Blender (`warmBlender` in `@rustybuns/cli/blender`), on Bob over ssh
when `BUILDER_HOST` is set, else on this Mac (`--local`). Bob needs nothing but Blender: the server script
(`packages/cli/src/blender-warm.py`) goes over ssh as the first line, and a GLB goes as bytes. Blender starts on
the first call and lives as long as its stdin: when the client closes, or is killed, the ssh and Bob's Blender go
with it (checked with `kill -9` on the client).

| Tool | Arguments | Answers |
|---|---|---|
| `blender_load` | `beast` (an id) or `glb` (a path under this app) | the mesh names; an empty scene first |
| `blender_stats` | `part` (a mesh or a material: a beast is one mesh, its parts are materials) | verts, faces, triangles and size per mesh, faces and triangles per material |
| `blender_render` | `view` (front, back, left, right, top, three-quarter) or `yaw` and `pitch` degrees; `size` 64-2048 | a Workbench PNG in the beast's vertex colours |

Add it to a run: `claude mcp add blender -- bun <repo>/apps/mythic-masters/scripts/blender-mcp.ts` (user scope),
or `claude -p ... --mcp-config <file>` for one run. A Haiku worker on 2026-11-16 loaded the jackalope, counted its
antler (328 triangles) and described a left view, all on Bob. The warm Blender also takes `build {script, args}`,
a `.py` under its folder run as a fresh cold run would (`bun scripts/warm-blender.ts`); the MCP doesn't offer it.
`bun scripts/beasts.ts --watch <id>` and `--serve` (one id a line on stdin, one `@@built {id, ok, log}` line
back; the dev server's `beast_nudge` keeps one open) build through it (#3822). A failed build closes that Blender
and the next build starts a fresh one.

**What the spike measured (Bob, Blender 5.2.1, `-t 8`).**

| | squonk (9000 tris) | jackalope (5596 tris) |
|---|---|---|
| Cold build (a fresh Blender) | 2.9-3.1 s | 2.2 s |
| Warm build (same Blender, again) | 2.0-2.4 s | 1.3-1.4 s |
| Warm GLB = cold GLB, byte for byte | yes, 3 of 3 (twice) | yes, 8 of 8 |
| Blender start | 0.7 s, 233 MB idle | the same |
| Memory after the builds | 418-427 MB | 361 MB, level over 8 builds |
| 1024 px render | 0.2 s, about 555 MB while it ran | 0.2 s, 499 MB |

So warm saves about 0.8 s a build: a third of a light beast, a quarter of a heavy one. The rest is the build
itself (bake, decimate, export). On the office Mac (busy, 5.2.0) squonk took 15-20 s warm or cold, and the start
was 2 s of it. A whole MCP session over ssh (start, load, stats, a render) took 2.7 s.

**A 4th and 5th call** go in `CALLS` in `blender-warm.py`, a tool row in `blender-mcp.ts`, and a guard for its
answer: `try_modifier {name, settings}` adds one of a fixed list of modifiers (Weighted Normal, Data Transfer,
Remesh, Decimate) with only that modifier's known settings checked, and answers the new stats and a render, then
takes it off. `select_faces {material | near: [x, y, z], radius}` answers the face count, centre and size of the
faces picked, with a render that draws them in another colour. Neither needs Python from the caller.

That is right for building. A build has to come out the same in CI, on any worker and on any Mac, and an MCP
drives one open Blender that runs its calls one after another. An MCP is worth adding for **looking and poking
at one model**:

- Which face, node or part sits under a crease or a dent?
- How many faces does one part have, before and after decimation?
- Try a modifier (Weighted Normal, Data Transfer, a different remesh voxel) on a built GLB before writing it
  into `beast.py`.
- Turn the camera to the angle the judge complained about.

The loop with both: build headless (`--watch <id>`), import the GLB into the MCP's Blender, find the fix by
poking there, write it into the sheet or the builder, and build headless again. Nothing an MCP session changes
ships until a script does the same thing.

### A third-party one instead (needs the owner)

Ours covers looking. If an agent needs a free hand in Blender, these are the steps:

- **Server.** Use Blender Lab's official server (add-on v1.0.3, Blender 5.1 or newer, stdio or Streamable HTTP;
  docs at blender.org/lab/mcp-server). The community server uses the same default port, so install only one.
- **It has no guards.** It runs whatever Python the model writes inside the open Blender, and Blender Lab says
  to use it on a machine with no sensitive data on it. So add it to the owner's user-scope MCP config, never to
  a repo `.mcp.json`, where every worktree would start it.
- **codeSplitter already has the hook.** Set `CODESPLITTER_BLENDER_MCP` to the config file and
  `CODESPLITTER_BLENDER_MCP_REPOS` to the repos to allow, and a local claude run gets that server's tools
  (`apps/codesplitter/src/harness.ts`, `blenderMcpFor`). Hosted runs never get it.
- **Installing it and choosing the machine are the owner's job.** A hire prompt can say "Blender MCP is on" once
  it is.

## What to build next (most value first)

1. **`try_modifier` and `select_faces`** in the MCP, as above. (`--watch` and `beast_nudge` on the warm Blender
   are done, #3822.)
