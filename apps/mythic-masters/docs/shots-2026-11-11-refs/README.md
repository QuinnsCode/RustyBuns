# The reference kit, 2026-11-11

The owner scored the old starters 1.3 out of 10 next to the references, because they were built and judged
without looking at any. Every rebuild that worked (#4171, #4173, #4177, #4178, #4199) did the same steps by
hand. Now one command does each step (Part of #4249). Run them from `apps/mythic-masters`:

```sh
bun scripts/beast-refs.ts --refs roc             # pictures into refs/roc/, credits and a traits stub into refs/roc.json
#   now write refs/roc.json's traits from the pictures
bun scripts/beast-refs.ts --closeups roc --main  # blender/out/refs/roc.now.png (and .main.png, git main's build)
bun scripts/beast-refs.ts --judge roc            # a fresh judge, trait by trait -> roc.judge.json, then the page
bun scripts/beast-refs.ts --compare roc          # blender/out/refs/roc.compare.html, the page the owner picks from
```

## Steps

1. **References.** `--refs` takes the beast's pictures in this order:
   - anything the owner drops into `refs/<id>/` (an owner photo always comes first);
   - the bestiary card's own Commons picks (`src/art.ts`);
   - the beast's Commons category, with its art subcategories ("Statues of …", "… in art") before the category's own files;
   - a text search, to top up.

   Only public domain, CC0, CC BY and CC BY-SA, one picture per artist, 6 at most. `--skip c4.jpg` keeps a bad one
   (a sign, a shop, an icon set) out for good. `--category` and `--query` fix a wrong lookup, and both are saved.
   The pictures aren't committed. The JSON keeps every credit, and `--refs` fetches them again.
2. **Traits.** Read the pictures and fill in `traits` in the JSON: silhouette, head, limbs, hide, colours, and the
   three things a child would draw. The judge scores these, so write what the pictures show, not what the model has.
3. **Close-ups.** `--closeups` renders front, side, three-quarter and head through an ortho camera, straight
   from the GLB (`blender/closeups.py`, about 20 s, one Blender). With `--main`, git main's build is drawn in the
   same run with the same framing, so a change in size shows. Judge from these, not from the contact sheet.
4. **Judge.** `--judge` shows a fresh `claude -p` the references, the strip and the traits (`judgeTraits` in
   `judge-loop.ts`). It answers yes, partly or no per trait with a note, a score out of 10 and the one fix that would
   help most. Agent judges score about 2 points above the owner, so steer by the ticks and the fix, not the number.
5. **Compare.** `--compare` writes one self-contained page: the references with their credits, before and now, and
   the trait table with each tick or cross. It works on a phone. Show it to the owner for the pick.

## First run: Nessie and Roc (the current models, nothing rebuilt)

- [roc-page.jpg](roc-page.jpg): the Roc's page. 3/10. The judge's fix: wings far longer, tawny, with long separated
  primaries, posed in flight with talons gripping something big ([verdict](roc.judge.json)).
- [nessie-phone.jpg](nessie-phone.jpg): the Nessie page at phone width. 3/10. The fix: paddle flippers in place of the
  box-footed legs, and the body sunk low in the water ([verdict](nessie.judge.json)).
- [nessie-closeups.jpg](nessie-closeups.jpg), [roc-closeups.jpg](roc-closeups.jpg): the close-up strips.

## What the kit learned

- A Commons text search for "Loch Ness Monster" brings back roller coasters, a pub, a number plate and a visitor
  centre. The beast's category is curated, so it goes first. Even so, its own files hold signs and shops, which is
  why the art subcategories rank above them and why `--skip` exists.
- The rig loader (`@rustybuns/rig/model`) hands back the mesh rescaled (Nessie measures 1.48 m there and 3.58 m in Blender), so it
  can't be used to frame Blender renders. `closeups.py` measures every GLB it's given and frames them all by the largest.
- The head tile is a heuristic (beasts face +X): the top quarter of an upright beast, or the top of the front third
  of one on all fours. It frames Nessie and the Roc, but a beast whose head hangs below its shoulders may need a better one.
