# Attacks redesign: shape, tempo, and the big moves

Status: step 1 (shapes in the sim) is built; steps 2-6 are still plan, tracked in #3268. The owner's calls are under Decided at the end.

## The idea

You spend most of a fight on your feet: touching (jabs, slams, the launcher), running and dodging, and building
energy. The ranged moves are the payoff, and each one is a **shape on the ground** with its own **tempo**, the way a
tabletop game prints a template and a damage range on a stat card. A beast's moves become part of its stats: "Torrent:
column 14 m x 1.2 m, charge 1.2 s, 22-48". Two tide beasts can read the same card; a storm beast reads a different one.

## What we have today

`src/moves.ts` gives every field six slots: light, heavy, launcher (touch), special, beam (ranged), ultimate (the
signature). Power, accuracy and look are the **same per slot in every field**, so fields differ only in type matchups and
their marks (burn, chill, root). `src/sim.ts` fires every ranged move the same way: a ball (special, 0.4 m) or a fast ball
(beam, 0.6 m) that **homes** on the target, plus a few signature looks (`wave`, `rain`, `nova`) that are only drawings.
Nothing has an area, nothing charges or keeps going, and aiming means nothing because the shot steers itself.

Energy: special 15, beam 35, ultimate 100. It fills from landing hits, taking hits, and holding the Charge button.

### Controls today

The fight locks your facing to the opponent; you never aim. Every scheme holds the same actions (`binds.ts`, `controls.ts`).

| Action | Laptop (default) | Mouse preset | Trackpad | Gamepad | Touch |
|---|---|---|---|---|---|
| Move | WASD | WASD | WASD | left stick / d-pad | floating stick, left half |
| Jump / fly | Space | Space | Space | X | Jump button |
| Dash (world: run) | Shift | Shift | Shift | RB | Dash button |
| Attack (light) | J | click | click | A | Attack (biggest button) |
| Strong (heavy; jump held: launcher) | K | right click | two-finger click | Y, or flick the right stick | Strong button |
| Special (moving at them: beam) | L | E | L | B | Special button |
| Guard (air: drop / dive) | ; | Q | ; | RT | Guard button |
| Ultimate | U | R | U | LB | small star |
| Charge energy (hold) | I | F | I | LT | small bolt |
| Bind | B | B | B | L3 | small link |

Trackpad plays as the laptop layout: a click is attack, a two-finger click is strong, and in the open world a drag turns the
camera. There is also an Arrows preset (arrows move, Z X C V fight). Gamepad buttons are rebindable in the Controls dialog.

## The new model

Every move is three things: a **delivery** (what shape it covers), a **tempo** (how its damage comes out over time), and
its numbers. `Move` grows these fields; `slot` stays so the HUD, bot and puppet keep working through the move.

### Delivery

| Delivery | What it covers | Numbers on the card | Good at | Beaten by |
|---|---|---|---|---|
| **Touch** | an arc in front of you at body reach | reach, arc | close pressure, combos, free | keeping away |
| **Column** | a rectangle from you, along your facing | length x width | long range, flyers (it pitches up at them) | a sidestep (orbit) when narrow |
| **Wall** | a column wider than it is long, often travelling outward | width x depth, speed | catching a sidestep or dash | a jump, or being far |
| **Cone** | a wedge from your mouth | angle x length | close crowds, a dash in at you | backing off |
| **Blast** (lob) | a circle where the lob lands, after a flight | range, radius, flight time | a guard (it comes from above), standing still | moving off the ring on the ground; flying high |
| **Nova** | a circle around yourself | radius | being swarmed, getting space | range |

Column and wall are one shape with two numbers, so "a narrow bolt" and "a wide short wall" sit on the same scale.

**No more homing.** A shape goes where you face (or where you lob it), so a dodge is a real dodge. The lob is aimed at the
spot the opponent stands when it leaves your hand, and the landing ring shows on the ground for its whole flight. That ring,
and a faint outline of every column, cone and wall during the wind-up, is how a player reads what is coming and where to go.

### Tempo

| Tempo | How it plays | Input | Like |
|---|---|---|---|
| **Quick** | fires on the press, short wind-up, one hit | tap | a jab, a thrown rock |
| **Charge** | hold to grow it (power, and length or radius), release to fire; slow while charging; a hit cancels it | hold, release | a pressure jet, a slam |
| **Build-up** | starts weak and narrow and grows the longer you keep it on them; drains energy every tick you hold | hold | a flame stream that roars hotter |
| **Fade** (putters out) | the big hit lands at once, then it keeps going weaker until it sputters out | tap | a geyser burst, a gust that dies down |

Tempo is a damage-over-time curve, and that is how it is built: a move has a duration and a curve (spike, held then spike,
ramp up, spike then decay). The sim samples the curve every tick the shape is live.

### Damage ranges, read from the board

The card shows a **range**, like "22-48". It is not a dice roll: where you are in the shape decides it, so the sim stays
deterministic (the tuner and replays rely on it) and a good dodge always pays.

- Blast and nova: full at the centre, the low number at the edge.
- Cone: full close, low at the tip.
- Column and wall: full across, low at the far end (a wall loses strength as it travels).
- Charge: the low number is a tap, the high one a full charge. Build-up: low at the first tick, high once it is roaring.

Might and Focus still scale it (touch from Might against Guard, the rest from Focus against Will), and type matchups still lean.

### The touch moves change too

Light stays quick (the jab string). Strong becomes a **charge**: tap it for today's heavy, hold it to wind up a slower, bigger
slam (1x to 1.6x). The launcher stays quick and keeps being everyone's way back to the ledge and their anti-air.

## Slots and energy

Six slots stay, renamed where it helps: light, strong, launcher (touch), **special** (cheap ranged), **big** (the heavy
ranged move, today's beam), ultimate (the signature).

- Touch moves are free and fill energy when they land, so the fight starts physical.
- Special costs 15: a quick or fading shape to poke with.
- Big costs 35 (a charge pays on release; a build-up pays per tick, about 35 for its full run).
- Ultimate needs 100.

**Retire the Charge-energy button** (decided). Energy comes from touching and being touched (plus a trickle while standing
still), which is what makes the big moves something you earn. Its button becomes **Big**: I on the laptop, F on the mouse
preset, LT on a pad, the small bolt on touch. Special stops doubling as "beam when moving at them". Same button count, no
overloaded presses, and a charge move's hold means one thing.

**Aim:** facing stays locked to the opponent (it is what makes touch and pad play well). While charging or holding a stream,
the move stick turns the shape up to 30 degrees either side, and for a lob pushes the landing spot out or in, so you can lead a
runner or cut off a dodge. A mouse cursor aim can come later as a preset.

## Every field gets its own kit

The light, strong and launcher stay the same shape in every field. The special and big are where fields differ:

| Field | Special (15) | Big (35) |
|---|---|---|
| Ember | Ember Orb: blast, quick, r 1.5 m at 10 m | Flame Breath: cone 60 deg x 6 m, build-up |
| Tide | Bubble Shot: column 10 x 0.6 m, quick | Torrent: column 14 x 1.2 m, charge (the heavy, heavy one) |
| Gale | Wind Blade: column 12 x 0.4 m, quick, fast | Jet Stream: wall 6 m wide, travels 7 m, fade, big push |
| Stone | Stone Toss: blast, quick, r 2 m at 9 m | Sandblast: cone 45 deg x 7 m, fade |
| Frost | Hail Shard: column 9 x 0.5 m, quick | Frost Breath: cone 50 deg x 5 m, build-up, chill stacks |
| Storm | Ball Lightning: blast, quick, r 1.5 m, slow lob | Lightning Bolt: column 16 x 0.6 m, charge (longest, narrowest) |
| Grove | Seed Shot: column 10 x 0.5 m, quick | Spore Stream: blast r 3 m at 8 m, build-up (the cloud grows) |
| Venom | Acid Spit: blast, quick, r 1.2 m at 8 m | Miasma Stream: cone 70 deg x 4 m, build-up |
| Spirit | Will-o'-Wisp: column, quick, slow, the one shot that still drifts toward them | Spirit Ray: column 12 x 0.8 m, fade |
| Shadow | Dusk Orb: blast, quick, r 1.8 m at 9 m | Nightmare Ray: wall 6 m wide x 5 m, charge |
| Iron | Iron Shard: column 10 x 0.4 m, quick, chips through guard | Forge Beam: column 12 x 1 m, charge |
| Wild | Howl: nova r 3 m, quick, pushes back | Roar: cone 90 deg x 5 m, fade |

Signatures take their shape from the look they already have: `rampage` (33 of them) a charged touch rush, `beam` a charged
column, `breath` a build-up cone, `nova` a nova, `rain` a big blast lobbed at range (or a scatter of small ones), `wave` a
travelling wall. A legend can override it (`creatures.ts` already has a row per beast).

Balance: bigger area or longer reach pays in wind-up, a longer telegraph or less damage. No formula fixes that by hand:
`bun run tune 800` plays the bots, and each field's big move is tuned until it lands about the same damage per energy. The
per-creature `edge` fit runs after.

## The beast card

A move line reads like a stat block, with a small drawing of its shape:

```
Torrent        tide   column 14 x 1.2 m   charge 1.2 s   22-48   35 energy
Flame Breath   ember  cone 60 deg x 6 m   build-up 2 s   6-30    35 over its run
Stone Toss     stone  blast r 2 m @ 9 m   quick          10-20   15 energy
```

## Build order

Each step is one PR off `main` that leaves the game playable.

1. **Shapes in the sim.** `Move` gets `delivery` and its numbers; the sim tests hits against columns, walls, cones, blasts
   and novas instead of homing balls. Every move is quick for now, mapped from today's look (beam to column, breath to cone,
   rain to blast, wave to wall, nova to nova). A journey test plays a fight through `local()` and checks a sidestep dodges a
   narrow column and a step back leaves a blast.
2. **Tempo.** Charge (hold and release), build-up (hold, energy per tick) and fade, with the damage ranges. Strong becomes a
   charge. Input: the Big button replaces Charge energy on keys, pad and touch; the Controls dialog and presets follow.
3. **Field kits and signatures.** The table above in `moves.ts`, signatures from their looks, then a tune run and a fresh
   `edge` fit.
4. **Telegraphs and effects.** Ground outlines during wind-ups, the lob's landing ring, and fx for streams that grow and fade.
5. **The bot.** It picks moves by range and shape, steps out of outlines (sideways from a column, outward from a ring) and
   holds streams while they land.
6. **The card.** Move lines with shape drawings in the HUD chooser and the compendium; `probe` gets the live shapes in
   `state()`.

## Decided (owner, 2026-11-02)

- Aim: facing stays locked on the opponent, with the stick nudge while charging or holding a stream.
- Damage ranges come from where the target stands in the shape. No dice.
- The Charge-energy button becomes the Big button; energy comes from touching and being touched.
- Your own blast and nova hit you too if you stand in them; your columns, walls and cones never do.
