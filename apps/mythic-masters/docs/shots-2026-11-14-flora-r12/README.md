# Plants and scenery climb, round 12 (#4457): tried, not kept

Round 11's judge asked for a new kind of tuft shape: dense, rounded, dark olive clumps at the branch tips, with short
needle tips only on the rim. The judge also asked for a higher, lopsided crown with sky between the clumps. This round
did that with knobs only, in `flora/pitch-pine.json`. The judge gave it no gain (BEFORE 4.5, NOW 4.5), so the change
is not in the game. It is kept here as `clump-cores.patch` (`git apply` from the repo root, then `bun run flora pitch-pine`).

What the patch does:

- Each twig-end tuft gets a lumpy dark core (`core` 0.12 -> 0.5, `core_at` 0.95, `core_dark` 0.12, `core_squash` 0.8).
  The needle bundles start within it (`brush` 1.4 -> 0.6, `splay` 0.6 -> 0.8), so only their tips show past its rim.
- The needles are dark olive (`#2e3a22` to `#3a4628`), with tips `#56623c` and `#5e6a40`.
- `share` 0.7 leaves some twigs bare, so the crown has gaps.
- The crown starts higher: the first limb level starts at 0.55 of the height (was 0.4).
- Far model: `lo_core` 0 -> 0.6 and `lo_needles` 22 -> 16. Far triangles: 1740 -> 1955 (budget 2000).

A first try with `core` 0.75 hid the needles in polygon balls. Its far model was over budget at 2361.

Shots use the same probe body as rounds 1 to 11 (`docs/shots-2026-11-06-flora/shot.js`). World state both times:
2388 near plants, 3210 far.

- `pine-barrens-before.jpg`, `pine-barrens-after.jpg`: the game, main and with the patch.
- `pitch-pine-before.jpg`, `pitch-pine-after.jpg`: `bun run flora pitch-pine --render`.

Judge (a fresh agent, BEFORE vs NOW): 4.5 -> 4.5. The near model got better: its tufts are rounder, which fits the
species. The far model got worse: it is a cluster of solid, many-sided green balls that reads as a broadleaf tree or
topiary. In the game, the mid and far trees look blobbier. On balance, there is no net gain.

Next: keep this near model, but leave the far model without balls (`lo_core` 0). Make the far model's tufts match the
near ones: a few spiky tufts tipped upward at the branch ends, darker olive with a lighter rim, and sky between them.
