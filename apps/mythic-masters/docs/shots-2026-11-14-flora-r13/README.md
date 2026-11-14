# Plants and scenery climb, round 13 (#4460): kept

Round 12's judge asked to keep round 12's near model (`clump-cores.patch`), keep the far model free of balls, and give
the far model spiky tufts tipped upward with sky between them. This round did that.

- Near model: round 12's patch as it was (dark lumpy tuft cores, `brush` 0.6, `share` 0.7, crown from 0.55 of the height).
- Far model: `lo_core` 0 (no balls). Three new tuft knobs in `blender/flora.py` that work only in the far model:
  `lo_up` 0.6 (tufts raked up), `lo_splay` 0.55 (narrower, not flat fans) and `lo_brush` 0.6 (bundles all along
  more twig, so a tuft has body). `lo_needles` 30, `lo_width` 1.1, `lo_tip` 0 (keeps the lighter tips).
  The trunk sprouts' far wedges are narrower (`lo_width` 1.2).
- Triangles: near 8875 -> 6761 (budget 12000), far 1740 -> 1805 (budget 2000). World state: 2388 near plants, 3210 far.

A first try with `lo_needles` 18, `lo_width` 1.6 and `lo_splay` 1.0 gave flat palm fans in the far model.

BEFORE shots are round 12's (`shots-2026-11-14-flora-r12`), taken from main. Flora has not changed on main since.
Probe body: `docs/shots-2026-11-06-flora/shot.js`.

Judge (a fresh agent, BEFORE vs NOW): 4.0 -> 4.5. Near crown: separate rounded tuft clumps with sky between them,
much more like a pitch pine. Far model: airier, but it still reads a little like fans. Game view: a little clumpier
and more gappy. Worse: the trunk sprouts make an even bottlebrush band, and the trunk reads smooth at game distance.

Next: thick plated bark that you can see at game distance (a wider base, grey-brown to orange-brown plates, dark
fissures), and the trunk sprouts cut to 3 or 4 short clusters instead of a band.
