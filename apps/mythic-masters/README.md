# Mythic Masters

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

An arena brawler of creatures from world folklore, where size and weight are real. The first eight come from the eight North American regions: the Jersey Devil, Mothman, the Hodag, Bigfoot, Champ, the Jackalope, the Rougarou and the Ozark Howler. Each has its folklore name, a body sheet drawn from its legend (the Jackalope is a 3 kg sprinter, Champ a 263 kg lake serpent), six stats (the radar chart on each card) and six moves named for what it does in its tale. Mass, height and stats give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island).

## Run it

```
bun install
cd apps/mythic-masters
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

`?a=jackalope&b=hodag&skin=volcano&watch=1` skips the picker. For an agent's browser, `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])` and `roster()`.

## The roster is data

`src/roster.json` is written by hand, one creature per legend: region, a line of the tale, archetype, elements (air, water, earth, fire, shadow, wild), mass, height, stats, six moves (light, heavy, launcher, special, beam, ultimate) and a `look`. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to those, then `bun run tune` until every pairing is 40-60%.

The `look` is a body plan (biped, quadruped, serpent, winged, swarm) and a parts list (horns, antlers, ears, snout, spikes, fins, tail, forked tail, hooves, bat or feather wings, shaggy, hunch, headless), plus a build, colours and, on four legs, leg length. `beast()` in [`packages/models`](../../packages/models/src/beasts.ts) builds the model from it with a seed, so a new creature is a line of data rather than an art job.

## Picking creatures

- Draw from the old legend, not a modern take on it. A folklore beast is public domain; a particular film's, novel's or tabletop game's version of it is not.
- Sacred figures of living religions and Indigenous beings are setting and story, never fighters, unless people from that culture say otherwise. The region list (#2708) marks them.
