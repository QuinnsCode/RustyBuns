# Sphinx paws, 2026-11-14

Round 24 of the beast models climb (#4649). It works on round 23's top gap ([shots-2026-11-14-sphinx-thighs](../shots-2026-11-14-sphinx-thighs/README.md)): the paws sat on a flat slab, the hind paw read as a separate block, and the foreleg stood like a straight post. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-paws.jpg](before-paws.jpg): main after round 23 (front, side, three-quarter, head; then the legs and paws close up)
- [now.jpg](now.jpg), [now-paws.jpg](now-paws.jpg): this round, at the same framing

## What changed

- **A `mitten` foot** (`foot_part` in `blender/beast.py`): one rounded dome, highest over the wrist, with a heel pad bulging out behind and under it, four fat toe lobes curled around its front edge, and a short claw on each toe. With `skin: true`, the dome and heel join the body before `blend` (the way a `limb` with `skin` does), so the paw blends up into the leg with no step and takes the fur hide. The toes and claws stay their own parts. No other beast uses it, so the others build as they did.
- **The Sphinx's paws** (`sphinx()` in `proposals/set-a/make.ts`): mittens, fore and hind, `len` 0.24 k and `width` 0.2 k (about 1.3 times the leg's width, down from 1.8). `r` stays at 0.08 k. Claws are 0.03 k.
- **The foreleg's pastern**: the wrist sits behind the paw (x 0.275 k, y 0.17 k), so the forearm leans forward from the elbow and the pastern slants forward and down into the paw.
- 8909 triangles, feet 4/4, wings 2/2, 31 joints (32 on main). `beasts.test.ts` and `beast-parts.test.ts` passed (107, on the builder).

## Scores

- First try, with the toes inside the skin too: a fresh judge gave 4.5 to 4.5, "same". The blend smoothed the toes and most of the claws away, so the paws read as "soft mitten blobs".
- Kept, with the toes and claws as their own parts: a fresh judge gave 5 to 5.5, "better" ("rounded, padded paws", no "hard step at the ankle"). The climb takes half the gain (+0.25).
- Trait judge against the references: 4/10 (round 23: 4/10). It didn't mark the limbs lower ("thin and without big toes"). Its fix: lift and enlarge the head on a longer, upright neck, give it a calmer, finer face, and make the wings paler, curling forward at the tips.

## What was learned

- `blend` (voxel 0.012 m, then smoothing) melts pads smaller than about 0.04 m into the shape beneath them. Detail that must stay readable, like toes and claws, stays outside the skin, and only the bulk goes in.

## Next (the judges' top gap)

The face: it reads flat and snouted, with a rubbery mouth, and the head-cloth sits on top like a separate cap. Give it a human profile: a nose bridge and a straight nose (no snout), a brow ridge, a jaw, a chin and cheekbones. Then sink the head-cloth so it wraps the skull and frames the face down to the shoulders. The trait judge also asks for the head higher and larger on a longer upright neck. After that, the wings.
