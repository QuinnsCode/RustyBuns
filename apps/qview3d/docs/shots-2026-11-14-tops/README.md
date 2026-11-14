# Tops: a tee and a hoodie, printed front, back and sleeve (#4539)

The demo shop with `crew-tee` and `pullover-hoodie`, from `bun run probe qview3d / --url http://localhost:5190`. The
probe body adds three test pictures, one to each print zone (`el.addImage(blob, "front" | "back" | "left-sleeve")`),
then picks the zone the shot is named after (`el.zone = ...`), which swings the camera to it.

- `tee-front.jpg`, `tee-back.jpg`, `tee-left-sleeve.jpg`: the tee from each zone's side (the sleeve from three-quarters).
- `hoodie-front.jpg`, `hoodie-back.jpg`, `hoodie-left-sleeve.jpg`: the same on the hoodie. Its front zone sits above the pocket.
- `tee-phone.jpg`, `hoodie-phone.jpg`: phone size (`--mobile`). The five products take the top row there, and the zones and
  the corner buttons share the second.
- `cap-still-works.jpg`: the cap with a picture, on the same code path (a hat has one zone, its front).

Taste is the owner's: the shapes are made in code (`src/widget/tops.ts`), so a fold, a hem or a fit is a few numbers in
`TEE` and `HOODIE`.
