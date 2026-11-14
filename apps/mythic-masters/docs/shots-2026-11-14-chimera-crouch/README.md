# Chimera crouch, 2026-11-14

Round 8 of the beast models climb (#4481). The round 7 rebuild ([shots-2026-11-13-chimera](../shots-2026-11-13-chimera/README.md)) stood tall on puffy legs with a barrel body. Its mane rayed out only at the top and sides.

- [before-close.jpg](before-close.jpg): main (round 7)
- [after-close.jpg](after-close.jpg): this round

## What changed

`hound()` in `proposals/set-a/make.ts` takes three new options. The Chimera is the only beast that uses them.

- `pose`: moves named nodes by (fore, up) in k before the flesh goes on. The Chimera drops its chest and shoulders. It braces its forelegs out in front (the elbow, wrist and paw all go forward). It folds its hind knees under the haunch, and its head stays raised.
- `waist`: the belly blob's depth and width. At 0.82 the waist tucks under the ribs. At 0.7 it pinched into a crease between the chest and the hip.
- `paw`: paw size. At 1.35 the Chimera has big lion paws.

Also:

- `chest` went from 1.25 to 1.1 and `legs` from 1.3 to 1.15, so the body is leaner.
- The mane has 18 rows over ±170° (it had 12 over ±220°). It is now a full ring round the face, the chin and throat included.
- 8710 triangles, feet 4/4. The rig has 25 joints and 7 tips, down from 34 and 12, because the mane's loose rays no longer count as tips. The `beasts.test.ts` suite passes (105).

## Scores

- Paired judge, out of 10: BEFORE 3 to NOW 3.5, verdict "better". On the climb that is half the gain (+0.25).
- Trait judge against the references: 4/10 (it was 3). Colours and the three things a child draws: yes. Silhouette, head, limbs and hide: partly.

## Next (the judges' top gap)

- The crouch reads only a little. Both judges still see an upright, soft body.
- It needs lower and wider forelegs, a visible rib and spine ridge, and a lean, sinewy haunch.
- The face needs a broad, wrinkled roaring muzzle and a wide-open mouth, not a button nose over a small red block.
