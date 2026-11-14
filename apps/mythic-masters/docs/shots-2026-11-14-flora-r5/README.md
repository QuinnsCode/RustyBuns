# Plants and scenery climb, round 5 (#4398)

Round 4's judge said the pitch pine crowns were see-through spikes of thin needle strips in one mid green, with no
mass. This round puts the tufts together into denser pads at the twig ends and shades them by where they sit in the crown.

What changed:

- `blender/flora.py`: a `shade` knob on a tuft (default 0, off, so white pine and tamarack rebuild byte for byte the same).
  It paints value by the tuft's height in the crown and how far out it sits: low and inside, the needles go toward
  `shade_dark` (default `#141d0e`); on top and at the rim, their tips go toward `shade_light` (default `#8f9c3c`).
  `shade_reach` sets how far out the rim is, as a share of the tree's height (0.35).
- `flora/pitch-pine.json`: tufts only on the last 28% of each twig (`start` 0.55 -> 0.72), 36 needles each instead of 16,
  and the triangles come from the dark knot balls, which go (`knot` 0.1 -> 0). The far model has one tuft of 16
  needles on a twig instead of two of 8 (`lo` 0.5 -> 0.34, `lo_needles` 8 -> 16).
- Triangles: near 11317 -> 11259 (budget 12000), far 1951 (no change, budget 2000).

Shots use the same probe body as rounds 1 to 4 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00, clear weather,
12 m off `world.places(1)[0]`. World state both times: 2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 4 -> 4.5. In the renders the crowns are denser and fuller, with light-to-dark
variation; in the game it is hard to see a change at this distance. Top gap: the near tufts now open out as flat radial
fans, so the trees read as palms, not pines. Make each tuft a 3D bottlebrush (needles in bundles of three, all round and
along the twig, pointing forward and up) on stubby, crooked twigs, and rebuild the far model from those tufts. In the game
the mid-ground pines want a flat-topped, irregular crown and a thick, dark-plated trunk.
