# Yeti rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model was a grey hunched ball on tube limbs, wrapped in rows of spiky
tufts, with blue stockings and a small face. The rebuild is the Sasquatch's blob ape made broader, hunched and white.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Tengu

## References

- [A show figure of the abominable snowman (Monsterpalooza 2011)](https://commons.wikimedia.org/wiki/File:Abominable_Snowman_Monsterpalooza2011.jpg)
- [A theme-park yeti in its ice cave](https://commons.wikimedia.org/wiki/File:Abominable_Snowman.JPG)
- ["Snowman portrait", the yeti as drawn by Sherpa Kunjo Chumbi](https://commons.wikimedia.org/wiki/File:Yeti_Snowman_portrait.png)

Traits: a towering ape covered in long pale shaggy hair; a pointed crown (the Sherpa drawing); a bare blue-grey face
with red eyes and fangs in an open snarl (the modern figures); hunched and broad, arms hanging to the knees; huge feet.
What a child would draw: the white shaggy body, the snarl with fangs, the big feet.

## What made it better

The generator (`proposals/set-b/yeti.ts`, made from the Sasquatch's by `mkyeti.ts`, commit 1930b209, on the PR) writes the sheet.

- **The Sasquatch's body, moved:** the chest, neck and head pushed forward and down for a hunch, the shoulders, arms
  and hands bigger, the hands down to the knees.
- **Shag from blobs, not tufts:** long hanging clumps (elongated, tilted blobs) off the shoulders, elbows, forearms,
  flanks and calves, blended into the skin so they share the `fur` hide. White tufts came out as paper shards.
- **The snarl:** a dark `mouth` ball sunk into the muzzle, two fangs down from the upper lip, two up from the lower and
  two small teeth between, all placed on the head's skin with `skin()`.
- **Colour:** white fur with a pale grey root (`hide` colours `[0.72, 0.72, 0.72]` to `[0.98, 0.98, 0.96]`), the face,
  hands and feet a blue-grey `face`, red glowing eyes.

## Still open

- The blob clumps blend into a smooth lumpy coat: the silhouette is shaggy, the surface is not. A strand or lock part
  that keeps the hide's colour (unlike `tuft`, which takes a palette colour) would give long hair.
- The fight HUD portrait is the old card art, not the model.
