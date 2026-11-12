# Jersey Devil rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model had a lofted `skull` head, flat panel wings and a thin body.
The rebuild follows the 1909 newspaper drawings: a horse's head on a long neck over a kangaroo's body.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Mothman

## References

- [Philadelphia Post, January 1909](https://commons.wikimedia.org/wiki/File:Jersey_Devil_Philadelphia_Post_1909.jpg)
- [The 1909 drawings side by side](https://commons.wikimedia.org/wiki/File:Jersey-devil-1-700x306.jpg) and [a clean scan](https://commons.wikimedia.org/wiki/File:Nj_devil_notgreyscale.png)
- [A carved figure](https://commons.wikimedia.org/wiki/File:Jersey_Devil_(1665080054).jpg) and [a painted miniature](https://commons.wikimedia.org/wiki/File:Jersey_devil_mini.jpg)

Traits: a long horse or goat head on a long neck, small horns, bat wings, a kangaroo's body standing on long hocked hind
legs, cloven hooves, small clawed forearms, a long thin tail with an arrowhead. What a child would draw: the horse
head, the bat wings, the forked tail.

## What made it better

The generator (`proposals/set-b/jersey-devil.ts`, commit 886f7431, on the PR) writes the sheet.

- **The horse head is four blobs** (a cranium, a long muzzle, a soft nose end and a jaw line) on a two-node neck with a
  tilted neck blob, all one skin (`blend: 0.016`) with the body. The old `skull` loft came out boxy.
- **Kangaroo legs:** a big tilted thigh blob, a shin raked back to a high hock and a cannon to the hoof, each a blob
  tilted along its bone (`rot`); a small blob at the foot node so the `hoof` part meets the leg instead of floating.
- **Bat wings** are the `wing` part: four finger bones from the wrist (`l_wwrist`) and a membrane sagging between them
  down to the flank, with a thumb claw on the wrist. The rigger finds both (wings 2/2).
- **The arrowhead** is three flattened `horn`s at the tail tip: a point and two barbs swept back.
- A short mane of flat tufts down the neck, red glowing eyes, curved horns, a mouth line and two front teeth.

## Still open (builder gaps)

- Body chains thinner than about two voxels vanish under `blend`, so the tail and the wing arm keep radii of 0.03 m and
  more, thicker than the drawings.
- The `ear` part's thick flap reads round from the front even at a third of its length wide.
