# Black Shuck rebuild, 2026-11-11

Part of the beast spike (#4249, lane 3: the four-legged biters). The old sheet was a skin-modifier tube dog with stick
legs and a crown of flame cones. The new one comes from `proposals/set-a/make.ts` (`bun proposals/set-a/make.ts black-shuck`).

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild

## References

- [A ghostly Black Dog](https://commons.wikimedia.org/wiki/File:Ghost-BlackDog.jpg), Spettro84, public domain ([ref-ghost-black-dog.jpg](ref-ghost-black-dog.jpg))
- [Black Dog](https://commons.wikimedia.org/wiki/File:Blackdog.jpg), Liza Phoenix, CC BY 3.0 ([ref-liza-phoenix.jpg](ref-liza-phoenix.jpg))
- [Black Dog, 2015](https://commons.wikimedia.org/wiki/File:Black_Dog_by_Vasilios_Markousis_2015.jpg), Vasilios Markousis, CC BY-SA 4.0 ([ref-markousis.jpg](ref-markousis.jpg))

Traits: a big, long-legged hound, deep in the chest and tucked at the waist; shaggy black fur, longest on the ruff,
the back and the tail; pricked ears; a long muzzle with bared fangs; burning eyes. The game's text gives it one eye in
the middle of its head, so it keeps one. What a child draws: a black shaggy dog, the glowing eye, the teeth.

## What changed

- **Head:** a cranium, a long muzzle, two cheeks and a lower jaw hung open, all blobs merged by `blend: 0.012`. A dark
  gullet glows faintly in the open mouth. Nose, nostrils, lips, teeth and the eye are ray-cast onto the head's skin.
- **Legs as blobs:** one ellipsoid per bone (`bone()` in the generator: from node to node, rotated to lie along it),
  plus knobs at the elbow and the hock. They blend into the body, so the legs get a shoulder, an elbow, a hock and a
  tucked waist. The rigger finds 4 of 4 feet. The `limb` loft was tried first: its top came out as a flat plate on the flank.
- **Fur:** thin strands (`base` 0.03, `flat` 0.5) in their own colour, a shade off the body. The first pass had wide flat
  tufts that read as scales, as the Hodag's did.
- **Hide:** the `fur` pattern, dark roots and lighter tips.

## Lessons

- `tuft` `spread` is degrees either side of the top, not the whole fan: 105 covers the back and flanks, 165 a full ruff.
- Pricked ears want `thick` under 0.1: at 0.3 the lobe makes them round, like a mouse's.
- **Gap:** a black beast can't be black. `shade()` in beast.py lifts any body darker than luminance 0.045 (linear)
  toward the belly's hue, and in the arena the Shuck comes out charcoal grey. The belly here is a warm charcoal so the
  lift isn't lavender.
