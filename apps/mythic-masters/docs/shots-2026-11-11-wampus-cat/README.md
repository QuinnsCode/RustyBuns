# Wampus Cat rebuild, 2026-11-11

Part of the beast spike (#4249, lane 3: the four-legged biters). Built with the hound generator
(`bun proposals/set-a/make.ts wampus-cat`), set to a cat's proportions: a longer, lower body (`long: 1.15`, `tall: 0.85`),
a short muzzle (0.55), a round crown and round ears, and a long smooth tail that lifts at the tip.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild

## References

- [The Wampus Cat statue at a school](https://commons.wikimedia.org/wiki/File:Wampus_cat_20160530_123904_(cropped).jpg), U458625, CC BY-SA 4.0 ([ref-statue.jpg](ref-statue.jpg))
- [A roadside Wampus Cat](https://commons.wikimedia.org/wiki/File:Wampus_Cat_-_panoramio.jpg), Todd Dwyer, CC BY-SA 3.0 ([ref-roadside.jpg](ref-roadside.jpg))
- [A puma, the cat it's built on](https://commons.wikimedia.org/wiki/File:Puma_-_49043749293.jpg), Carlos, CC BY 2.0 ([ref-puma.jpg](ref-puma.jpg))

Traits: a big lean mountain cat, long and low; a small round head with a short muzzle; round ears; a long tail with a
lifted tip; tawny with faint dark bands; eyes that glow yellow-green. What a child draws: a big sneaky cat, the glowing eyes, the long tail.

## Lessons

- Stretching the body (`long`) pulls the chest, belly and hip nodes apart. The body blobs have to stretch with it, or
  the trunk pinches into three humps.
- A cat's tail is smooth: `bush: 0` drops its fur, `thick: 1.5` fattens the skin.
- **Gap:** `stripes` bands come out faint under a `fur` hide. The hide's map multiplies over the band too, and the bands
  are cut only where the spine chain owns the face. A banded (tabby) `hide` pattern would read better (lane 1's area).
