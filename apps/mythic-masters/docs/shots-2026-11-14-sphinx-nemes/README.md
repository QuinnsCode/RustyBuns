# Sphinx head-cloth and legs, 2026-11-14

Round 18 of the beast models climb (#4613). It works on the top gap from round 17 ([shots-2026-11-14-sphinx](../shots-2026-11-14-sphinx/README.md)): the head-cloth was a furry blue blob, and the legs were thin stilts with knobbly joints. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg): main after round 17 (front, side, three-quarter, head; ortho close-ups)
- [now.jpg](now.jpg): this round, at the same scale

## What changed

- **Head-cloth as ribbons:** the cap blob and the `nm`, `l_flap` and `l_lap` nodes are gone. Each stripe is now its own flat `horn` part (`flat` 0.22, the same width at both ends, bent toward the head), alternating `cloth` blue and `gold`, with each gold one 4 mm proud of the blue so the two don't flicker.
  - **Cap:** 13 meridians from the brow over the crown to the nape.
  - **Flaps:** 10 level bands per side, stacked from the temple to the shoulder, each one longer and further out than the one above.
  - **Lappets:** 7 short bands per side down the breast.
  - **Brow band:** a gold arc across the forehead, temple to temple. The cobra stays.
  - Parts aren't body material, so the fur hide no longer covers the cloth. That was why round 17's cap came out furry: blended blobs and `paint` both fold into the body's hide.
- **Lion legs:** each bone gets a muscle blob high up (`muscle()` in `sphinx()`): upper arm, forearm, wrist, thigh, gaskin and shank. The leg now tapers from a heavy forearm or gaskin down to the paw, with no thin shafts between knobs.
- **Face** colour lighter (0.88, 0.7, 0.48). It barely shows (see below).
- Still 8914 triangles, feet 4/4, wings 2/2, 29 joints and 10 tips. `beasts.test.ts` passes (105).

## Scores

- Paired judge, out of 10: BEFORE 3 to NOW 4.5, verdict "better". The climb takes half the gain (+0.75).
- Trait judge against the references: 3/10. Its fix: "a heavy crouched lion with big paws, and a smooth, calm human face".

## What was learned

- A part in its own material is the way to get a clean colour on a furry beast. Blobs (with `blend`) and `paint` are both body faces, and the hide's map multiplies over them, so their colour comes out furred.
- The same applies to the face: it's painted, so it carries the fur. That's why it reads as a lumpy, muddy blob. A smooth face needs the builder to keep painted faces out of the hide (`bake_hide` in `blender/beast.py`), or the face built as parts.

## Next (the judge's top gap)

The face still reads as a lumpy, muddy brown blob with no readable brow, nose, jaw or eyes. It needs to be out of the fur hide (a builder change, or the face as smooth parts) with clear features. After that: chunky lion shoulders and haunches, bigger paws, and a crouched couchant pose like the references.
