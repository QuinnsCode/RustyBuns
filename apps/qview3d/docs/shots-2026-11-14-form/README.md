# The hat, the shirt and the hoodie on the product page

The demo shop (`public/index.html`) as a product page: pick the hat, the shirt or the hoodie, customise it, then Add
to cart. The widget is a field in that form (`<qview-3d name="design">`), so the cart line carries the saved design's
id. Each shot is the probe with a test sticker (a checkerboard with a black border) on every print zone, then the
named zone picked: `bun run probe qview3d / --url <dev server> --js <body> --shot out.png`, `--mobile` for the
`-phone` ones (390 x 844 at 2x).

- `cap-front`: the field cap.
- `tee-front`, `tee-back`, `tee-sleeve`: the crew tee's three zones.
- `hoodie-front`, `hoodie-back`, `hoodie-sleeve`: the pullover hoodie's three zones.
- `hoodie-close` against `before-hoodie-close`, and `cap-front` against `before-cap-front`: what changed for #4591.

What changed, from #4591's list:

1. **A picture keeps its shape where the cloth narrows.** It used to be drawn at one scale across, the fabric's width
   at the picture's middle, so on a tapering sleeve or a cap's crown it came out as a teardrop or a keystone. Now it is
   drawn in bands 3 px tall, each at the width of the cloth at its own height (`paint` in `src/widget/print.ts`). The
   sleeve's columns are also spaced by arc length round its oval section, and its width is that oval's perimeter, not
   `2 pi r`.
2. **The shoulder outline is smooth.** Each half has 96 rows, packed toward the top where it closes over the shoulder
   (`rowAt` in `src/widget/tops.ts`), as fine as the old 64 at the hem.
3. **A sleeve picture no longer creases into the shoulder.** The sleeve's zone stops short of where the tube blends
   out of the armhole, and a new picture fits a short sleeve's zone both ways.

The hanger (item 3 of #4591) waits for the owner's answer on #4590.
