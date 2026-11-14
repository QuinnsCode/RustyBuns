# Chimera locks, 2026-11-14

Round 13 of the beast models climb (#4524). In round 12 ([shots-2026-11-14-chimera-goat](../shots-2026-11-14-chimera-goat/README.md)), the mane was rows of flat, saw-toothed plates over the whole front half of the body.

- [before-close.jpg](before-close.jpg): main (round 12)
- [after-close.jpg](after-close.jpg): this round

## What changed

All of it is in `chimera()` in `proposals/set-a/make.ts`.

- **The mane is a few big locks, not rows of plates.** There are two layers from the head to the neck. The outer layer is 6 by 11 long, dark locks. The inner layer is 4 by 10 shorter, lighter locks that frame the face. Each lock is about half as flat as before (`flat` 0.6, it was 0.35), wider at the root, and curls back onto the neck (`curve` 60 to 75).
- **The mane stops at the shoulders.** The layer that ran down to the chest is gone, and so is the hound's own ruff of small tufts. The shoulders now show the lion's body.
- 8698 triangles, feet 4/4, 32 joints. The `beasts.test.ts` suite passes (105).

## What I tried and left out

- **Round locks** (`flat` 0.85, 5 by 9, 0.38 long) read as rock spikes, not hair. With that layer on, a red-brown chunk also showed by the goat's face; without it, the chunk was gone. Half-flat locks are in between.

## Scores

- **Paired judge, out of 10:** BEFORE 4.5, NOW 5, verdict "better". On the climb, that is half the gain (+0.25), so 4 becomes 4.25.
- **Trait judge against the references:** 5/10 (4 last run).

## Next (the judges' top gap)

- The locks still read as cone spikes in a pinecone pattern. A lock part in `blender/beast.py` would help: a clump that is broad and flat at the root, twists, and has a soft round tip.
- **The paired judge's top gap is the pose and proportions again.** It wants a lower chest, shorter and thicker legs in a coiled crouch, and forelegs spread wide. Rounds 10 and 11 worked on those, and each judge sees them a little differently.
- **The trait judge** wants a leaner body, with ribs and a bristle ridge that show, and big, round paws.
