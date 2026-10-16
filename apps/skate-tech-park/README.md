# Skate Tech Park

> **What it proves:** a three.js game whose physics is a pure fixed-step sim, so the same code runs in the page and in headless tests, with no backend and a ten-line desktop config. One of the [Rusty Buns](../../README.md#see-it-work) examples.

A street skating spot at golden hour: a kicker, a funbox, a rail, and a gap no board can clear. It is one board with one physics. Ride it as a skateboard, or press Tab and the same board wears the rocket roadster: a low white wedge with ten cold-gas thrusters. They fire in time with what the board does, as if the rockets did the tricks: the four at the back on a push, a pump or a boost, the four under the corners on a pop and (unevenly) through a flip, the two at the nose on a spin, and a short burst on a landing. Tab changes only how it looks, never how it rides.

Tricks score when you land them: air time, every 180 you spin, kickflips, grinds, and riding away fakie or in reverse. Land sideways or mid-flip and you bail: you keep your momentum, slide and tumble across the ground, then stand back up.

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
| Jump | <kbd>Space</kbd> ollie: the tail snaps, the nose kicks up and the board levels itself in the air. A ring pulses where each foot works the board (orange the back foot, white the front), like a screen recorder shows clicks. A flip that is nearly round when it lands is caught flat |
| Rear jets, pump | hold <kbd>Shift</kbd>: speed along the heading, and through a transition it gains speed (fast enough up a quarter pipe and you fly off the wall and drop back down it) |
| Kickflip | <kbd>F</kbd> in the air | |
| Manual, nose manual | hold <kbd>Q</kbd> / <kbd>Z</kbd> on the ground (or hold the mouse still for 0.3 s, nudged down for the nose, or the pad right / left trigger); <kbd>W</kbd> / <kbd>S</kbd> hold the balance. Let go to score it, and it keeps your combo alive || Swap skins, back to the start | <kbd>Tab</kbd> (the ride carries on), <kbd>R</kbd> |

## How it's built

- `src/level.ts`: the `Level` the sim rides on: a height at any point, pieces, rails, spawns and bounds. `src/levels/plaza.ts` is the training plaza, but the game opens in a national park (El Capitan Meadow) unless `?level=` says otherwise. The view meshes each piece by sampling its own height.
- `src/levels/`: skate parks on real ground. `pieces.ts` is the kit (kicker, quarter pipe, bowl, funbox, ledge, handrail, flat bar, sky rail (an impossible bar on stilts, 160 m long, fed by a kicker: it's a tech deck, the landscape is the toy), stairs, hubba, hip, spine, and a named `gap`), plus landscape features a snow park would cut from a mountain: a creek `halfpipe`, a `tabletop`, `rollers` to pump, a `fallenLog` with a grind along its top, an `outcrop` boulder and a `geyserCone` with a crater. Each is a pure height function plus rail segments. `park.ts` shrinks a [park zone](../../packages/terrain) by `TERRAIN_SCALE` (a 1 km zone becomes a ~333 m disc, at half height so cliff faces are rideable), drapes each site's kit onto the slope (a site can ask for a flat pad instead), and carries each level's gaps, goals, pickups and spawns as data. The ground makes the big features itself: a gap can be just where you leave the ground and where you land, and a goal can be to climb a cliff face. `goals.ts` watches a run (gap bonuses, combo, pickups). Levels: El Capitan Meadow, Glacier Point Rim, Old Faithful Bowl, Mariposa Grove, Half Dome, Yosemite Falls, Grand Prismatic, Grand Canyon. A new place is two steps: `bun packages/terrain/scripts/fetch-place.ts <id> "<name>" <lat> <lon>` writes its 2 km of real ground (about two seconds, any spot on Earth the public elevation tiles cover), then a short `ParkSpec` in `src/levels/` lays the kit on the flat parts and names the drops.
- `src/sim.ts`: the ride as a pure fixed-step simulation (60 steps a second), with no three.js or DOM. It handles grounded rolling with slopes and walls, launching off lips, air with spins and flips, grinds, landings and bails, and which thrusters are firing, derived from the board's state each step.
- `src/models.ts`: the giant fingerboard (no rider; a dished, kicked deck with a round outline, ply edge and grip, trucks with baseplate, kingpin and bushing, urethane wheels on cores; `src/parts.ts` is the catalogue and `src/parts-picker.ts` the wrench-button picker that repaints it) and the roadster from three.js primitives, so there is nothing to load or license. The roadster's body is a side profile extruded across its width. `src/render/skins.ts` rides either one on the same pose and swaps them on Tab; `src/render/plumes.ts` draws the exhaust out of each nozzle. `src/render/chase.ts` is the chase camera, `src/render/sky.ts` the hazy sky and far ridges, `src/render/pieces.ts` meshes every piece by sampling its own height function (painted wood, concrete, colour-blocked edges) and every rail, ledge edge and coping in steel with grind wax, two draw calls a level; and `src/render/tilt.ts` tips the board up on two wheels in a manual, shaking as the balance runs out; `src/render/scenery.ts` the small pines, rocks, aspens, stumps, cairns, trail signs, tents, bushes, ferns and wildflowers that give a park its scale: the kit sits in a flowery clearing and the forest thickens into groves past its edge (they shrink away as the board nears). `src/render/critters.ts` the wildlife: birds that burst into the air, rabbits and squirrels that bolt, and gliders wheeling overhead; they run from the rider and the camera and are never caught.
- `src/shop.ts`: pay to play, for looks only. A few finishes in `parts.ts` carry a `price` (cents) and show a lock in the picker until bought; no part changes how the board rides. A `Wallet` holds what you own and takes money through a `Checkout`. The page ships a test checkout that says yes and charges nothing, and keeps the wallet in this browser. Real payments, and making it multiplayer, both need a backend this app does not have yet (it runs entirely in the page): a Worker that talks to the payment provider and holds the wallet against an account, and a room per level that relays each rider's pose.
- `src/main.ts`: the scene, the chase camera, the keys and the HUD.
