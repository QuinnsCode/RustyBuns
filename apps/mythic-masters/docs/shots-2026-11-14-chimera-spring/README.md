# Chimera spring, 2026-11-14

Round 10 of the beast models climb (#4489). In round 9 ([shots-2026-11-14-chimera-roar](../shots-2026-11-14-chimera-roar/README.md)), the lion stood on stiff legs with a level back. Its mane was a flat ring of shards that hid the face.

- [before-close.jpg](before-close.jpg): main (round 9)
- [after-close.jpg](after-close.jpg): this round

## What changed

All of it is in `chimera()` in `proposals/set-a/make.ts`. `hound()` is not changed.

- **The spine tips up to a raised rump.** The hip goes up 0.1 and the belly drops less (0.05, it was 0.09), so the back rises from the low chest to the haunch. The serpent tail's root moves up with it.
- **The legs bend at real angles.** The upper arm runs back and down to an elbow tucked behind the shoulder. Then the forearm reaches forward to a paw planted far out in front. The thigh runs forward to a knee under the belly, and the shank runs back to a high hock.
- **The face sits forward of the mane.** The neck and head move 0.04 to 0.06 forward.
- **The mane is a shaggy mass in layers.** There are two layers of locks, not one ring rayed round the face:
  - a long, dark layer along the neck and chest that flows back over the shoulders;
  - a lighter, shorter layer from the head back that frames the face.

  The skin under the mane is painted a dark brown (`ruff`), so the locks read as one mass and not as shards on a yellow neck. The ruff is bigger (1.7, it was 1.45).
- 8552 triangles, feet 4/4, 31 joints. The `beasts.test.ts` suite passes (105).

## Scores

- **Paired judge, out of 10:** BEFORE 5, NOW 5.5, verdict "better". On the climb, that is half the gain (+0.25), so 3.25 becomes 3.5.
- **Trait judge against the references:** 5/10 (it was 4).

## Next (the judges' top gap)

- **The hind legs** are still long and bendy. Shorten and thicken them. Give them a lion's hock: a thigh, a hock that points back, and a short upright foot bone. Then the rump sits higher than the shoulders.
- **The mane now covers the cheeks and jaw**, so the roar reads less well from the front. Keep the jaw clear of the mane.
- **The trait judge:** slim the legs into sinewy limbs with big, round, clawed paws.
