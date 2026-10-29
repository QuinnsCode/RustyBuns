# Game idea 1: Wildclash, a creature arena brawler where size and weight are real

Working title. An arena fighter for elemental creatures. The roster and moves feel like a
creature-collecting RPG, the combat is a 3D anime brawler (dash, fly, beam clashes, a charge
meter), and the stages add a bit of platform-fighter knockback and ring-outs.

The pitch: the creatures fight like animals of their size would. A 90 kg armoured tortoise with
shoulder cannons is a tank. A 6 kg electric mouse is a pinball. Type matchups still count, but they
stop deciding the fight, and the small fast creature can take down the big fire dragon by reading
it and never getting hit.

All creatures are our own designs. No licensed monsters, names or art.

## Pillars

1. **Mass is a stat you can feel.** Weight, size and top speed come from the creature's body
   rather than a level number, and they drive knockback, turning, air control, hitboxes and stamina.
2. **Every creature keeps its whole moveset.** No four-move limit. Moves sit on inputs the way a
   fighting game lays them out, so the skill is in when you use them.
3. **The underdog can win.** Matchups lean, they don't decide. The light build has to be able to
   take the heavy one down with clean play.
4. **3D arenas that matter.** Water, high ground, tall grass, rock pillars and ledges all change
   the fight, and you can knock someone out of the ring.

## The physical model

Each creature has a body sheet:

| Stat | Drives |
|---|---|
| Mass (kg) | knockback dealt and taken, grab/throw rules, ground shake, launch distance |
| Size class (S/M/L/XL) | hurtbox, how easily it's hit, which gaps and tunnels it fits |
| Top speed / acceleration | dash distance, chase and escape |
| Turn rate | how fast it can turn to follow a target; big bodies swing wide |
| Air | none / hop / glide / full flight |
| Stamina | how long it can sprint, fly or keep up a beam before it's gassed |
| Armour | super-armour on heavy attacks, chip damage through blocks |

So, as rough archetypes:

- **Heavy tank (the shell-cannon tortoise):** can't be launched far, shrugs off light hits mid-
  attack, water cannons push opponents back. Slow to turn, a huge target, falls out of the air fast.
- **Heavy bruiser (the plant-bulb behemoth):** vines grab from range, spores zone the ground,
  heals in sunlight. The slowest creature in the game, and it can't fly at all.
- **Light skirmisher (the electric mouse):** the fastest dash and the smallest hurtbox, wall-jumps,
  and can run up a big creature's back. Gets launched a long way by a single heavy hit and runs
  out of stamina if it keeps sprinting.
- **Flyer (the fire drake):** full flight and strong beams, a big wingspan hitbox. Grounded for
  a short while if a heavy hit lands on its wings.

The key matchup to tune around: the light skirmisher against the flyer. The skirmisher wins by
staying under the wings and in the blind spot behind the slow turn, and by chaining small hits
until the flyer is grounded. The flyer wins by keeping its distance and landing one big hit.

## Nothing hides in the air

A flyer is strong, never untouchable. Being airborne is a choice with a cost:

- Flight drains stamina. Out of stamina, you fall and can't take off again until you've rested on the ground.
- The arena has a low ceiling, so a hovering flyer stays in range.
- Every creature has a launcher (heavy with jump held) that reaches well overhead: the anti-air.
- Projectiles and beams home in 3D, so a grounded creature can shoot up.
- A heavy hit on a flyer clips its wings and grounds it for a few seconds.
- The only time a flyer is out of reach is mid-move, the same as anyone else.

The feel is closer to a 3D platform fighter than a turn-based one: positioning, spacing and timing,
with flight as one more movement option rather than a safe zone.

## Combat system

Borrowing the 3D anime brawler shape:

- **Lock-on 3D arena.** Free camera with a soft lock, dash in any direction, a vertical layer
  for flyers and jumpers.
- **Inputs:** light / heavy / special / guard / dash / jump-or-fly, plus a charge button.
- **Energy meter.** Hold charge to fill it. Specials and elemental moves spend it. Heavier
  creatures charge slower but their moves cost more and hit harder.
- **Full moveset.** Each creature has around 8-12 moves mapped to direction + button (forward
  special, down special, air special, and so on), plus one ultimate per bar of stored energy.
- **Beam and push clashes.** Two beams or two body slams meet and you mash or time for the
  push. Mass gives a starting edge, timing can beat it.
- **Teleport dodge / vanish.** Spend energy on a perfect-timed dodge to step behind an attack.
  Light creatures get it cheaper.
- **Combos and launchers.** A launcher sends the target up or away. You chase with a dash and
  keep the combo going. Heavy creatures can armour through a launcher once per combo.

And from platform fighters:

- **HP and launch %.** Each hit takes HP and builds launch %, which makes the next launch go further.
  Zero HP is a KO, and so is a ring-out (knocked out of the arena), whatever HP is left.
- **Hits from behind.** A hit in the blind spot behind a slow turner does more damage, stuns longer and
  goes through armour. This is how the light skirmisher beats a heavy.
- **Ledges and recovery.** Creatures that fly or jump well can recover. Heavy ones need a
  ledge grab.

## Types

Types change damage and status, but within limits:

- Super-effective is about +25%, not 2x. Resisted is about -20%. Immunities become heavy
  resistance (an electric hit on a ground type still stuns briefly).
- Elements touch the arena: water puts out fire zones and makes floors slick, electric through
  water arcs further, fire burns tall grass away, grass regrows cover.

## Modes

- **Versus:** 1v1 local and online.
- **Tag team (2v2 or a 3-creature team with switch-ins):** call in a teammate for an assist,
  switch out to recover stamina.
- **Free-for-all:** up to 4 creatures, ring-outs enabled.
- **Later:** a training dojo, a story path through the arenas, and creature growth that unlocks
  new moves instead of raising stats.

## Arenas

Like a stadium that redresses itself between rounds, one arena layout can wear many looks. The sim owns
the layout (ring, lake, ceiling); a skin only repaints it. New rules come as new layouts later.
Each one changes how the matchups play out:

- Lake: deep water favours the swimmers and makes the heavies slow.
- Canyon: tall walls and narrow passages, which the small fast creatures can use.
- Volcano: lava floor zones, updrafts for flyers.
- Forest: tall grass hides small creatures, and fire can burn it down.
- Sky platforms: small floating islands, all about ring-outs.

## Tech sketch (fits the repo)

- Browser-first 3D (three.js) so it runs in Bun's desktop build and on the web.
- Deterministic fixed-step sim (60 Hz) with rollback netcode for 1v1. One Durable Object per
  match relays inputs and stores replays. Matches are small, so cost is tiny.
- Body sheets and movesets as data (JSON/TS), so balancing is a table edit.
- The roster was first seeded from a public creature-stats API; it is now 64 creatures from world folklore,
  written by hand from the legends (`src/creatures.ts`), on twelve fields of our own with a shared move pool.
- Prototype with capsule bodies and placeholder models before any art.

## First milestone (vertical slice)

1. One arena (flat ring with a lake on one side).
2. Two creatures: the heavy tank and the light skirmisher, 6 moves each.
3. Local 1v1 with dash, guard, charge, one beam clash, ring-out.
4. Tuning harness: a headless sim that runs bot-vs-bot matches and reports win rate per matchup,
   so "the small one can win" is a number we tune toward (target 40-60%).

## Where it is

The first slice is `apps/wildclash`: one arena with three skins, four creatures from the importer,
local 1v1 against a bot, and `bun run tune` for the bot-vs-bot win rates.

## Open questions

- Decided: HP bar plus launch %.
- How many creatures at launch (8? 12?), and which archetypes are missing?
- Online from day one, or local first?
