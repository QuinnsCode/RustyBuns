# Skate Tech Park: the trick audit

What the sim can name today, what real skating has that it cannot, and how each missing family would fit. The sim
names a trick from numbers it already tracks (`src/sim.ts`): how far the board turned under the rider (`board`) and
flipped (`flip`), how far the rider spun (`spun`) and which foot is forward (`stance`), where the deck met a bar
(`at`, `rel`) and the pitch held onto it (`grindNose`), which wheels are down (`manual`), which end or rail a hand holds
(`grab`, `grabRail`), how long a board stood on the coping (`stall`) or rode a wall (`wall`). A trick we can add is one
those numbers already tell apart; a trick we cannot needs a number the sim does not keep yet. Mechanics are described
in our own words; the physics stays our own.

## What the park names today

| Family | Tricks | Named by |
| --- | --- | --- |
| Pops | ollie, nollie | which foot snaps (`popT`, `nollie`) |
| Flicks (16) | kickflip, heelflip, shove-it, frontside shove-it, 360 shove-it, frontside 360 shove-it, varial, inward heel, hardflip, 360 hardflip, varial heel, tre flip, laser flip, nightmare flip, double kickflip, double heelflip | `board` turn and `flip` turns, the SkateBench grid (`src/tricks.ts`) |
| Flick + rider spin | big flip (tre + 180), bigspin (360 shove-it + 180), "180 kickflip" and the like | `WITH_HALF_TURN`, else the degrees go in front |
| Frontside and backside | "frontside 180 kickflip", "backside bigspin", "frontside 180 50-50 grind", "backside disaster" | the spin's sign against `stance` (`sideOf`), set from the flick pad's layout (goofy layouts mirror it) |
| Grabs (8) | tail grab, nose grab; with the stick held: indy, stalefish (back hand, toe or heel rail), mute, melon (front hand), japan and method when held longer | the manual keys held in the air, the stick's side against the stance (`grab`, `grabRail`, `grabName`), by the second |
| Air | 180, 360, 540..., fakie, nollie, "2x" repeats | `spun`, landing speed sign, `tricks` |
| Grinds (15) | 50-50, 5-0, nosegrind, smith, feeble, crooked, overcrook, boardslide, lipslide, tailslide, noseslide, bluntslide, nose bluntslide, willy, salad; "slide" names on ledges; "frontside 180 " in front when spun in | which part of the deck is over the bar, at what angle, and the pitch held onto it by the manual keys at the catch (`grindFor`, `grindNose`, `grindSpun`) |
| Lip tricks (7) | rock to fakie, disaster, axle stall, tail stall, nose stall, blunt to fakie, nose blunt | a coping caught at the top of a slow wall ride (`stall`), named like a grind by `at`, `rel`, the turn in and the held end (`stallFor`) |
| Wallrides | wallride | a sheer face met going along it fast, ridden for up to a second (`wall`, `wallN`) |
| Manuals (2) | manual, nose manual | `manual`, by the second |
| Chains | x2..x8, "link" between kinds (air, grind, manual, lip, wall) | `chain`, `comboKind` |

The grind grid, so the gaps read: a bar under one truck, nearly across the deck, is named by which truck and which
side the hanging end is on. Back truck: smith (near side) and feeble (far side). Front truck: crooked (near side)
and overcrook (far side). Straighter it is a 5-0 or a nosegrind; across it is a boardslide or a lipslide, or a
tailslide or noseslide when a tip is over the bar. The pitch is a third axis: the manual key held as the board
catches the bar keeps that end high through the grind (the view holds the manual's pose), so a tailslide with the
nose up is a bluntslide, a noseslide with the nose down a nose bluntslide, a front truck with the tail dropped a
willy and a back truck with the nose dipped a salad. We read the key rather than the air's own pitch: the pitch
eases level within a few tenths of a second of leaving the ground, so at most catches it would say nothing.

Frontside and backside follow the compendium's own sign: the grid calls a positive board turn backside, so a
regular rider's positive (leftward) spin is backside too, and a goofy layout mirrors it (`sideOf` in `tricks.ts`).
The board carries no rider to look at, so the stance changes nothing but the name. The toe side is the side a
backside turn swings the nose to, which is what the stick picks for a rail grab (`toeSide`, `grabName` in `sim.ts`).

A stall is a vert air that only just clears the coping: falling back past the lip slower than `STALL_FALL` (an apex
within `STALL_REACH` of it) with nobody pushing the board over onto the deck, the coping catches it the way a bar
catches a grind, except the board keeps the heading it came up with and stands still. It is held with the stick
like a grind at walking pace, so it tips fast; a pop or a pull back (brake) drops it back down the wall it came up,
fakie, and a stall held past `STALL_MAX` drops in on its own. Along the coping (a quarter turn in) it is an axle
stall; an end held high is a blunt; a tip on the coping a tail or nose stall; turned onto it more than `STALL_TURNED`
a disaster; else a rock to fakie.

A wallride is the sheer-face stop (`SHEER`) with the part of the speed along the face kept: a tip that meets a face
while the board is going along it faster than `WALL_MIN` turns the board to lie on the wall (`faceAt` reads the
face's normal from the ground's rise where the floor jumps), the wheels `WALL_GAP` out from it, and it rides until
it drops off the foot, rises over the top or `WALL_MAX` runs out. On the ground again it is scored by the second.

## Missing, and how each would fit

Ordered by how little the sim needs to learn.

1. **Reverts and switch.** A revert is a 180 pivot on the wheels right after a landing; switch is riding with the
   other foot forward after a 180, which the sim calls fakie. The stance is there now; a revert would be a short
   ground spin on landing, scored as a link in the chain, and switch a flip of the stance after it.
2. **No-comply, boneless, footplant.** A foot leaves the board, plants, and the board follows. A different pop:
   `pop` with a foot on the ground, a shorter air, a 180 of the board carried by the hand or the foot. One new
   pop kind beside ollie and nollie, named at landing.
3. **Handplants (inverts).** A hand on the coping, the board overhead, back down the wall. A stall with the rider
   upside down: now that stalls exist, an invert is a stall with a hold time and its own pose, once there is a rider
   to pose.
4. **Pressure flips, impossibles, late flips, primo and darkslide.** Off-axis flips (the board over the foot, or
   flipped around the back foot) and sliding on the wheels' edge or upside down. Each needs an axis the sim does
   not turn about, and darkslide and primo need the board to ride on something other than its wheels or its
   deck. Furthest off.

The follow-ups are tracked in [#2789](https://github.com/QuinnsCode/RustyBuns/issues/2789).
