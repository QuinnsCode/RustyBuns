# Rocket Skate

> **What it proves:** a three.js game whose physics is a pure fixed-step sim, so the same code runs in the page and in headless tests, with no backend and a ten-line desktop config. One of the [Rusty Buns](../../README.md#see-it-work) examples.

A street skating spot at golden hour: a kicker, a funbox, a rail, and a gap no board can clear. Ride it on a skateboard, or press Tab and take the rocket roadster: a low white wedge with ten cold-gas thrusters fed from one air tank. Four push from the back. The main one sits behind the licence plate, which drops to uncover it. Four under the corners lift the car off the ground, and two at the nose spin it in the air. The tank refills slowly while you're on the ground.

Tricks score when you land them: air time, every 180 you spin, kickflips, grinds, and riding away fakie or in reverse. Land sideways or mid-flip and you bail.

## Run it

```
cd apps/rocket-skate
bun install
bun run dev              # in the browser
bun run desktop:dev      # as a desktop app
bun test test            # the ride, headless
```

`/?showroom` parks the roadster and circles the camera round it, to check the model against reference photos.

| Do this | On the board | In the roadster |
|---|---|---|
| Go, brake | <kbd>W</kbd> <kbd>S</kbd> | <kbd>W</kbd> <kbd>S</kbd> |
| Steer, or spin in the air | <kbd>A</kbd> <kbd>D</kbd> | <kbd>A</kbd> <kbd>D</kbd> (the nose thrusters) |
| Jump | <kbd>Space</kbd> ollie | hold <kbd>Space</kbd> for the lift thrusters |
| Boost | | hold <kbd>Shift</kbd> for the rear thrusters |
| Kickflip | <kbd>F</kbd> in the air | |
| Swap rides, back to the start | <kbd>Tab</kbd>, <kbd>R</kbd> | <kbd>Tab</kbd>, <kbd>R</kbd> |

## How it's built

- `src/spot.ts`: the spot as a list of ramps and rails. The sim reads heights from it and the view builds its meshes from the same numbers.
- `src/sim.ts`: the ride as a pure fixed-step simulation (60 steps a second), with no three.js or DOM. It handles grounded rolling with slopes and walls, launching off lips, air with spins and flips, grinds, landings and bails, and the roadster's tank and which thrusters are firing.
- `src/models.ts`: the skater, the board and the roadster from three.js primitives, so there is nothing to load or license. The roadster's body is a side profile extruded across its width. Each nozzle carries a plume that the view shows when the sim says it fires.
- `src/main.ts`: the scene, the chase camera, the keys and the HUD.
