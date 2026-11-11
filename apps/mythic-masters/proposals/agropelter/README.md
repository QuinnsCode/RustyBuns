# Agropelter candidates

The owner scored the starters about 1.3 out of 10 next to the references (#4172). These are three rebuilt
directions for the Agropelter, built the way the Hodag was (#4171). Each rigs with 2 feet and fits a
6800-triangle budget (today's `beasts/agropelter.json` is 6400). Comparison page:
https://claude.ai/artifact/6Hi6MEPjZeS4g6hg9HnQaA

| Candidate | Sheet | From | Shot |
|---|---|---|---|
| A, 1910 | `agropelter-cox.json` | Cox's plate: a lean hunched ape, long sly face, black mane, rope-thin arms far longer than its legs looping back and forward, a branch in one fist | [cox.jpg](../../docs/shots-2026-11-10-agropelter/cox.jpg) |
| B, 1939 | `agropelter-tryon.json` | Tryon's drawing: squat and pot-bellied, a wide toothy grin under a low brow, big pointed ears, long heavier arms with hooked fingers round a branch | [tryon.jpg](../../docs/shots-2026-11-10-agropelter/tryon.jpg) |
| C, starter | `agropelter-starter.json` | both plates on starter proportions: a head near half the beast, big eyes, a huge grin, tall ears, whip arms holding a branch overhead in both fists | [starter.jpg](../../docs/shots-2026-11-10-agropelter/starter.jpg) |

Today's model, from the same camera: [now.jpg](../../docs/shots-2026-11-10-agropelter/now.jpg).

## References

- [Cox, Fearsome Creatures of the Lumberwoods (1910), p. 40](https://commons.wikimedia.org/wiki/File:Fearsome_Creatures_of_the_Lumberwoods,_with_a_Few_Desert_and_Mountain_Beasts_(page_40_crop).png)
- [Tryon, Fearsome Critters (1939)](https://commons.wikimedia.org/wiki/File:Agropelter.jpg)

Those are the only two period plates of the Agropelter on Commons. What both share: an ape's face with a
villainous grin, arms longer than its legs, a shaggy dark mane, pointed ears, a dead branch in its fist, a hunch.

## How it is built

- The head is round flesh from `blobs` (cranium, a jutting muzzle, a chin, a brow) merged with `blend`, as on the Hodag.
  A `mask` node just behind the eyes, with `snout` and `jaw`, is painted `face`, so the bare ape face shows.
- The grin is a dark `ridge` lip band with `horn` teeth on the muzzle's surface. Brows are `ridge`s.
- Each arm is a chain of 7 to 14 nodes on a Catmull-Rom curve (`arm()` in `make.ts`) under one `limb`, so a
  whip-thin arm bends round instead of kinking at one elbow.
- Ears are `ear` parts. The ear's `width` is a radius, so it is kept near a third of `len`, or the ear comes out round.
- The branch is `horn`s in `bark`: a blunt trunk through the left fist, a stub behind it, a splintered end and two forked twigs.
  Four hooked `horn` fingers curl round it.

## Build and look

```sh
bun proposals/agropelter/make.ts
blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/agropelter/agropelter-cox.json --render
bun proposals/agropelter/make.ts --check   # rigs every built GLB, says whether it finds 2 feet
```

The GLB lands in `public/models/agropelter-<name>.glb` (don't commit it) and the contact sheet in `blender/out/`.

## Once one is picked

Copy its sheet over `beasts/agropelter.json` with `"id": "agropelter"` (the `about` is already the live one),
run `bun scripts/beasts.ts --render agropelter`, and delete this folder.
