# The hair and hairline, round 6 of the people climb (#6279), 2026-11-26

`human()` in `packages/models/src/human.ts`, shot from `bun packages/models/scratch/humans/serve.ts` with
`bun scripts/probe.ts --url http://localhost:<port>/ --size 5120x2880 --js '__humans.only(["average"]); __humans.view("face"); __humans.turn(t)' --shot x.png`
at a turn of 0 (`front`, crop `-c 1300 2000 --cropOffset 800 1560`), 35 (`three`, `-c 1300 1700 --cropOffset 800 1900`),
80 (`side`, `-c 1200 1300 --cropOffset 1000 2900`), 60 (`temple`, `-c 1500 2000 --cropOffset 300 1700`) and
160 (`back`, `-c 1500 2200 --cropOffset 300 1460`).

- **The old hair.** A sheet of 14 rows by 36 columns. Its edge cut straight across the forehead, and from the temple it
  ran down to the ear as one flat diagonal plane. It rose to full thickness in 12 mm up each column, so it stood off the
  skin like a helmet.
- **A hairline of its own.** `HAIRLINE` is a list of points round the head, joined by a spline. The line runs in a soft
  arc across the forehead and turns a rounded corner at the temple. It comes down in front of the ear to a sideburn,
  goes up and over the ear, and comes down behind it to the nape. Each column starts a little higher or lower than its
  neighbours (0.8 mm), so the edge is never a ruled line.
- **Finer points.** 22 rows by 96 columns. The rows bunch up at the hairline and again at the crown, where the dome
  turns over, which also softens the old spike on top.
- **Thinning in.** The distance from the edge is measured across the hairline, not up the column. That way the temple
  and the front of the sideburn thin in the same way the forehead does. At the edge the hair lies 0.4 mm off the skin.
  It reaches full thickness over 16 mm. Over the ears and down the sideburns it stays cut short (12 % thickness).
- **Colour.** A hair point's `tone` is how thin the hair is there. In `paint` a thin point takes the skin's colour,
  darkened a little, and it comes in to the hair's colour over the first 6.5 mm.
- **Strands follow the hair.** A new `grain` attribute on every point holds where that point sits in the grain of its
  material: its rest position, or for hair, its position round the head and up its column. The shader draws strands
  along it, so they run back over the top and down the sides instead of being vertical stripes everywhere.
- 20,316 to about 23,400 triangles a figure (+3,100), in the scratch page's default outfit.

Judge: BEFORE 2.8, NOW 3.1. Their words: the back and crown "now show smooth combed strand flow with a believable sheen".
The hair "wraps round the head instead of looking like a helmet". Against that: the soft edge "looks smeared or
bleached rather than like skin with fine hairs growing out of it", and the sideburn is "one blurry spike".
