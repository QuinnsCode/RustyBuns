# Splat Rooms

Two things: a hunting game in photoreal splat rooms, and a browser for [InteriorGS](https://huggingface.co/datasets/spatialverse/InteriorGS) scenes: flick through rooms, see the splats, and click objects. Every object in these scenes ships with a label and a 3D box, so the room is queryable, not just viewable. This is the groundwork for the splat-gun hunting game.

## Play

**Play** tab, pick a room, **Start hunt**. The room blacks out and you're told what to find. Drag to look, space fires one splat, shift-space sprays twenty. Each shot lights the patch of room it lands on, permanently: this is a map you build, not a torch you sweep. Charge holds twelve and refills one every 1.5 s, so a spray costs you the next nine seconds; far hits light less than close ones. When you think you've spotted the thing, hit **P** and click it. A wrong pick tells you what you actually clicked and costs four charge.

Rounds are built backwards, which is what makes them fair: pick a target, find a standing spot with clear line of sight to it, then face 22° off it so it's in view but not centred. A round that can't be seen is never offered. Targets prefer rare labels, so you get "find the microwave" rather than "find a cup" in a room holding six hundred cups.

## Get scenes

Scenes go in `~/Documents/SplatRooms/<scene>/` (override with `SPLAT_ROOMS_DIR`), one folder per scene, straight from the dataset:

```
hf download spatialverse/InteriorGS --repo-type dataset \
  --include "0002_*/*" --local-dir ~/Documents/SplatRooms
```

A folder needs `labels.json`; `3dgs_compressed.ply` (~31 MB) adds the visuals, and `occupancy.json` / `structure.json` come along for later. A labels-only folder still opens: you get the boxes and the object list, which is enough to judge whether a room is worth downloading in full.

## Run

```
bun install                     # at the repo root
cd apps/splat-rooms
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
```

Drag to orbit, shift-drag to pan, wheel to zoom, click to select. The left rail lists rooms, the right rail lists objects by kind, rarest first, since a category with two instances makes a better hunting target than one with six hundred.

## What's known to work

- The compressed PLY is `splat-transform`'s format (chunked min/max plus 11/10/11-bit packed positions, 256 splats per chunk), which is PlayCanvas's own, so its `gsplat` loader reads it unchanged.
- Splats, label boxes and the occupancy grid share one frame: right-handed, z-up, metres. The viewer hangs the scene under a root rotated -90° about X for PlayCanvas's y-up world, and picks rays in data space so boxes need no conversion.
- Picking is ray vs oriented box, built from the 8 corners. Flat boxes (paintings, labels) get 1 cm of thickness so they stay clickable, and near-ties prefer the smaller object so a mug beats the table under it.
- Serving scenes: `/scenes` is an external mount, read from disk and never embedded, and it honours range requests so a 31 MB PLY streams.

- The blackout is a 2D mask canvas over the render, not a splat shader: reveals are world points re-projected each frame, so they stay stuck to the room as you look around. Shot hit points come from ray vs the round's blockers, so "the centre of the shot" needs no splat raycast.
- Round planning is pure geometry over `labels.json` + `structure.json`, tested against the real scenes: the target is always visible from the vantage, seeds are reproducible, and a scene with no `structure.json` falls back to the objects' own footprint.

**Not yet verified:** actual splat rendering (it works, per your screenshot) at game framerates. This container has no GPU, and 517k splats under software WebGL can't hold a frame, so the PlayCanvas render path is the one part that needs your eyes on real hardware.

## Choosing scenes

`labels.json` is the only file that says what's in a room. `pick-scene.py` (repo root) ranks folders by how many distinct hand-sized categories they hold. Two data points so far: an eyewear shop scored 22 (4 kinds, 340 identical glasses), a café scored 156 (28 kinds: straws, jars, spoons, cup lids, napkins, a coffee maker). Retail with one product is bad; hospitality and homes are good.

## Licensing

InteriorGS ships under its own licence, not CC0, so scenes are downloaded by the user at runtime rather than bundled. Read the terms on the dataset page before shipping anything built on them.
