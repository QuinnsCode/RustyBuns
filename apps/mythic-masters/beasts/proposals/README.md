# Hodag candidates

The owner scored the current Hodag (`beasts/hodag.json`) 1.3 out of 10 next to the references. These are three
rebuilt directions for that one starter. Each rigs with 4 feet and fits a 7000-triangle budget.

| Candidate | Sheet | From | Shot |
|---|---|---|---|
| A, statue | `hodag-statue.json` | the Rhinelander statue: grin, two down-fangs, bull horns, orange glare, nine curved spines, a low heavy crawl | [statue.jpg](../../docs/shots-2026-11-10-hodag/statue.jpg) |
| B, 1893 | `hodag-hoax.json` | Shepard's 1893 hoax photo: an ox-hide brute up on its legs, a bristling ridge, a spear tail, brown | [hoax.jpg](../../docs/shots-2026-11-10-hodag/hoax.jpg) |
| C, starter | `hodag-starter.json` | the statue's face on starter proportions: a head near half the beast, round body, stubby clawed legs, three spines | [starter.jpg](../../docs/shots-2026-11-10-hodag/starter.jpg) |

Today's model, from the same camera: [now.jpg](../../docs/shots-2026-11-10-hodag/now.jpg).

## References

- [1893 photo, lumbermen and the Hodag](https://commons.wikimedia.org/wiki/File:A_hodag_surrounded_by_a_group_of_armed_men.jpg)
- [The Rhinelander visitor-center statue](https://commons.wikimedia.org/wiki/File:Hodag_(16170156665).jpg)
- [A painted town Hodag, the grin and fangs](https://commons.wikimedia.org/wiki/File:Hodag_Statue_-_panoramio.jpg)
- [Cox, Fearsome Creatures of the Lumberwoods (1910), p. 34](https://commons.wikimedia.org/wiki/File:Fearsome_Creatures_of_the_Lumberwoods,_with_a_Few_Desert_and_Mountain_Beasts_(page_34_crop).png)

## What changed in how it is built

- The head is round flesh (two blobs, a cranium and a bulldog muzzle, merged with `blend`), not the `skull` loft, which came out a box.
- The grin is a dark `ridge` lip band with `horn` teeth set on the muzzle's surface, plus two big fangs.
- The back spines are curved `horn`s swelling toward the hips, not straight `spikes` cones.
- Three hooked `horn` claws per paw instead of the paw's own small claws.

`face()` and `spines()` in `make-hodag.ts` take a size, so the same face fits each body.

## Build and look

```sh
bun beasts/proposals/make-hodag.ts
blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- beasts/proposals/hodag-statue.json --render
```

The GLB lands in `public/models/hodag-statue.glb` (don't commit it) and the contact sheet in `blender/out/`.

## Once one is picked

Copy its sheet over `beasts/hodag.json` with `"id": "hodag"`, run `bun run beasts hodag`, and delete this folder.
