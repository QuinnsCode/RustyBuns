# Plants and scenery climb, round 2 (#3312)

From a distance the pitch pines looked like lollipops: a few big hexagon blobs on a bare pole. The far model (drawn past
60 m) built its crown with `masses()` in `blender/flora.py`. That is one lumpy blob per main limb, each at least
`size × 1.1 × height` across, so it came out as about 15 one-metre puffs that looked nothing like the near tree.

What changed, all in `flora/pitch-pine.json`:

- `lo_leaves: true`: the far model grows real needle tufts (one a twig, 1.3 times as big) in place of the masses.
- The crown starts lower, at 30% of the trunk instead of 40%, with 15 limbs instead of 14. The sprouts on the trunk are bigger and more frequent.
- Triangles: near 9867 -> 10642, far 1177 -> 1881. The budget is now [11000, 2000]; main was already over its 7000.

Shots, taken with the same probe body as round 1 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00,
clear weather, 12 m off `world.places(1)[0]`.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game. World state both times: 2388 near plants, 3210 far.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 3 -> 3.5. Top gap: the needle tufts are opaque hexagon puffs with flat
needle cards stuck on. They should read as soft pine brushes (an alpha-cut needle card, or a dense ring of fine needles).
