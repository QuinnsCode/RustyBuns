# Sphinx thighs, 2026-11-14

Round 23 of the beast models climb (#4641). It works on round 22's top gap ([shots-2026-11-14-sphinx-hocks](../shots-2026-11-14-sphinx-hocks/README.md)): the hind legs read as stacked cylinders with a hard kink and thin, flat paddle feet. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg): main after round 21 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): this round, at the same scale

## What changed

- **No twist in a `limb`** (`blender/beast.py`). `loft_frame` picks its hint axis by how steep the leg is. Once a span slants more than about 37 degrees (a gaskin angled back), it swaps axes, and the ring's frame turns half over. The loft then twists through itself into a V at the joint. That V was the "block at the knee" in rounds 21 and 22. Each ring now keeps the same side as the ring before it. Three other beasts with a steep `limb` change a little (agropelter, curupira, raiju). The other ten come out byte for byte the same. `beast-parts.test.ts` builds such a leg and checks that no ring turns over.
- **`limb` takes `calf_at`** (0.35 by default): where along the chain the `calf` bulge sits. The Sphinx's hind leg puts it at 0.6, so the gaskin swells instead of the thigh.
- **`foot` takes `r` and `tall`**: `r` is the paw's size (from round 22's `tried.diff`), and `tall` scales the pad's height alone. The paws are deep and padded now, not planks.
- **The Sphinx's hind leg** (`sphinx()` in `proposals/set-a/make.ts`): the knee and hock are set directly. The thigh runs down and forward, the gaskin goes back at about 45 degrees to a high hock, and the cannon stands nearly upright over the paw. The thigh is fuller (0.17, 0.14 k), with no knob behind the knee. The haunch is bigger, lower and further forward, so it covers the top of the thigh. Fore and hind paws are one size (`r` 0.08 k, `tall` 1.8).
- 8921 triangles, feet 4/4, wings 2/2. `beasts.test.ts` and `beast-parts.test.ts` passed (107, on the builder).

## Scores

- Paired judge, out of 10: BEFORE 4 to NOW 5, verdict "better": "each leg is one smooth limb that blends into the body". The climb takes half the gain (+0.5).
- Trait judge against the references: 4/10 (round 21: 4/10, round 22: 3/10). Its fix: the wings, "one broad pale sweep with rows of feathers curling forward at the tips", and more weight in the paws and haunches.

## What was learned

- A bigger paw (`r` 0.1 k, or the hind paw at the forepaw's `len` and `width`) loses a hind foot in the rig (feet 3/4): the voxel skeleton stops finding that tip. Keep `r` at 0.08 k and get the depth from `tall`.
- Check a V or a crease at a joint for a turned ring before adding blobs to fill it. A stifle blob and a lower haunch blob did nothing, because the fold was in the loft itself.

## Next (the judges' top gap)

The paws still sit on a flat slab base, and the hind paw reads as a separate block. Make each paw one rounded mitten with four toe pads and a heel pad, blended up into the leg, about 1.3 times the leg's width. Then give the foreleg a slight elbow bend and a pastern angle, so it doesn't stand like a straight post. After that, the wings: flat paper cards that should be one broad sweep with feathers curling forward at the tips.
