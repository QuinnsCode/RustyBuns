# Beast of Gevaudan rebuild, 2026-11-11

Part of the beast spike (#4249, lane 3: the four-legged biters). Built from the same hound generator as the Black Shuck
(`bun proposals/set-a/make.ts gevaudan`), with a bigger head, a broad open jaw, heavier legs, a dark band down the
spine and a pale throat and belly.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild

## References

- [The London Magazine's engraving, 1765](https://commons.wikimedia.org/wiki/File:Gevaudanwolf.jpg), "AF", public domain ([ref-london-magazine.jpg](ref-london-magazine.jpg))
- [La bête du Gévaudan, etching, 1764](https://commons.wikimedia.org/wiki/File:B%C3%AAte_du_G%C3%A9vaudan_(1764).jpg), unknown, public domain ([ref-1764-etching.jpg](ref-1764-etching.jpg))
- [The Marvejols statue](https://commons.wikimedia.org/wiki/File:Repr%C3%A9sentation_de_la_B%C3%AAte_du_G%C3%A9vaudan_%C3%A0_Marvejols.jpg), Daniel Culsan, CC BY-SA 4.0 ([ref-marvejols.jpg](ref-marvejols.jpg))
- [Sculptures of the Beast](https://commons.wikimedia.org/wiki/File:B%C3%AAte_du_G%C3%A9vaudan_-_sculptures.jpg), Les Randonneurs de la Fare, CC BY-SA 4.0 ([ref-saugues-sculptures.jpg](ref-saugues-sculptures.jpg))

Traits: a wolf that is too big, with a huge head on a deep chest and a long open jaw full of fangs. The prints show a
mane down the neck and a long, heavy, tufted tail. Its coat is reddish, with a black band down the spine and a pale throat and belly.
What a child draws: a giant wolf, the jaws, the stripe on its back.

## What changed

- The hound generator's head with `snout: 1.3` (a broad muzzle), `crown: 0.8` (a flat brow, not a dome) and the jaw hung
  fully open, two amber eyes under ridged brows.
- Legs as blended blobs at 1.25 times the Shuck's thickness.
- **The spine band:** a chain of nodes (`sp1` to `sp5`) placed by ray-cast 2 cm under the back's skin and `paint`ed
  dark; the back's tufts and the tail are in the band's colour too. The pale bib is the same trick under the chest.

## Lessons

- A painted chain under the skin needs its nodes close (2 cm) and fat enough (5 cm) or only the end nearest the neck
  takes the colour.
- **Gap:** the spine band is only as sharp as the mesh's faces. A `hide` pattern with a dorsal band (a stripe along the
  body's top, edges soft) would make it crisp. Lane 1 owns the hide patterns.
