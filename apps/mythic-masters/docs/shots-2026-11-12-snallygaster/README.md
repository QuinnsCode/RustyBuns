# Snallygaster rebuild, 2026-11-12

The first cryptid of the compendium pass: each beast rebuilt from references one at a time, with the owner steering
each prototype. The old sheet was a grey lizard with bat wings and a yellow dot of an eye. The rebuild follows the
owner's own pictures and the Maryland accounts.

- [before-close.jpg](before-close.jpg): the old model (front, side, three-quarter, head; ortho, from git main)
- [after-close.jpg](after-close.jpg): the rebuild, at the same scale
- [coil-close.jpg](coil-close.jpg): the body coiled like the owner's drawing (#4374), at the same scale

## References

- The owner's two pictures, kept private and not committed: a green and ochre dragon-bird with a tentacle beard, and a
  pale coiled one with a single eye.
- [Snallygaster](https://commons.wikimedia.org/wiki/File:Snallygaster-image.png), Lumberwoods, CC0 (the bestiary card's picture)
- [Snallygaster Jersey Barrier](https://commons.wikimedia.org/wiki/File:Snallygaster_Jersey_Barrier.jpg), Tripodero, CC BY-SA 3.0

Traits are in `refs/snallygaster.json`. What a child draws: the tentacles coming out of its beak, a bird head on a
dragon body, big green feathered wings.

## What changed

- **Head:** one big yellow eye in the middle of the forehead (the owner's pick, as in the old accounts), a pale,
  metal-like hooked beak with a row of teeth down each side (also the owner's pick), red frills on the crown, and a
  beard of 21 crimson tentacles in two rings spilling from the gape.
- **Body:** a low, heavy green dragon torso on short, stout orange bird legs with three-toed talons, ribs under the
  throat and belly, a white feather bib, a deep S in the neck, and a whip tail that swings sideways into a curl.
- **Wings:** feathered, not a membrane: a thin green arm, four overlapping rows of green covert feathers and twenty
  long ochre primaries swept toward the wingtip.
- 8,996 triangles, feet 2/2, wings 2/2. Generator: `proposals/compendium/snallygaster.ts`.

## Builder change: `rake` on a membrane's feathers

A membrane's `feathers` row stood straight out of the wing's edge, square to it, so primaries looked like a comb.
`rake` (degrees) swings each feather in the membrane's plane toward the row's end (`to`), or with a negative value
back toward `from`. The Snallygaster uses -40, which sweeps the primaries up and out toward the wingtip. It defaults
to 0, so no other sheet changes until it asks for it.

## Builder change: `stripes` under a blended belly (#4372)

[belly-bands.jpg](belly-bands.jpg): the underside from below, dark bands between the ribs from the legs to the throat.

`stripes` only banded a chain's back, and only faces within 5 cm of the node radii, so on a body of blended blobs
(the skin sits far past those radii) it painted nothing. `side: "under"` bands the underside instead (faces turned
down past `below`), and a face counts when it sits within `reach` of the skin a ray from the chain first meets.
Three more things it needed before the bands showed in the GLB, not just on the full mesh:

- The cuts at each band's edge only slice the flesh near the band. A plane through the whole beast also cut the
  wings and legs, and the hide's unwrap of that skin collapsed (UVs on 0% of the map, the scales gone).
- The band borders go in a `keep` vertex group the decimator leaves, and the borders are split on the low-poly mesh,
  so a band two triangles wide keeps its full colour instead of half of it on every shared vertex.
- A face out past a bend's outside (under the chest) takes the joint's one spot on the chain and came out as one
  solid dark block; those faces, and the thighs blended into the belly, aren't banded.

The sheet's ribs are now 12, spaced evenly along the underside (`phase` puts each band halfway between two ribs).
The darkest band is `band` in the palette. Blender draws a thin light line along a split border; the game smooths
normals across split copies, so it doesn't show there.

## The climb

Each round was judged trait by trait against the references by a fresh judge (`bun scripts/beast-refs.ts --judge`).
Judges run about 2 points above the owner, so the ticks matter more than the number.

| Round | Change | Judge |
|---|---|---|
| 2 | pale toothed beak, separate primaries | 4/10 |
| 3 | thicker torso, ribs, covert feathers, tail curl | 3/10 |
| 4 | 16 cm lower on stouter legs, bigger beak, white bib | 3/10; head passes |
| 6 | wing made of feathers on raked primaries | 4/10; wings pass |
| 7 | the coil, a denser beard, bigger teeth | 3/10; beard passes |
| 8 | the whole body one S (#4374): throat bowed low, back arched over the hips, tail sweeping up into a sideways curl; bib moved onto the throat | 4/10; body still short |

## Lessons

- A thicker torso buries parts placed on the old surface (the chest bib vanished in round 3): move face and chest
  parts out whenever the blob under them grows.
- Long stilt legs read as a heron, not a dragon, whatever the head does. Lowering the body did more than any head detail.
- A wing reads as feathered only when the feathers carry its outline; any membrane wider than the arm reads as a slab.
- `bone()` only turns a blob in the side plane, so a tail that coils sideways is built from overlapping spheres instead.
- A body bowed low at the chest buries parts placed on the chest: the white bib went under the throat until it moved onto `neck1`.

## Still open

- The body coils now (#4374), but beside the drawing the judge still reads it as short and the neck as stubby.
