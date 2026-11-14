# Plants and scenery climb, round 11 (#4452): tried, not kept

Round 10's judge asked for the crowns: darker olive, clumped, rounded needle masses with gaps between them, not open
fans of flat blades. This round took round 8's `ball-tufts.patch` and did what that round's notes said: lighter tips
and smaller cores. The judge gave it no gain (BEFORE 4.5, NOW 4.5), so the change is not in the game. It is kept here
as `starburst-tufts.patch` (`git apply` from the repo root, then `bun run flora pitch-pine`).

What the patch does:

- `blender/flora.py`: round 8's `ball` knob on `tuft` foliage, unchanged (needles burst from the twig tip in all
  directions but straight down, over a small dark core).
- `flora/pitch-pine.json`: `ball` 0.8, 40 needles in 2 tufts a twig (was 36 in 3), `ball_core` 0.16, `ball_dark`
  0.25, darker olive needles (`#2a3c22` to `#374a28`) with lighter tips (`#5a6e42`, `#647848`). Far model: 13 needles
  a tuft, `lo_width` 1.6, `lo_ball_core` 0.24. Triangles: near 8875 -> 9475 (budget 12000), far 1740 -> 1740 (2000).

Shots use the same probe body as rounds 1 to 10 (`docs/shots-2026-11-06-flora/shot.js`). World state both times:
2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game, main and with the patch.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`.

Judge (a fresh agent, BEFORE vs NOW): 4.5 -> 4.5. In the game the two shots look almost the same. In the model, the
crown is fuller, but the tufts are flat radial starbursts that read as palm or yucca fronds, not pine.

Two rounds (8 and 11) have now tried needles as blades fanned around a point, and neither gained. The next try should
change the kind of shape, not the knobs: build each tuft as a lumpy, dark olive mass (a blob like `masses()` makes,
with short needle tips only on its rim), so a crown reads as clumps with sky between them. Also start the crown higher
and make it lopsided.
