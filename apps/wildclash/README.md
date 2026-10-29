# Wildclash

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A creature arena brawler where size and weight are real. A 6 kg electric skirmisher, a 90 kg fire drake, a 85 kg shell tank and a 100 kg plant bruiser, each with six moves on fighting-game inputs. Mass, height and six stats (the radar chart on each card) give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **The dive.** A flyer's heavy with fly-down held drops on the target. One that lands bounces back up out of reach; one that misses leaves the flyer on the ground beside it.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island, and one per built region).
- **64 regions of folklore.** `src/regions.ts` is the world's route, North America → Central and South America → Africa → Europe → Japan → Asia, each region with the legends it's known for. Regions 1-8 are playable, 9-16 are built but high level, and 17-64 show in the arena list as coming soon. A being held sacred today (skinwalkers, the feathered serpent, Mami Wata, nāga) is marked as setting and story and is never a fighter.

## Run it

```
bun install
cd apps/wildclash
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

Keyboard, touch or gamepad. On a touch screen a stick appears wherever your left thumb lands and the buttons sit under your right thumb (big: light, heavy, special, dash, jump; small: fly down, guard, charge, ultimate). A standard gamepad plays with the left stick or d-pad, A jump, X light, Y heavy, B special, LB guard, RB dash, LT fly down, RT charge, Back ultimate. All three feed the same `Input` (`src/controls.ts`).

`?a=volthune&b=surmire&skin=pine-barrens&watch=1` skips the picker (`skin` is a skin name or a built region's id). For an agent's browser, `window.wildclash` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])`, `roster()` and `regions()`.

## The roster is data

`src/roster.json` is written by `bun scripts/import-roster.ts`, which reads base stats, height, weight, elements and level-up moves from a public creature-stats API and reshapes them: a new name from our own syllables, our stat axes, and six move slots (light, heavy, launcher, special, beam, ultimate), each renamed from its element and shape. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to those two tables, then `bun run tune`.
