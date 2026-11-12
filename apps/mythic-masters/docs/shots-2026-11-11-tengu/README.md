# Tengu rebuild, 2026-11-11

Part of the beast spike (#4249, lane 4). The old model was a teal body with a red head, red socks and lumpy black
wings. The rebuild dresses it as the great mountain tengu of the shrine statues and festival masks: a mountain ascetic
with crow's wings.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the contact sheet and close-up of the new one
- [after-ortho.jpg](after-ortho.jpg): side, three-quarter and two head views of the GLB
- [fight.jpg](fight.jpg): side-on in a fight against the Yeti

## References

- [Tengu statue, Hansobo shrine, Kencho-ji, Kamakura](https://commons.wikimedia.org/wiki/File:Tengu_statue_@_Hansobo_Shrine_@_Kencho-ji_@_Kamakura_(13897784031).jpg)
- [A bronze tengu statue with wings and a fan](https://commons.wikimedia.org/wiki/File:Statue_of_Tengu_(15307645834).jpg)
- [A carved crow tengu](https://commons.wikimedia.org/wiki/File:Karasu-Tengu-Statue.jpg)
- [A red long-nosed tengu at the Shinagawa shrine festival](https://commons.wikimedia.org/wiki/File:Tengu_at_Shinagawa_Shrine.jpg)
- [Hokusai, crow tengu](https://commons.wikimedia.org/wiki/File:Hokusai_tengu_2.jpg)

Traits: a red face with a very long nose, fierce eyes under bushy white brows, a white beard; the small black cap on the
brow; an ascetic's pale robes with pompoms down the chest, wide trousers, tall one-toothed clogs; great black crow's
wings; a fan of feathers in one hand. What a child would draw: the red face, the long nose, the wings.

## What made it better

The generator (`proposals/set-b/tengu.ts`, on the PR) writes the sheet.

- **Clothes are `paint`:** the body's material is the robe, and `paint` turns the head, face and hands red, the legs
  into blue trousers, a sash node at the waist dark, and the wing arm black, all on one blended skin.
- **The nose** is one thick `horn` tapering to a blunt `tip_base`, lifting a little at the end.
- **The cap** is a short `horn` whose top is wider than its root (`tip_base > base`), squared off with `flat`.
- **The beard** is six flat `horn`s hanging under the chin; the brows are short flat `horn`s swept up and out.
- **The clogs** are a `hoof` sole with a single wide, flat `horn` tooth under it, so the feet stand high; the rigger
  still finds both.
- **Wings:** the old cupped `membrane` with ten narrower primaries (`feathers`, `tip: 0.3`) instead of seven wide lumps.
- **The fan** is six flat `horn` feathers fanned from the right hand.

## Still open

- A `ridge` brow across the head stuck out sideways like horns (as on the Sasquatch); a soft brow part would help.
- The robe has no folds or sleeves that hang; it is a body painted pale.
