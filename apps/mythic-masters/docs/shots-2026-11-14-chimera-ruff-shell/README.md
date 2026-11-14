# Chimera: a ruff shell under the mane, 2026-11-14 (not kept)

Round 15 of the beast models climb (#4604). In round 14 ([shots-2026-11-14-chimera-lock-part](../shots-2026-11-14-chimera-lock-part/README.md)), a judge still saw the mane as "a field of separate flat shards stuck on the shoulder". This round tried to give it a solid mass under the locks. Two fresh judges both scored it "same", so the change is not on main. These notes are here so the next round doesn't try it again.

- [before.jpg](before.jpg): main (round 14)
- [now-brim.jpg](now-brim.jpg): try 2, the shell in the mane's colour
- [now-sunk.jpg](now-sunk.jpg): try 3, the shell pushed back and darkened

## What was tried

- **A blob kept out of `blend`.** `blender/beast.py` melts every blob into the skin, and the blended skin takes the body's material. An `over: true` blob was joined after the remesh in its own `material`, so it showed as a shell over the skin. The locks rooted on it, because `surface()` already reads every blob.
- **Two shells on the Chimera:** an ellipsoid behind the head (tall and wide, thin front to back) to frame the face, and one over the neck.
- Try 1 (a small shell 0.09 behind the head): mostly buried in the skull, so almost nothing showed.
- Try 2 (0.16 behind, 0.29 radius, the `mane` colour): from the front, a full disk of mane round the face. But its smooth top edge showed above the brow, and the judge read it as "a hood or helmet brim". Judge: 5 to 5, "same".
- Try 3 (0.2 behind, the dark `ruff` colour): the brim went, and the mane read darker and fuller from the front. Judge: 4.5 to 4.5, "same", "nearly identical".
- Feet 4/4, 32 joints, 9 tips, and the `beasts.test.ts` suite passed (105). A bigger shell once gave the rigger a 33rd joint.

## What it says

A volume hidden under the locks doesn't change what the judge reads: it reads the locks themselves, which are flat cards. Both judges asked for **few, big, chunky clumps** (6 to 10 thick, tapered locks, layered, a darker under-layer) instead of many small flat ones. Round 13 tried few big locks, and the top ones reached the goat's neck and broke the rig. A next try at that needs the locks kept below the goat's root (`g1`), for example along `head` to `neck` only, with `spread` under 180.

The second judge's other gap: thin, rubbery legs on small flat paws, not a coiled crouch.
