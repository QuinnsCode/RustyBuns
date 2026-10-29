# Mythic Masters

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

An arena brawler of creatures from world folklore, where size and weight are real. The first eight come from the eight North American regions: the Jersey Devil, Mothman, the Hodag, Bigfoot, Champ, the Jackalope, the Rougarou and the Ozark Howler. Each has its folklore name, a body sheet drawn from its legend (the Jackalope is a 3 kg sprinter, Champ a 263 kg lake serpent), six stats (the radar chart on each card) and six moves named for what it does in its tale. Mass, height and stats give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **The dive.** A flyer's heavy with fly-down held drops on the target. One that lands bounces back up out of reach; one that misses leaves the flyer on the ground beside it.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island, and one per built region).
- **64 regions of folklore.** `src/regions.ts` is the world's route, North America → Central and South America → Africa → Europe → Japan → Asia, each region with the legends it's known for. Regions 1-8 are playable, 9-16 are built but high level, and 17-64 show in the arena list as coming soon. A being held sacred today (skinwalkers, the feathered serpent, the alux, the ukuku, Mami Wata, nāga) is marked as setting and story and is never a fighter. Regions 1-16 are source-checked: pick one in the arena list and its lore page (the legend, where it comes from, the sources, and what of it is sacred) shows under it, from `src/lore.ts`.
- **An open world between the arenas.** *Walk the world* puts your pick on a supercontinent of those 64 regions pushed back together Pangaea-style, each cell's ground read from real elevation. Start in the Pine Barrens; winning a region's arena opens the roads to its neighbours. Central and South America are open but hold only wild creatures far stronger than you, and the other 48 are on the map, walled off as coming soon.

## Run it

```
bun install
cd apps/mythic-masters
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

Keyboard, touch or gamepad. On a touch screen a stick appears wherever your left thumb lands and the buttons sit under your right thumb (big: light, heavy, special, dash, jump; small: fly down, guard, charge, ultimate). A standard gamepad plays with the left stick or d-pad, A jump, X light, Y heavy, B special, LB guard, RB dash, LT fly down, RT charge, Back ultimate. All three feed the same `Input` (`src/controls.ts`). The open world walks on the keyboard for now.

`?a=jackalope&b=hodag&skin=pine-barrens&watch=1` skips the picker (`skin` is a skin name or a built region's id), and `?world=1&a=jackalope` walks the world. For an agent's browser, `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])`, `roster()`, `regions()` and `world` (`enter()`, `state()`, `travel(n)`, `reset()`).

## The world is data

Where a region sits is a row in `src/world/places.ts`: its cell on the 12 × 8 world grid, and the real place and width its ground comes from. `bun scripts/fetch-world.ts` reads every region's ground from the public Terrarium elevation tiles into `src/world/ground.json` (33 × 33 heights each, about 190 KB); `src/world/world.ts` stitches the cells into one heightfield, easing each seam into a slope, and decides where you may walk. Adding a region to the world is its row in `src/regions.ts`, a place and a fetch.

## The roster is data

`src/roster.json` is written by hand, one creature per legend: region, a line of the tale, archetype, elements (air, water, earth, fire, shadow, wild), mass, height, stats, six moves (light, heavy, launcher, special, beam, ultimate) and a `look`. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to those, then `bun run tune` until every pairing is 40-60%.

The `look` is a body plan (biped, quadruped, serpent, winged, swarm) and a parts list (horns, antlers, ears, snout, spikes, fins, tail, forked tail, hooves, bat or feather wings, shaggy, hunch, headless), plus a build, colours and, on four legs, leg length. `beast()` in [`packages/models`](../../packages/models/src/beasts.ts) builds the model from it with a seed, so a new creature is a line of data rather than an art job.

## Picking creatures

- Draw from the old legend, not a modern take on it. A folklore beast is public domain; a particular film's, novel's or tabletop game's version of it is not.
- Sacred figures of living religions and Indigenous beings are setting and story, never fighters, unless people from that culture say otherwise. `src/regions.ts` marks them.
