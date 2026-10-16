# Skate Tech Park

> **What it proves:** a three.js game whose physics is a pure fixed-step sim, so the same code runs in the page and in headless tests, with no backend and a ten-line desktop config. One of the [Rusty Buns](../../README.md#see-it-work) examples.

A street skating spot at golden hour: a kicker, a funbox, a rail, and a gap no board can clear. It is one board with one physics. Ride it as a skateboard, or press Tab and the same board wears the rocket roadster: a low white wedge with ten cold-gas thrusters. They fire in time with what the board does, as if the rockets did the tricks: the four at the back on a push, a pump or a boost, the four under the corners on a pop and (unevenly) through a flip, the two at the nose on a spin, and a short burst on a landing. Tab changes only how it looks, never how it rides.

Tricks score when you land them: air time, every 180 you spin, kickflips, grinds, and riding away fakie or in reverse. Land sideways or mid-flip and you bail.

## Run it

```
cd apps/skate-tech-park
bun install
bun run dev              # in the browser
bun run desktop:dev      # as a desktop app
bun test test            # the ride, headless
```

`/?showroom` parks the roadster and circles the camera round it, to check the model against reference photos.

| Do this | Keys |
|---|---|
| Go, brake | <kbd>W</kbd> <kbd>S</kbd> |
| Steer, or spin in the air | <kbd>A</kbd> <kbd>D</kbd> |
| Jump | <kbd>Space</kbd> ollie |
| Rear jets, pump | hold <kbd>Shift</kbd>: speed along the heading, and through a transition it gains speed (fast enough up a quarter pipe and you fly off the wall and drop back down it) |
| Kickflip | <kbd>F</kbd> in the air | |
| Swap skins, back to the start | <kbd>Tab</kbd> (the ride carries on), <kbd>R</kbd> |

## How it's built

- `src/level.ts`: the `Level` the sim rides on: a height at any point, pieces, rails, spawns and bounds. `src/levels/plaza.ts` is the first one. The view meshes each piece by sampling its own height.
- `src/levels/`: skate parks on real ground. `pieces.ts` is the kit (kicker, quarter pipe, bowl, funbox, ledge, handrail, flat bar, stairs, hubba, hip, spine, and a named `gap`), each a pure height function plus rail segments. `park.ts` shrinks a [park zone](../../packages/terrain) by `TERRAIN_SCALE` (a 1 km zone becomes a ~333 m disc, at half height so cliff faces are rideable), drapes each site's kit onto the slope (a site can ask for a flat pad instead), and carries each level's gaps, goals, pickups and spawns as data. The ground makes the big features itself: a gap can be just where you leave the ground and where you land, and a goal can be to climb a cliff face. `goals.ts` watches a run (gap bonuses, combo, pickups). Levels: El Capitan Meadow, Glacier Point Rim, Old Faithful Bowl, Mariposa Grove.
- `src/sim.ts`: the ride as a pure fixed-step simulation (60 steps a second), with no three.js or DOM. It handles grounded rolling with slopes and walls, launching off lips, air with spins and flips, grinds, landings and bails, and which thrusters are firing, derived from the board's state each step.
- `src/models.ts`: the giant fingerboard (no rider) and the roadster from three.js primitives, so there is nothing to load or license. The roadster's body is a side profile extruded across its width. `src/render/skins.ts` rides either one on the same pose and swaps them on Tab; `src/render/plumes.ts` draws the exhaust out of each nozzle. `src/render/chase.ts` is the chase camera, `src/render/sky.ts` the hazy sky and far ridges, and `src/render/scenery.ts` the small pines and rocks that give a park its scale (they shrink away as the board nears).
- `src/main.ts`: the scene, the chase camera, the keys and the HUD.
