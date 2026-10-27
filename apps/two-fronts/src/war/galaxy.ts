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

export type GalaxyId = "short" | "full" | "horde";

export interface GalaxyDef {
  id: GalaxyId;
  name: string;
  blurb: string;
  width: number; // the map is width by 100
  pay?: number;  // the share of its sectors' income a side is paid, so a big map doesn't drown in armies (1 if unset)
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
// Tarn and Umber, in the Narrows, have a dust sea of old ore diggings that pays well, and Rook and Xan a jungle
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


// The Horde: sixty worlds, twelve columns of five, the Thunder Marines' half to the west and the Wooka's to
// the east. The map is point-symmetric like the others, but the forces aren't: the Wooka come in
// force, two or three armies to a world against the Thunder Marines' one or two, and the Thunder Marines hold the
// sky with more ships. Fend them off, then push back. Doren, the forest moon, is the Wooka's home.
const HORDE_NAMES = [
  ["Brill", "Corva", "Pell", "Quarry", "Halden", "Vesk", "Rook", "Sable", "Bracken", "Nyx", "Orin", "Thistle"],
  ["Harrow", "Ivo", "Dun", "Tarn", "Kessa", "Lumen", "Umber", "Vey", "Morrow", "Cinder", "Moss", "Wend"],
  ["Aster", "Keel", "Jessup", "Garrick", "Selby", "Corran", "Xan", "Yarrow", "Dell", "Glade", "Hollow", "Doren"],
  ["Tolle", "Fenwick", "Ostra", "Calder", "Wick", "Lisle", "Zell", "Pinewatch", "Burrow", "Sorrel", "Thorn", "Fernhome"],
  ["Iona", "Reave", "Castor", "Merrin", "Hale", "Bastia", "Briar", "Loam", "Sedge", "Rushmere", "Gorse", "Bramble"],
];
// The worlds with more than a capital, by their index in the first half (the second half mirrors it).
const HORDE_SECTORS: Record<number, SectorKind[]> = {
  24: ["spaceport", "capital"], 2: ["spaceport", "capital"], 9: ["spaceport", "capital"],
  14: ["shield", "capital"], 12: ["shield", "capital"], 17: ["shield", "spaceport", "capital"],
  5: ["cannon", "capital"], 29: ["cannon", "capital"],
  6: ["jungle", "capital"], 22: ["jungle", "capital"], 20: ["canyon", "capital"], 27: ["canyon", "capital"],
};
const HORDE_REGIONS: Record<string, string> = {
  "0n": "Thunder Reach", "0s": "Iron Coast", "1n": "Bastion March", "1s": "Glass Fields", "2n": "The Ramparts", "2s": "Ashfall",
  "3n": "Ember Belt", "3s": "The Narrows", "4n": "Bramblewild", "4s": "Mossdeep", "5n": "Fernhold", "5s": "Wooka Wilds",
};
function hordeGalaxy(): Galaxy {
  const COLS = 12, ROWS = 5, W = 239, ROW_Y = [15, 32, 49, 66, 83];
  const hash = (i: number, k: number) => { const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); };
  const systems: SystemDef[] = [], start: Record<string, Start> = {}, lanes: [string, string][] = [];
  const idOf = (row: number, col: number) => HORDE_NAMES[row]![col]!.toLowerCase();
  for (let i = 0; i < COLS * ROWS; i++) {
    const row = Math.floor(i / COLS), col = i % COLS, n = COLS * ROWS;
    // A world in the second half is its twin's mirror: across the centre, the jitter turned round too.
    const first = i < n / 2, k = first ? i : n - 1 - i;
    const kRow = Math.floor(k / COLS), kCol = k % COLS;
    // In quarter steps, which add and subtract exactly, so a twin sits exactly on its mirror.
    const jx = Math.round((hash(k, 1) - 0.5) * 32) / 4, jy = Math.round((hash(k, 2) - 0.5) * 24) / 4;
    const x = first ? 15 + kCol * 19 + jx : W - (15 + kCol * 19 + jx), y = first ? ROW_Y[kRow]! + jy : 98 - (ROW_Y[kRow]! + jy);
    const cp = Math.floor(col / 2), half = row < 2 ? "n" : row > 2 ? "s" : col < 6 ? "n" : "s";
    systems.push({ id: idOf(row, col), name: HORDE_NAMES[row]![col]!, region: `${cp}${half}`, x, y, sectors: HORDE_SECTORS[k] ?? ["capital"] });
    const marines = col < COLS / 2, front = col === 5 || col === 6, home = k === 24;
    start[idOf(row, col)] = marines
      ? { owner: "marines", armies: home || front ? 2 : 1, fleets: home ? 3 : front ? 2 : 1 }
      : { owner: "wooka", armies: home || front ? 3 : 2, fleets: home ? 2 : 1 };
    if (col + 1 < COLS) lanes.push([idOf(row, col), idOf(row, col + 1)]);
    if (row + 1 < ROWS) lanes.push([idOf(row, col), idOf(row + 1, col)]);
    // Diagonals on a pattern that turns into itself half a turn round.
    if (row + 1 < ROWS && col + 1 < COLS && Math.abs(2 * (row + col) - 13) % 4 === 1) lanes.push([idOf(row, col), idOf(row + 1, col + 1)]);
  }
  const regions: RegionDef[] = Object.entries(HORDE_REGIONS).map(([id, name]) => {
    const mine = systems.filter((s) => s.region === id), xs = mine.map((s) => s.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    return { id, name, bonus: (mine.length >= 6 ? 3 : 2) + (id[0] === "2" || id[0] === "3" ? 1 : 0), label: [cx, id[1] === "n" ? 3 : 97.5] as [number, number] };
  });
  return galaxy({ id: "horde", name: "The Horde", blurb: "60 worlds, and the Wooka come in force", width: W, pay: 0.3, regions, systems, lanes, start });
}

export const GALAXIES: Record<GalaxyId, Galaxy> = { short: SHORT, full: FULL, horde: hordeGalaxy() };
export const galaxyOf = (c: { galaxy: GalaxyId }) => GALAXIES[c.galaxy];

export const SECTOR_NAMES: Record<SectorKind, string> = { capital: "Ruined city", spaceport: "Space station", shield: "Shield generator", cannon: "Shore cannon", canyon: "Dust sea", jungle: "Glow jungle" };
// Credits a sector earns its holder each turn. The dust sea's ore pays best.
export const SECTOR_INCOME: Record<SectorKind, number> = { capital: 3, spaceport: 2, shield: 1, cannon: 1, canyon: 3, jungle: 1 };

export const FACTION_NAMES: Record<Faction, string> = { marines: "Thunder Marines", wooka: "Wooka" };
