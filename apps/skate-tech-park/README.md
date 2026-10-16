# Skate Tech Park

> **What it proves:** a three.js game whose physics is a pure fixed-step sim, so the same code runs in the page and in headless tests, with no backend and a ten-line desktop config. One of the [Rusty Buns](../../README.md#see-it-work) examples.

A street skating spot at golden hour: a kicker, a funbox, a rail, and a gap no board can clear. It is one board with one physics. Ride it as a skateboard, or press Tab and the same board wears the rocket roadster: a low white wedge with ten cold-gas thrusters. They fire in time with what the board does, as if the rockets did the tricks: the four at the back on a push, a pump or a boost, the four under the corners on a pop and (unevenly) through a flip, the two at the nose on a spin, and a short burst on a landing. Tab changes only how it looks, never how it rides.

Tricks score when you land them: air time, every 180 you spin, kickflips, grinds, and riding away fakie or in reverse. Land sideways or mid-flip and you bail: you keep your momentum, slide and tumble across the ground, then stand back up.

## Weather

Every park has its own air (`weather` in its spec, moods in `src/render/weather.ts`): drifting clouds and a sun disc in the sky, fog that closes in, grain on the ground, rain streaks that lean into the wind, snow that whitens the flats, dust, mist, drifting motes, and lightning in a storm. Yosemite Falls is rainy, Half Dome snowy, the Grand Canyon dusty. Add `?weather=rain|storm|snow|dust|mist|noon|dusk|overcast|golden` to any park to change it.

## The whole park is the skate park

Beyond the hand-placed kit, every park is filled with contour ribbons (`src/levels/ribbons.ts`): a ribbon traces the hillside at one height and extrudes a profile along it (a berm, a cut bank, a channel, rollers, whoop berms) as a chain of short pieces with coping along the crest, so it follows the land instead of standing on it. A profile is a recipe with a width and a height, so one berm molds into a low roller or a tall wall, and `add`, `mirror` and `waves` make new profiles from old ones. `fill: { lines: 8 }` in a `ParkSpec` lays them across the slopes the sites leave empty, clear of spawns, gaps, trees and each other.

## Run it

```
cd apps/skate-tech-park
bun install
bun run dev              # in the browser
bun run desktop:dev      # as a desktop app
bun test test            # the ride, headless
```

## Ride together, on Cloudflare

The users button (or `?room=ABCD`) opens a room of up to four riders on the level you are on; the link is the invite. Everyone rides their own sim and sees the others as boards with a name tag, and you can run into them (`src/net/bump.ts`: pushed out and bounced). The shield button switches the room to PvE (`&pve=1`), where boards pass through each other; a room is one mode, so it is a different room from the same code with collisions. The server only relays poses, so it costs next to nothing idle. `src/edge/worker.ts` serves the built page and sends `/ws` to a `World` Durable Object per level and room code (`src/edge/world.ts`, rules in `src/net/room.ts`, the cap is `MAX_RIDERS`). Where there is no `/ws` (the dev server, the desktop app) it stays single player.

```
bun run edge:dev         # the whole thing locally, with wrangler
bun run deploy           # to Cloudflare (the owner runs this: it needs the account)
```

## Paying for finishes

Priced deck, truck and wheel finishes (looks only) are bought through Stripe Checkout (`src/edge/pay.ts`). The page asks `/api/checkout` for a hosted payment page; the Worker prices the item from the catalog, never from the page. A purchase is recorded only when Stripe's signed webhook (`/api/stripe-webhook`) says it was paid, into a `Purchases` Durable Object per player id, and the page reads it back from `/api/owned`. Players are guests: the id is the secret one kept in the browser, so clearing site data loses the purchases until accounts exist. The dev server has no Worker, so there the free test checkout is used; the desktop app can't buy priced finishes.

The owner sets this up once (agents don't touch secrets): put `STRIPE_SECRET_KEY` (a restricted key that can create Checkout Sessions) and `STRIPE_WEBHOOK_SECRET` on the Worker as secrets, through varlock and 1Password, then `bun run deploy`. In the Stripe dashboard add a webhook endpoint `https://<your worker>/api/stripe-webhook` for the event `checkout.session.completed`, and try it in test mode first with card `4242 4242 4242 4242`.

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
- `src/levels/`: skate parks on real ground. `pieces.ts` is the kit (kicker, quarter pipe, bowl, funbox, ledge, handrail, flat bar, sky rail (an impossible bar on stilts, 100 to 160 m long, fed by a kicker, in every park; a bar climbing faster than you fall still catches you from below, so steep ones land: it's a tech deck, the landscape is the toy), stairs, hubba, hip, spine, and a named `gap`), plus landscape features a snow park would cut from a mountain: a creek `halfpipe`, a `tabletop`, `rollers` to pump, a `fallenLog` with a grind along its top, an `outcrop` boulder and a `geyserCone` with a crater. Each is a pure height function plus rail segments. `park.ts` shrinks a [park zone](../../packages/terrain) by `TERRAIN_SCALE` (a 1 km zone becomes a ~333 m disc, squashed vertically so cliff faces are friendly to ride; `?real` or the mountain button gives the true height), drapes each site's kit onto the slope (a site can ask for a flat pad instead), and carries each level's gaps, goals, pickups and spawns as data. The ground makes the big features itself: a gap can be just where you leave the ground and where you land, and a goal can be to climb a cliff face. `goals.ts` watches a run (gap bonuses, combo, pickups). Levels: El Capitan Meadow, Glacier Point Rim, Old Faithful Bowl, Mariposa Grove, Half Dome, Yosemite Falls, Grand Prismatic, Grand Canyon. A new place is two steps: `bun packages/terrain/scripts/fetch-place.ts <id> "<name>" <lat> <lon>` writes its 2 km of real ground (about two seconds, any spot on Earth the public elevation tiles cover), then a short `ParkSpec` in `src/levels/` lays the kit on the flat parts and names the drops.
- `src/sim.ts`: the ride as a pure fixed-step simulation (60 steps a second), with no three.js or DOM. It handles grounded rolling with slopes and walls, launching off lips, air with spins and flips, grinds, landings and bails, and which thrusters are firing, derived from the board's state each step. The board keeps its energy: speed is along the surface and every height gained or lost is paid from it (v² - 2gh), so a halfpipe rides wall to wall and a vert wall throws the board straight up to drop back in; a landing keeps the part of the velocity along the ground, so a drop into a transition rolls away fast; the wheels rolling and the air slow it gently; a sloping rail speeds a slide up or stalls it; a carve's turn carries into the air as spin.
- `src/models.ts`: the giant fingerboard (no rider; a dished, kicked deck with a round outline, ply edge and grip, trucks with baseplate, kingpin and bushing, urethane wheels on cores; `src/parts.ts` is the catalogue and `src/parts-picker.ts` the wrench-button picker that repaints it) and the roadster from three.js primitives, so there is nothing to load or license. The roadster's body is a side profile extruded across its width. `src/render/skins.ts` rides either one on the same pose and swaps them on Tab; `src/render/plumes.ts` draws the exhaust out of each nozzle. `src/render/chase.ts` is the chase camera, `src/render/sky.ts` the painted-looking sky (a rosy band between haze and blue, a wide warm sun wash) and four layers of fir-toothed far ridges that fade into the haze, Firewatch-style, `src/render/pieces.ts` meshes every piece by sampling its own height function (painted wood, concrete, colour-blocked edges) and every rail, ledge edge and coping in steel with grind wax, two draw calls a level; and `src/render/tilt.ts` tips the board up on two wheels in a manual, shaking as the balance runs out; `src/render/scenery.ts` the small pines, rocks, aspens, stumps, cairns, trail signs, tents, bushes, ferns and wildflowers that give a park its scale: the kit sits in a flowery clearing and the forest thickens into groves past its edge (they shrink away as the board nears). `src/render/critters.ts` the wildlife: birds that burst into the air, rabbits and squirrels that bolt, and gliders wheeling overhead; they run from the rider and the camera and are never caught.
- `src/levels/scatter.ts`: fills every park with kit parts from edge to edge (a seeded, jittered grid over the bounds; flat ground only; clear of sites, trees, landmarks, spawns and gap lines). A `ParkSpec` gets it by default; `scatter: { seed, cell, fill, slope }` tunes it, `scatter: false` turns it off.
- `src/levels/thumb.ts`: the picture on each start-screen card, the level's own floor sampled into a small hillshaded, contoured height map with a survey grid; the card tilts it against the pointer for a little parallax.
- `src/shop.ts`: pay to play, for looks only. A few finishes in `parts.ts` carry a `price` (cents) and show a lock in the picker until bought; no part changes how the board rides. A `Wallet` holds what you own and takes money through a `Checkout`. The page ships a test checkout that says yes and charges nothing, and keeps the wallet in this browser. Real payments need a backend: a Worker that talks to the payment provider and holds the wallet against an account.
- `src/main.ts`: the scene, the chase camera, the keys and the HUD.
