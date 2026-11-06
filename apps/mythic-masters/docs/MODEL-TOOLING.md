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

- **Surfaces and shading** (the builder and the game's materials): #3067. It bakes per-vertex ambient occlusion in `beast.py`, using its own ray-cast bake (24 fixed rays per vertex against a BVH, about 0.3 s a beast, deterministic). It blends `paint` and `stripes` borders in vertex colour, so they no longer step along triangle edges. It keeps body colours in a luminance band. And `stylize` in `src/beasts.ts` patches the standard material with `onBeforeCompile`: a half-Lambert warped diffuse, a warm sun with a cool sky fill, a rim light, a fade from dark feet to bright head, and a tighter highlight on horns, claws and teeth.
- **Silhouette and anatomy** (the sheets): #3072. It changes 22 sheets: bigger heads, necks and shoulders, a chest-to-hip taper on the Rougarou and Black Shuck, faces re-fitted to the grown heads, an open maw and brows on the Olgoi-Khorkhoi, and a real mid-tone hide with a light belly on the near-black beasts.

The talks and papers behind it, and what each one gives a low-poly beast:

| Source | Idea | For our beasts |
|---|---|---|
| Mitchell, Francke, Eng, "Illustrative Rendering in Team Fortress 2" (NPAR 2007; Valve's GDC talks on the same) | half-Lambert warped diffuse ramp, view-dependent rim light, value gradient dark at the feet to bright at the head, silhouette first | shading that reads at fight size with no textures; a rim that edges the beast off the arena |
| Junya Motomura, "Guilty Gear Xrd's Art Style: The X Factor Between 2D and 3D" (GDC 2015) | hand-tuned vertex normals, vertex colour driving the shadow threshold, inverted-hull outlines | smooth shading on a low-poly skin; baked occlusion that pins shadow into creases |
| Weighted and transferred normals (common practice; Blender's Weighted Normal and Data Transfer modifiers) | normals from a smooth proxy onto the low-poly mesh | parts that don't facet after decimation |
| Baked vertex ambient occlusion and cavity (Cycles bake to a colour attribute, or Dirty Vertex Colors) | occlusion stored per vertex, no runtime cost | armpits, the under-belly and where a horn meets the skull read darker |
| Silhouette and shape-language talks (Overwatch art direction, GDC 2017, and the TF2 paper's silhouette section) | one big shape per character that you can name in black fill; big, medium and small detail | exaggerate the one feature the legend names: the Hodag's spines, the Jackalope's antlers |
| Colour blocking (character-art practice) | a dominant hue, a secondary, one accent, value contrast back to belly | sixty-four beasts that don't blur into one brown |

### Scores (a fresh judge subagent each round, out of 10)

- **Surfaces, the 4 gallery pages as a set:** 4.5 to 5.5. Round 1 got 5.0 and round 2 got 5.5. Round 3 added a stepped ramp, countershading and +20% saturation, and stayed at 5.5. The judge's remaining complaints are about the sheets or need a closer camera.
- **Anatomy, beast by beast:** a paired run (the same judge saw before and after of one beast) moved 9 of 22 up a point: the Rougarou to 6, and the Afanc, Black Shuck, Mokele-mbembe, Nessie, Ozark Howler and Red Dragon to 5. The Sasabonsam and Flatwoods Monster went to 4. Thirteen stayed level and none got worse (the Fresno Nightcrawler fell in round 1 and was put back).
- **Judge noise is about ±1** between instances; the Black Shuck read 3 and 5 on the same build. One-point moves are weak evidence on their own, so a judge round should take two judges and use the paired score.

### What the spike learned

- Proportion in a skin-modifier stick figure is spent. The next gains need builder parts the sheets can't fake: heads that aren't round, legs that taper, hands and feet as shapes, wing membranes that sag (#3071).
- Not tried yet: custom or weighted normals in the Guilty Gear Xrd style, and a Cycles bake. Dark beasts (Black Shuck, Cadejo, Mothman) still read as one value, and glossy, wet and metal materials barely differ. These are follow-ups on #3067.
- `feetOf` counts anything in the bottom 15% of the height as a foot, so a taller head can turn a base into a foot. The Flatwoods Monster took 6 loops because of it.

## What a CLI would save

From the two workers' tooling logs:

| | Surfaces (Gizmo) | Anatomy (Cosmo) |
|---|---|---|
| Build | 2-4 s a beast; 60-72 s for all 76 in parallel | 8-20 s a beast; 4 min 36 s for the whole roster |
| Loops | 3 judged rounds in about an hour | 1-3 build-look loops a beast (6 on the Flatwoods Monster) |
| Looking | Chrome on `?gallery`; waited a fixed 11 s because the page has no "all loaded" signal (4 s gave half-empty pages) | contact sheets one file each; no montage of many beasts; the gallery draws them at 40 px |
| Editing | a shader NaN showed only as bloom blobs | node coordinates by hand in JSON; a radius grows the surface but not the parts on it, so eyes and teeth sink (a scratch `fitface.py` fixed it); a substring scale caught toe nodes and broke feet; two JSON layouts make script diffs noisy |
| Blender MCP | none reached the session | none reached the session |

Both logs asked for the same thing: a page that says when it's ready, a way to shoot it without driving Chrome by hand, and an edit that rebuilds one beast and swaps it in place.

The commands worth adding to `scripts/beasts.ts`:

- `bun run beasts --watch <id>`: rebuild one beast when its sheet changes and tell the dev server to reload
  that GLB (no full page reload, no lost camera).
- `bun run beasts --shots [page]`: drive a headless browser to the gallery and write the 4 pages as PNGs, so
  a judge round needs no hand-driven Chrome.
- `bun run beasts --judge`: the BEFORE and NOW shots for a fresh judge, with the score table appended to a
  file the PR body reads.
- `bun run beasts --silhouette <id>`: the contact sheet in flat black fill, the silhouette test as one command.
- `bun run beasts --scale <id> head=1.3,neck=1.2`: scale a group of node radii, with the parts on those nodes following.
- `bun run beasts --montage <ids>`: one sheet of many beasts' contact sheets, to judge a batch at once.
- The gallery sets `window.mythicMasters.galleryReady`, which a shot waits for in place of a fixed sleep.

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

### Getting more done per minute

An MCP is one open Blender and one scene, so its calls run one after another. Throughput comes from headless
runs, and an MCP is for looking at one beast. Measured on the 8-core, 16 GB office Mac (2026-11-01, under load):

| Run | Wall time | Note |
|---|---|---|
| All 76, every Blender at once (the old `Promise.all`) | 126 s | about 350 MB a Blender, about 26 GB asked of a 16 GB Mac |
| All 76, one Blender per core (`--jobs`, the default now) | 98 s | half the system time, same GLBs byte for byte |
| All 76, `--jobs 4` | 171 s | fewer than one per core leaves cores idle |
| One beast with Blender already warm | 1-5 s | a cold start is most of it |

- Build only the sheet you changed (`bun run beasts <id>`, or `--watch <id>`), not the roster.
- Blender's thread count changes the decimated mesh (Cadejo comes out different at 1, 2 and 4 threads), so
  since #3238 `scripts/beasts.ts` pins every Blender to `-t 8`, the count the committed GLBs were built with,
  and any Mac (the 64 GB builder too) now writes the same GLBs. Don't change the pin to fit more Blenders on a
  machine. The current tool list is in [BLENDER-TOOLS.md](BLENDER-TOOLS.md).

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

## Round 2: builder parts (#3071)

`blender/beast.py` has four more part kinds, documented in its header: `skull` (muzzle taper, flat crown, jaw, droop), `limb` (a tapering leg with a calf, lofted over a chain of nodes), `foot` (paw, hoof, talon, web) and `wing` (finger bones, panels whose far edge scallops and sags). Shots and paired scores: `docs/shots-2026-10-31-parts/`. Lesson: a `limb` with a big `depth` or radius reads as a slab; keep it close to the skin's own leg and use it for the taper and the hoof, not for bulk.

## Round 3: limb thighs and feet on 13 more beasts (#3093)

`limb` now eases its taper between nodes (smoothstep, not a straight cone), is narrower across than deep at the thigh and round by the ankle, closes its buried top in a dome and has 16 sides instead of 14, so a thigh reads as muscle rather than a slab. The Agropelter, Kelpie, Raiju, Sasabonsam and Wampus Cat are the sheets that use it.

Feet (13 beasts): the Chimera, Emela-ntouka, Gevaudan, Grootslang, Kongamato, Minotaur, Ninki-nanka, Puca, Sphinx, Tarasque, Troll, Wolpertinger and Zmey had no toes at all; each now has a `foot` part (paw, hoof or talon). The Hydra is left out: a talon split into extra feet in the rigger (10 of 4), and a paw nudged its head-shake just under the test bound. Not done: the issue names 40 untouched beasts; 13 of the 54 not in #3072 or #3084 were the ones with nothing at the foot, and the rest need a per-beast look (heads, brows, hands) that this round did not get to. Left in a follow-up issue.

## Round 4: thighs on four sheets, Hydra feet (#3107)

The Yule Cat, Hidebehind, Leshy and Hodag had no `limb` part, so their thighs were skin tubes. Each now has `limb` parts over its leg chains (radii 0.95 of the node, 0.8 at the foot, `depth` 1.1), and the leg nodes under them are thinned to 0.8 so the tube doesn't show through. The Hydra has feet: a small paw with no toes or claws on each foot node (the first try, a talon, rigged as 10 feet, and a toed paw broke the head-shake test; this one rigs 4/4 and passes). Feet, wing counts and the Imugi budget didn't move; `bun test ./test` passes.

Not done: skull, brow and hand detail on the rest of the roster, and paired judge scores.

## Round 5: skulls on eight more beasts, and the first paired judge scores (#3093)

The Black Shuck, Cadejo, Ozark Howler, Ushi-oni, Nue, Nessie, Red Dragon and Jackalope get a `skull`, using #3131's recipe: `width` 0.95 and `height` 0.9 of the head node, set back 0.7 of the head's radius along head to snout, `len` the head-to-snout distance plus the head's radius plus 0.4 of the snout's. Three needed their own numbers. A head on an upright neck (Nessie) sets back only 0.15 of the radius, or the back of the skull sticks out like a hammer. The Red Dragon and the Jackalope have a head sphere bigger than the recipe's skull, so theirs is about 1.35 times longer and reaches the teeth and nose that floated in front of the face.

Paired judge (`--shots --as before`, then `--judge`, now that #3495 shoots close-ups): Red Dragon 17 to 19, Rougarou 20 to 21, Jackalope 19 to 18, and the other six level, out of 30. The Rougarou's skull waits for #3499, which rebuilds the same model, so it ships with #3500. That is "same" overall and within the ±1 noise, except for the Dragon. The Mokele-mbembe also got a skull, but it scored 18 to 16 (its round head became a small block), so it was dropped. Feet and wing counts and the Imugi's 3200 budget didn't move.

Not done: the 16 beasts that still have no builder part need beaks, hands or their own head shape, not this recipe (#3500).

## Round 6: limbs and feet on four beasts with no builder parts (#3494)

The beast-detail climb's first art round on the paired judge. Four beasts from #3500's list, picked as the weakest on the gallery close-ups:

- **Mokele-mbembe:** `limb` columns from shoulder and hip down to a flared ankle (radii about 0.26, 0.19, 0.22), and three-toed `foot` pads whose nails replace the horn nails that floated under each leg. The muzzle node moves forward and the eyes sit into the head instead of standing off it. A `skull` with `flat` 0 and `snout` 0.7 (#3500's suggestion) still came out a block with a flat face, so the round head stays.
- **Curupira:** its legs were 0.01 apart and read as one ghost's tail in three-quarter view. The legs move out 0.03 to each side, and each limb is two `limb` parts, thigh in the body colour and shin or forearm in the painted colour (`heel`, `bark`). One `limb` over the whole leg covers the painted colour blocking.
- **Dokkaebi:** brute-sized `limb` arms and legs. The voxel rigger now finds 5 tips, not 6: the one it dropped was a side branch at the raised elbow. The club arm still ends at the club and both feet are found.
- **Rougarou:** the `skull` written on #3500, now that #3499 has merged.

Paired judge, out of 30: Curupira 19 to 20, Dokkaebi 20 to 22, Mokele-mbembe 21 to 22, Rougarou 19 to 21. Verdict "better". It named exactly these four and no others. Feet and wing counts didn't move.

What was learned: a `limb` takes one material. When a beast has painted lower legs or forearms, split the limb at the knee or elbow so the paint shows. On a round-headed beast, a long muzzle node and seated eyes help more than a `skull`.

## Round 7: a hooked beak on the Roc, fingers on the Mothman (#3500)

- **Roc:** the straight cone beak and the separate hook under it become one curved `horn` (80 degrees toward down, `flat` 1.5 so it's deeper than wide, 0.44 long) and a short lower mandible under it, so it reads as a raptor's hooked, open beak. The nostrils move onto the beak.
- **Mothman:** the single spike off each hand becomes three long hooked fingers and a thumb: a curved `horn` in the body's colour for each, with a claw on its end (the end point is worked out with the same arc as `tube()`, so the claw sits on the finger tip).
- **Tengu, tried and dropped:** a thicker nose root and a frowning mouth made the voxel rigger find 18 joints instead of 19, and the gallery's held pose turned it away from the camera. The judge scored it 19 to 18. Its long red nose already reads; the crow-beak idea needs a look at the rig first.

Paired judge, out of 30: Mothman 19 to 21, Roc 20 to 21 (both its notes name the wings, which didn't change; the ±1 noise applies). Feet, wing and tip counts and joint counts didn't move.

What was learned: a part near the head can change the rigger's joints, and with them the gallery's held pose. Check the joint count in the build row before judging.

## Round 8: hands on the Troll and Sasabonsam, a red-and-black Kongamato (#3516)

- **Troll:** its arms were plain sausages that ended in a stub. Each arm is one `limb` from shoulder to finger (radii 0.15, 0.1, 0.12, 0.1, so the forearm swells), with a four-toed `paw` for a hand. The legs get `limb` thighs, and frosted brow `ridge`s give it a scowl. Thin the arm and leg nodes under a `limb` to 0.8.
- **Sasabonsam:** the single iron spike that floated off each hand becomes three hooked iron fingers rooted in the hand (curved `horn`s, `off` 0, so nothing floats). Its floating jaw cones become a `teeth` part along head to jaw, with a lower row. A dark fur `tuft` runs down the body.
- **Kongamato:** black `stripes` down the back and tail, black shins and crest, a lower mandible under the beak, and `teeth` along the beak in place of three floating tooth cones.

Paired judge, out of 30: Kongamato 17 to 18, Sasabonsam 18 to 19, Troll 17 to 18. Verdict "better" (each within the ±1 noise). Feet and wing counts didn't move. Sasabonsam rigs 26 joints instead of 29, and Troll 29 with 7 tips instead of 9.

What was learned:
- `limb` radii are about 0.7 of the node radius the skin drew. The node's own radius reads as a stovepipe.
- One `limb` over a whole arm joins cleanly. Two that meet at the elbow leave a ring.
- A `paint` or `stripes` material is folded into the body colour, and so is every other part in that material: banding the Kongamato in its `wing` colour turned its membranes red. Give the bands their own palette entry.
- A `tuft` along neck to chest on the Sasabonsam made the rigger find a third foot and a third wing (3/2, 3). The body tuft alone rigs fine.
