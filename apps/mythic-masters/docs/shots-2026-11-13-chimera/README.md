# Chimera rebuild, 2026-11-13

Round 7 of the beast models climb (#3516). This is the first of the Africa and Europe sheets carried from #2808 to be rebuilt from references.
The old sheet was a skin tube body on stick legs. It had a round head with no mouth, a flat brown mane, a goat neck that looked like a second snake, and a yellow tail.
The rebuild uses the set A hound body (`hound()` in `proposals/set-a/make.ts`, run with `bun proposals/set-a/make.ts chimera`). That body is built as a lion, and a goat neck and head and a serpent tail are then added to it.

- [before-close.jpg](before-close.jpg): the old model (ortho close-ups from git main)
- [after-close.jpg](after-close.jpg), [after.jpg](after.jpg): the rebuild

## References

From `refs/chimera.json` (`bun scripts/beast-refs.ts --refs chimera` downloads them again):

- [Chimera, Apulian plate](https://commons.wikimedia.org/wiki/File:Chimera_Apulia_Louvre_K362.jpg), Lampas Group, public domain
- [Chimaira, Nordisk familjebok](https://commons.wikimedia.org/wiki/File:Chimaira,_Nordisk_familjebok.png), public domain
- [Chimera of Arezzo](https://commons.wikimedia.org/wiki/File:Chimera_di_Arezzo.jpg), Lucarelli, public domain
- [Chimera of Arezzo, Florence](https://commons.wikimedia.org/wiki/File:Museo_archeologico_di_Firenze,_La_chimera_d%27arezzo_02.JPG), sailko, CC BY 2.5

A search for the name alone found a carved pew lion, a gold ring and a battle print. Those are in `skip`, and the
search now uses the "Chimera of Arezzo" category.

## What changed

- **Lion:** the hound body, with a deep chest, a big ruff, thick legs and wolf paws with claws. It has a short broad muzzle that roars wide open (`gape` 1.2) over fangs,
  and small round ears. Long dark mane tufts ray round the face.
- **Goat:** a neck rises out of the middle of the back to a narrow head. It has horns swept back, small ears, a beard and a
  brushed mane, all in its own dark brown coat (`paint`).
- **Serpent:** the tail rises off the rump and arches up over the back. It ends in a snake head turned forward, with
  green eyes and fangs. It has green scales (`paint`) and darker bands (`stripes`).
- 8741 triangles, feet 4/4, 34 joints and 12 tips (main had 9 tips). The `beasts.test.ts` suite passes.

## Scores

- Paired judge, out of 10: BEFORE 3 to NOW 5.5, verdict "better". On the climb that counts as half the gain (+1.25).
- Trait judge against the references: 3/10. Colours and the three things a child draws: yes. Silhouette, head and hide: partly. Limbs: no.

## Lessons

- `spikes` down the spine of a blended body float off it. Here they came out as loose brown chips above the back, so they were left out.
- On a ruff of 1.45, mane tufts shorter than about 0.3 k sink into the ruff blob, and the mane disappears. Long tufts (0.34 k,
  base 0.075 k) ray out from the front. They also add rig tips (7 to 12).

## Next (the judges' top gap)

A lean, low crouch like the Arezzo bronze. It needs forelegs braced forward, a tucked waist, ribs, and muscled legs with big paws, not
the barrel body on puffy legs that `hound()` makes at `chest` 1.25 and `legs` 1.3. Then close the mane into a full ring round the face.
