# Sasquatch rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model was a tube figure under rows of leaf-like tufts, orange, with a
small boxy head. The rebuild is one blended skin from blobs, built from the references below.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Kappa

## References

- [The 1967 film frame (Patterson and Gimlin)](https://commons.wikimedia.org/wiki/File:Patterson_Gimlin_Bigfoot_(cropped).jpg)
- [Bigfoot Trails statue, Cataloochee, NC (Flickr upload on Commons)](https://commons.wikimedia.org/wiki/File:Bigfoot_Trails_Statue,_Cataloochee,_NC_(46721642951).jpg)
- [Murphy the Bigfoot, a museum figure's face](https://commons.wikimedia.org/wiki/File:Murphy_the_Bigfoot.jpg)
- [The Pikes Peak carved Bigfoot](https://commons.wikimedia.org/wiki/File:Pikes_Peak_Bigfoot_P4160515.jpg)

Traits: huge and dark brown; no neck, the head sunk into a hump of shoulder; a peaked, cone-shaped crown; a bare face
under a heavy brow, deep-set eyes, a flat broad nose and a wide thin mouth; arms hanging past the hips; a barrel chest
and belly; bent knees; long flat feet. What a child would draw: a big hairy body, the pointed head, the giant feet.

## What made it better

The generator (`proposals/set-b/sasquatch.ts` with a shared `lib.ts`, and `shot.py` for the ortho views; commit 28495670, on the PR)
writes the sheet.

- **The body is all blobs** (pelvis, belly, chest, a hump at the neck, deltoids, upper arms, forearms, thighs, knees,
  calves, ankles) merged by `blend: 0.03`, so the fur hide covers the whole beast. `limb` parts would have stayed plain
  fur next to a hide-mapped trunk.
- **The cone crown is a tilted blob** on the head with a small `crest` node at its peak, which keeps the head the rig's
  highest tip (see the Agropelter's notes).
- **A big head:** the whole head (cranium, cone, brow, muzzle, chin, two jowls) is built at 1.35 times life size, as on the
  big-head starters the owner picked. Face parts are placed on its skin with the ray-cast `skin()`.
- **The bare face** is a `mask` node in front of the eyes, painted `face` (as on the Agropelter). The paint fades softly
  into the fur, so it needs a face colour well apart from the fur's, or it vanishes.
- **Fur:** `hide` pattern `fur` at `size: 0.035`. Tufts are kept to the back, the head and the backs of the arms, laid
  flat (`flat: 0.2`, `sink: 0.95`, `sweep: 2.6`). Standing out (the defaults), they read as leaves or shingles.

## Traps

- **A hide's `colours` are absolute sRGB**, turned into ratios over the body colour. Grey multipliers like
  `[0.55, 0.52, 0.5]` over a brown body come out blue-grey.
- A `ridge` placed across the head's side for a brow sticks out sideways like an ear. The brow is a blob instead.

## Still open (builder gaps)

- The `fur` pattern's strands run along +x (a four-legged body's length). On an upright beast they run across the
  body; up close the fur reads as dapples rather than hanging hair.
- A blob under `blend` can't keep its own material, so the brow and the face's hair ruff can't be another colour except
  through `paint` by nearest node.
