# Beast models: how they're made, what the tools are, and where to take them

The target is a GameCube-era platform fighter: low poly, but rich shading, chunky heroic proportions,
and a silhouette you can name in black fill. This file says how a Mythic Masters beast is made today, which
tech-art ideas the 2026-10-31 spike brought in, what tools each step used, and what to build next (a CLI,
WebMCP tools on the gallery page, and a Blender MCP path for codeSplitter's agents).

## The pipeline today

| Step | Tool | Where | Time |
|---|---|---|---|
| Write the body as a stick figure: nodes with a radius, links, parts (horns, tufts, scales, teeth, ears, ridges, membranes, feathers), palette | a text editor (the agent edits JSON) | `beasts/<id>.json` | the agent's thinking time |
| Wrap it in flesh, lay the parts on it, decimate to the budget, write the GLB | headless Blender 5.2 (`blender -b --factory-startup -P blender/beast.py`): skin modifier, subdivision, a light smooth, voxel remesh for `blend`, decimate | `blender/beast.py` -> `public/models/<id>.glb` | a few seconds per beast |
| Contact sheet (profile, front, three-quarter by a 1 m post) | Blender EEVEE (`--render`) | `blender/out/<id>.png` | a few seconds more |
| Skeleton, skin weights, feet and wings | auto-rig's voxel rigger (`@rustybuns/rig`, `analyze`) | `public/models/<id>.rig.json` | under a second |
| All of the above for every sheet | `bun run beasts [--render] [id ...]` | `scripts/beasts.ts` | about 3 min for 4 sheets on a worker |
| Judge as a set, at fight size | `bun run dev`, Chrome, `?gallery=0..3` (16 per page) | `src/gallery.ts` | one screenshot per page |
| Score | a fresh judge subagent given BEFORE and NOW shots, out of 10, with no anchoring | the PR body | a minute per round |

The loop is tweak a sheet, build, look at the PNG, then look at the gallery. Builds are deterministic (edges
in sheet order, the exported mesh sorted), so a GLB that "didn't change" is a stale file, not a coin flip.

## Tech-art ideas the spike brought in

Two workers ran at once, each with a lane that doesn't touch the other's files:

- **Surfaces and shading** (the builder and the game's materials): <!-- LANE A PR -->
- **Silhouette and anatomy** (the sheets): <!-- LANE B PR -->

The talks and papers behind it, and what each one gives a low-poly beast:

| Source | Idea | For our beasts |
|---|---|---|
| Mitchell, Francke, Eng, "Illustrative Rendering in Team Fortress 2" (NPAR 2007; Valve's GDC talks on the same) | half-Lambert warped diffuse ramp, view-dependent rim light, value gradient dark at the feet to bright at the head, silhouette first | shading that reads at fight size with no textures; a rim that edges the beast off the arena |
| Junya Motomura, "Guilty Gear Xrd's Art Style: The X Factor Between 2D and 3D" (GDC 2015) | hand-tuned vertex normals, vertex colour driving the shadow threshold, inverted-hull outlines | smooth shading on a low-poly skin; baked occlusion that pins shadow into creases |
| Weighted and transferred normals (common practice; Blender's Weighted Normal and Data Transfer modifiers) | normals from a smooth proxy onto the low-poly mesh | parts that don't facet after decimation |
| Baked vertex ambient occlusion and cavity (Cycles bake to a colour attribute, or Dirty Vertex Colors) | occlusion stored per vertex, no runtime cost | armpits, the under-belly and where a horn meets the skull read darker |
| Silhouette and shape-language talks (Overwatch art direction, GDC 2017, and the TF2 paper's silhouette section) | one big shape per character that you can name in black fill; big, medium and small detail | exaggerate the one feature the legend names: the Hodag's spines, the Jackalope's antlers |
| Colour blocking (character-art practice) | a dominant hue, a secondary, one accent, value contrast back to belly | sixty-four beasts that don't blur into one brown |

<!-- SCORES -->

## What a CLI would save

The workers' tooling logs are summed up here. <!-- TOOLING LOGS -->

The commands worth adding to `scripts/beasts.ts`:

- `bun run beasts --watch <id>`: rebuild one beast when its sheet changes and tell the dev server to reload
  that GLB (no full page reload, no lost camera).
- `bun run beasts --shots [page]`: drive a headless browser to the gallery and write the 4 pages as PNGs, so
  a judge round needs no hand-driven Chrome.
- `bun run beasts --judge`: the BEFORE and NOW shots for a fresh judge, with the score table appended to a
  file the PR body reads.
- `bun run beasts --silhouette <id>`: the contact sheet in flat black fill, the silhouette test as one command.

## WebMCP tools on the gallery page

The gallery is where the beasts get judged, so an agent in a signed-in browser should be able to work there
the way Skate Tech Park's `src/agent.ts` and Park Hide & Seek register theirs (`document.modelContext`, nothing
registers when the browser doesn't have it). Tools:

- `beast_list`: the page's beasts with their sheet ids, budgets, triangle counts, feet and wings.
- `beast_focus(id, view)`: one beast filling the frame, side, front or three-quarter, with the light fixed.
- `beast_nudge(id, node, dx, dy, dz, dr)`: move or swell one node in the sheet. In dev it posts to a dev-server
  route that writes the sheet and runs the one-beast build, then hot-swaps the GLB. In production it's absent.
- `beast_silhouette(on)`: every beast in flat black fill.
- `gallery_page(n)`: switch pages.

The nudge round trip (edit, build, swap) is the step the workers spent most of their time on by hand.

## Blender MCP, and codeSplitter

There are two Blender MCP servers in 2026:

- **Blender Lab's official server** (projects.blender.org/lab/blender_mcp, docs at blender.org/lab/mcp-server):
  a Blender add-on (v1.0.3, Blender 5.1 or newer) and an MCP server (stdio or Streamable HTTP, no auth). It runs
  LLM-written Python in the open Blender with no guards, and Blender Lab says to use a VM or a machine with no
  sensitive data on it.
- **The community server** (formerly blender-mcp by Siddharth Ahuja, renamed in September 2026). It uses the same
  default port as the official add-on, so run one or the other.

Neither reached the agents in this spike. Both workers searched for one, and headless Blender stayed the loop.
That's the right default for builds, because a build has to run the same in CI and on any worker. An MCP adds
looking and poking at a live scene: picking the node under a crease, reading the face count of one part,
trying a modifier before it goes into the builder.

For codeSplitter, in order of value against cost:

1. **Model review in the diff.** When an agent's change touches a sheet or a GLB, render the before and after
   contact sheets in the review and put them side by side, the way codeSplitter already puts code diffs. A
   reviewer (human or agent) judges a model change by looking, not by reading a JSON diff of node coordinates.
   This fits the judged areas directly: agent review and conflict handling. The render is headless Blender on
   whatever runs the checks.
2. **Hand the user's Blender MCP to local agent runs.** codeSplitter's local sandbox runs the agent CLI on this
   machine, so it can pass the user's own Blender MCP config to the agent (`--mcp-config` for Claude Code). It's
   opt-in per repo, and off by default because of the no-guards warning above. An agent editing a sheet can
   then open the build in the user's Blender, look, and nudge.
3. **Blender in the Cloudflare container sandbox.** The container image would carry headless Blender, about
   400 MB, so cloud agent runs could build and render too. It costs image size and container minutes, so it
   needs a price check first and a cap.

Follow-up issues: the CLI is #3053, the gallery WebMCP tools are #3054, and codeSplitter model review plus Blender MCP is #3055.
