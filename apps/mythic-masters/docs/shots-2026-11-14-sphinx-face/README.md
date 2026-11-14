# Sphinx face, 2026-11-14

Round 19 of the beast models climb (#4616). It works on the top gap from round 18 ([shots-2026-11-14-sphinx-nemes](../shots-2026-11-14-sphinx-nemes/README.md)): the face was a lumpy, muddy brown blob, because it is `paint`ed and the fur hide covered it. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg): main after round 18 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): this round, at the same scale
- [face.jpg](face.jpg): the front close-up, cropped to the head

## What changed

- **The face is out of the fur hide** and needs no builder change. `shade()` in `blender/beast.py` folds each `paint` material into the body's material (and so into the hide), but never one whose palette entry has a 6th value (glow). The palette's `face` is now `[0.86, 0.68, 0.48, 0.55, 0, 0]`: glow 0, so it stays its own smooth skin material.
- **Bigger features**, so the face reads at fight size: the eyes 1.3 times larger with bigger pupils, the kohl lines longer and thicker, and fuller lips.
- 8913 triangles, feet 4/4, wings 2/2, 29 joints. `beasts.test.ts` passed (105).

## Scores

- Paired judge, out of 10: BEFORE 3 to NOW 4, verdict "better". The climb takes half the gain (+0.5).
- Trait judge against the references: 4/10 (round 18: 3/10). Its fix: "Replace the spindly stilt legs with heavy, muscled lion forelegs and big-toed paws, and lower the stance so the body looks crouched and powerful."

## What was learned

- To keep any `paint`ed region (a face, a muzzle, a mask) out of a furry beast's hide, give its palette entry a 6th value of 0. It keeps a clean colour at no cost in triangles.
- The edge between the face and the furred neck is now hard. The head-cloth's flaps hide most of it.

## Next (the judges' top gap)

The body: heavy, muscled lion forelegs and big-toed paws, chunky shoulders and haunches, and a lower, crouched couchant stance like the references. The paired judge also flagged the wings as flat, card-like feather slats.
