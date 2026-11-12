# Kappa rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model had a boxy torso, a shell standing off the back like a plate, a
cyan diamond for the dish, and its eyes set into a flat face. The rebuild is one blended skin from blobs, built from the
references below.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Sasquatch

## References

- [A kappa, 1836 water-imp plate](https://commons.wikimedia.org/wiki/File:Kappa_water_imp_1836.jpg)
- [Wakan Sansai Zue (1712), the kappa entry](https://commons.wikimedia.org/wiki/File:Kappa-Wakan-Sansaizue-cropped.jpg)
- [A woodblock kappa among reeds](https://commons.wikimedia.org/wiki/File:Kappa_jap_myth.jpg)
- [The Kappa-dera temple statue, Asakusa](https://commons.wikimedia.org/wiki/File:Kappa-dera_Temple_Kappa_statue.jpg)
- [A green kappa statue on a Tokyo street](https://commons.wikimedia.org/wiki/File:Green_Kappa_statue.jpg)

Traits: child-sized, crouched, long thin limbs; frog-green skin with dark spots; a turtle's shell on the back and a pale
plastron in front; a beak; round yellow eyes; a dish of water on the crown ringed by a fringe of hair; webbed hands and
feet. What a child would draw: the shell, the dish on its head, the beak.

## What made it better

The generator (`proposals/set-b/kappa.ts` with a shared `lib.ts`, and `shot.py` for the ortho views; commit 28495670, on the PR)
writes the sheet.

- **One skin from blobs** (`blend: 0.012`): the belly, chest, neck, limbs, a blob each for the feet and hands, the round
  head and the carapace and plastron.
- **The shell's colour is `paint`** over five small nodes inside the carapace blob (`shell`, `shell_top`, `shell_low`,
  and an `l_shell` pair). One node coloured only the shell's middle: paint goes to the nearest node, and the shoulders
  won the shell's edges.
- **The dish is two short `horn`s** pointing up with `tip_base` a little over `base`: flat discs, a pale rim with the
  water in it. The fringe is a ring of 16 short flat `horn`s hanging off the crown round it.
- **The beak** is two flattened `horn`s (`flat: 0.7`), a hooked upper bill over a shorter lower one.
- **The eyes** are a yellow ball, a pupil and a glint, laid on the head's skin with `skin()`.
- **Hide:** `pattern: "spots"`. The `skin` pattern's folds came out as watermelon stripes on a body this small.

## Still open (builder gaps)

- The shell has no scutes or rim; a shell pattern would need a hide of its own, since `hide` covers the whole body.
- The `web` foot is a thin flat fan. From the side it reads as a line on the ground, so the foot blob carries the shape.
