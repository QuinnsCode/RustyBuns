// Real ground on demand. A place added with scripts/fetch-place.ts is one json beside the others in zones/ and
// is not imported up front: a bundler splits each into its own file, so a page only carries the ground it rides.
import type { ZoneData } from "./terrain.ts";

const loaded = new Map<string, Promise<ZoneData>>();

/** The zone with this id (any json in zones/), fetched the first time it is asked for and kept after. */
export const loadZone = (id: string): Promise<ZoneData> => {
  let zone = loaded.get(id);
  if (!zone) {
    zone = import(`./zones/${id}.json`).then(
      (m) => m.default as ZoneData,
      () => { loaded.delete(id); throw new Error(`no zone ${id}`); },
    );
    loaded.set(id, zone);
  }
  return zone;
};
