# Squonk rebuild, 2026-11-10

The owner scored the starters about 1.3 out of 10 next to the references. Four rebuilds of the Squonk were tried (PR #4173,
comparison page https://claude.ai/artifact/NdnayKsnJmbKzP6Bj3oxNX). The owner said the first three were still bad and
shared a photo of a clay Squonk sculpture. The fourth candidate was built from that photo over three rounds, and the
owner picked it. It is now `beasts/squonk.json`.

- [now.jpg](now.jpg): the old model
- [sculpt.jpg](sculpt.jpg): the pick, the sculpture's body under the weeping face
- [cox.jpg](cox.jpg), [tryon.jpg](tryon.jpg), [starter.jpg](starter.jpg): the three that weren't picked

## References

- [Cox, Fearsome Creatures of the Lumberwoods (1910), drawn by Coert Du Bois](https://commons.wikimedia.org/wiki/File:Squonk.png)
- [The same plate, book scan page 36](https://commons.wikimedia.org/wiki/File:Fearsome_Creatures_of_the_Lumberwoods,_with_a_Few_Desert_and_Mountain_Beasts_(page_36_crop).png)
- [Tryon, Fearsome Critters (1939), drawn by Margaret R. Tryon](https://commons.wikimedia.org/wiki/File:Squonk.jpg)
- The owner's photo of a clay sculpture (not committed, since it's someone's artwork). It has a pale barrel body in deep
  even rolls, stout legs with wrinkles and nailed toes, and long drooping ears.

## What made it better, for the next starter

The generator (`proposals/squonk/make-squonk.ts`, last in commit d4aa5fd2) has these pieces:

- **Rolls of skin:** thin ellipsoid rings a little bigger than the torso, merged by `blend`. At 5,200 triangles the
  decimator cuts them into jagged edges. At 9,000 (with `blend: 0.008`) they come out smooth.
- **Legs as blobs:** a thigh, a knee knob, a shin, three thin rings at the ankle, a pad, four toe ellipsoids, and an `eye`
  ball for each nail. They blend into one skin with the body, so the legs get knees and ankles, not `limb` tubes.
  The blobs go on the `l_` nodes and their `r_` twins (offset z flipped). The rigger still finds 4 feet.
- **Faces placed on the skin:** every face part goes on the blobs' surface with a ray-cast (`skin()`), not a guessed
  offset. A ridge laid straight across a curved head (forehead wrinkles, a long tear) sticks off it like a comb or a fin.
- **Tears:** a thin wet ridge on the lower lid, a bead at its corner, and a trail of small `eye` beads sunk into the cheek.
  Drops hanging off the jowl or chin read as earrings.
- **What didn't work:** blending the eye socket from a ring of small blobs worked, but nose and lip colour done by
  `paint` on extra nodes bleeds across the muzzle. The owner preferred the round weeping face anyway.
- **Still open:** the ears are thin flat `ear` leaves, where the sculpture's are thick and fleshy.
