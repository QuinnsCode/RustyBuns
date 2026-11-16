# Sphinx face wrapping the head, 2026-11-15 (notes only)

Round 27 of the beast models climb (#4665). It worked on round 26's top gap ([shots-2026-11-15-sphinx-eyes](../shots-2026-11-15-sphinx-eyes/README.md)): the face sat on the head like a flat mask, with a seam down the cheek in three-quarter view, and the eyes read big and goggly. **Not kept**: the code is in [tried.diff](tried.diff), and main's Sphinx is unchanged.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 26 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round's try, at the same framing

The head close-ups use the same camera as round 26: orthographic, 0.95 m wide, centred on the front 0.45 m of the beast above 45% of its height, with `blender/closeups.py`'s lights.

## What was tried (`sphinx()` in `proposals/set-a/make.ts`)

- **A side plane for the skull**: a fourth head ellipsoid (`side`, 0.105 by 0.115 by 0.108 of the head-scale, a little behind and below the cranium's centre) from the cheek back under the head-cloth to the jaw's angle. The face ellipsoid was widened from 0.088 to 0.096, and the jaw-corner blobs moved back 0.03 and made a little bigger.
- **Eyes 20% smaller, looking forward**: the white, kohl, lid and pupil scaled by 0.8, turned from -18 to -6 degrees, and moved in from 0.04 to 0.036. The smaller kohl almond vanished at round 26's sink (0.011), so it is sunk 0.009 and the white 0.006.
- 8909 triangles, feet 4/4, wings 2/2, 31 joints.

## Scores

- Fresh judge: 4 to 4/10, "same" ("slightly smaller eyes with softer brows and a smoother cheek-to-jaw blend", but the faces look almost the same). The climb has no gain.
- Trait judge against the references: 5/10 (round 26: 4/10). Its fix: curl the wing tips forward.

## What was learned

- A cheek-to-jaw blend and smaller eyes are too small a change to read at this framing. The face's problem is now its faceting: at 8909 triangles out of a 9000 budget, the remeshed head shows sharp creases in three-quarter view, and the lips and nose read as painted flats.

## Next (the judge's top gap)

The face is faceted and doll-like: flat painted lips, a wedge nose and sharp creases in three-quarter view. Give the head more of the triangle budget (or smooth it after the remesh) so the cheeks, jaw and brow are rounded, and give the lips and nose real volume. Make the head-cloth one draped surface rather than stacked separate stripe boxes.
