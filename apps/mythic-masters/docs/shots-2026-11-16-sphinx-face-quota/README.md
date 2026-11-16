# Sphinx face with its own triangle quota, 2026-11-16

Round 29 of the beast models climb (#4690). It works on round 28's top gap ([shots-2026-11-15-sphinx-dense](../shots-2026-11-15-sphinx-dense/README.md)): the face was a faceted mask, with hard creases and patchy shading across the cheeks and jaw in three-quarter view. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 28 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round, at the same framing ([face-camera.py](face-camera.py), as round 28's)

## What was wrong

The creases were not in the normals or the baked colour. Three renders of the same GLB showed where they came from:

- With every colour taken off (one flat tone), the face's normals already shaded fairly smoothly.
- The `tone` colour on the face is plain white: the occlusion bake adds nothing there, and blurring it changed nothing.
- **With the lights' shadows turned off, the cheeks went smooth.** The face had 775 triangles (about 3 by 6 cm each), and each one cast its own little shadow over the next. That is the terminator problem on a coarse mesh, and normals can't fix it. Only more triangles can.

The full mesh (171768 triangles, before decimation) is smooth all over, so the detail was there to keep.

## What changed

- **`round` on a sheet** (`blender/beast.py`, `low_poly`): `{material: triangles}`. Those materials are decimated on their own first, to that many triangles, with nothing else touched. The main pass then keeps them whole (weight 1 in `keep`), and the rest of the beast pays. `dense` can't do this: its weights stop mattering past about 0.7, and 1 keeps every triangle.
- **The Sphinx** (`sphinx()` in `proposals/set-a/make.ts`): `round: { face: 1800 }` (the face ends with 1915 triangles, up from 775). The nose wedge has 12 sides (a horn's `segments`, 8 by default) and a soft ball at its tip. 8746 of 9000 triangles, feet 4/4, wings 2/2, 30 joints (31 before). Two builds give the same GLB byte for byte.
- At 1500 the face looked about the same as at 1800. The head-cloth and feathers didn't visibly pay at either.

## Scores

- Fresh judge: 4 to 4.5/10, "better (slightly)" ("a heavy brow ridge above the eyes gives the face structure", "the nose and brow still look faceted, like a separate block stuck on"). The climb takes half the gain (+0.25), to 9/10.
- The first judge, on a build that also took the full mesh's normals onto the face, gave the same 4 to 4.5. That normal transfer (Blender's Data Transfer modifier) made every build a different GLB, so it was taken out. Its measured effect on the normals was small (p90 off the full mesh went from 18 to 8 degrees), and the triangle quota is what removed the shadow facets.
- No trait judge this round: `refs/sphinx/` has no pictures on this worker (`--refs sphinx` fetches them).

## What was learned

- To check what makes facets, render three ways: with the colour taken off, with only the vertex colour as emission, and with no shadows. Here it was the shadows.
- Blender's `DATA_TRANSFER` of custom normals isn't deterministic run to run. Keep it out of the builder.

## Next (the judge's top gap)

Both judges named the eyes first. They are small, flat, shiny black beads in a thin outline, with no lids that read, so the stare looks dead. Make them bigger almond eyes with lids, a coloured iris and a catchlight, set a little wide (the climb's faces-first direction). Then blend the brow and nose into the head instead of leaving them as blocks, and give the lips a soft hint of a smile.
