# Sphinx eyes with an iris and a catchlight, 2026-11-18

Round 30 of the beast models climb (#4706). It works on round 29's top gap ([shots-2026-11-16-sphinx-face-quota](../shots-2026-11-16-sphinx-face-quota/README.md)): the eyes were small, flat, shiny black beads in a thin outline with no lids that read, so the stare looked dead, and the brow and nose sat on the face like blocks. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 29 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round, at the same framing ([face-camera.py](face-camera.py), as round 29's)

## What changed (`sphinx()` in `proposals/set-a/make.ts`)

- **Eyes that look back.** Each eye's layers sit on one line out of the face (`eyes()`), so they stay concentric: the kohl rim behind, a bigger white (about 40% wider and taller, set 15% further apart), an amber `iris` filling most of it, a smaller pupil, and a glowing `glint` catchlight (palette glow 2) high on the iris toward the temple.
- **Lids.** The upper lid in the face's skin is larger to match, and a soft lower lid sits under the white, so the eye sits between lids and not on the face as a bead. The kohl wing moved out with the eye.
- **The brow** is two soft arches, one over each eye, sunk deeper and taller so it slopes into the forehead (one straight shelf before), the outer ends a little lower for a calm brow, not a scowl.
- **The nose** is rounder: a wider bridge and less flat (0.7 to 0.5), so it reads less like a wedge stuck on.
- **A hint of a smile.** The two upper-lip rolls tilt so their outer ends lift, the mouth line curls up at the corners, and a small rise in each cheek lifts the corners. Splitting the lower lip in two the same way was tried and dropped: it read as four scattered pieces again (round 26's complaint).
- 8744 of 9000 triangles, feet 4/4, wings 2/2, 30 joints. Two builds give the same GLB byte for byte.

## Scores

- Fresh judge: 3 to 4/10, "better (slightly)" ("the eyes now have brown irises and a white catchlight, so they read as alive instead of black and glassy", "the brow ridge is gone, which removes the stern, heavy-browed look", "the nose is smaller and softer"). The climb takes half the gain (+0.5), to 9.5/10.
- No trait judge this round: `refs/sphinx/` has no pictures on this worker.

## What was learned

- Proud parts on one line out of the face (`on(E, ed, sink)`, negative sink stands proud) keep an eye's layers concentric; the iris at -0.002, the pupil at -0.005 and the glint at -0.009 of the head-scale all show over a white sunk 0.009.
- A brow as two arched blobs sunk about 0.019 blends into the forehead; at 0.022 it nearly vanished.

## Next (the judge's top gap)

The mouth: the lips are flat, dark dashes with little curve or volume, and the cheeks and chin are slack. Give it a soft, fuller, upturned mouth with cheek volume (a single curved lower lip, not split rolls; a `ridge` or `lock`-like curved part in the `lip` material may do it). The eyes could go a little bigger and wider again.
