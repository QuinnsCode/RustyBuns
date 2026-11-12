# Mothman rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model had flat butterfly wings spread sideways with yellow dots and a
single red blob for eyes. The rebuild follows the Point Pleasant statue's silhouette: wings towering behind and above.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Jersey Devil

## References

- [The Point Pleasant statue (Bob Roach), cropped](https://commons.wikimedia.org/wiki/File:Mothman_Statue_(cropped).jpg)
- [The statue in 2009](https://commons.wikimedia.org/wiki/File:Mothman_Statue_23_May_2009.jpg) and [in 2025](https://commons.wikimedia.org/wiki/File:Mothman_Statue_2025.jpg)
- [An artist's impression of the 1966 sightings](https://commons.wikimedia.org/wiki/File:Mothman_Artist%27s_Impression.png)

Traits: taller than a man, lean and muscular; the head small and sunk between the shoulders; two huge glowing red
eyes; great moth wings behind it, a pointed forewing rising past the head and a rounder hindwing below; a furred
thorax. What a child would draw: the red eyes, the big wings, the dark body.

## What made it better

The generator (`proposals/set-b/mothman.ts`, commit 886f7431, on the PR) writes the sheet.

- **One skin from blobs** (`blend: 0.02`): a chest with pecs, a shoulder hump the head sinks into, long lean limbs.
- **Moth wings, not butterfly wings:** two `membrane`s per side, the forewing's leading edge being the rig's wing chain
  (`l_wroot`, `l_welbow`, `l_wtip`, the tip at 2.8 m), the hindwing a rounder panel below. Ten outline points round each
  edge; `scallop` on a membrane cuts sawteeth, which read as a bat or a leaf, so the moth wings have none.
- **The eyes** are 0.066 m glowing red balls (glow 2.6) set in a slightly larger dark ring, wide on the head.
- **The collar** is a ring of four blob puffs round the neck on their own nodes, painted pale. Tufts there came out as a
  sawtooth bib on the chest.
- **Antennae** are two thin curved `horn`s.

## Still open (builder gaps)

- A `membrane` is one flat colour: no eye-spots, bands or veins. Thin `horn` ribs laid on it as veins stuck out past the
  wing from the side; a moth wing pattern wants a map on the membrane like the body's `hide`.
