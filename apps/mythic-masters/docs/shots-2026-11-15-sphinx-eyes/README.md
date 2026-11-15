# Sphinx eyes and lips, 2026-11-15

Round 26 of the beast models climb (#4662). It works on round 25's top gap ([shots-2026-11-15-sphinx-profile](../shots-2026-11-15-sphinx-profile/README.md)): paper-thin kohl lids floating on a flat face, and small lips. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 25 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round, at the same framing

The head close-ups are an orthographic camera, 0.95 m wide, on the middle of the front 0.45 m of the beast above 45% of its height, with `blender/closeups.py`'s lights.

## What changed (`sphinx()` in `proposals/set-a/make.ts`)

- **Eyes set into the face.** The two kohl ridges that floated over each eye are gone. A dark kohl almond a little bigger than the white sits just behind it, so the line is a rim round the eye. A heavy upper lid in the face's own material covers the top of the white, and one short kohl wing runs back toward the temple. The brow ridge and the cheekbones stand out a little further, so the eye sits in a socket between them.
- **Lips with volume**: two soft rolls for the upper lip (a dip in the middle) and a fuller lower roll, all ellipsoids, with a thin dark mouth line between. No more red diamonds.
- 8909 triangles, feet 4/4, wings 2/2, 31 joints.

## Scores

- Fresh judge: 4.5 to 5/10, "better" ("the lips are now one flat mouth, not four scattered red triangles", "the eyes read as eyes"). The climb takes half the gain (+0.25).
- Trait judge against the references: 4/10 (round 25: 4/10). Its fix: a larger, calmer face, a fuller head-cloth, a longer upright neck.

## What was learned

- `on()` finds the skin on the head's three ellipsoids, but the brow and cheek blobs raise the blended skin above that. Parts sunk by more than about 0.012 of the head-scale vanish under it (the first try buried the eyes at 0.019). Sink the white about 0.008 and the kohl 0.011, and set the pupil 0.001 proud.

## Next (the judge's top gap)

The face sits on the head like a flat mask, and in three-quarter view it splits into two planes with a seam down the cheek. Give the skull a side plane: carry the cheek and jaw back under the head-cloth so the face wraps the head. The eyes read a little big and goggly in three-quarter view: shrink them about 20% and turn them to look forward. Then the neck (longer, the head higher) and the wings (a forward curl).
