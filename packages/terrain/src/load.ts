// Real ground on demand. Every json in zones/ (the seven Park Hide & Seek surveyed, and the places Skate Tech
// Park's fetch-parks.ts added, one per national park) is listed here with a static import, so each bundler
// does the right thing without being able to read a template path: Vite splits each into its own chunk and a
// page only carries the ground it rides, while esbuild (the Worker) and Bun.build (the desktop) carry them all
// in the bundle and resolve the import at once. Park Hide & Seek bundles the seven up front (zones.ts) and
// asks for the rest the first time a round lands on one; Skate Tech Park loads every level this way.
import type { ZoneData } from "./terrain.ts";

export const ZONE_FILES: Record<string, () => Promise<{ default: unknown }>> = {
  "acadia": () => import("./zones/acadia.json"),
  "american-samoa": () => import("./zones/american-samoa.json"),
  "arches": () => import("./zones/arches.json"),
  "badlands": () => import("./zones/badlands.json"),
  "big-bend": () => import("./zones/big-bend.json"),
  "biscayne": () => import("./zones/biscayne.json"),
  "black-canyon": () => import("./zones/black-canyon.json"),
  "bryce-canyon": () => import("./zones/bryce-canyon.json"),
  "canyonlands": () => import("./zones/canyonlands.json"),
  "capitol-reef": () => import("./zones/capitol-reef.json"),
  "carlsbad-caverns": () => import("./zones/carlsbad-caverns.json"),
  "channel-islands": () => import("./zones/channel-islands.json"),
  "congaree": () => import("./zones/congaree.json"),
  "crater-lake": () => import("./zones/crater-lake.json"),
  "cuyahoga-valley": () => import("./zones/cuyahoga-valley.json"),
  "death-valley": () => import("./zones/death-valley.json"),
  "denali": () => import("./zones/denali.json"),
  "dry-tortugas": () => import("./zones/dry-tortugas.json"),
  "el-capitan": () => import("./zones/el-capitan.json"),
  "everglades": () => import("./zones/everglades.json"),
  "gates-of-the-arctic": () => import("./zones/gates-of-the-arctic.json"),
  "gateway-arch": () => import("./zones/gateway-arch.json"),
  "glacier-bay": () => import("./zones/glacier-bay.json"),
  "glacier-point": () => import("./zones/glacier-point.json"),
  "glacier": () => import("./zones/glacier.json"),
  "grand-canyon": () => import("./zones/grand-canyon.json"),
  "grand-prismatic": () => import("./zones/grand-prismatic.json"),
  "grand-teton": () => import("./zones/grand-teton.json"),
  "great-basin": () => import("./zones/great-basin.json"),
  "great-sand-dunes": () => import("./zones/great-sand-dunes.json"),
  "great-smoky-mountains": () => import("./zones/great-smoky-mountains.json"),
  "guadalupe-mountains": () => import("./zones/guadalupe-mountains.json"),
  "haleakala": () => import("./zones/haleakala.json"),
  "half-dome": () => import("./zones/half-dome.json"),
  "hawaii-volcanoes": () => import("./zones/hawaii-volcanoes.json"),
  "hot-springs": () => import("./zones/hot-springs.json"),
  "indiana-dunes": () => import("./zones/indiana-dunes.json"),
  "isle-royale": () => import("./zones/isle-royale.json"),
  "joshua-tree": () => import("./zones/joshua-tree.json"),
  "katmai": () => import("./zones/katmai.json"),
  "kenai-fjords": () => import("./zones/kenai-fjords.json"),
  "kings-canyon": () => import("./zones/kings-canyon.json"),
  "kobuk-valley": () => import("./zones/kobuk-valley.json"),
  "lake-clark": () => import("./zones/lake-clark.json"),
  "lassen-volcanic": () => import("./zones/lassen-volcanic.json"),
  "mammoth-cave": () => import("./zones/mammoth-cave.json"),
  "mariposa-grove": () => import("./zones/mariposa-grove.json"),
  "mesa-verde": () => import("./zones/mesa-verde.json"),
  "mount-rainier": () => import("./zones/mount-rainier.json"),
  "new-river-gorge": () => import("./zones/new-river-gorge.json"),
  "north-cascades": () => import("./zones/north-cascades.json"),
  "old-faithful": () => import("./zones/old-faithful.json"),
  "olympic": () => import("./zones/olympic.json"),
  "petrified-forest": () => import("./zones/petrified-forest.json"),
  "pinnacles": () => import("./zones/pinnacles.json"),
  "redwood": () => import("./zones/redwood.json"),
  "rocky-mountain": () => import("./zones/rocky-mountain.json"),
  "saguaro": () => import("./zones/saguaro.json"),
  "sequoia": () => import("./zones/sequoia.json"),
  "shenandoah": () => import("./zones/shenandoah.json"),
  "theodore-roosevelt": () => import("./zones/theodore-roosevelt.json"),
  "virgin-islands": () => import("./zones/virgin-islands.json"),
  "voyageurs": () => import("./zones/voyageurs.json"),
  "white-sands": () => import("./zones/white-sands.json"),
  "wind-cave": () => import("./zones/wind-cave.json"),
  "wrangell-st-elias": () => import("./zones/wrangell-st-elias.json"),
  "yosemite-falls": () => import("./zones/yosemite-falls.json"),
  "zion": () => import("./zones/zion.json"),
};

const loaded = new Map<string, Promise<ZoneData>>();

/** The zone with this id (any json in zones/), fetched the first time it is asked for and kept after. */
export const loadZone = (id: string): Promise<ZoneData> => {
  let zone = loaded.get(id);
  if (!zone) {
    const file = ZONE_FILES[id];
    zone = file ? file().then((m) => m.default as ZoneData) : Promise.reject(new Error(`no zone ${id}`));
    zone.catch(() => loaded.delete(id));
    loaded.set(id, zone);
  }
  return zone;
};
