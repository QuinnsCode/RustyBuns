# Squonk rebuild, 2026-11-10 (Part of #4172)

The owner scored the starters about 1.3 out of 10 next to the references. These are three rebuilds of the Squonk, made the
way the Hodag was (PR #4171). Comparison page: https://claude.ai/artifact/NdnayKsnJmbKzP6Bj3oxNX. Shots are in
[docs/shots-2026-11-10-squonk](../../docs/shots-2026-11-10-squonk/).

## References

- [Cox, Fearsome Creatures of the Lumberwoods (1910), drawn by Coert Du Bois](https://commons.wikimedia.org/wiki/File:Squonk.png)
- [The same plate, book scan page 36](https://commons.wikimedia.org/wiki/File:Fearsome_Creatures_of_the_Lumberwoods,_with_a_Few_Desert_and_Mountain_Beasts_(page_36_crop).png)
- [Tryon, Fearsome Critters (1939), drawn by Margaret R. Tryon](https://commons.wikimedia.org/wiki/File:Squonk.jpg)

Commons has no other drawings of it. Traits every version shares: loose skin hanging in folds, warts and moles, a
mournful face with a slack open mouth, weeping, the head carried low, thin legs on long splayed toes, and a short tail.

## The candidates

- `squonk-cox.json`: the 1910 plate. Hunched, with nine rolls of loose hide, a skin hood draped by the low face, and thin legs on long toes.
- `squonk-tryon.json`: the 1939 drawing. Sitting up, pale and warty all over, with pointed ears, a wailing mouth and a knotted brow.
- `squonk-starter.json`: a starter. A big weeping head with huge eyes and big tears on a small saggy body, with basset hoods and stubby legs.

## Building

`make-squonk.ts` writes the three sheets. The face is built from blobs (a cranium, a muzzle and two jowls), with eyes, lids,
brow, mouth and tears placed on those blobs' surface. The folds are thin ellipsoid rings a little bigger than the torso,
merged by `blend`. From `apps/mythic-masters`:

```sh
bun proposals/squonk/make-squonk.ts
bun proposals/squonk/check.ts squonk-cox out.png   # blender/beast.py build, the rigger's feet check, close render (close.py)
```

`check.ts` writes `public/models/squonk-*.glb`. Delete those files, don't commit them. Once a pick is made, it gets copied over
`beasts/squonk.json` (with its id and `about` kept) and this folder is deleted.
