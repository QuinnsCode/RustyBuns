# Wildclash

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A creature arena brawler where size and weight are real. A 6 kg electric skirmisher, a 90 kg fire drake, a 85 kg shell tank and a 100 kg plant bruiser, each with six moves on fighting-game inputs. Mass, height and six stats (the radar chart on each card) give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **An open world between the arenas.** *Walk the world* puts your pick on a supercontinent of 64 real places pushed back together Pangaea-style, each cell's ground read from real elevation. Start in the Pine Barrens; winning a region's arena opens the roads to its neighbours. Central and South America are open but hold only wild creatures far stronger than you, and Africa, Europe, Japan and Asia are on the map, coming soon.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island).

## Run it

```
bun install
cd apps/wildclash
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

`?a=volthune&b=surmire&skin=volcano&watch=1` skips the picker, and `?world=1&a=volthune` walks the world. For an agent's browser, `window.wildclash` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])`, `roster()` and `world` (`enter()`, `state()`, `travel(n)`, `reset()`).

## The world is data

A region is a row in `src/world/regions.ts`: its number, name, tier (playable, high level, coming soon), its cell on the 12 × 8 world grid, the real place and width its ground comes from, its arena skin and its folklore. `bun scripts/fetch-world.ts` reads every region's ground from the public Terrarium elevation tiles into `src/world/ground.json` (33 × 33 heights each, about 190 KB); `src/world/world.ts` stitches the cells into one heightfield, easing each seam into a slope, and decides where you may walk. Adding a region is a row, its skin and a fetch.

## The roster is data

`src/roster.json` is written by `bun scripts/import-roster.ts`, which reads base stats, height, weight, elements and level-up moves from a public creature-stats API and reshapes them: a new name from our own syllables, our stat axes, and six move slots (light, heavy, launcher, special, beam, ultimate), each renamed from its element and shape. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to those two tables, then `bun run tune`.
