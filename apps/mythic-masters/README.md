# Mythic Masters

> **What it proves:** a 3D arena brawler whose balance is a number, not a feeling: a deterministic 60 Hz sim that a headless bot-vs-bot tuner plays thousands of times a second. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A creature arena brawler where size and weight are real, fought by 76 beasts from folklore around the world, at least one for each of its 64 regions (the last 12 are small, common cryptids: the Snallygaster, the Dover Demon, the Hoop Snake, the Drop Bear and eight more; a 6 kg jackalope, the Jersey Devil on bat wings, a hodag and an agropelter are among them), each with six moves out of its legend on fighting-game inputs. Mass, height and six stats (the radar chart on each card) give each body its speed, turn rate, jump, stamina, armour and how far it flies when hit. So the small one can win by staying behind a slow turner, and the big one by landing a single heavy hit. The plan and the rules behind it are in [notes/game-ideas/1-creature-arena.md](../../notes/game-ideas/1-creature-arena.md).

- **Nothing hides in the air.** Flying drains stamina until you fall, the ceiling is low, everyone's launcher (heavy with jump held) reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings for three seconds.
- **The dive.** A flyer's heavy with fly-down held drops on the target. One that lands bounces back up out of reach; one that misses leaves the flyer on the ground beside it.
- **HP and launch %.** Hits take HP and build launch %, which sends the next hit further. You lose at zero HP or when you fall off the ring.
- **From behind hits harder.** Hits in a slow turner's blind spot do more damage, stun longer and ignore armour.
- **One arena, many looks.** The layout (ring, lake, ceiling) is the sim's; a skin in `src/arena.ts` only repaints it (stadium, volcano, sky island, and one per built region).
- **64 regions of folklore.** `src/regions.ts` is the world's route, North America → Central and South America → Africa → Europe → Japan → Asia → Oceania, each region with the legends it's known for. Regions 1-8 are playable, 9-16 are built but high level, and 17-64 show in the arena list as coming soon. High level is not a level gate: the roads south open like any other, but there is no arena there, only strong wild creatures that attack as you walk and send you home if you lose. A being held sacred today (skinwalkers, the feathered serpent, the alux, the ukuku, Mami Wata, the yacumama, nāga, the Rainbow Serpent) is marked as setting and story and is never a fighter. Regions 1-16 are source-checked: pick one in the arena list and its lore page (the legend, where it comes from, the sources, and what of it is sacred) shows under it, from `src/lore.ts`.
- **A journey to bind them.** *New journey* starts at the Bog Witch's door, where you take three of five commons (hodag, squonk, agropelter, jackalope, tatzelwurm). Each playable region is twelve sections along a dashed switchback trail (`src/journey.ts`, laid on the ground by `src/world/trail.ts`); the Pine Barrens' twelve run from Batsto Village to Leeds Point, where the Jersey Devil waits. You can roam a section freely, but a curtain of bog-light shuts the next one until you beat or bind the keeper on its lit stone, and every section you clear writes one true thing about the place into the compendium. Wild cryptids roam each section: walk into one to fight it, and once it's worn down press **B** to bind it with the witch's ink (three tries a fight; a mythic is half as easy). Your line-up follows you through the world, each in its own rigged beast like the wild ones and keepers (a flyer roams on the wing), and steps in one after another when the lead goes down. It holds three to start and gains a slot for every region's mythic you beat, up to six; the rest rest in the **Eldritch Compendium** (**Tab**), which also holds the bestiary and the region pages. *Versus* on the title screen is the old two-pick arena.
- **Nobody will believe this either.** The journey is played as found footage, dead straight with a lot of nonsense in it (`src/director.ts`): you and Gary were taken up by a saucer, and it put you back down in the pines with a cursed totem that wants the compendium filled. A new journey opens on tape (REC light, grain, timecode, a hand on the camera) as its beam lowers you into Batsto. The first time in a region the camera sweeps round you to a narrator's line; each trail section gets a line on tape; a keeper or a mythic waits while the camera circles it and its name slams in; and its end, a bind (*Totem: Mine.*) or the whole line-up falling holds on a sepia freeze frame before the result. Any key skips a scene. `window.mythicMasters.director` has `state()` and `skip()`.
- **The Eldritch Compendium.** Every menu is a page of an aged tome (`src/tome.css`): the title is a scroll, the Bog Witch's offer a loose sheet, a fight's outcome a torn note, and the compendium a two-page spread with ribbon bookmarks that turns a leaf when you change chapter. The bestiary keeps each cryptid under drifting ink-smoke until you meet it in the wild; met, a blurred glimpse shows through with its name; bound, its plate is inked clear (`src/compendium.ts`). Headings are Grenze Gotisch, names and buttons Covered By Your Grace, long text IM Fell English, all served from `public/fonts` (SIL OFL) so the desktop build reads the same offline.
- **An open world between the arenas.** The journey walks your line-up across a supercontinent of those 64 regions pushed back together Pangaea-style. Each region is a ragged piece of one coastline, not a square, and each piece's ground is read from real elevation. Start in the Pine Barrens. A piece you can't enter yet lies low and grey behind a curtain of mist; face it and a label over the mist names it and the arena that opens its road (a hover or tap on a grey piece of the map says the same). Win that arena and, back in the world, the camera climbs to watch the piece rise into its real hills and colours (any move skips the shot). Crossing a border puts the region's name and its legends across the top for a moment, marked *Discovered* the first time you stand in it. The map in the corner (M or a tap for a big one) is paper fog until you walk near, and keeps what you've seen. Central and South America are open but hold only wild creatures far stronger than you, and the other 48 are on the map as coming soon.
- **Every creature has a tier in `src/tiers.ts` (common, uncommon, rare, legendary, mythic, event, unknown): commons turn up most, rarer ones stand a few levels higher, event creatures roam only in their season, and an unknown is a shrouded shape whose name stays "???" until you bind it. Roam the wilds.** The world is 15 × 10 km (a region is 1.28 km across), and the ground near you is drawn every 4 m with its own hummocks, gullies and boulder fields over the real elevation, rougher in the mountains than on the plains. Each biome grows its own trees, scrub, ferns, flowers and rocks, from Skate Tech Park's scenery set. Wild creatures circle dens across each open region; on a trail a den holds one of its section's own cryptids at the section's level, and a name tag over the nearest says its level and whether it is new to your journal. Walk into one and you fight it, and bind it if you can.

- **A card for every beast.** *Bestiary* (or `?cards=1`) deals all 76 as trading cards: the beast's pictures, its six stats as a radar with the numbers on it, its body and its signature move. All 76 carry a picture: a black-and-white drawing and a colour one where an open one exists, and for the seven legends with none (Sasabonsam, Ninki Nanka, Imugi, Nian, the Beast of Bray Road, the Teakettler, the Fresno Nightcrawler) our own ink drawings from the legend (`art-src/*.svg`, rendered by `bun scripts/draw-art.ts`, CC0) (the 1909 newspaper Jersey Devil, the lumberwoods plates of 1910 and 1939, a Joris Hoefnagel horned hare from the 1570s, Toriyama Sekien's yōkai, Gustave Doré's minotaur, Ivan Bilibin's Zmey), each credited on the card. The picks are Wikimedia Commons titles in `src/art.ts`; `bun scripts/fetch-art.ts` saves a 480 px copy of each to `public/art/` and writes its artist and licence to `src/art.json`, and a test fails on a pick nobody fetched or a licence we can't use.

## Run it

```
bun install
cd apps/mythic-masters
bun run dev           # the page, at the port Vite prints
bun run tune          # bot-vs-bot win rate for every pairing (bun scripts/tune.ts 200 for more matches)
```

Laptop keyboard, mouse, touch or gamepad, all playing like a platform fighter: few buttons, and direction picks the move. The shipped keys need no mouse: WASD moves, Space jumps (a tap is a short hop), Shift dashes, and the right hand fights from the home row: J attack, K strong (with jump held: the launcher), L special (moving at them: the beam), ; guard (in the air it drops you: a fast fall, or with strong while flying the dive), U ultimate, I charge. A click attacks and a right click (a two-finger click on a trackpad) is strong. Settings has three layouts, one click each: Laptop, Mouse (the rest by the left hand: Q guard, E special, R ultimate, F charge) and Arrows (arrows move, Z X C V fight), and every key can still be moved by hand. A gamepad: A attack, B special, X jump, Y strong, RT guard, RB dash, LB ultimate, LT charge, L3 bind, and the right stick is strong too, aimed (up: launcher, down while flying: dive). On a touch screen a stick appears wherever your left thumb lands, and the buttons sit in an arc under your right thumb (attack biggest in the corner, jump above it); a thumb rolls from one button to the next without lifting. Under them the sim is tight: a press made while you're busy is kept for 8 frames and goes off on the first free one, a light that lands chains into the next light or a strong, and feet bite when you stop or turn. Everything feeds the same `Input` (`src/controls.ts`, keys in `src/binds.ts`). In the open world the same stick walks (a light push walks slowly), a drag (finger or mouse), the right stick or Q / E turns the camera, and the one button left (or RB) runs.

`?a=jackalope&b=hodag&skin=pine-barrens&watch=1` skips the picker (`skin` is a skin name or a built region's id), and `?world=1&a=jackalope` walks the world. For an agent's browser, `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(["KeyW", "KeyJ"])` (key codes or action ids), `roster()`, `regions()` and `world` (`enter()`, `state()` with your section and the wild ones near you, `travel(n)`, `teleport(x, z)`, `beat(n)`, `reset()`).

## The world is data

Where a region sits is a row in `src/world/places.ts`: its cell on the 12 × 8 world grid, and the real place and width its ground comes from. The grid only says who borders whom: `src/world/world.ts` grows each piece from a seed jittered off its cell through a slow warp of the plane, with the empty cells and a ring around the grid as sea, so borders and coasts are ragged. `bun scripts/fetch-world.ts` reads every region's ground from the public Terrarium elevation tiles into `src/world/ground.json` (33 × 33 heights each, about 190 KB); `src/world/world.ts` stitches the cells into one heightfield, easing each seam into a slope, and decides where you may walk. Adding a region to the world is its row in `src/regions.ts`, a place and a fetch.

## The beasts are sheets

Each creature is one sheet, `beasts/<id>.json`. Its body is a stick figure (nodes with a radius, links
between them, `l_` names mirrored) that Blender's skin modifier wraps in flesh, plus parts laid on it (spikes
along a chain, horns, eyes, wing membranes with `scallop` for a bat's trailing edge) and a palette. Optional:
`belly` (a palette colour the underside blends into), `blobs` (ellipsoids at nodes, for a short fat body the
skin modifier would box, in their own `material`, tilted by `rot`, merged seamlessly with `blend`). One sheet
always builds the same GLB.

More optional fields (the full list is at the top of `blender/beast.py`):

- `tuft` parts: flat, curling fur along a chain, fanned around it with `rows` and `spread`, so a back,
  mane or ruff reads shaggy rather than plated. `spikes` take `rows`, `spread`, `sweep` and `tilt` too. A tuft or spike roots `sink` of the way out to the skin, a blob's where one covers the chain.
- `scales` (overlapping flat plates along a chain, with `rows`, `spread` and `overlap`), `teeth` (cones along a
  muzzle chain's lip, upper and with `lower` the lower, mirrored for both sides), `ear` (a flat, cupped leaf with
  `tilt` and `cup`) and `ridge` (a short curved brow or lip) are the surface parts; the field list at the top of
  `blender/beast.py` has each one's fields.
- Membranes take `camber` (a cupped wing), `puff` (a flipper's thickness) and `feathers` (a row of flat
  feathers past part of the rim, each a vane rounding off to a blunt `tip`, 0.4 of its width). Horns take `curve` and `bend` (ox horns, a hooked beak) and `tip_base`
  (a club).
- `ends: 1` puts back the radius every chain end loses to smoothing (muzzles, fists, tail tips).
  `bridge: true` mends a trunk the skin modifier tears where a fat node meets several links; without it,
  put a node halfway along the link yourself.
- `paint` gives nodes' flesh another material (legs, a horn grown from nodes); `stripes` bands a chain's back.
- `offset` and `scale` move and size the whole beast. `wings` is how many wings it has: the rig keeps only
  that many of the high, wide tips (long hair and outer heads look like wings too) and the row checks it.
- A palette entry's 6th value is glow. It keeps its colour in the GLB and in the game, where a hit's flash
  no longer wipes it, and the contact sheet renders without filmic roll-off so it doesn't wash out. `bun run beasts` builds every sheet
(`blender/beast.py`, Blender 5 on PATH) into `public/models/<id>.glb`, renders a contact sheet (profile, front,
three-quarter, beside a 1 m post) to `blender/out/<id>.png` to judge it by eye, then runs
[auto-rig](../auto-rig/README.md)'s voxel rigger on it and writes `<id>.rig.json`: the skeleton, skin weights and
which tips are feet. The row it prints fails when a sheet's feet don't all come out as tips (a leg too short
to survive the rigger's pruning). In the arena (`src/beasts.ts`) the beast is skinned to that skeleton and posed
by closed-chain IK every frame: the root rides the fighter, the feet plant and step when left behind (quicker
steps at a sprint), and in the air the legs hang. The head looks at the other fighter, the tail lags the
turns, and the fighter's state poses the body: an attack coils the other way through its wind-up and snaps into
the strike by how the move looks (a slam lunges, a launcher or nova rears, a jab or beam thrusts the head, a breath
sweeps it), sized by the archetype (a bruiser twists at the hips, a tank stamps its front feet, a skirmisher crouches
deep), with wings snapping down on a slam and flaring on a rise, and a tail whipping across a swing. A hit throws
the body back, a guard and a charge crouch, a dash leans in, flight banks, and a landing squashes. `src/fx.ts`
puts each beast's element on screen: motes it sheds standing still (embers, frost mist, smoke, sparks), an aura
that brightens for a charge and blazes through an ultimate's wind-up, a trail off every swing, a breath that keeps
pouring, impacts shaped by the slot that landed them, glowing shots, and dust and prints under the feet.
`window.mythicMasters.camera("side")` stands the camera side-on to judge it. The game smooths each GLB's normals as it loads (the decimator leaves hard folds; `src/smooth.ts`) and sets a slit pupil into every `eye` ball (`src/eyes.ts`), so no sheet needs a rebuild for either. The arena draws under filmic tone mapping with a soft room light, a rim light that stays opposite the camera so dark hides keep their outline, a contact shadow under each beast and, on a desktop, bloom. A new creature is a new sheet, a `bun run beasts`, and a line
in `ROSTER` (`src/roster.ts`).


### The model loop

`bun scripts/beasts.ts --watch <id>` rebuilds a beast on every save of its sheet, and a running `bun run dev` swaps it into `?gallery` without a reload. `--silhouette <id>` writes the contact sheet in flat black (`blender/out/<id>.silhouette.png`). `--shots [page] [--as before|now]` writes the four `?gallery` pages as PNGs from headless Chrome (each waits for `shelf().ready()`, the gallery's "every beast loaded" signal, also the `gallery_ready` WebMCP tool) (`blender/out/shots/<label>/`). `--judge` shoots NOW, hands BEFORE and NOW to a fresh `claude -p` judge and writes its score table to `blender/out/judge.md` for the PR body (take BEFORE first with `--shots --as before`).

## The roster is data

The same sheet holds the fighter, written by hand from the legend: its archetype (which bot plays it), elements, height and mass, six stats, and six moves (light, heavy, launcher, special, beam, ultimate) named for what it does in its tale. The Jersey Devil's ultimate is *Up the Chimney*, the hodag's beam the *Buzzard Stench* it was said to reek of, and the agropelter's beam a *Widowmaker*, the loggers' word for a dead branch that falls on you. Frame data comes from a move's power in `src/sim.ts`; the body comes from mass and stats in `src/roster.ts`. Balancing is an edit to a sheet or to those two tables, then `bun run tune` (every pairing is 40-60% today).
