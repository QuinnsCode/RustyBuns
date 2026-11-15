# Sphinx profile, 2026-11-15

Round 25 of the beast models climb (#4656). It works on round 24's top gap ([shots-2026-11-14-sphinx-paws](../shots-2026-11-14-sphinx-paws/README.md)): the face read flat and snouted, with a rubbery mouth, and the head-cloth sat on top like a separate cap with bare scalp behind it. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 24 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round, at the same framing

The head close-ups are an orthographic camera, 0.95 m wide, on the middle of the front 0.45 m of the beast above 45% of its height (`blender/closeups.py`'s camera and lights).

## What changed (`sphinx()` in `proposals/set-a/make.ts`)

- **No snout.** The round nose blob (centred low, about 5 cm deep) blended into the face as a muzzle. In its place is a straight nose: a `horn` in the `face` material from the bridge between the eyes, down and forward to a broad tip (flat 0.7). It is its own part, so the blend can't melt it.
- **A jaw**: a pair of blobs at the jaw's corners under the ears, so the face is a square jaw narrowing to the chin, not one egg. The cheekbones sit a little higher and further out.
- **Quieter lips**: thinner ridges in a muted brown-red, no longer two red diamonds.
- **The head-cloth wraps the skull**: the flaps start at the temple, higher, and reach back past the skull (0.2 to 0.24 of the head-scale, up from 0.11 to 0.18), and the cap's meridians run 10 degrees further down the nape. No bare scalp shows between the cap and the flaps.
- 8909 triangles, feet 4/4, wings 2/2, 31 joints.

## Scores

- Fresh judge: 3.5 to 4/10, "better" ("a real straight nose instead of the snout-like bulge", "the side lappet is a clean striped panel that frames the face"). The climb takes half the gain (+0.25).
- Trait judge against the references: 4/10 (round 24: 4/10).

## What was learned

- A cap of ribbons at a smaller radius (0.145 of the head-scale, not 0.15) lets the cranium poke through between the meridians. Sink the cloth by covering more of the skull, not by pulling it in.
- Lips thinner than about 0.011 of the head-scale vanish at close-up size. 0.013 reads.

## Next (the judges' top gap)

The face as one sculpted mesh: set the eyes into sockets under the brow ridge, so the kohl lids stop floating as paper-thin shards; give the lips volume; firm up the cheekbones and jaw. The trait judge still wants a longer, thicker neck with the head higher, and rounder wings that curl forward.
