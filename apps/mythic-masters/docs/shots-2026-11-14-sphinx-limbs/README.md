# Sphinx limbs, 2026-11-14

Round 21 of the beast models climb (#4627). It works on the top gap from round 20 ([shots-2026-11-14-sphinx-body](../shots-2026-11-14-sphinx-body/README.md)): the legs were lumpy, swollen tubes of stacked blobs. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg): main after round 20 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): this round, at the same scale

## What changed

- **`limb` takes `skin`** (`blender/beast.py`): a `limb` part with `skin: true` is built into the body with the blobs, before `blend`, so the voxel remesh makes the body and leg one smooth skin. A plain `limb` is a separate part: on the Sphinx it came out faceted after the LOD, with a seam at the body.
- **One limb per leg** (`sphinx()` in `proposals/set-a/make.ts`): the hound's leg bones, its elbow and hock knobs and round 18's muscle blobs are gone. A limb runs shoulder, elbow, wrist, paw (and hip, knee, hock, paw), heavy at the top, swelling at the forearm and gaskin, tapering to the wrist and hock. The leg nodes under it are thinned to 0.025 k.
- **Shoulder blade and haunch**: one flatter shoulder plate and one rounder haunch, sunk into the body, replace round 20's big shoulder and haunch slabs.
- **The knee back under the hip**, so the hind leg doesn't zig-zag.
- 8924 triangles, feet 4/4, wings 2/2, 31 joints. `beasts.test.ts` and `beast-parts.test.ts` passed (106, on the builder).

## Scores

- Paired judge, out of 10: BEFORE 4 to NOW 4.5, verdict "better". The climb takes half the gain (+0.25).
- Trait judge against the references: 4/10 (round 20: 4/10). Its fix is the face: "a calm, smooth human face with straight nose, full closed lips and kohl-lined almond eyes, framed by wider head-cloth flaps."

## What was learned

- A loose `limb` part on a `blend`ed beast decimates into flat facets. `skin: true` puts it in the remesh, so it blends like a blob.
- The forelegs read as solid lion legs now. The hind leg still looks blocky at the knee and hock: the gaskin is short and the hock is only 0.05 k behind the paw.

## Next (the judges' top gap)

The hind legs are stiff and stubby, with block-like knee and hock joints. Give the hind leg a longer, slanting gaskin and a high, sharp hock (move `l_hock` up and back, `l_bfoot` forward). Then the wings, which are flat, spiky paper cards and need layered, shaped feathers. The face is still a flat mask with small eyes up close.
