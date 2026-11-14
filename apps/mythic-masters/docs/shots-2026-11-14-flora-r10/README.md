# Plants and scenery climb, round 10 (#4447): kept

Round 9's judge asked for the canopy. The pitch pines read as broadleaf or palm-like fronds on thin, bare, curving
trunks. The judge wanted them straighter, with thicker trunks, darker blue-green tufts, sparser crowns, tufts sprouting
from the trunk, and fewer trees.

What changed, all in `flora/pitch-pine.json`:

- Trunk: radius 0.26 -> 0.4, lean 0.11 -> 0.04, wobble 0.5 -> 0.2, kink 0.18 -> 0.05. The bole now stands straight
  and thick.
- Crown: 15 -> 10 main limbs, from 0.4 of the height (was 0.3), length 0.3 -> 0.26, kinkier (0.15 -> 0.25). This
  gives a sparser, higher, open crown.
- Tufts: darker blue-green (`#2c4a34`, `#34523a`, `#3c5a3a`, tips `#506c44`, `#5a7448`). The far model has 22 narrower
  needles a tuft (was 16; `lo_width` 1.6 -> 1.25).
- Trunk sprouts: 18 a stem (was 9), bigger (0.055 -> 0.08), 14 needles, up to 0.75 of the height (was 0.55).
- Triangles: near 11954 -> 8875 (budget 12000), far 1981 -> 1740 (budget 2000).

Not done: fewer trees. When the `pitch-pine` weight in `FLORA` went from 0.41 to 0.3, the placement changed and the
white cedars' blob-stack far models took over the view. So the weight stays as it was until the white cedar is fixed.

Shots use the same probe body as rounds 1 to 9 (`docs/shots-2026-11-06-flora/shot.js`). World state both times:
2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game, main and with this change.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`.

Judge (a fresh agent, BEFORE vs NOW): 4 -> 4.5. The near trees now stand straight and tall, with long bare lower
trunks and tufts up top, so the stand reads more like a pine forest. But the crowns are still bright, flat, fan-shaped
blade clusters that look like palms or bamboo. Top gap: change the crowns to darker olive, clumped, rounded needle
masses with gaps between them (fewer, denser tufts, not open fans of flat blades).
