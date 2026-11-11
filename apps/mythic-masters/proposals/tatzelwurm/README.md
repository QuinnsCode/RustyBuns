# Tatzelwurm rebuild, 2026-11-10

The owner scored the starters about 1.3 out of 10 next to their references (#4172). These are three
rebuilds of the Tatzelwurm, done the way the Hodag was (#4171). Comparison page:
https://claude.ai/artifact/F5pCsJQRPPskEvUeYhUdzD. Shots are in
[docs/shots-2026-11-10-tatzelwurm](../../docs/shots-2026-11-10-tatzelwurm/).

## References

- [A 19th-century Alpine travel book: a long scaly worm, a cat face, two paws](https://commons.wikimedia.org/wiki/File:Tatzelwurm_Reise_in_die_Alpine.png)
- [Scheuchzer (1723), the cat-headed serpent, coiled](https://commons.wikimedia.org/wiki/File:Scheuchzer(1723)-vol2-p378a-catheaded-serpent.jpg)
- [Scheuchzer (1723), the tufted cat face, whiskers and spiny mane](https://commons.wikimedia.org/wiki/File:Houghton_Swi_607.23_-_Ouresipho%C3%ADtes_helveticus,_fig_X_(cropped).jpg)
- [A village fountain: big cat head, short body, coiled tail](https://commons.wikimedia.org/wiki/File:Tatzelwurm.jpg)
- [Haus der Natur, Salzburg: a museum reconstruction with a red crest](https://commons.wikimedia.org/wiki/File:Salzburg_Haus_der_Natur_-_Europa_Tatzelwurm.jpg)

Every version shares: a cat's face, flat in front, with pointed ears, big eyes, a short nose and often
whiskers; a thick scaly worm body lying low; only two short clawed front legs; and a tail that tapers or coils.

## The candidates

Round 1 tried three cat-faced takes (the plates, an Alpine folk figure, a big-head starter; shots `plate.jpg`,
`alpine.jpg`, `starter.jpg`). The owner turned them all down and asked for something close to the Haus der Natur
figure, so round 2 follows that one:

- `tatzelwurm-museum.json`: the figure as it stands. An upright neck, a broad blunt head with the jaw dropped open
  over a row of fangs, a red forked tongue, finned frills, three short red horns, a red crest from the neck round the
  curled tail, and four sprawled legs with white claws. Rigs 4 of 4 feet.
- `tatzelwurm-museum2.json`: the same build on the lore's two front legs only. Rigs 2 of 2 feet.

Both are at the 6,000-triangle budget. The open mouth needs no new builder feature: the lower jaw is its own node
and blob, hung below the snout with a dark gullet between them.

## How to build

From `apps/mythic-masters`:

    bun proposals/tatzelwurm/make-tatzelwurm.ts        # writes the two sheets
    blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/tatzelwurm/tatzelwurm-museum.json --render
    bun proposals/tatzelwurm/build.ts <close.py> <out dir> [museum|museum2]   # build, check feet, close-up

`close.py` is the close-up render script from the brief on #4172. The GLBs land in `public/models/`; delete them
before committing. The picked sheet replaces `beasts/tatzelwurm.json` (id back to `tatzelwurm`, its `about` kept),
and this folder is deleted.
