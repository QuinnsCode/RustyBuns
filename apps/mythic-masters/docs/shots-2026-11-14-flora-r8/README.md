# Plants and scenery climb, round 8 (#4434): tried, not kept

Round 7's judge asked for the pitch pine's crown as dense, dark, rounded tuft clumps, on the far model too. This round
tried that, and the judge gave it no gain (BEFORE 3.5, NOW 3.5), so the change is not in the game. It is kept here as
`ball-tufts.patch` (`git apply` from the repo root) for a later round to build on.

What the patch does:

- `blender/flora.py`: a `ball` knob on `tuft` foliage. The needles burst from the twig tip in all directions but
  straight down, over a dark 20-triangle core (`ball_core`). The far model uses an 8-triangle lumpy diamond as its
  core (`lo_ball_core`), so it fits the 2000-triangle budget.
- `flora/pitch-pine.json`: `ball` 0.85, 28 needles in 2 tufts a twig, dark blue-green colours, a `flat` crown
  envelope, more kinked branches. Triangles: near 11954 -> 11083 (budget 12000), far 1981 -> 1971 (budget 2000).

Shots use the same probe body as rounds 1 to 7 (`docs/shots-2026-11-06-flora/shot.js`). World state both times:
2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game, main and with the patch.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`.

Judge (a fresh agent, BEFORE vs NOW): 3.5 -> 3.5. The pom-pom tufts are closer to how a pitch pine holds its
needles, and the near render reads more like one. But in the game they show as black spiky starbursts against the
sky, so the trees look harsher. Top gap: the ground. Swap the bright green spiky rosettes for dense, knee-high,
unbroken cover of low huckleberry, blueberry and scrub oak (dull olive and red-brown), with only patches of bare sand.

If a later round picks the patch up: lighten the tufts' tips and shrink the dark cores, so they read as dark green
against the sky, not black.
