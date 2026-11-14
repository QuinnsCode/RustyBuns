# Tops: the range, and a hanger (#4563)

The five tops on one body form, from `bun run probe qview3d / --url http://localhost:5190 --shot out.png` (add
`--mobile` for phone size). As in [the first tops' shots](../shots-2026-11-14-tops/README.md), which are the BEFORE
here, the probe body adds a test picture to each print zone (`el.addImage(blob, zone)`, the tanks' front and back
only), then picks the zone the shot is named after (`el.zone = ...`).

- `tee-front.jpg`, `tee-back.jpg`, `tee-left-sleeve.jpg`, `tee-phone.jpg`: the crew tee, with a set-in sleeve out of a
  real armhole, a rib collar, rolled hems with twin stitching and drape at the hem.
- `sweater-front.jpg`, `sweater-left-sleeve.jpg`: the crew sweater: knit, rib collar, cuffs and waistband.
- `hoodie-front.jpg`, `hoodie-back.jpg`, `hoodie-phone.jpg`: the hoodie: the hood lying back with its centre seam,
  drawcords with tips, the pouch pocket stitched along its top and bottom, rib cuffs and waistband.
- `tank-front.jpg`: the men's tank: wide straps, bound edges.
- `racerback-front.jpg`, `racerback-back.jpg`: the women's cut: a scoop neck, a racer back and a shaped waist.
- `tee-hanger.jpg`, `hoodie-hanger.jpg`: the hanger spike (`display="hanger"`, the demo shop's "On a hanger" button): the top starts laid
  flat and hangs from the hanger by its shoulders, its mesh run as cloth for about a second, then frozen.

A fresh judge agent scored BEFORE against these (scores are direction, not taste: the owner's look is the MANUAL RUN):

| | score |
| --- | --- |
| BEFORE (the tee and hoodie of #4561) | 3.5 / 10 |
| NOW, all five on the form | 6.5 / 10 |
| tee / sweater / hoodie | 7 / 6 / 6 |
| men's tank / racerback | 5.5 / 6 |
| tee / hoodie on the hanger | 4 / 3.5 |

The form beat the hanger, so the hanger stays a spike: the widget's own controls don't offer it, a page opts in
with `display="hanger"`. The judge's faults left: the hanging sleeves fold into a stiff slab and the bar shows at the
neck; a picture on a tank or a curved sleeve rounds off; the shoulder tops' outline is jagged on the sweater and hoodie.

Taste is the owner's. A cut is a few numbers in `CUTS` (`src/widget/tops.ts`); the folds are `bodyFold` there.
