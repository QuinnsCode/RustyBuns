# Starter faces, cute but could be scary, 2026-11-15

Round 29 of the beast models climb (#4690), the first on the owner's direction for faces: halfway between cute and horrifying, a creature that *could* be frightening but turns out to be sweet. This round does three starters whose faces read as plain monsters or as blank beads: the Hodag, the Agropelter and the Jackalope. Rebuild them with `bun scripts/beasts.ts hodag agropelter jackalope`.

- [before.jpg](before.jpg): main, one row a beast (Hodag, Agropelter, Jackalope), each front, profile and three-quarter of the head
- [now.jpg](now.jpg): this round, at the same framing

The head close-ups come from [faces.py](faces.py) (`blender -b --factory-startup -P faces.py -- blender/closeups.py <in.glb> <out.png>`): `closeups.py`'s head box, 1.4 times its size, the centre dropped by 0.12 of that so the mouth is in frame.

## What changed (the sheets in `beasts/`, by hand)

- **Eyes that look back at you.** Each eye has a big dark pupil filling about 60% of its front and a white catchlight up and out (a `glint` material, glow 1.2). The glowing eyes glow less: the Hodag's eyes are amber at 0.5 (was orange at 2.2) and 15% bigger, and the Agropelter's are yellow at 0.45 (was 1.6) and 15% bigger. Before, the Agropelter's yellow eyes had no pupils. The Jackalope's black beads are now a warm brown iris round a black pupil, in a ring 20% bigger.
- **Brows tipped up at the middle**, from a scowl's V to curious and a little worried: the Hodag's and Agropelter's brow ridges are raised a little and turned.
- **The Hodag's mouth corners turned up** into a toothy grin. It keeps its fangs and horns.
- Triangles, feet and joints as before (Hodag 6999, feet 4/4; Agropelter 6798, feet 2/2; Jackalope 5584, feet 4/4).

## Scores

- Fresh judge, told the face direction: 3.5 to 4.5/10, "better". The Agropelter gained most ("before, glowing pupil-less eyes read as possessed; now goofy and likeable"). The Hodag moved "from glaring to wide-eyed and curious". The Jackalope is mixed: its eyes are charming but sit proud of the skull with no lids, so they read a little startled. The climb takes half the gain (+0.5).

## Next (the judge's top gap)

The mouths read as a grimace: a flat dark slit with a full row of even teeth says "about to bite", not "secretly sweet". Turn the corners up into a soft closed smile or a smirk. Cut the teeth to one or two oversized fangs or buck teeth, and give the mouth a lip line or a cheek bulge so it makes an expression. Then sink the eyes into sockets with simple upper lids (a relaxed half-lid reads friendly). The Agropelter's brows still scowl a little, and the Hodag's brow is a heavy ridge.
