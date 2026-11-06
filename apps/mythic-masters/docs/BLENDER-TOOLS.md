# Blender tools: what's here, how to run it, what to build next

Mythic Masters has done more Blender work than any other app (beasts, plants, ground textures), so its tools
are listed here. Read this before a model round, so the next round starts from the tools instead of finding them
again. [MODEL-TOOLING.md](MODEL-TOOLING.md) has the beast pipeline's history and art notes. This file covers the
tools and the rules.

Blender 5.2 LTS is at `/opt/homebrew/bin/blender` on the office Mac and is on `PATH`. The builder Mac (Bob)
has it too ([MAC_SETUP.md](../../../MAC_SETUP.md)).

## The tools, one table

Run them from `apps/mythic-masters`. Everything they write to look at goes in `blender/out/` (gitignored).

| What | Command | Writes | Time |
|---|---|---|---|
| Build beasts (mesh, AO bake, decimate, rig) | `bun run beasts [id ...]` (`--render` is on) | `public/models/<id>.glb`, `<id>.rig.json`, `blender/out/<id>.png` | 1-5 s a beast warm, about 100 s for all 76 |
| Rebuild one beast on save, hot-swap it in the gallery | `bun scripts/beasts.ts --watch <id>` (with `bun run dev` up) | the same | seconds per save |
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
| Model diff by picture | `bun apps/codesplitter/scripts/model-review.ts [base] [head] [out.html]` | before and after renders of every changed `.glb` | per GLB |

What you can put in a sheet (`horn`, `tuft`, `skull`, `membrane`, `teeth`, ...) is listed at the top of
`blender/beast.py`. The plant knobs are at the top of `blender/flora.py`, and the ground layers are `LAYERS` in
`blender/ground.py`. Read those headers. Don't read the whole builder.

### In the browser (WebMCP and probe)

- The gallery (`?gallery=<page>`) registers WebMCP tools in `src/gallery-agent.ts`: `beast_list`, `beast_focus`,
  `beast_nudge` (dev only: `dev-beasts.ts` writes the sheet, rebuilds that one beast and hot-swaps it) and
  `beast_silhouette`.
- `bun run probe mythic-masters --js 'mythicMasters.gallery(0)'` reads the game's state with no tab to drive.

## Rules that save a round

- **Builds are deterministic, so trust the diff.** A GLB that didn't change is a stale file, not bad luck. Each
  Blender is pinned to `-t 8` (`BLENDER_THREADS` in `scripts/beasts.ts`, #3238), because the thread count
  changes the decimated mesh. Don't take the pin off, and don't change it to fit more Blenders on a machine.
  Plants and ground never decimate, and come out byte for byte the same at `-t 1` and `-t 8` (checked on three
  plants and two ground layers, #3823), so they need no pin.
- **One Blender per core, not all at once.** All 76 at once asked about 26 GB of a 16 GB Mac (126 s). One per
  core (`--jobs`, the default) took 98 s. Build only the sheet you changed.
- **A cold start is most of the time.** A warm single build takes 1-5 s. `--watch` is the fast loop. Rebuilding
  the whole roster is not.
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

**Today, no Blender MCP reaches the office's agents.** No worker in the 2026-10-31 spike had one, and this
session had none either (a tool search for `blender` came back empty). Every build so far was headless.

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

### Wiring one up (needs the owner)

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

1. **One shared Blender runner.** The same spawn-and-error-filter is written seven times: `beasts.ts`,
   `flora.ts`, `ground.ts`, `scripts/usdz.ts`, codeSplitter's `model-review.ts`, and splat-rooms' `build.ts` and
   `fronts.ts`. They disagree on details: the two splat-rooms scripts leave out `--python-exit-code 1`, only
   `usdz.ts` reads `BLENDER_PATH`, and each keeps a different part of the error. Move it into one helper (with `findBlender` from
   meshy-studio's `engine/blender.ts`), probably in `packages/cli`, and delete the copies. (#3821)
2. **A warm Blender.** Cold start is most of a single build. A long-running `blender -b` that takes jobs on a
   socket or stdin would make `--watch` and `beast_nudge` feel close to instant. It would also give agents a
   guarded, scripted version of what an MCP offers: named calls like `load`, `stats(part)`,
   `render(view)` and `try_modifier`, not arbitrary Python. (#3822)
3. **A Blender MCP on Bob for looking.** Once the owner installs it, write the one-model recipe above into this
   file with the tool names the server really has. (MANUAL RUN #3824)
