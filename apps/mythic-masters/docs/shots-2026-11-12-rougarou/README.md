# Rougarou rebuild, 2026-11-12

Part of the beast spike (#4249, lane 3, set A). The old sheet was a skin-modifier tube body, smooth and brown, with a
scaly tail and a boxy snout. The rebuild is one blended skin of blobs with the set A wolf head, kept upright (`feet: 2`).

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model (contact sheet, ortho close-ups from git main)
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild
- [fight.jpg](fight.jpg): side-on (`camera("side")`) in a bot fight against the Chupacabra, no page errors

## References

- [Rougarou, swamp museum figure](https://commons.wikimedia.org/wiki/File:Rougarou.jpg), XxxJohnDoExxxx, CC BY-SA 4.0 ([ref-swamp-figure.jpg](ref-swamp-figure.jpg))
- [Loup-garou](https://commons.wikimedia.org/wiki/File:Loup-garou_dessin%C3%A9_par_Henri_Julien.png), Henri Julien, public domain ([ref-henri-julien.jpg](ref-henri-julien.jpg))
- [Werewolf head](https://commons.wikimedia.org/wiki/File:Painting_Werewolfhead.jpg), Ixitixel, public domain ([ref-ixitixel.jpg](ref-ixitixel.jpg))

The Commons search for the name brings back a roller coaster and its pin; those are skipped in `refs/rougarou.json`,
which searches the werewolf category instead.

Traits: a tall wolf standing as a man, broad shaggy shoulders over a lean waist, digitigrade legs, a bushy tail; a long
muzzle snarling open, tall pointed ears, red eyes; long clawed arms held out; grey-brown shag, a paler muzzle and
chest. What a child draws: a wolf standing up like a man, the glowing red eyes, the big teeth.

## What changed

- **Body:** a barrel chest and heavy shoulders over a lean waist, blob arms and digitigrade legs (thigh, knee knob,
  shin, hock, long foot), a tail grown from the rump. The mass sits high on purpose: the rig's root is at 0.68 of the
  height (the Jersey Devil's lesson), so the puppet reads it as upright.
- **Head:** the set A wolf head (`proposals/set-a/make.ts`) at 1.55 with the muzzle at 1.05, the jaw hung wide (`gape` 1.4), fangs on both
  lips, a dark gullet, glowing red eyes under brows, tall pointed ears.
- **Arms** reach forward to long hooked claws; wolf `paw` feet with claws.
- **Fur:** a `fur` hide, thin strands (base 0.03) down the back, a darker mane over the neck and shoulders, fringes
  on the arms and thighs, a bushy tail.
- 8992 triangles, feet 2/2.

## Lessons

- **Trap:** the puppet's head is the highest tip plus every tip within 0.35 of the body's size (`headOf` in
  `src/beasts.ts`). With tall ears on top of a long muzzle, the snout tip fell outside that and was swung as a
  hanging limb (the upright-limbs test in `test/beasts.test.ts` counts 4, not 3). Shorter ears (`len` 0.17 of the
  head) and a slightly shorter muzzle (`M` 1.05) bring it back. Check `hangingLimbs` after changing a head, not only the feet.
- An extra paint chain under the chest (a bib) is a branch the rig can count as a limb too.
- An `ear`'s `thick` lobe rounds its tip: at 0.08 the ears read as a rabbit's. Leave `thick` off for a pricked wolf ear.

## Still open (builder gaps)

- The ears still come out round-ended from the front even flat: an `ear` with a pointed tip would fix it.
- No paler throat and chest yet: a `paint`ed bib barely showed through the `fur` hide, and its chain added a limb, so it is out.
- The `fur` strands run along +x, across an upright body (the lane 4 gap), so the coat reads mottled, not hanging.
- In the arena the rim light washes the grey coat pale (#4265).
