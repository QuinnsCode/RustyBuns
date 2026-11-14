# Plants and scenery climb, round 6 (#4410)

Round 5's judge said the near tufts opened out as flat radial fans, so the pitch pines read as palms. This round
makes each tuft a 3D bottlebrush.

What changed:

- `blender/flora.py`: a `bundle` knob on a tuft (default 1, off, so white pine and tamarack rebuild the same). With
  `bundle` 3 the needles come in bundles of three. Each bundle sits at a different place around and along `brush` of
  twig behind the tip and points forward and up by `splay`. The bundles get shorter toward the tip, so the brush ends
  round. Each needle in a bundle turns a third of a turn from the one before, so the brush has body from every side.
- `flora/pitch-pine.json`: `bundle` 3, `brush` 0.55 -> 1.4, `splay` 0.6, `reach` 1.0, `needle_width` 0.05 -> 0.04.
  The twigs are a little shorter and more crooked (`length` 0.42 -> 0.4, `wobble` 0.35 -> 0.45, `kink` 0.35). The far
  model uses the same bundle code (5 bundles of 3 on a tuft, `lo_width` 1.6).
- Triangles: near 11259 -> 11344 (budget 12000), far 1951 -> 1881 (budget 2000).

Shots use the same probe body as rounds 1 to 5 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00,
clear weather, 12 m off `world.places(1)[0]`. World state both times: 2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two
  sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 3.5 -> 4.5. Up close, the palm fans are now longer, denser needle tufts along
the branches. In the game the forest looks almost the same, because most trees on screen are the far model: thin
crowns of wide fans on smooth, plain trunks. Top gap: a dark plated bark you can see (`#3a2e28` to `#5a3a2c`, with
vertical plates), a crooked bole with stubs of dead branches, and a far model with heavier, more solid tuft clumps.
