# Tatzelwurm rebuild, 2026-11-10

The owner scored the starters about 1.3 out of 10 next to the references (#4172). Round 1 tried three cat-faced
takes and the owner turned all of them down, asking for something close to the Haus der Natur figure. Round 2
followed that figure, and the owner picked the four-legged build, which is now `beasts/tatzelwurm.json` (PR #4178).
Comparison page: https://claude.ai/artifact/F5pCsJQRPPskEvUeYhUdzD

- [now.jpg](now.jpg): the old model
- [museum.jpg](museum.jpg): the pick, after the Salzburg figure on four legs
- [museum2.jpg](museum2.jpg): the same build on the lore's two front legs
- [plate.jpg](plate.jpg), [alpine.jpg](alpine.jpg), [starter.jpg](starter.jpg): round 1, not picked

## References

- [Haus der Natur, Salzburg (1988 reconstruction), the target](https://commons.wikimedia.org/wiki/File:Salzburg_Haus_der_Natur_-_Europa_Tatzelwurm.jpg)
- [A 19th-century Alpine travel book: a long scaly worm, a cat face, two paws](https://commons.wikimedia.org/wiki/File:Tatzelwurm_Reise_in_die_Alpine.png)
- [Scheuchzer (1723), the cat-headed serpent](https://commons.wikimedia.org/wiki/File:Scheuchzer(1723)-vol2-p378a-catheaded-serpent.jpg)
- [Scheuchzer (1723), the tufted cat face and spiny mane](https://commons.wikimedia.org/wiki/File:Houghton_Swi_607.23_-_Ouresipho%C3%ADtes_helveticus,_fig_X_(cropped).jpg)
- [A village fountain: big cat head, coiled tail](https://commons.wikimedia.org/wiki/File:Tatzelwurm.jpg)

## What made it better, for the next starter

- An open mouth needs no builder change: give the lower jaw its own node (linked from `head`) and a flat blob, hang
  it below the snout blob, and put a dark `eye` in the gap as the gullet. Fangs are `horn`s off the upper lip.
- A hanging tongue is a flat `horn` (`flat` 0.3, `tip_base` for a ribbon) with two short flat horns at its tip for the fork.
- `flat` squashes a horn along its `bend` direction. Bend sideways (`[0, 0, 1]`, `curve` 2) for a crest spine that is
  thin side to side, or forward for an ear that is thin front to back. Slit pupils are two thin flat horns, up and down.
- A crest that follows a chain round a raised neck and a curled tail needs each spine set off the chain's own upper
  side, from the direction between its nodes, not just straight up.
- Frills read as fins as a fan of flat pointed horns. An `ear` leaf there reads as a round elephant ear.
- The `scales` part stands out as jagged shards at fight size, so the pick goes without it.
- When the rig loses feet, the legs have merged into a fat body: move the elbows and feet further out to the side.
