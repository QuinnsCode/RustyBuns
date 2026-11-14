# Plants and scenery climb, round 4 (#4395)

Past 60 m the game swaps the pitch pine for its far model, and that was a sparse skeleton of big, flat, pale fan
cards with small green balls on it. It did not read as the same tree. Each far tuft had a third of the needles at
2.5 times the width (wide, pale fans), only three of every five twigs had leaves, and every twig carried an
80-triangle ball (the spec's `core`), which used up the budget.

What changed:

- `blender/flora.py`: four knobs for the far model, each defaulting to the old behaviour, so white pine and tamarack rebuild byte for byte the same.
  - On a tuft: `lo_needles` (how many needles; default a third), `lo_width` (width factor; default 2.5) and `lo_tip` (blends the tips back toward the base green; default 0).
  - On any foliage: `lo_core` (the twig's dark ball in the far model; 0 for none).
- `flora/pitch-pine.json`: in the far model every twig has leaves now (level 2 `lo` 1.0), with two tufts of 8 needles at 1.5 times the width, tips 60% back to the base green, and no core balls.
- Triangles: near 11317 (no change), far 1881 -> 1951 (budget 2000).

Shots use the same probe body as rounds 1 to 3 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00, clear weather,
12 m off `world.places(1)[0]`. World state both times: 2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 4.5 -> 5. Top gap: the crowns are see-through, flat-shaded spikes of thin
needle strips in one mid green, so in game the pines look wispy, with no mass. Group the tufts into denser pads at
the branch ends, and shade them by value (near black-green inside and underneath, yellow-green on top and on the sunlit side).
