# Plants and scenery climb, round 3 (#4393)

Up close, the pitch pine's needle tufts looked like opaque green hexagons with flat needle cards stuck on. The
hexagons were two dark blobs: one per twig (the spec's `core`) and one in every tuft (until now fixed at `0.22 ×
size` in `blender/flora.py`).

What changed:

- `blender/flora.py`: the tuft's knot is now a knob, `knot` (its radius as a share of `size`; 0 for none). The default is still 0.22, so white pine and tamarack rebuild byte for byte the same.
- `flora/pitch-pine.json`: knot 0.1 and core 0.12 (the blobs are a third the size), 16 needles a tuft instead of 13, needles 0.05 wide instead of 0.035.
- Triangles: near 10642 -> 11317 (budget now 12000), far 1881 (no change).

Shots use the same probe body as rounds 1 and 2 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00, clear weather,
12 m off `world.places(1)[0]`. World state both times: 2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 3.5 -> 4. Top gap: the far model's crown is a sparse skeleton of big, flat, pale
fan cards. It should have the near model's density, tuft shape and darker green.
