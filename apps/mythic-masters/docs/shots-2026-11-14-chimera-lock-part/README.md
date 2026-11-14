# Chimera: a lock part for the mane, 2026-11-14

Round 14 of the beast models climb (#4535). In round 13 ([shots-2026-11-14-chimera-locks](../shots-2026-11-14-chimera-locks/README.md)), the mane was big `tuft` cones. A tuft is a cone, so the mane read as a pinecone's rows of plates.

- [before-close.jpg](before-close.jpg): main (round 13)
- [after-close.jpg](after-close.jpg): this round

## What changed

- **A `lock` part in `blender/beast.py`.** A lock is a clump of hair. It is broad and flat at the root and a little fuller a third of the way out. Then it rounds off to a soft tip (the `LOCK` profile), not a cone's point. It twists as it curls (`twist`, 40 degrees), it is grooved into strands (`groove`), and it is shaded smooth. Each lock is a little longer or shorter than the next, curls a little more or less, and swings aside (`swing`) by a fixed amount, the same every build, so a row of locks doesn't line up like a grid.
- **`tube()` takes `twist`, `groove` and `smooth`**, for any part that needs them.
- **The Chimera's mane is many smaller locks** (`chimera()` in `proposals/set-a/make.ts`): 10 by 17 dark ones outside and 7 by 14 lighter ones framing the face, both from the head to the neck.
- 8669 triangles, feet 4/4, 32 joints, 9 tips. The `beasts.test.ts` suite passes (105).

## What I tried and left out

- **Few big locks** (7 by 13, 0.38 long): they read as streaks, but the top ones reached the goat's neck. The rigger then joined the two necks and lost the goat's head tip (29 joints, 8 tips).
- **Few big locks, shorter and tighter** (0.3 long, curl 100): the rig was whole again, but a fresh judge scored it "same" (4 to 4), and it still read as layered armour plates.
- **Blunt locks** (the first `LOCK` profile, wider at the tip): they read as rock chunks.

## Scores

- **Paired judge, out of 10:** BEFORE 3.5, NOW 4, verdict "better". On the climb, that is half the gain (+0.25), so 4.25 becomes 4.5.
- **Trait judge against the references:** 4/10 (5 last run; the run-to-run noise is about ±1).

## Next (the judges' top gap)

- **The mane as one solid volume.** The paired judge: "a field of separate flat shards stuck on the shoulder". It wants a thick ruff round the face that grows out of the head and neck, with tufts that taper out from it, and a colour that blends into the body fur. A try: a `blob` shell under the locks (the ruff's mass, painted the mane colour), so the locks are its surface and not cards on bare skin.
- **The trait judge:** lean, sinewy lion legs with big round paws, a bristle ridge on the spine, and ribs that show.
