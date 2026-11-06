// The seeded rolls that decide who lives in a den, with no imports, so the room (src/net/dens.ts) checks a den against
// the same rolls the page draws it from without carrying the world (#3700). world.ts and view.ts use these too.

/** A number in [0, 1) for a grid point and a salt: the world's one source of chance. */
export function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const DEN = 200;          // metres across a den
export const DEN_CHANCE = 0.4;   // of the dens on open, dry, playable ground, how many hold a creature
/** Salts of a den cell's rolls: whether it holds anyone, who (over the region's pool), and the level's spread. */
export const DEN_SALT = { holds: 41, who: 46, level: 47 } as const;

/** Where den cell `cx, cz`'s creature circles: somewhere in the middle half of the cell. */
export const denHead = (cx: number, cz: number): [number, number] => [(cx + 0.25 + 0.5 * hash(cx, cz, 42)) * DEN, (cz + 0.25 + 0.5 * hash(cx, cz, 43)) * DEN];

/** How strong the wild ones of region n are: 1 in the Pine Barrens, climbing along the route, a few levels of spread. */
export const wildLevel = (n: number, roll: number) => 1 + 2 * (n - 1) + Math.floor(roll * 3);

/** On a trail, a den holds one of its section's own wild ones, picked by the den's name, at the section's level or one up. */
export function sectionPick(den: string, wilds: readonly string[], level: number): { id: string; level: number } | undefined {
  if (!wilds.length) return undefined;
  let h = 0;
  for (const ch of den) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { id: wilds[h % wilds.length]!, level: level + (h % 3 === 0 ? 1 : 0) };
}
