# The head's bones and the neck, round 7 of the people climb (#6387), 2026-11-26

`human()` in `packages/models/src/human.ts`, shot from `bun packages/models/scratch/humans/serve.ts` with
`bun scripts/probe.ts --url http://localhost:<port>/ --size 5120x2880 --js '__humans.only(["average"]); __humans.view("face"); __humans.turn(t)' --shot x.png`
at a turn of 0 (`front`, crop `-c 1300 2000 --cropOffset 800 1560`), 35 (`three`, `-c 1300 1700 --cropOffset 800 1900`),
80 (`side`, `-c 1200 1300 --cropOffset 1000 2900`) and 35 again, lower, for the jaw and neck (`jaw`, `-c 1500 1700 --cropOffset 1300 1900`).

- **The neck no longer ends in a flat top.** The neck ended at its last torso ring (`neckTop`) with a flat disc, which
  showed behind the jaw as a step: a short cylinder that the head sat on. Now one more ring takes the neck on up inside
  the head, narrower and pulled back. The neck meets the skull under the jaw and at the nape.
- **Bones at the sides of the head.** `bones()` pushes the side of the skull out (x) where bone widens it:
  - the cheekbone, under the eye's outer corner and back along its arch;
  - a hollow under it, less in a fuller face;
  - the temple, dipping in;
  - the angle of the jaw, under the ear (more with a wide `jaw` and with muscle).

  `surf()` takes the bones into account, so the lids, nose and mouth still lie on the skin.
- **A stronger brow ridge** (0.0035 to 0.0045 head units, a little broader), so the brows sit in it more.
- No new triangles.

Judge: BEFORE 3.0, NOW 3.4. Their words: a real neck "runs from under the jaw and ear down into the turtleneck", and "a
soft malar plane and some shading under the cheekbone now break up the flat oval". Against: the profile is almost
unchanged. The top gap is the nose's hard rectangular top between the brows: it looks stuck on.
