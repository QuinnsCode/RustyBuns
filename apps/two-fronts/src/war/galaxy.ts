// The galaxies a campaign can be fought over. The short map is eight systems in three regions,
// one evening's war. The full campaign is thirty systems in seven regions, over several evenings:
// each side's two home regions, then the High Drift, the Narrows and the Ember Belt between them.
// Both maps are point-symmetric, so neither side starts with the better ground.
import type { Faction, SectorKind } from "../battle/contract.ts";

export interface SystemDef {
  id: string;
  name: string;
  region: string;
  x: number; // map position, in the galaxy's width by 100
  y: number;
  sectors: SectorKind[];
}

export interface RegionDef { id: string; name: string; bonus: number; label: [number, number] }

// Armies are per sector.
export interface Start { owner: Faction; fleets: number; armies: number }

export type GalaxyId = "short" | "full";

export interface GalaxyDef {
  id: GalaxyId;
  name: string;
  blurb: string;
  width: number; // the map is width by 100
  regions: RegionDef[];
  systems: SystemDef[];
  lanes: [string, string][];
  start: Record<string, Start>;
}

export interface Galaxy extends GalaxyDef {
  neighbours(id: string): string[];
  adjacent(a: string, b: string): boolean;
  system(id: string): SystemDef;
}

function galaxy(def: GalaxyDef): Galaxy {
  const near = new Map(def.systems.map((s) => [s.id, [] as string[]]));
  for (const [a, b] of def.lanes) { near.get(a)!.push(b); near.get(b)!.push(a); }
  const byId = new Map(def.systems.map((s) => [s.id, s]));
  return {
    ...def,
    neighbours: (id) => near.get(id) ?? [],
    adjacent: (a, b) => near.get(a)?.includes(b) ?? false,
    system: (id) => {
      const s = byId.get(id);
      if (!s) throw new Error(`no system ${id}`);
      return s;
    },
  };
}

// Most worlds are one capital sector. Kessa and Lumen, the two worlds of the Narrows, are whole
// planets of three sectors, and Corva and Morrow each guard the way into their side's home region
// with an anti-ship cannon. Turned half a turn around, Aster lands on Orin, Brill on Nyx, Corva on
// Morrow and Kessa on Lumen, each with the other side's start.
const SHORT = galaxy({
  id: "short",
  name: "Short war",
  blurb: "8 systems, one evening",
  width: 100,
  regions: [
    { id: "west", name: "Thunder Reach", bonus: 2, label: [19, 98] },
    { id: "core", name: "The Narrows", bonus: 3, label: [50, 98] },
    { id: "east", name: "Wooka Wilds", bonus: 2, label: [81, 98] },
  ],
  systems: [
    { id: "aster", name: "Aster", region: "west", x: 10, y: 28, sectors: ["capital"] },
    { id: "brill", name: "Brill", region: "west", x: 14, y: 72, sectors: ["capital"] },
    { id: "corva", name: "Corva", region: "west", x: 32, y: 49, sectors: ["cannon", "capital"] },
    { id: "kessa", name: "Kessa", region: "core", x: 50, y: 26, sectors: ["shield", "spaceport", "capital"] },
    { id: "lumen", name: "Lumen", region: "core", x: 50, y: 72, sectors: ["shield", "spaceport", "capital"] },
    { id: "morrow", name: "Morrow", region: "east", x: 68, y: 49, sectors: ["cannon", "capital"] },
    { id: "nyx", name: "Nyx", region: "east", x: 86, y: 26, sectors: ["capital"] },
    { id: "orin", name: "Orin", region: "east", x: 90, y: 70, sectors: ["capital"] },
  ],
  lanes: [
    ["aster", "brill"], ["aster", "corva"], ["brill", "corva"],
    ["corva", "kessa"], ["corva", "lumen"], ["kessa", "lumen"],
    ["kessa", "morrow"], ["lumen", "morrow"],
    ["morrow", "nyx"], ["morrow", "orin"], ["nyx", "orin"],
  ],
  start: {
    aster: { owner: "marines", fleets: 2, armies: 2 },
    brill: { owner: "marines", fleets: 1, armies: 2 },
    corva: { owner: "marines", fleets: 3, armies: 2 },
    lumen: { owner: "marines", fleets: 2, armies: 1 },
    kessa: { owner: "wooka", fleets: 2, armies: 1 },
    morrow: { owner: "wooka", fleets: 3, armies: 2 },
    nyx: { owner: "wooka", fleets: 1, armies: 2 },
    orin: { owner: "wooka", fleets: 2, armies: 2 },
  },
});

// Each side's homeworld (Aster, Fernhome) has a spaceport. The front runs down the middle of the
// High Drift, the Narrows and the Ember Belt: a shipyard world in each outer region, a shield
// world either side of the Narrows, and a cannon world guarding each way into a home region.
// Tarn and Umber, in the Narrows, have a mining canyon that pays well, and Rook and Xan a jungle
// that the side holding it fights from.
const FULL = galaxy({
  id: "full",
  name: "Full campaign",
  blurb: "30 systems, several evenings",
  width: 160,
  regions: [
    { id: "reach", name: "Thunder Reach", bonus: 2, label: [20, 5] },
    { id: "coast", name: "Iron Coast", bonus: 2, label: [20, 97] },
    { id: "drift", name: "The High Drift", bonus: 3, label: [80, 5] },
    { id: "narrows", name: "The Narrows", bonus: 5, label: [80, 51.5] },
    { id: "ember", name: "Ember Belt", bonus: 3, label: [80, 97] },
    { id: "wilds", name: "Wooka Wilds", bonus: 2, label: [140, 5] },
    { id: "deep", name: "Deepwood", bonus: 2, label: [140, 97] },
  ],
  systems: [
    { id: "brill", name: "Brill", region: "reach", x: 10, y: 16, sectors: ["capital"] },
    { id: "corva", name: "Corva", region: "reach", x: 30, y: 16, sectors: ["capital"] },
    { id: "aster", name: "Aster", region: "reach", x: 10, y: 38, sectors: ["spaceport", "capital"] },
    { id: "dun", name: "Dun", region: "reach", x: 30, y: 38, sectors: ["capital"] },
    { id: "harrow", name: "Harrow", region: "coast", x: 10, y: 60, sectors: ["capital"] },
    { id: "ivo", name: "Ivo", region: "coast", x: 30, y: 60, sectors: ["capital"] },
    { id: "jessup", name: "Jessup", region: "coast", x: 10, y: 82, sectors: ["capital"] },
    { id: "keel", name: "Keel", region: "coast", x: 30, y: 82, sectors: ["capital"] },
    { id: "pell", name: "Pell", region: "drift", x: 50, y: 16, sectors: ["capital"] },
    { id: "quarry", name: "Quarry", region: "drift", x: 70, y: 16, sectors: ["spaceport", "capital"] },
    { id: "rook", name: "Rook", region: "drift", x: 90, y: 16, sectors: ["jungle", "capital"] },
    { id: "sable", name: "Sable", region: "drift", x: 110, y: 16, sectors: ["capital"] },
    { id: "lumen", name: "Lumen", region: "narrows", x: 50, y: 49, sectors: ["cannon", "capital"] },
    { id: "kessa", name: "Kessa", region: "narrows", x: 70, y: 36, sectors: ["shield", "spaceport", "capital"] },
    { id: "tarn", name: "Tarn", region: "narrows", x: 70, y: 62, sectors: ["canyon", "capital"] },
    { id: "umber", name: "Umber", region: "narrows", x: 90, y: 36, sectors: ["canyon", "capital"] },
    { id: "vey", name: "Vey", region: "narrows", x: 90, y: 62, sectors: ["shield", "spaceport", "capital"] },
    { id: "morrow", name: "Morrow", region: "narrows", x: 110, y: 49, sectors: ["cannon", "capital"] },
    { id: "wick", name: "Wick", region: "ember", x: 50, y: 82, sectors: ["capital"] },
    { id: "xan", name: "Xan", region: "ember", x: 70, y: 82, sectors: ["jungle", "capital"] },
    { id: "yarrow", name: "Yarrow", region: "ember", x: 90, y: 82, sectors: ["spaceport", "capital"] },
    { id: "zell", name: "Zell", region: "ember", x: 110, y: 82, sectors: ["capital"] },
    { id: "nyx", name: "Nyx", region: "wilds", x: 130, y: 16, sectors: ["capital"] },
    { id: "orin", name: "Orin", region: "wilds", x: 150, y: 16, sectors: ["capital"] },
    { id: "bracken", name: "Bracken", region: "wilds", x: 130, y: 38, sectors: ["capital"] },
    { id: "cinder", name: "Cinder", region: "wilds", x: 150, y: 38, sectors: ["capital"] },
    { id: "dell", name: "Dell", region: "deep", x: 130, y: 60, sectors: ["capital"] },
    { id: "fernhome", name: "Fernhome", region: "deep", x: 150, y: 60, sectors: ["spaceport", "capital"] },
    { id: "glade", name: "Glade", region: "deep", x: 130, y: 82, sectors: ["capital"] },
    { id: "hollow", name: "Hollow", region: "deep", x: 150, y: 82, sectors: ["capital"] },
  ],
  lanes: [
    // The Thunder Marines' home regions, and the ways out of them.
    ["brill", "corva"], ["brill", "aster"], ["corva", "dun"], ["aster", "dun"], ["aster", "harrow"],
    ["dun", "ivo"], ["harrow", "ivo"], ["harrow", "jessup"], ["ivo", "keel"], ["jessup", "keel"],
    ["corva", "pell"], ["dun", "lumen"], ["ivo", "lumen"], ["keel", "wick"],
    // The middle.
    ["pell", "quarry"], ["quarry", "rook"], ["rook", "sable"],
    ["wick", "xan"], ["xan", "yarrow"], ["yarrow", "zell"],
    ["pell", "lumen"], ["lumen", "wick"], ["sable", "morrow"], ["morrow", "zell"],
    ["quarry", "kessa"], ["rook", "umber"], ["xan", "tarn"], ["yarrow", "vey"],
    ["lumen", "kessa"], ["lumen", "tarn"], ["kessa", "tarn"], ["kessa", "umber"],
    ["tarn", "vey"], ["umber", "vey"], ["umber", "morrow"], ["vey", "morrow"],
    // The Wooka's home regions, and the ways out of them.
    ["sable", "nyx"], ["morrow", "bracken"], ["morrow", "dell"], ["zell", "glade"],
    ["nyx", "orin"], ["nyx", "bracken"], ["orin", "cinder"], ["bracken", "cinder"], ["bracken", "dell"],
    ["cinder", "fernhome"], ["dell", "fernhome"], ["dell", "glade"], ["fernhome", "hollow"], ["glade", "hollow"],
  ],
  start: {
    aster: { owner: "marines", fleets: 3, armies: 2 },
    brill: { owner: "marines", fleets: 1, armies: 1 },
    corva: { owner: "marines", fleets: 1, armies: 2 },
    dun: { owner: "marines", fleets: 1, armies: 2 },
    harrow: { owner: "marines", fleets: 1, armies: 1 },
    ivo: { owner: "marines", fleets: 1, armies: 2 },
    jessup: { owner: "marines", fleets: 1, armies: 1 },
    keel: { owner: "marines", fleets: 1, armies: 2 },
    pell: { owner: "marines", fleets: 2, armies: 2 },
    quarry: { owner: "marines", fleets: 2, armies: 2 },
    lumen: { owner: "marines", fleets: 2, armies: 2 },
    kessa: { owner: "marines", fleets: 2, armies: 1 },
    tarn: { owner: "marines", fleets: 2, armies: 2 },
    wick: { owner: "marines", fleets: 2, armies: 2 },
    xan: { owner: "marines", fleets: 2, armies: 2 },
    hollow: { owner: "wooka", fleets: 1, armies: 1 },
    glade: { owner: "wooka", fleets: 1, armies: 2 },
    fernhome: { owner: "wooka", fleets: 3, armies: 2 },
    dell: { owner: "wooka", fleets: 1, armies: 2 },
    cinder: { owner: "wooka", fleets: 1, armies: 1 },
    bracken: { owner: "wooka", fleets: 1, armies: 2 },
    orin: { owner: "wooka", fleets: 1, armies: 1 },
    nyx: { owner: "wooka", fleets: 1, armies: 2 },
    zell: { owner: "wooka", fleets: 2, armies: 2 },
    yarrow: { owner: "wooka", fleets: 2, armies: 2 },
    morrow: { owner: "wooka", fleets: 2, armies: 2 },
    vey: { owner: "wooka", fleets: 2, armies: 1 },
    umber: { owner: "wooka", fleets: 2, armies: 2 },
    sable: { owner: "wooka", fleets: 2, armies: 2 },
    rook: { owner: "wooka", fleets: 2, armies: 2 },
  },
});

export const GALAXIES: Record<GalaxyId, Galaxy> = { short: SHORT, full: FULL };
export const galaxyOf = (c: { galaxy: GalaxyId }) => GALAXIES[c.galaxy];

export const SECTOR_NAMES: Record<SectorKind, string> = { capital: "Capital", spaceport: "Spaceport", shield: "Shield generator", cannon: "Anti-ship cannon", canyon: "Mining canyon", jungle: "Jungle" };
// Credits a sector earns its holder each turn. The canyon's ore pays best.
export const SECTOR_INCOME: Record<SectorKind, number> = { capital: 3, spaceport: 2, shield: 1, cannon: 1, canyon: 3, jungle: 1 };

export const FACTION_NAMES: Record<Faction, string> = { marines: "Thunder Marines", wooka: "Wooka" };
