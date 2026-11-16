# Sphinx face given more of the budget, 2026-11-15

Round 28 of the beast models climb (#4683). It works on round 27's top gap ([shots-2026-11-15-sphinx-wrap](../shots-2026-11-15-sphinx-wrap/README.md)): the face was faceted and doll-like, with sharp creases in three-quarter view, because the decimator took the head down with the rest of the beast to 9000 triangles. Run it with `bun proposals/set-a/make.ts sphinx`, then `bun scripts/beasts.ts sphinx`.

- [before.jpg](before.jpg), [before-face.jpg](before-face.jpg): main after round 27 (front, side, three-quarter, head; then the head close up: front, profile, three-quarter)
- [now.jpg](now.jpg), [now-face.jpg](now-face.jpg): this round, at the same framing

The head close-ups come from [face-camera.py](face-camera.py) (`blender -b --factory-startup -P face-camera.py -- <in.glb> <out>`): orthographic, 0.95 m wide, centred on the front 0.45 m of the beast above 45% of its height, with `blender/closeups.py`'s lights.

## What changed

- **`dense` on a sheet** (`blender/beast.py`, `low_poly`): a map from materials to how much of their detail the decimator keeps, as weights in the `keep` vertex group it already leaves alone. The beast stays at its budget, and the parts not named (the furred lion body, under its baked hide) pay.
- **The Sphinx** (`sphinx()` in `proposals/set-a/make.ts`): face 0.7; lips, eyes, kohl, pupils and mouth 1; head-cloth (cloth, gold) and feathers 0.75. 8750 triangles, feet 4/4, wings 2/2, 31 joints. The GLB builds the same byte for byte twice.

## Scores

- Fresh judge: 4.5 to 5.5/10, "better" ("the wing feathers changed from jagged, broken-looking shards into rounded, evenly spaced feather blades", "the head-cloth crown now wraps the skull in continuous bands instead of crumpled zig-zag strips", smoother lips). The climb takes half the gain (+0.5).
- Trait judge against the references: 4/10 (round 27: 5/10). Its fix: broader, smoother wings curling forward at the tips, and a heavier, smoother lion body.

## What was learned

- The decimator is zero-sum. Keeping only the face (weight 0.6 on the face's materials) rounded the brow and cheeks but shredded the head-cloth ribbons and turned the feathers into shards. Keeping the cloth at 1 starved the face until the lips and eyes nearly vanished. Name every hand-made part that should stay crisp, and let the blended furred body pay.
- Weight 1 on all the face's materials keeps every triangle: 16678 of a 9000 budget, and the rig found 0 of 4 feet.
- Raising the face from 0.7 to 0.85 gave the same mesh: the weight stops mattering past about 0.7.

## Next (the judge's top gap)

The face is still a faceted mask: hard creases and shading seams across the cheeks and jaw in three-quarter view, the nose a sharp wedge, and no blend into the neck or the head-cloth's edge. Smooth the face's shading (the 40 degree auto-smooth and the weighted normals both run on the decimated mesh), round the cheekbones, jaw and nose bridge, and close the seam at the cloth. Then the lappets: separate boxes with ragged gold at their bottom edges; make each side one striped panel.
