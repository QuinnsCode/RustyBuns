# Wildclash

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A creature arena brawler where size and weight are real. A 6 kg electric skirmisher, a 90 kg fire drake, a 85 kg shell tank and a 100 kg plant bruiser, each with six moves on fighting-game inputs. Mass, height and six stats (the radar chart on each card) give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **The dive.** A flyer's heavy with fly-down held drops on the target. One that lands bounces back up out of reach; one that misses leaves the flyer on the ground beside it.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island, and one per built region).
- **64 regions of folklore.** `src/regions.ts` is the world's route, North America → Central and South America → Africa → Europe → Japan → Asia → Oceania, each region with the legends it's known for. Regions 1-8 are playable, 9-16 are built but high level, and 17-64 show in the arena list as coming soon. High level is not a level gate: the roads south open like any other, but there is no arena there, only strong wild creatures that attack as you walk and send you home if you lose. A being held sacred today (skinwalkers, the feathered serpent, the alux, the ukuku, Mami Wata, the yacumama, nāga, the Rainbow Serpent) is marked as setting and story and is never a fighter. Regions 1-16 are source-checked: pick one in the arena list and its lore page (the legend, where it comes from, the sources, and what of it is sacred) shows under it, from `src/lore.ts`.
- **An open world between the arenas.** *Walk the world* puts your pick on a supercontinent of those 64 regions pushed back together Pangaea-style. Each region is a ragged piece of one coastline, not a square, and each piece's ground is read from real elevation. Start in the Pine Barrens. A piece you can't enter yet lies low and grey behind a curtain of mist; win a neighbouring arena and it rises into its real hills and colours. Crossing a border puts the region's name and its legends across the top for a moment, marked *Discovered* the first time you stand in it. The map in the corner (M or a tap for a big one) is paper fog until you walk near, and keeps what you've seen. Central and South America are open but hold only wild creatures far stronger than you, and the other 48 are on the map as coming soon.

## Run it

```
bun install
cd apps/wildclash
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

Keyboard, touch or gamepad. On a touch screen a stick appears wherever your left thumb lands and the buttons sit under your right thumb (big: light, heavy, special, dash, jump; small: fly down, guard, charge, ultimate). A standard gamepad plays with the left stick or d-pad, A jump, X light, Y heavy, B special, LB guard, RB dash, LT fly down, RT charge, Back ultimate. All three feed the same `Input` (`src/controls.ts`). In the open world the same stick walks (a light push walks slowly), a drag on the right half or the right stick turns the camera, and the one button left (or RB) runs.

`?a=volthune&b=surmire&skin=pine-barrens&watch=1` skips the picker (`skin` is a skin name or a built region's id), and `?world=1&a=volthune` walks the world. For an agent's browser, `window.wildclash` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])`, `roster()`, `regions()` and `world` (`enter()`, `state()`, `travel(n)`, `beat(n)`, `reset()`).

## The world is data

Where a region sits is a row in `src/world/places.ts`: its cell on the 12 × 8 world grid, and the real place and width its ground comes from. The grid only says who borders whom: `src/world/world.ts` grows each piece from a seed jittered off its cell through a slow warp of the plane, with the empty cells and a ring around the grid as sea, so borders and coasts are ragged. `bun scripts/fetch-world.ts` reads every region's ground from the public Terrarium elevation tiles into `src/world/ground.json` (33 × 33 heights each, about 190 KB); `src/world/world.ts` stitches the cells into one heightfield, easing each seam into a slope, and decides where you may walk. Adding a region to the world is its row in `src/regions.ts`, a place and a fetch.

## The beasts are sheets

Each archetype's body is a beast from folklore in `beasts/<id>.json`: a stick figure (nodes with a radius, links
between them, `l_` names mirrored) that Blender's skin modifier wraps in flesh, plus parts laid on it (spikes
along a chain, horns, eyes, wing membranes with `scallop` for a bat's trailing edge) and a palette. Optional:
`belly` (a palette colour the underside blends into), `blobs` (ellipsoids at nodes, for a short fat body the
skin modifier would box). One sheet always builds the same GLB. `bun run beasts` builds every sheet
(`blender/beast.py`, Blender 5 on PATH) into `public/models/<id>.glb`, renders a contact sheet (profile, front,
three-quarter, beside a 1 m post) to `blender/out/<id>.png` to judge it by eye, then runs
[auto-rig](../auto-rig/README.md)'s voxel rigger on it and writes `<id>.rig.json`: the skeleton, skin weights and
which tips are feet. The row it prints fails when a sheet's feet don't all come out as tips (a leg too short
to survive the rigger's pruning). In the arena (`src/beasts.ts`) the beast is skinned to that skeleton and posed
by closed-chain IK every frame: the root rides the fighter, the feet plant and step when left behind (quicker
steps at a sprint), and in the air the legs hang. The head looks at the other fighter, the tail lags the
turns, a heavy lunges the body forward and a launcher rears it up on its hind legs. A new creature is a new sheet, a `bun run beasts`, and a line
in `BEASTS`.

## The roster is data

`src/roster.json` is written by `bun scripts/import-roster.ts`, which reads base stats, height, weight, elements and level-up moves from a public creature-stats API and reshapes them: a new name from our own syllables, our stat axes, and six move slots (light, heavy, launcher, special, beam, ultimate), each renamed from its element and shape. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to those two tables, then `bun run tune`.
