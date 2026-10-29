# Two Fronts: the rules redesign

A design doc, not a spec. Numbers are starting points for the sim and the table; the shape is the point.
What exists today is in the [README](../README.md); this doc says what changes. Our words: **crystal fields**
(the ore), **warrens** (the Wooka's dens and landing holds), **the Gale** (the storm), **objective points**
(what wins), **command cards** (bought with energy).

## 1. The turn, made legible

Four turns make a year, a season each: **Thaw, Highsun, Dustfall, Frost**. Turn `T` is year `ceil(T/4)`,
season `(T-1) % 4`. Points are counted every Frost. The five UI phases stay, and both sides still give
their orders at once, blind to each other's numbers.

The banner reads one line on desktop and folds to three at 390 px (year/turn/season/side · phase and
sub-step · waiting on). Every screen carries it, the hero battle's briefing included.

| Phase | Banner: phase | Banner: sub-step (one at a time) | Waiting on |
| --- | --- | --- | --- |
| 1 | `PHASE 1 of 5: MUSTER` | `Collecting energy` → `Buying cards` → `Raising troops and ships` → `Playing cards` | you |
| 2 | `PHASE 2 of 5: DEPLOY` | `Moving armies between sectors you hold` | you |
| 3 | `PHASE 3 of 5: FLEETS` | `Sending ships` → `Loading transports` → `Bombarding` | you |
| 4 | `PHASE 4 of 5: COMMIT` | `Landing on Lumen · Crystal field` (one line per landing, the place named) | you |
| 5 | `PHASE 5 of 5: BATTLES` | `Choosing your hero's battle` → `Sending orders` | you |

The pauses get their own sub-step so nobody wonders why the map is grey:

| Pause | Banner: sub-step | Waiting on |
| --- | --- | --- |
| Other seat still ordering | `PHASE 5 of 5: BATTLES · Orders sent` | `the Wooka` |
| Attacks declared | `RETREATS · 2 attacks on you, 1 of yours · Hold or pull out` | you / the Wooka |
| Hero battle (yours) | `BATTLES · Your hero: Lumen · Crystal field (ground)` | you |
| Hero battle (theirs) | `BATTLES · Wooka hero: Kessa (orbit)` | `the Wooka` |
| Deploy after fighting | `DEPLOY · Move into Lumen · Warren, or up to the front` | you |
| Collect | `COLLECT · Income · The Gale moves · Frost: points counted` | nobody, 3 s |

Full example: `YEAR 2 · TURN 6 · HIGHSUN · THUNDER MARINES (you) · PHASE 3 of 5: FLEETS · Sending ships · Waiting on: you`.

## 2. Open vs contested

Every place on the map (an orbit or a sector) is in one of three states, from the viewing side's seat.

| State | Meaning | Moving in is | Fill | Glyph |
| --- | --- | --- | --- | --- |
| **Open** | nobody of the enemy's is there (yours or empty) | a move: no fight | your colour solid, or grey if empty | `icon("map-pin")` |
| **Held** | the enemy holds it, nobody of yours there | an attack: it will be declared | enemy colour, diagonal hatch | `icon("shield")` |
| **Contested** | both sides have pieces there now | joining a fight already coming | split fill, both colours, pulsing border | `icon("swords")` |

Rules around the states:

- A declared attack turns its target **Contested** for both sides the moment the retreats pause opens, so the
  map shows every fight of the turn before a die rolls.
- An order arrow into a **Held** place carries `icon("swords")` on its bend; into an **Open** place, `icon("arrow-right")`.
  The Commit panel says the same in words: `Attack · Kessa · Warren` or `Move · Lumen · Shield`.
- Under fog, a **Held** place shows the hatch and a `icon("circle-help")` for its numbers. **Open** and **Contested**
  are never fogged: you have someone there, or nobody has. Fog hides counts, never the state.
- The orbit row of a world uses the same three states and glyphs as its sectors, so "is the sky mine" reads the same way.

## 3. Objective points

The war is won on points, not on 75% of the key sectors. Points are counted every **Frost** (the 4th turn of a year)
and once more at the war's end. Taking **every enemy capital** still wins at once.

| Source | Points | When |
| --- | --- | --- |
| Each crystal field held | 3 | every Frost |
| Each public match objective held (2 per war) | 2 | every Frost |
| Your secret objective held (1 per side) | 4 | war's end only |
| Each region held (every capital in it) | 1 | every Frost |
| Scored command cards cashed | as printed (2 to 3) | war's end |

Match objectives are drawn from the seed at the war's start from a pool per map (`Hold Kessa's capital`,
`Hold both cannons`, `Hold three spaceports`, `Hold the orbit over Kessa and Lumen`, `Hold a crystal field on each
Narrows world`). Both public ones are on the banner's side panel; the secret one is in your hand.

| Map | Turns (years) | First to | Typical close war |
| --- | --- | --- | --- |
| Intro | 8 (2) | 8 | ends on points at turn 8 |
| Short | 16 (4) | 18 | one side runs 6 a year, ends turn 12 to 16 |
| Full | 32 (8) | 36 | |
| Horde | 40 (10) | 48 | |

At the war's end the higher total wins; ties go to more crystal fields, then more capitals. Morale stays: under 30%
of the key sectors your income halves. The score bar shows `12 · 7` with a `icon("gem")` beside the field count.

## 4. Command cards

**Energy** comes in at Muster: 1 per capital, 2 per spaceport. It carries over, **capped at 10**. Hand max stays 5.
Taking 3 or more places in a turn still earns a card: the top of any one deck, free.

Buying: each deck shows its top 2 cards face up, the same for both sides (seeded). You buy in Muster; the next card
flips. A buy does not deny the other side the same card this turn (both sides order at once and blind).
Cards are played in Muster on somewhere you hold unless they say otherwise. **Scored** cards sit in your hand to the
war's end and pay if their condition holds then.

| Fleet deck `icon("rocket")` | Cost | Effect |
| --- | --- | --- |
| Trap (today's) | 2 | on an orbit or sector you hold with 1 piece: half of what attacks it blows up, and so does yours |
| Blockade runner | 3 | one landing this turn ignores the enemy fleet's cut over that world |
| Pinpoint bombardment | 3 | one bombardment this turn kills 2 per ship, and goes through a shield at full |
| Escort | 2 | your transports carry 3 armies each this turn |
| Flank | 2 | ships you send into one space battle count +1 hull this turn |
| Sky lord (scored) | 4 | hold the orbit over every world of one region at war's end: 3 points |

| Ground deck `icon("swords")` | Cost | Effect |
| --- | --- | --- |
| Weapon upgrade (today's) | 3 | a sector you hold rolls d8s defending for good, +1 turret in a hero battle |
| Muster (today's) | 3 | raise 1 army per 2 on that world, 2 at least, 4 at most |
| Dig in (today's) | 2 | cover in every ground fight across that region this turn |
| Warren raid | 3 | on a sector you hold: an enemy warren or pad next to it loses 1 army and takes no landings this turn |
| Sappers | 2 | move armies between two sectors you hold on one world that don't touch, this turn |
| Crystal baron (scored) | 4 | hold 2 crystal fields at war's end: 3 points |

| Gale deck `icon("wind")` | Cost | Effect |
| --- | --- | --- |
| Read the weather | 2 | one fogged world shows its numbers this turn |
| Forecast | 1 | see the Gale's next two moves on one planet |
| Steer the Gale | 4 | before it moves, push the Gale 1 sector either way on one planet |
| Shelter | 2 | armies on one sector ignore the Gale this turn |
| Stillness | 3 | the Gale does not move on one planet this turn |
| Eye of the storm (scored) | 3 | at war's end, more of your armies than theirs stand under the Gale: 2 points |

The AI buys from the Ground deck first, then Fleet when it holds 2+ orbits over enemy ground, and Gale when the Gale
sits one move from a crystal field it holds. It plays scored cards when it holds the condition at year 3 or later.

## 5. The Gale

Every planet with 3 or more sectors has a storm track: the Gale sits on one sector of the ring (section 6) and moves
**1 to 3 sectors clockwise** at Collect, off the seed (seed, turn, planet), so an online turn replays the same. The
map shows it as a hatched band with `icon("wind")` over the sector, and a faint arc for where it could be next turn
(three sectors; Forecast narrows it to one).

| Under the Gale | Rule |
| --- | --- |
| Armies not in a warren or a shield sector | lose 1 in 3, rounded down (3 to 5 armies lose 1, 6 to 8 lose 2) |
| Landings there | none (Blockade runner does not help: the sand does) |
| Bombardment there | none, in either direction: sand hides the ground |
| Ground attack into it from a neighbour | allowed; the defender has cover |
| Hero battle there | fought in the storm: short sight, no strikes, no gunships |
| Income from it | paid as usual |

Warrens and shields shelter; everything else is exposed, crystal fields included. So a field under the Gale costs its
holder a share of the garrison every turn it stays, and the warren beside it is where the garrison waits it out.

Galaxy-wide, one **event a year**, drawn off the seed at Thaw and announced at the Frost before (`Next year: solar
flare over The Narrows` on the banner's side panel). It lands on the year's first turn.

| Event | Effect, for that one turn |
| --- | --- |
| Solar flare | fleets in one region can't move; bombardment there still fires |
| Lane storm | one hyperlane is closed |
| Ore bloom | crystal fields pay double credits, and 1 point each to their holder at once |
| Dust year | the Gale moves 3 on every planet, and once more at Collect |
| Clear skies | fog lifts everywhere: both sides see every number |
| Quiet year | nothing; both sides get 2 energy |

## 6. The planet board

A multi-sector world is a ring of 4 to 7 territories, so the Gale can sweep round it and a landing has a "next door".
A one-sector world stays a single capital with no Gale. Ground moves and attacks go between sectors that touch on the
ring; **Sappers** is the exception.

| Sector | Income | Energy | Landing hold | Shelters from the Gale | Notes |
| --- | --- | --- | --- | --- | --- |
| Capital | 3 | 1 | no | no | raises armies; builds ships if no spaceport |
| Spaceport | 2 | 2 | yes | no | builds ships |
| Shield | 1 | 0 | no | yes | halves bombardment, strikes cut to 1 |
| Cannon | 1 | 0 | no | no | knocks 1 enemy ship a turn out of the orbit |
| Crystal field | 4 | 0 | no | no | 3 points every Frost; today's dust sea, renamed (`canyon` stays the id) |
| Jungle | 1 | 0 | no | no | holder has cover, as today |
| Warren | 1 | 0 | yes | yes | the Wooka's den; taken by the Marines it is a landing pad, same rules |

Landing costs effort:

- Armies ride **transports**: a fleet order from a system where the armies stand carries **up to 2 armies per ship**
  along a lane. Carrying is the ships' move for the turn; they arrive in the orbit and fight any space battle first.
  If they lose it, the transports turn back with their troops.
- A landing goes onto a **hold you hold** (warren, pad, spaceport), or onto a **beachhead next to one**. Holding no
  hold on that world, you may make an **assault landing** straight onto a hold the enemy holds or nobody holds: one
  place only, and only through an orbit you hold or nobody holds.
- The enemy's orbit still cuts the count as today (3 minus their ships, minus 1 per 2 turns held), the Gale closes a
  sector, and Warren raid closes a hold.
- Crystal fields have no hold. You take the warren (or spaceport) beside one and push over the ring.

Short map, Kessa and Lumen, 6 territories each. The Gale runs 1 → 2 → 3 → 4 → 5 → 6 → 1. Lumen is Kessa's mirror.

```
Kessa (Wooka at start)                    Lumen (Marines at start)

          [1 Capital]                               [1 Capital]
   [6 Jungle]      [2 Spaceport]           [6 Jungle]      [2 Warren]
   [5 Warren]      [3 Shield]              [5 Spaceport]   [3 Crystal field]
        [4 Crystal field]                         [4 Shield]
```

The full map's Tarn and Umber (today's dust seas) become 6-territory boards the same way; the other multi-sector
worlds get a warren beside their spaceport and stay at 3 or 4. The horde map's `canyon` worlds follow Tarn.

## 7. Hero in space vs hero on the planet

The hero still fights one battle a turn. What each buys:

| | Space win (orbit) | Ground win (sector) |
| --- | --- | --- |
| Holds | the orbit, and `held` starts counting | the sector, its income, its hold if it has one |
| This turn's landings below | yours land, theirs turn back | unchanged |
| Reinforcement trickle | yours in every ground battle on that world this turn | none |
| Bombardment and strikes | yours from next Collect, strikes in battles below | none |
| Survivors | ships left, scaled by hull | armies left, scaled by tickets |
| Points and cards | Sky lord progress; an orbit objective | crystal field or objective progress; a card if 3+ places fell |
| Loss costs | hero out 6 turns, blockade, bombardment to come | hero out 3 turns, the army there is gone |

When to pick which:

- **Space** when the orbit is Contested over a world where you have landings queued, or where the enemy's landings are
  coming: the sky decides who gets down and who trickles. Also when an enemy fleet of 2+ would bombard a thin garrison.
- **Ground** when a crystal field or an objective sector would be lost on the dice, when the orbit is already Open or
  safely yours, or when the Gale is on the sector (no strikes either way, so the hero's gun matters more).
- The Battles panel shows the odds of both and marks the pick that moves more points this turn with `icon("star")`.

## 8. Reinforcement trickle (proposal to sim)

Today a side holding the orbit gets a one-shot `min(40, ships × 8)` tickets of drop pods. Proposed: a **trickle**.

| Knob | Start | Meaning |
| --- | --- | --- |
| R | 10 | tickets per minute of battle per ship in the orbit |
| T | 100 | cap on tickets a side receives over the battle |
| Pod every | 30 s | delivered as drop pods, split across the posts the side holds |
| Shield held by the enemy | R halved | the shield shoots at the pods |
| Side holds no post | 0 | overrun is cut off: nothing lands, the counter pauses, resumes on a retake |
| Orbit Contested or empty | 0 for both | nobody owns the sky |

What the sim should answer (`scripts/sim.ts`, AI against AI, every sector, both ways):

1. Win rate of equal armies with 0, 1, 2, 3, 4 ships over the attacker, against today's one-shot.
2. How fast an overrun side stops receiving: a side that loses its last post inside 3 minutes should have got under 20% of T.
3. Whether T ever binds in a 15-minute battle (if never, lower it or drop it).
4. Ticket ratio at the end by ships, and whether 3+ ships makes the ground battle a formality (it should not).
5. A battle under the Gale: trickle stays, strikes and gunships go, check the defender does not run away with it.

Don't tune the numbers here; the sim agent does, and writes the result to `BattleSpec.reinforcements` as a rate and cap.

## 9. A worked turn: year 2, turn 6, Thunder Marines, short map

State: the Marines hold Aster, Brill, Corva, and on Lumen the capital, warren, spaceport and jungle; the Wooka landed
on Lumen last Frost and hold its crystal field (3) and shield (4) with 3 and 2 armies. The Gale sits on Lumen 2
(Warren). Marines: 3 ships over Corva, 2 over Lumen (the orbit is theirs), 14 credits, 3 energy carried, 5 earned.
Public objectives: `Hold both cannons`, `Hold a crystal field on each Narrows world`. Score 7 · 6.

| Step | Banner | What happens |
| --- | --- | --- |
| 1 | `YEAR 2 · TURN 6 · HIGHSUN · THUNDER MARINES (you) · PHASE 1 of 5: MUSTER · Collecting energy · Waiting on: you` | +6 energy (4 capitals, Lumen's spaceport 2) on 3 carried: 9, under the cap of 10 |
| 2 | `... PHASE 1 of 5: MUSTER · Buying cards` | buy **Shelter** (2) and **Escort** (2) from the face-up pairs; 5 energy left |
| 3 | `... PHASE 1 of 5: MUSTER · Raising troops and ships` | 2 armies at Lumen 1 Capital (4), 1 ship at Lumen 5 Spaceport (3); 7 credits left |
| 4 | `... PHASE 1 of 5: MUSTER · Playing cards` | **Shelter** on Lumen 2 Warren (the Gale is on it, 3 armies there); hold **Escort** |
| 5 | `... PHASE 2 of 5: DEPLOY · Moving armies between sectors you hold` | 2 new armies from Lumen 1 to Lumen 2 Warren, next to the crystal field: 5 there |
| 6 | `... PHASE 3 of 5: FLEETS · Sending ships` | 2 ships Corva → Kessa orbit: **Held**, so the arrow carries `icon("swords")`, an attack |
| 7 | `... PHASE 3 of 5: FLEETS · Loading transports` | none: no landing from another system this turn |
| 8 | `... PHASE 3 of 5: FLEETS · Bombarding` | 2 ships over Lumen bombard Lumen 4 Shield: 1 kill (halved through the shield), the field is not under the Gale |
| 9 | `... PHASE 4 of 5: COMMIT · Landing on Lumen · Crystal field` | ground attack over the ring, Warren → Crystal field, 4 armies: **Held**, declared |
| 10 | `... PHASE 5 of 5: BATTLES · Choosing your hero's battle` | odds: Kessa orbit 2 v 2, 48%; Lumen field 4 v 3, 55%, `icon("star")` (3 points a year). Pick **ground** |
| 11 | `... PHASE 5 of 5: BATTLES · Orders sent · Waiting on: the Wooka` | the other seat is still ordering |
| 12 | `... RETREATS · 1 attack on you, 2 of yours · Hold or pull out · Waiting on: you` | the Wooka attack Corva's orbit from Morrow; Lumen 3 and Kessa orbit now **Contested**. Hold |
| 13 | `... BATTLES · Your hero: Lumen · Crystal field (ground)` | orbit is yours: trickle at R × 2 ships; the Gale is on the warren, not the field, so strikes fire. Win, 2 armies left |
| 14 | `... DEPLOY · Move into Lumen · Crystal field, or up to the front` | 2 armies into the field, 1 stays in the warren; Kessa orbit lost on dice, 1 ship back to Corva |
| 15 | `... COLLECT · Income · The Gale moves` | +23 credits (sectors 21, Thunder Reach 2); the Gale moves 2 to Lumen 4 Shield (sheltered: no loss); event next Thaw: `Solar flare over The Narrows` |
| 16 | `YEAR 2 · TURN 7 · DUSTFALL · THUNDER MARINES (you) · PHASE 1 of 5: MUSTER · Collecting energy · Waiting on: you` | next turn; Frost is turn 8, the field pays 3 then if it is still held |

## 10. Out of scope, later

- Neutral or third-party pieces on the planet board (locals who aren't Wooka), and more than two seats.
- A Gale on one-sector worlds, or weather in the space battle.
- Trading cards or energy between seats; a card market the other side can empty.
- Lore cutscenes for the warrens (the "completely normal" family scenes) and the Gale's own radio lines.
- Desktop layouts beyond the folded banner; 390 px is the target, desktop is the stretch.
