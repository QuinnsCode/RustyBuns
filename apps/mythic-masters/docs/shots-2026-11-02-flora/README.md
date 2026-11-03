# Native plants, headless look (2026-11-02)

The first look in a browser at the plants grown in Blender (#3288), taken with `bun run probe` from the repo root.

- `pine-barrens-close.jpg`, `pine-barrens-open.jpg`: region 1. Grown pitch pines, blueberry and the near ground plants. The world state reports 2418 near plants and 3214 far ones.
- `southwest-desert.jpg`: region 6 (opened with `world.beat`). Grown agave and prickly pear near the party, 2302 near and 4090 far. The dense green forest behind it is where the desert meets the next region on the minimap. Whether that edge is too hard is a judgment call on looks.

## Recipe

```sh
bun run probe mythic-masters --js "
  const w = ms => new Promise(r => setTimeout(r, ms)), m = mythicMasters;
  m.journey.begin(['hodag', 'squonk', 'agropelter']); await w(800);
  m.world.enter(); await w(1000);
  for (let i = 1; i <= 12; i++) m.world.beat(i);           // open more regions
  const p = m.world.places(6)[0]; m.world.teleport(p.x + 12, p.z + 12);
  m.world.setHour(11); m.world.setWeather({ rain: 0, snow: 0, mist: 0 }); await w(8000);
  const s = m.world.state(); ({ name: s.name, plants: s.plants, far: s.far })
" --shot out.png
```

Gotchas:

- `world.enter()` without a journey only opens the starter screen. The camera stays in the arena and `plants` reads 0. Call `journey.begin` with creature ids (not indices) first.
- `--js` is already the body of an async function. Wrapping it in `(async () => ...)()` hands back an unawaited promise (`undefined`), and the shot is taken at once.
- A fresh journey opens only region 1, so `teleport` into another region does nothing until `world.beat` opens it.
