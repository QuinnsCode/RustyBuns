# Chimera goat, 2026-11-14

Round 12 of the beast models climb (#4511). In round 11 ([shots-2026-11-14-chimera-hock](../shots-2026-11-14-chimera-hock/README.md)), the goat was a thin dark stalk with small horns, and it disappeared in the front view.

- [before-close.jpg](before-close.jpg): main (round 11)
- [after-close.jpg](after-close.jpg): this round

## What changed

All of it is in `chimera()` in `proposals/set-a/make.ts`. The goat is now bold enough to read from every side, the front too.

- **The neck** is thicker and longer: node radius 0.1 at the root (it was 0.07), and the neck blob is about 45% wider.
- **The head** is bigger, and so are the muzzle, the eyes and the ears.
- **The horns** are thick at the root (base 0.048, it was 0.03) and long (0.48, it was 0.3). They sweep back in a 115-degree arc past the neck.
- **The goat has its own coat.** A shaggy coat runs from under the head down to the lion's back, and a long beard hangs from the chin. The coat is darker than the goat's skin, and the skin is lighter, a warm grey-brown, so it doesn't read as one dark value against the background.
- 8554 triangles, feet 4/4, 31 joints. The `beasts.test.ts` suite passes (105).

## Scores

- **Paired judge, out of 10:** BEFORE 5, NOW 5.5, verdict "better". On the climb, that is half the gain (+0.25), so 3.75 becomes 4.
- **Trait judge against the references:** 4/10. It now ticks the silhouette, the colours, and "a dark goat head with horns rises from the back".

## Next (the judges' top gap)

- **The mane.** Rebuild it as fewer, larger clumps of fur that flow back from the face and stop at the shoulders. Now it is rows of flat, saw-toothed plates over the whole front half of the body. This probably needs a new kind of part in `blender/beast.py` (a lock: a thick, curved, tapering clump), because the `tuft` cones read as plates however they are placed.
- **The trait judge:** lean, sinewy legs, with the ribs and a bristle ridge showing.
