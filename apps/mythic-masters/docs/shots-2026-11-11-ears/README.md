# Fleshy ears and webbed frills, 2026-11-11

Two builder options in `blender/beast.py`, both opt-in. A sheet without them builds the same GLB as before
(checked: the Tatzelwurm rebuilt byte for byte before its sheet changed).

## Squonk ears (#4180)

`ear` takes `thick` (the section's depth in its width; the old leaf is 0.12) and `fold` (the edges swing forward
by that share of the width, a hollow). With either one the ear is a rounded 12-sided flap that ends in a lobe.
The Squonk uses `thick: 0.5, fold: 0.3`, and its ears are a little longer and wider (`len` 0.33, `width` 0.095),
so they hang like the clay sculpture's heavy flaps (see [the Squonk notes](../shots-2026-11-10-squonk/README.md)).

- [squonk-before.jpg](squonk-before.jpg): flat, paper-thin leaves
- [squonk-after.jpg](squonk-after.jpg): thick drooping flaps

## Tatzelwurm frills (#4179)

`horn` takes `web`, a group name. Horns in a row with the same `web` get a skin between each rib and the next. It
follows both curved ribs, and its free edge is pulled in by `scallop` (0.3) toward the root. `web_thick` (0.012) sets
the thickness, and `web_mat` the material (the first rib's by default). The first rib of the group holds these settings.
The Tatzelwurm's five frill ribs a side are `web: "frill"`, so they read as fins, like the Haus der Natur figure's
(see [the Tatzelwurm notes](../shots-2026-11-10-tatzelwurm/README.md)).

- [tatzelwurm-before.jpg](tatzelwurm-before.jpg): a fan of bare ribs
- [tatzelwurm-after.jpg](tatzelwurm-after.jpg), [tatzelwurm-close.jpg](tatzelwurm-close.jpg): webbed fins
