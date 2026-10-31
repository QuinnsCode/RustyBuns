# Park punch list

> **Snapshot of the first eight parks.** There are now 63 (see the README). Regenerate with `bun scripts/ride.ts` before trusting this list (#2956).

What a scripted rider found riding all eight parks (the issue says seven; the picker has eight) end to end on main at
`191ff053`, after the bigger maps, edge barrier, granite faces and vert landed. Regenerate with `bun scripts/ride.ts`
(`bun scripts/ride.ts el-capitan` for one park, `--json` for data). The rider is a script, not a person: it steers
straight at each target, so a snag can be its fault. Treat "feels off" items below as a place to look, not a verdict.

Per spawn it tours the lines, gap launches, pickups and rail run-ins within 150 m, ollies at lips, flicks a trick in
every air and holds a manual now and then, with the chase camera running behind it.

## Holds

- The sim never produced a NaN, and the rider never left a park's walls, on any park.
- The chase camera never went under the ground and never fell more than 30 m behind the board, flat out or in the air.
- Flips, grinds, manuals and gaps chain: every park reached a chain of x2 or more, El Capitan and Grand Prismatic hit x8.
- Grinds were caught on seven of the eight parks (Mariposa Grove is the exception, below).

## To fix or look at

Sheer faces the rider cannot ride up (the biggest snag clusters, checked against the height field):
- **Old Faithful**, z 98, x -44..10: ground jumps 2.6 m to 9.5 m in one step, the outside of the bowl. Ridden from the
  south it is a wall with no ramp; ~95 snags at (-16, 100).
- **El Capitan**, z 90, x -112..-65: 2.7 m to 5.0 m in one step under the rails. ~50 snags at (-53, 89).
- **Half Dome**, route points (265, 190) and (285, 215) sit on top of quarter pipes, so the "return line" cannot be
  ridden to its first beat from the front.

Clusters not checked by hand (each is 50+ snags, nearest feature in brackets):
- Glacier Point (-29, 28) and (-154, 141) [funbox, boulder]; its "plateau line" got 0 / 5 and pickups 1 / 6.
- Half Dome (139, 42) and (47, 276) [stairs, hubba]; Yosemite Falls (44, -179) [kicker], (83, 71) [funbox].
- Grand Prismatic (-79, -222) [spring runoff pipe, 31 m off] and (-146, -177) [Sinter Jump launch].
- Grand Canyon (-48, 211) [funbox]; Mariposa Grove (-110, 139) [sky rail kicker], (-60, -26) [box].

Others:
- **Mariposa Grove** caught no grind although it has two handrails and a flat bar (x -80 and x 50): check they can be ollied on.
- **Pickups**: the tour collected 0 to 4 of each park's 4 to 6. Either they sit off the lines or the 1.8 m pickup radius is tight at speed.
- **Combo goals are tiny**: goals ask for 800 to 1,200, a chained tour makes 6,000 to 140,000 (Grand Prismatic 138k at x8).
  The combo goal is met on every park in minutes; raise the targets, or cap what a chain can add.
- Named gaps (Boulder Gap, Glacier Point Gap, Valley Hop, Canyon Drop, Half Dome Face) were cleared by a tour on only
  some parks; `test/levels.test.ts` clears all of them on the proper line, so this is approach-angle, not geometry.

Not covered here: how it feels. Whether a landing is satisfying, how the camera reads at speed, and whether a line
flows are for a person with the page open.
