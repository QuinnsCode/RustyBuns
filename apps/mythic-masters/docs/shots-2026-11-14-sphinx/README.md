# Sphinx rebuild, 2026-11-14

Round 17 of the beast models climb (#4609). This is the first of the Africa and Europe sheets after the Chimera to be rebuilt from references.
The old sheet had a potato body on stick legs and a thin snake neck. Its round bald head sat in a flat blue panel, and its wings were two flat blue-and-cream paddles.
The rebuild uses the set A lion body (`hound()`). It puts a man's head in place of the hound's, and feathered wings on the shoulders. Run it with `bun proposals/set-a/make.ts sphinx`.

- [before.jpg](before.jpg): the old model (front, side, three-quarter, head; ortho close-ups from git main)
- [now.jpg](now.jpg): the rebuild, at the same scale

## References

From `refs/sphinx.json` (`bun scripts/beast-refs.ts --refs sphinx` downloads them again). The wide Giza tourist photo and a scarab seal are in `skip`.

- [028MAD Sphinx](https://commons.wikimedia.org/wiki/File:028MAD_Sphinx.jpg), the Naxian sphinx (the bestiary card's picture), CC BY-SA 3.0
- [Le Sphynx](https://commons.wikimedia.org/wiki/File:Album_de_voyages_en_%C3%89gypte,_Gr%C3%A8ce,_Turquie,_Alg%C3%A9rie_et_Russie_-_btv1b84515044_(20_of_63).jpg), Giza, an album of 19th-century photographs, public domain
- [Sphinx at the Met](https://commons.wikimedia.org/wiki/File:Visiting_The_MET_MUSEUM_(91).jpg), Ferfive, CC BY 4.0
- [Townley Sphinx](https://commons.wikimedia.org/wiki/File:Sphinx_Townley_British_Museum.jpg), British Museum, CC BY-SA 4.0

## What changed

- **Lion:** the hound body standing proud, with the breast lifted, thick legs (`legs` 1.3), big paws (`paw` 2.2), a pale bib and belly, and a long tail with a tuft at the end.
- **Head:** the hound's head is taken out (its cranium, muzzle, jaw, teeth and ears). A man's head goes in its place, 1.4 times life size so it reads at fight size. It has a cranium, a face narrowing to a chin, a straight nose, a brow and cheekbones, all blended into one skin, plus almond eyes lined in kohl, full closed lips and a plaited beard.
- **Head-cloth:** a blue cap over the crown, flat flaps behind the cheeks and two lappets down the breast (`nm`, `l_flap`, `l_lap` painted `cloth`), and a gold cobra on the brow.
- **Wings:** an arm from each shoulder blade that rises high and back and curls forward at the tip. On it is a cupped cream membrane with 16 long sandstone primaries swept back along the trailing edge, as on the Naxian and Townley marbles.
- 8914 triangles, feet 4/4, wings 2/2, 27 joints and 8 tips. The `beasts.test.ts` suite passes (105).
- `scripts/commons.ts` no longer refuses a Commons file whose artist credit runs past 5000 characters (the Giza album's credit was a whole list of photographers). It cuts the credit instead, and `plain` keeps 200 characters of it anyway.

## Scores

- Paired judge, out of 10: BEFORE 3 to NOW 4.5, verdict "better". On the climb that counts as half the gain (+0.75).
- Trait judge against the references: 3/10. The beast it sees (a lion carrying a person's head, big feathered wings) scores yes. The silhouette, head, limbs, hide and colours score partly.

## Tried and dropped

- **Gold bands on the head-cloth** as `ridge` parts: they stood off the cap like spikes.
- **Covert feathers** as rows of flat `horn`s over the membrane (the Snallygaster's recipe): on a wing this upright they read as rubble.
- **Bands from `stripes`**, with a new `on` key that bands only the faces painted `cloth`: the cap and flaps came out in the body's fur, not blue. The builder change was dropped with it.
- `legs` 1.45: the joints came out puffy, like a poodle's.

## Next (the judges' top gap)

The head-cloth as a crisp, faceted shape striped in gold and blue (flared side flaps, a band across the brow), framing a bigger, lighter face with clear brows, nose and lips. Then thick, muscled lion legs (the judges still see thin stilts with bulbous joints). The stripes need a builder part, because `stripes` doesn't band painted flesh cleanly.
