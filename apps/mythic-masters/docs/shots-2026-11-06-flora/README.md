# Plants and scenery climb, round 1 (#3312)

The Pine Barrens floor at 11:00, clear weather, 12 m off its first place (`world.places(1)[0]`). `shot.js` is the
probe body that took both shots: `bun run probe mythic-masters --js "$(cat apps/mythic-masters/docs/shots-2026-11-06-flora/shot.js)" --shot out.png`.
It answers and closes the Book's opening talk, skips the director's scenes, and calls `world.peace(true)` so no fight starts.

- `pine-barrens-before.jpg`: one grass tuft repeated evenly over the sand.
- `pine-barrens-after.jpg`: the same tufts gathered into tussocks (`clumped` in `src/world/flora.ts`), with bare sand between.

World state both times: 2388 near plants, 3211 far.
