# Plants and scenery climb, round 7 (#4424)

Round 6's judge said the pitch pine's trunk read as a smooth brown pole. This round gives it plated bark, a crooked
bole and stubs of dead branches.

What changed:

- `blender/flora.py`, three trunk knobs, all off by default, so every other plant rebuilds the same:
  - `bark.plates`: every third side of the trunk sinks into a furrow (that share of the radius) and is painted
    `bark.furrow`. The plates between are cracked across here and there.
  - `trunk.rings`: the near trunk gets that many times the rings, so the cracks have room. The far model keeps its rings.
  - `trunk.stubs` (with `stub_from`, `stub_to`, `stub_length`, `bark.dead`): short dead branch stubs low on the bole,
    near model only. They use their own random stream, so the crown grows the same.
- `flora/pitch-pine.json`: `plates` 0.2, `rings` 2, `sides` 9 -> 15, 5 stubs. The plates are lighter (`#8a6650` to
  `#6a4c3c`) against black furrows (`#1a1410`), because the baked shade under the crown made the old bark read as
  black in the game. The bole leans and bends more (`lean` 0.08 -> 0.11, `wobble` 0.35 -> 0.5, `kink` 0.12 -> 0.18).
- Triangles: near 11344 -> 11954 (budget 12000), far 1881 -> 1981 (budget 2000).

Shots use the same probe body as rounds 1 to 6 (`docs/shots-2026-11-06-flora/shot.js`): the Pine Barrens at 11:00,
clear weather, 12 m off `world.places(1)[0]`. World state both times: 2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`. The near model from two
  sides, and the far model on the right.

Judge (a fresh agent, BEFORE vs NOW): 3 -> 3.5. The trunks lean and kink, and in the game they are darker and
furrowed, so they read more like scrubby pitch pines than straight poles. The crowns are still flat cards of bright
"pom-pom" needles, and the far model is still sparse spiky fans. Top gap: the crown. An open, irregular, flat-topped
crown of dark blue-green tuft clumps on short twisted branches, with the fan cards swapped for dense rounded clumps.
