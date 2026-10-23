// Fetches the ground for every park in the table (src/levels/parks.ts) that has none yet: a 2 km square of
// Terrarium tiles each, about 9 s and 70 KB, with the sea or lake flattened to the row's `water` level. Pass ids to
// fetch just those, or `--again` to refresh them (after changing a row's spot or water level).
//
//   bun scripts/fetch-parks.ts zion arches
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fetchPlace } from "../../../packages/terrain/scripts/fetch-place.ts";
import { PARKS } from "../src/levels/parks.ts";

const zones = join(import.meta.dir, "../../../packages/terrain/src/zones");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--")), again = process.argv.includes("--again");
for (const p of PARKS) {
  if (p.places || (ids.length && !ids.includes(p.id)) || (!again && existsSync(join(zones, `${p.id}.json`)))) continue;
  await fetchPlace(p.id, p.name, p.lat, p.lon, p.blurb, p.water);
}
