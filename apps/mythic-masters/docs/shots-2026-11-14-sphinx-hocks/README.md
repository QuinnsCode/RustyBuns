# Sphinx hocks, 2026-11-14 (notes: not kept)

Round 22 of the beast models climb (#4632). It worked on the top gap from round 21 ([shots-2026-11-14-sphinx-limbs](../shots-2026-11-14-sphinx-limbs/README.md)): the hind legs were stiff and stubby, with block-like knee and hock joints. The judges scored it "same", so the change was not kept. Its code is in [tried.diff](tried.diff) (`git apply` from the repo root).

- [before.jpg](before.jpg): main after round 21 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): the tried change, at the same scale

## What was tried

- **A lion's hind leg in the pose** (`sphinx()` in `proposals/set-a/make.ts`): the knee forward of where round 21 put it, the hock 0.05 k further back and 0.08 k higher, the paw 0.05 k forward, so the gaskin is longer and slants back and the cannon bone slants forward to the paw.
- **A slim hock**: the hind `limb` radii 0.17, 0.115, 0.05, 0.048 (were 0.16, 0.1, 0.06, 0.058).
- **`foot` takes `r`** (`blender/beast.py`): the paw's size in metres, the node's radius by default, so a slim leg node can carry a deep paw. The hind paw node went to 0.035 k with `r` 0.07 k. With a fat node (0.07 k), the skin from the hock down swells into a cone: that cone was the "block" under the hock in round 21.
- 8922 triangles, feet 4/4, wings 2/2, 31 joints.

## Scores

- Paired judge, out of 10: BEFORE 4 to NOW 4, verdict "same". "The hind legs now bend more at the hock... still look blocky and stacked from separate pieces."
- Trait judge against the references: 3/10 (round 21: 4/10). Its fix: "rebuild the legs, paws and haunches as heavy, muscled lion limbs."

## What was learned

- In `limb`, `calf` bulges at 35% of the whole chain. With the chain hip, knee, hock, paw (plus the buried top), that is the thigh, not the gaskin, so `calf` can't swell a gaskin. A gaskin bulge needs its own place along the chain (a `calf_at`, say) or a skin blob behind the shank.
- The slim node made the cannon slim, but next to the forelegs (still on fat 0.07 k nodes) the hind legs looked thin and stick-like, and the paws looked flat. Fore and hind should change together.
- The knee and thigh still show hard creases where the haunch blob meets the limb. The judge's eye goes there before it reaches the hock.

## Next (the judges' top gap)

The hind legs still read as stacked cylinders with a hard kink and thin, flat paddle feet. They should be one tapered limb: a thick muscled thigh blending into the haunch, a narrow hock angled back, then a short upright lower leg ending in a round, padded paw as wide as the forepaws. Start from [tried.diff](tried.diff), give the hind paw the forepaw's width and depth, and blend the haunch into the thigh (one blob, not a slab on a tube).
