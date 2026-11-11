# Jackalope rebuild, 2026-11-11

The owner scored the starters about 1.3 out of 10 next to the references (#4172). Three rebuilds of the Jackalope were
tried (comparison page https://claude.ai/artifact/362PyvupwmAm8ggH66kkTS), and the owner picked C, the big-head starter.
It is now `beasts/jackalope.json`.

- [now.jpg](now.jpg): the old model
- [starter.jpg](starter.jpg): the pick, a sitting hare with a head near half its height
- [statue.jpg](statue.jpg), [plains.jpg](plains.jpg): the two that weren't picked (the Douglas statue, and the crouched hare of the plates)

## References

- [The Douglas, Wyoming statue (Carol M. Highsmith)](https://commons.wikimedia.org/wiki/File:One_of_Wyoming%27s_%22Official_Mythological_Creatures,%22_the_jackalope,_in_Douglas,_Wyoming_LCCN2015634051.tif)
- [A mounted head, side on](https://commons.wikimedia.org/wiki/File:Jackalope.JPG) and [from the front](https://commons.wikimedia.org/wiki/File:Jackalope_101.jpg)
- ["Le lièvre cornu", an 18th-century engraving](https://commons.wikimedia.org/wiki/File:Lepus_cornutus.jpg)
- [Hoefnagel, Animalia Quadrupedia et Reptilia, plate XLVII](https://commons.wikimedia.org/wiki/File:Animalia_Qvadrvpedia_et_Reptilia_(Terra)_Plate_XLVII.jpg)

Shared traits: a jackrabbit body on a big folded haunch, long hind feet flat on the ground, tall ears, deer antlers
rising between the ears with two or three tines, a big dark eye high on the side, pale muzzle, throat and belly.

## What made it better, for the next starter

The generator (`proposals/jackalope/make-jackalope.ts`, commit 790a6dc0, on the PR) has these pieces:

- **One skin from blobs:** the body, haunches, the long hind feet, the legs and the head (a cranium, a muzzle and two
  cheeks) are all ellipsoids merged by `blend: 0.009`. The hind foot is a long flat blob on the hock node, lying on the
  ground in front of the haunch.
- **Faces on the skin:** each face part sits on the head blobs with the same ray-cast `skin()` as the Squonk's.
- **An eye that reads at fight size:** a pale `ring` ball sunk a little deeper, the dark eye standing out of it, and a
  small white glint up front. A glint pushed too far out pokes off the side of the head.
- **Ears and antlers apart:** ears root further out on the crown and splay out (`dir` z 0.3 to 0.4), the antlers root
  near the middle, so from the front the antlers rise between the ears as in the mounts. Each ear is two `ear` leaves:
  the fur back and a smaller pale inner one laid just in front.
- **A pale bib:** a short chain of nodes just under the chest's skin (`bib1`, `bib2`, linked from `chest`) that `paint`
  colours. Too deep and the chest's own link wins every face; too far out and it bulges.
- **Feet:** sitting, the front paws stand between the hind feet. Closer than about 0.1 m across and the rigger merges
  them (1 or 3 feet of 4): front paws at z 0.045, hind feet at z 0.16 to 0.17.
- **Traps:** longer antler tines (0.16 m) made the rigger drop a foot, so they stay short. The lip ridges curving
  under the muzzle read as a goatee and were cut.
- **Still open:** tines are plain cones, the fur is smooth (no ticking or dark ear rims), ears are thin flat leaves,
  and a sitting pose gets pulled out of shape by the four-legged walk.
