# The house look: one style for every beast

Every beast in Mythic Masters is drawn to this page. Read it before you touch a sheet. The tools are in
[BLENDER-TOOLS.md](BLENDER-TOOLS.md) and the pipeline's history is in [MODEL-TOOLING.md](MODEL-TOOLING.md).

**The look in one line:** a chunky storybook toy that could bite you, and is glad to see you.

The models to copy are the starters: the **Hodag**, the **Squonk** and the **Jackalope**
(`bun scripts/beast-refs.ts --closeups hodag`). When a new model stands next to those three in the gallery, it
must look like it came out of the same box.

## Why this page exists

On 2026-11-22 the gallery held three styles at once: the chunky starters, a set of lean, small-headed
"realistic" beasts (Wampus Cat, Rougarou, Jersey Devil), and about fifty older sheets that are bare skin-modifier
tubes with bead eyes (Kelpie, Mokele-mbembe, Camahueto). One style, this one, replaces all three.

## The rules

Each rule has a number, so a model can be checked against it, not argued about.

1. **Big head.** The head is the biggest single form after the trunk. On a biped the head is 0.30 to 0.38 of
   the standing height. On a four-legged beast the head (skull plus muzzle) is 0.40 to 0.55 of the trunk's
   length. A long-necked or snake beast keeps a head at least 1.6 times as wide as its neck.
2. **Round, soft forms.** Build the body from `blobs` joined by `blend` into one skin. No bare skin-modifier
   tubes, no balloon joints, no flat planes or wedges. A muzzle is short and round (at most 0.6 of the skull's
   length) unless the legend is about the snout.
3. **Thick, short limbs with big feet.** A leg is never thinner than 0.45 of its own top width, and it has a
   knee or elbow you can see. Hands, paws, hooves and talons are 1.3 to 1.6 times as wide as the limb above
   them. Legs are short: the belly clears the ground by no more than 0.5 of the trunk's depth (a biped's legs
   are no longer than its trunk plus head).
4. **The house face.** It comes from the kit (below), never placed by hand:
   - Eyes are 0.28 to 0.36 of the head's width each, set a little wide, on the front half of the head.
   - Each eye has a white (or pale tinted) ball, a coloured iris 0.75 of it, a dark pupil 0.45 of it, and one
     white catchlight up and out. Eye glow is 0.5 at most.
   - A soft upper lid in the body's colour covers the top fifth of the eye. Brows tip **up** in the middle.
   - The mouth's corners turn up. Teeth are one or two big fangs, buck teeth, or one short neat row. No
     snarl, no full row of needles, no open red throat unless the beast's move needs it.
5. **One thing from the legend, made big.** Pick the one trait a child would draw (the Hodag's horns and back
   spines, the Jackalope's antlers) and make it 1.5 times too large. The other traits stay small or go.
6. **Three colours and the eyes.** A body colour at middle brightness, a lighter belly, and one accent for the
   legend's trait. Keep colours clean and a little warm; no grey-brown mud. The `hide` pattern is large and
   low in contrast (it must read as fur, scales or skin at fight size, never as camouflage or noise).
   Only the eyes and the one accent may glow.
7. **Budget and rig.** 5600 to 9000 triangles. Use `round` so the face keeps its triangles. The build's row
   must say `ok`: feet and wings match the sheet, never one-sided.
8. **Scale by legend, not by style.** Keep each beast's size and archetype (`k`, `archetype`, the fighter
   block, `feet`, `wings`, node names the rig or the moves use). The look changes; the fighter does not.

## The kit: `proposals/house/`

One face, one limb and one foot for the whole roster live in `proposals/house/kit.ts`. A beast is a short
row of numbers in a body plan that calls it and writes `beasts/<id>.json`. Do not copy the kit's code into a beast
file, and do not place an eye, lid, pupil or tooth by hand in a sheet: change the kit's numbers for that beast
instead. If the kit can't make a form you need, add a knob to the kit, with a default that leaves every other beast
as it was. Sizes are metres; a head's sizes are in `w`, half the head's width.

What the kit has (each returns sheet pieces; only `writeSheet` writes a file):

- `head({w, tall, long, muzzle, snout, flat, drop, droop, cheeks, jaw})`: a round cranium of blobs, a short muzzle
  (`muzzle` is its reach as a share of the skull, capped at 0.6), round cheeks. Returns its blobs and the ellipsoids
  the face is cast onto.
- `face(head, {eye, wide, high, sink, iris, pupil, lid, brow, browTilt, browUp, grin, smile, teeth, tooth, nose, mood})`:
  the house face. `eye` (0.32) is each eye's width over the head's; `wide` (32 degrees) and `high` (8) place it;
  `teeth` is `fangs`, `fang`, `buck`, `row` or `none`; `nose` is `dots`, `pad` or `none`; `mood` (`glad`, `fierce`,
  `shy`) presets the brows and grin. Returns the parts and the sheet's `eyes` setting (the builder's lid ring, no
  shrinking).
- `ear(head, {...})` and `horn(head, {...})`: an ear or a horn rooted on the head's skin, sizes in `w`.
- `limb({along, top, thin, knee, calf, depth, shoulder, radii, mirror})`: a thick limb lofted into the skin
  (`skin: true`); `thin` (0.62, floor 0.45) is its narrowest share of `top`, `knee` the joint's knob. With `radii`
  and `mirror: false` it lofts a neck or a tail.
- `foot({at, form, low, size, long, sole, toes, claw, ...})`: `hoof`, `mitten` (a padded paw in the skin), `hand`,
  `talon` or `flipper`, `size` (1.45) times the limb's width `2 * low`.
- `palette({body, belly, accent, iris, white, brow, extra})`: rule 6's colours plus the face's (`white`, `iris`,
  `pupil`, `glint`, `lid`, `brow`, `mouth`, `tooth`, `nose`, `dark`, `claw`). Iris glow is capped at 0.5; a body too
  dark, too light or without colour throws.
- `hide(pattern, body, {size, contrast, cover})`: the body's pattern from its own colour, `contrast` (0.12) either
  way, `size` (0.12 m) large.
- `DENSE`: the face's materials kept whole through the decimator (put it in the sheet's `dense`).
- `writeSheet(id, body)`: writes the sheet, keeping the old one's id, name, about, archetype, feet, wings and
  budget; a plan with another feet or wings count throws.

The body plans, one file each so a lane can own one: `quadruped.ts` (`quadruped({k, trunk, leg, thin, feet,
footSize, clear, neck, lean, thick, head, face, tail, pal, skin, trait})`), `biped.ts` (`biped({k, legLen, leg,
trunk, belly, arm, armLen, feet, hands, head, jut, face, pal, skin, trait})`) and `longneck.ts` (`longneck({k, body,
humps, reach, neck, bow, leg, feet, tail, head, face, pal, skin, trait})`). Each holds a `BEASTS` table, and
`bun proposals/house/<plan>.ts <id>` writes those sheets. `trait` returns the legend's one big thing as parts.
Judge a round beside the starters with `bun proposals/house/lineup.ts hodag jackalope squonk <id>` (one picture,
one camera, true scale; `blender/out/lineup.png`).

A beast (the Kelpie from `quadruped.ts`, its forelock and tail locks left out):

```ts
kelpie: () => quadruped({
  k: 1, feet: "hoof", trunk: [1.0, 0.66, 0.62], leg: 0.14, thin: 0.66, footSize: 1.5, footTall: 1.5,
  neck: 0.4, lean: 30, thick: 0.21,
  head: { w: 0.21, tall: 0.95, muzzle: 0.32, snout: 0.7, flat: 0.88, drop: 0.3, droop: 20, cheeks: 0.45 },
  face: { eye: 0.33, wide: 34, high: 8, sink: 0.38, teeth: "buck", grin: 0.55, nose: "dots" },
  tail: 0.5, droop: 0.5,
  pal: { body: [0.17, 0.27, 0.36], belly: [0.42, 0.55, 0.6], accent: [0.22, 0.56, 0.42], iris: [0.25, 0.7, 0.78],
    roughness: 0.6, extra: { hooves: [0.3, 0.27, 0.25, 0.85, 0] } },
  skin: { pattern: "wet", size: 0.18, contrast: 0.14, cover: 0.08 },
  trait: ({ head: h }) => [   // the mane, made big: wet weed-green locks down the crest and the tail
    { kind: "lock", along: ["head", "neck", "chest"], n: 8, len: 0.58, base: 0.16, rows: 3, spread: 32, material: "accent" },
    ear(h, { from: [-0.35, 1, 0.55], dir: [-0.3, 1, 0.35], len: 0.9, width: 0.45, point: 0.4, material: "hide" }),
  ],
}),
```

**The eye and the game.** The game gives every ball in the `eye` material a slit pupil at runtime
(`src/eyes.ts`). The house eye draws its own round pupil, so it uses no `eye` material (`white`, `iris`, `pupil`,
`glint`) and the game adds nothing. The iris and pupil are flattened lenses turned to the game's gaze (forward,
37 degrees out), so the builder's lid ring hoods them where the kit drew them. The cost: the runtime blink, which
darkens the `eye` material, has nothing to darken on these beasts.

## How a round goes

Not on the office Mac: nothing runs Blender there (the owner's order, 2026-11-23; see
[BLENDER-TOOLS.md](BLENDER-TOOLS.md)). Steps 2, 3 and 5 below start Blender.

1. Read the beast's `about`, its legend in `src/lore.ts` and its moves. Write down the one big trait (rule 5).
2. Build it: `bun proposals/house/<plan>.ts <id>` writes the sheet, `bun scripts/beasts.ts <id>` builds it and
   draws `blender/out/<id>.png`. Look at the picture every time.
3. Head close-ups: `bun scripts/beast-refs.ts --closeups <id>` draws `blender/out/refs/<id>.now.png`.
4. Check the eight rules, then put it beside a starter. Fix the worst thing. Go again.
5. Stop when it passes the rules and sits well beside the Hodag, or when three rounds in a row change nothing.

## What not to do

- Don't make a beast lean, tall and small-headed because the real animal is. The Wampus Cat is a cat-shaped
  toy, not a puma.
- Don't add detail before the big forms are right. Tufts, spikes and scales on a wrong shape make it worse.
- Don't turn the glow up to make a beast read. Fix the shape and the colours.
- Don't build an iris or pupil as a ball cut into another ball. Eye balls are 10 by 7 segments, so where two cut
  each other the edge comes out ragged; the kit's lenses each show their own clean outline.
- Don't name a material with `hoof`, `horn`, `claw`, `fang`, `tooth`, `tusk`, `talon` or `beak` unless it should
  shine: beast.py gives those a gloss coat (a hoof came out chrome). The kit's hooves are `hooves`.
- Don't build a neck or tail from a row of blobs: it reads as a string of beads. Loft it (`limb` with `radii` and
  `mirror: false`).
- Don't let hair or a tail hang near the ground. A lock whose tip comes within 0.15 of the beast's height of the
  floor is counted as a foot (the Kelpie's tail read `feet 6/4` until it was lifted).
- Don't cast a mouth straight sideways off the muzzle's front: it ends inside the cheeks. The kit's smile is an arc
  at the muzzle's own radius, and the decimator keeps it only because its material is in `DENSE`.
- A blob's `material` is dropped by `blend`, except that the builder rings each eye's lid in the material of the
  head's blob. The kit puts `lid` (the body's colour) there; in the body material the lid took the belly's tone.
- Don't edit `blender/beast.py` for one beast's sake. A builder change must leave every other sheet's GLB the
  same, byte for byte (`test/beast-determinism.test.ts`).
