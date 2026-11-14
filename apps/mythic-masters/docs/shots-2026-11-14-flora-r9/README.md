# Plants and scenery climb, round 9 (#4440): kept

Round 8's judge asked for the ground: no more bright green spiky rosettes, but dense, knee-high, unbroken cover of
low huckleberry, blueberry and scrub oak, dull olive and red-brown, with only patches of bare sand.

What changed, all in `src/world/flora.ts`:

- `TURF` takes a `scrub` flag. Where it is set, each turf tuft is a low leafy mound (`scrub()`): small oval leaves over
  a lumpy dome, turned outward so the mound shows leaf faces from the side. The leaves are olive and dull green, with
  about one in four red-brown, dark low down. A few bare stems come up from the foot.
- The near grass ring draws a 30-leaf mound, and the far ring a 7-leaf mound with bigger leaves (`SCRUB_LEAVES`).
  The turf is now three instanced meshes (grass, near scrub, far scrub), filled in one pass by `scatterTurf`.
- Pine Barrens turf: `scrub: true`, cover 0.5 -> 0.95, clump 1 -> 0.6 (thick cover with thinner sandy patches, not
  tussocks with bare sand between), height 0.45 -> 0.6 m, a duller colour. Other biomes are not changed.

Shots use the same probe body as rounds 1 to 8 (`docs/shots-2026-11-06-flora/shot.js`). World state both times:
2388 near plants, 3210 far.

| | tufts | triangles (last frame, every pass) | draw calls |
|---|---|---|---|
| BEFORE (main) | 8160 | 2,360,494 | 137 |
| NOW | 16133 | 2,977,577 | 138 |

The extra 0.6 M triangles come from the doubled cover. A phone on low quality stops the far ring at its plants'
reach (110 m), as before.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game, main and with this change.

Judge (a fresh agent, BEFORE vs NOW): 3.5 -> 4. The understory changed from evenly spaced bright spiky tufts to an
olive-brown scatter of leafy shrubs. That reads more like Pine Barrens scrub and fits the sandy floor. But the scrub is
still thin and flat, with too much bare sand between patches. Top gap: the canopy. The pitch pines still read as broadleaf
or palm-like fronds on thin, bare, curving trunks. Make them straighter, with thicker shaggy trunks, dark blue-green needle
clusters in irregular clumped tufts, sparse open crowns and tufts sprouting from the trunk, and fewer trees, so more
sky shows through.
