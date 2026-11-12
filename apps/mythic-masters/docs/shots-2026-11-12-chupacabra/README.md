# Chupacabra rebuild, 2026-11-12

Part of the beast spike (#4249, lane 3, set A). The old sheet was a skin-modifier lizard with stick arms, a row of purple
cones and two red balls for eyes. The rebuild is one blended skin of blobs, kept upright (`feet: 2`) as its sheet always was.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model (contact sheet, ortho close-ups from git main)
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild
- [gallery.jpg](gallery.jpg): gallery page 0, with the Rougarou beside it

## References

- [Chupacabras (vector)](https://commons.wikimedia.org/wiki/File:Chupacabras.svg), LeCire, vectorised by Karta24, public domain ([ref-lecire-color.jpg](ref-lecire-color.jpg))
- [Chupacabra](https://commons.wikimedia.org/wiki/File:Chupacabra_padayachee.jpg), Alvin Padayachee, public domain ([ref-padayachee.jpg](ref-padayachee.jpg))
- [Chupacadabra](https://commons.wikimedia.org/wiki/File:Chupacadabra.jpeg), Mebeingyou, CC BY-SA 3.0 ([ref-mebeingyou.jpg](ref-mebeingyou.jpg))

The full list (and the ones skipped: a photo of a person with a trap) is in `refs/chupacabra.json`, with the traits.

Traits: a child-sized upright hopper, hunched on bent legs; a big bald head wider at the top, huge slanted black eyes,
a tiny nose and mouth; thin arms held up in front with long claws; a row of long quills from the crown down the back;
grey-green scaly skin, dark blotches, a paler belly. What a child draws: the black eyes, the spikes, an alien kangaroo.

## What changed

- **Body:** blobs for the pot belly, narrow shoulders, big haunches, a knee knob, a long shin and a backward hock,
  merged by `blend: 0.022`. Root on the chest: the rig's root sits at 0.76 of the height, so the puppet reads it as upright.
- **Head:** a dome, a narrow face and a small chin at 1.3 times size. Each eye is two overlapping black spheres
  (an almond slanting up and back) with a glint; nostrils, a small mouth line and two fangs, all ray-cast on the skin.
- **Quills:** 10 pale curved `horn`s placed by ray-cast along the crown and spine, longest at the crown and shoulders.
- **Hide:** `scales` at 0.014 m with a `spots` overlay for the dark blotches; three-toed `talon` feet, hooked claws.
- 7000 triangles, feet 2/2.

## Lessons

- Two overlapping eye spheres make an almond only when they overlap by more than half; set apart they read as bug eyes.
- An eye sunk more than half its radius into a blended head vanishes into a dark smudge.

## Still open (builder gaps)

- An eye is always a sphere: a slanted almond eye (the trait every drawing has) needs an `eye` with a squash and a tilt.
- The `spots` overlay also lands on the face, so a blotch can sit between the eyes; a mask or a "below" limit would help.
