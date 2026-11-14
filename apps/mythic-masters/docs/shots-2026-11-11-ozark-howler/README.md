# Ozark Howler rebuild, 2026-11-11

Part of the beast spike (#4249, lane 3: the four-legged biters). Built with the hound generator
(`bun proposals/set-a/make.ts ozark-howler`): a heavy cat on thick legs (`legs: 1.45`), a deep chest and a full ruff,
a broad short muzzle hung open, curving horns, red glowing eyes, and a ropy tail with a tuft at the end.

- [before.jpg](before.jpg), [before-close.jpg](before-close.jpg): the old model
- [after.jpg](after.jpg), [after-close.jpg](after-close.jpg): the rebuild

## References

All by PetuniaJoan, CC BY-SA 4.0:

- [The Howler with long horns](https://commons.wikimedia.org/wiki/File:Ozarkhowlerlonghorns.jpg) ([ref-long-horns.jpg](ref-long-horns.jpg))
- [Ozark Howler](https://commons.wikimedia.org/wiki/File:Ozark_Howler.png) ([ref-howler.jpg](ref-howler.jpg))
- [With fangs bared](https://commons.wikimedia.org/wiki/File:Ozark_Howler_With_Fangs_Bared.png) ([ref-fangs.jpg](ref-fangs.jpg))
- [A head study](https://commons.wikimedia.org/wiki/File:Ozark_Howler_drawing.jpg) (not saved)

Traits: bear-sized and stocky; shaggy black-brown fur, longest on the neck and shoulders; big horns curving back from the
crown; red eyes; a wide mouth of fangs; a long thin tail with a tuft at the end. What a child draws: a big black furry cat, the horns, the red eyes.

## Lessons

- Thick legs (`legs`) only on the upper bones: the lower ones scale by its square root. At full scale the wrist and hock
  swell into balls.
- The horns are one `horn` each, rooted by ray-cast on the crown and bent back (`curve: 120`). That's enough to read at fight size.
