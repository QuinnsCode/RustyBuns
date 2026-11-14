# Chimera: the mane as a few chunky clumps, 2026-11-14 (not kept)

Round 16 of the beast models climb (#4607). Round 15 ([shots-2026-11-14-chimera-ruff-shell](../shots-2026-11-14-chimera-ruff-shell/README.md)) showed that a judge reads the locks, not what is under them. It asked for 6 to 10 thick, tapered, layered locks with a darker under-layer. This round tried that. A fresh judge scored it "same", so the change is not on main.

- [before.jpg](before.jpg): main (round 14's mane: 10 by 17 and 7 by 14 small locks)
- [now-short.jpg](now-short.jpg): try 2, short fat locks
- [now.jpg](now.jpg): try 5, the one judged

## What was tried

Everything was in `chimera()` in `proposals/set-a/make.ts`. The two `lock` rows became three layers along `head` to `neck`: a dark `ruff` under-layer, then `tuft`, then the light `mane` framing the face.

- **Try 1** (5 by 9, 4 by 8 and 3 by 7, base 0.1 to 0.075, `flat` 0.6, curve 90 to 60): it broke the rig (30 joints, 8 tips). The goat's head tip was lost, as in round 13.
- **Try 2** (4 by 8, 3 by 7 and 2 by 7, base 0.12 to 0.08, `flat` 0.8, length about 2.4 times the base): the rig was whole again (32 joints, 9 tips). But the locks read as rock nuggets or pinecone scales.
- **Try 3** (longer and thinner, curl 120): the locks lay flat on the skin like scales.
- **Try 5, judged** (curl 35 to 45, `sweep` 1.3 to 1.8, length 0.24 to 0.34, base 0.085 to 0.065, outer `spread` 150): the locks stream back from the face. From the front, this is the widest mane so far. 8700 triangles, feet 4/4, 31 joints, 9 tips. The `beasts.test.ts` suite passes (105). The suite doesn't pin the joint count, and the heads, tail and feet all hold.
- The diff (two rows swapped for three) is in this round's PR body. It isn't on main.

## Score

- **Paired judge, out of 10:** BEFORE 4.5, NOW 4.5, verdict "same". The climb stays at 4.5.
- What it said: from the front, the frame is wider and more lion-like, and the face is cleaner. From the side, the few big locks read as "pinecone scales or porcupine spikes", and the gaps between them show the dark skin under them. The crown above the brow is bare, so the head looks small.

## What it says

This is the second round in a row on the mane with no gain. Few big locks and many small locks both read as flat cards. A `tube` with a flat section can't read as fur at this camera, whatever its count or size. A mane needs a different part: for example, overlapping clumps that share a root mass and rise over the crown and cheeks with no gaps, or a fur shell with strand cards. That is builder work in `blender/beast.py`, not a sheet tweak. So the climb moves to its item 2: rebuild other beasts from their references (kelpie, leshy, sphinx, wolpertinger first).
