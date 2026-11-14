# Sphinx body, 2026-11-14

Round 20 of the beast models climb (#4623). It works on the top gap from round 19 ([shots-2026-11-14-sphinx-face](../shots-2026-11-14-sphinx-face/README.md)): spindly stilt legs on small flat paws, and a stance too high for a lion. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg): main after round 19 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): this round, at the same scale

## What changed (all in `sphinx()` in `proposals/set-a/make.ts`)

- **Lower and heavier**: a `pose` sinks the chest, belly, hips, shoulders and hip joints about 0.12 to 0.15 (in k) between bent legs, with the elbows and knees out of the straight line, the way the couchant statues sit low. The neck and head rise less, so the face stays at the same height in the frame. The wing roots come down with the chest.
- **Thick legs**: `legs` goes from 1.3 to 1.75, the chest from 1.15 to 1.2 and the waist from 0.85 to 0.95.
- **Shoulders and haunches**: a broad blob over each foreleg's shoulder and a round haunch over each hip joint.
- **Big paws**: the paw's height and toe pads scale with the foot node's radius (`foot_part` in `blender/beast.py`), so the four foot nodes get a radius of 0.07 k (it was 0.035), and each foot part's `sole` is set to its node's height so the paw still stands on the ground.
- 8921 triangles, feet 4/4, wings 2/2, 30 joints.

## Scores

- Paired judge, out of 10: BEFORE 4 to NOW 4.5, verdict "better". The climb takes half the gain (+0.25).
- Trait judge against the references: 4/10 (round 19: 4/10). Its fix: "Reshape the lion legs and haunches into smooth, solid forms with large forepaws, and give the wings curled, layered feather rows."

## What was learned

- A fat foot node is the cheap way to get a deep, round paw with visible toes: `foot_part` sizes the paw's height (0.9 r) and its toe balls (0.42 r) from the node's radius, not from `len` and `width`. Move `sole` with the node, or the paw floats.
- Stacked blobs (bone, muscle, shoulder, haunch) add mass but read as lumps: both judges call the legs "swollen tubes". The next step is fewer, longer forms, not more blobs.

## Next (the judges' top gap)

The torso and legs are lumpy, swollen tubes with no clear shoulder blade, ribcage or tapering paw. Replace the stacked leg blobs with one smooth lofted `limb` per leg (`shoulder`, `elbow`, `calf` in `blender/beast.py`), tapering to the wrist and paw. Then the wings: flat card-like feather slats, not curled forward.
