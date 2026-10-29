# Skate Tech Park: the trick audit

What the sim can name today, what real skating has that it cannot, and how each missing family would fit. The sim
names a trick from numbers it already tracks (`src/sim.ts`): how far the board turned under the rider (`board`) and
flipped (`flip`), how far the rider spun (`spun`), where the deck met a bar (`at`, `rel`), which wheels are down
(`manual`), and now which end a hand holds (`grab`). A trick we can add is one those numbers already tell apart; a
trick we cannot needs a number the sim does not keep yet. Mechanics are described in our own words; the physics
stays our own.

## What the park names today

| Family | Tricks | Named by |
| --- | --- | --- |
| Pops | ollie, nollie | which foot snaps (`popT`, `nollie`) |
| Flicks (13) | kickflip, heelflip, shove-it, frontside shove-it, 360 shove-it, varial, inward heel, hardflip, varial heel, tre flip, laser flip, double kickflip, double heelflip | `board` turn and `flip` turns, the SkateBench grid (`src/tricks.ts`) |
| Flick + rider spin | big flip (tre + 180), bigspin (360 shove-it + 180), "180 kickflip" and the like | `WITH_HALF_TURN`, else the degrees go in front |
| Grabs (2) | tail grab, nose grab | the manual keys held in the air, by the second (`grab`, `grabs`) |
| Air | 180, 360, 540..., fakie, nollie, "2x" repeats | `spun`, landing speed sign, `tricks` |
| Grinds (11) | 50-50, 5-0, nosegrind, smith, feeble, crooked, overcrook, boardslide, lipslide, tailslide, noseslide; "slide" names on ledges; "180 " in front when spun in | which part of the deck is over the bar and at what angle (`grindFor`, `grindSpun`) |
| Manuals (2) | manual, nose manual | `manual`, by the second |
| Chains | x2..x8, "link" between kinds | `chain`, `comboKind` |

The grind grid, so the gaps read: a bar under one truck, nearly across the deck, is named by which truck and which
side the hanging end is on. Back truck: smith (near side) and feeble (far side). Front truck: crooked (near side)
and overcrook (far side). Straighter it is a 5-0 or a nosegrind; across it is a boardslide or a lipslide, or a
tailslide or noseslide when a tip is over the bar.

## Missing, and how each would fit

Ordered by how little the sim needs to learn.

1. **More grid cells, no new numbers.** 360 hardflip (-360, kick), nightmare flip (360, double kick), frontside
   360 shove-it (-360, none), 360 heelflip variants. Each is one row in `TRICKS`, a key in `bindings.ts` and
   `FLICK_KEYS`, a stroke in `classic` and a short label in `griptape.ts`. The keyboard is nearly full (free: `H`,
   `J`, `P`, `C`, `X`), so the next batch should go on the flick pad first.
2. **Frontside and backside.** A 180 with a kickflip is a "frontside flip" or a "backside flip" by which way the
   rider turns against their stance. The sim knows the spin's sign (`spun`) but not the stance: a flick profile is
   regular or goofy (`mirror`), the sim is not told. One field (`stance`) set from the profile would name every
   spin and spin-in grind frontside or backside, and turn "180 smith grind" into "hurricane" territory.
3. **More grabs.** Indy, melon, mute, stalefish, method and japan are a hand and a side: which hand (front or
   back) and which rail (toe or heel), with the legs tweaked. Today a grab is an end (tail or nose) because that
   is what the manual keys already mean. A second axis (steer held while grabbing picks the rail) names four more
   from the same `grab` state; the view would tuck the board the other way.
4. **Lip tricks and stalls.** Rock to fakie, axle stall, disaster, blunt to fakie, tail stall. The sim has coping
   as rails and vert airs that come back down, but a board that reaches the lip slowly flies over it or drops
   back. A stall is a catch on the coping at low speed (apex within a few tenths of a metre of the lip), held
   with the same lean as a grind, released back down the wall fakie. The name comes from `at` like a grind: a
   truck is an axle stall, the middle a rock, across is a disaster, the tail with the nose high a blunt.
5. **Bluntslides and the pitch of a slide.** Blunt, nose blunt, willy and salad grinds differ from tailslide,
   noseslide, crooked and smith by the board's pitch on the bar (tail on the bar with the nose pointed up). The
   catch reads yaw and position, not pitch. Keeping the landing pitch (`s.pitch` at the catch is already the
   air's eased pitch) and holding it through the grind would add them as four more cells in `grindFor`.
6. **Reverts and switch.** A revert is a 180 pivot on the wheels right after a landing; switch is riding with the
   other foot forward after a 180, which the sim calls fakie. Both need a stance (item 2); a revert would also be
   a short ground spin on landing, scored as a link in the chain.
7. **No-comply, boneless, footplant.** A foot leaves the board, plants, and the board follows. A different pop:
   `pop` with a foot on the ground, a shorter air, a 180 of the board carried by the hand or the foot. One new
   pop kind beside ollie and nollie, named at landing.
8. **Handplants (inverts).** A hand on the coping, the board overhead, back down the wall. A stall (item 4) with the
   rider upside down: once stalls exist, an invert is a stall with a hold time and its own pose.
9. **Wallrides.** The sim stops the board against a sheer face (`SHEER`); a wallride would let a board that hits
   a face sideways and fast keep rolling along it for a moment, then drop off. Needs the face's own heading and a
   ride-along state like a grind. Fits the earthworks' cut faces and the park wall.
10. **Pressure flips, impossibles, late flips, primo and darkslide.** Off-axis flips (the board over the foot, or
    flipped around the back foot) and sliding on the wheels' edge or upside down. Each needs an axis the sim does
    not turn about, and darkslide and primo need the board to ride on something other than its wheels or its
    deck. Furthest off.

The follow-ups are tracked in [#2789](https://github.com/QuinnsCode/RustyBuns/issues/2789).
