// Where the faction people stand on the open ground (docs/FACTIONS.md): a quest step's person a few metres off the
// stone of the section it waits at, and each post's rank a little further out. The same spots every time: they come
// from a hash of who and where, never from chance, and they are found in a fixed order (the factions as model.ts lists
// them), so no two people at one stone stand on top of each other.
// No three.js and no DOM: rivals-view.ts draws them, the tests walk up to them.
import { FACTIONS, type FactionId } from "../factions/model.ts";
import { TRAILS, WORLD } from "./trail.ts";
import { dry, ownerAt } from "./world.ts";

export interface Spot { x: number; z: number }

/** Metres: walk this close and they speak. */
export const TALK_R = 5;
/** Metres kept between any two faction people at one stone. */
const APART = 6;
/** Metres from the stone a quest person stands (the first that has dry ground), and the ring the posts stand in. */
const STAGE_D = [9, 10, 8, 11, 12], POST_D = [16, 24] as const;
const ANGLES = 24;

const far = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const isFaction = (s: string | undefined): s is FactionId => FACTIONS.some((f) => f === s);

/** The first spot round `stone` that is dry ground of region n and clear of `others`: each distance in turn, and at
 * each the angles in turn from `from`. */
function find(stone: Spot, n: number, from: number, dists: readonly number[], others: readonly Spot[]): Spot | undefined {
  for (const d of dists) for (let i = 0; i < ANGLES; i++) {
    const a = from + (i * Math.PI * 2) / ANGLES;
    const at = { x: Math.round((stone.x + Math.cos(a) * d) * 10) / 10, z: Math.round((stone.z + Math.sin(a) * d) * 10) / 10 };
    if (ownerAt(at.x, at.z) === n && dry(WORLD, at.x, at.z) && others.every((o) => far(o, at) >= APART)) return at;
  }
  return undefined;
}

const stages = new Map<string, Spot | undefined>(), posts = new Map<string, Spot | undefined>();
const defined = (s: Spot | undefined): s is Spot => s !== undefined;

/** Where faction f's quest person stands for a step at section k of region n: about 9 m from that section's stone, on
 * dry ground of the region, and at least 6 m from where the other two would stand at the same stone. */
export function stageSpot(f: FactionId, n: number, k: number): Spot | undefined {
  const key = `${f}:${n}:${k}`;
  if (stages.has(key)) return stages.get(key);
  const stone = TRAILS.get(n)?.stones[k];
  // the factions before this one stand first; this one takes the first clear spot after them
  const others = FACTIONS.slice(0, FACTIONS.indexOf(f)).map((o) => stageSpot(o, n, k)).filter(defined);
  const at = stone && find(stone, n, ((hash(key) % 3600) / 3600) * Math.PI * 2, STAGE_D, others);
  stages.set(key, at);
  return at;
}

/** Where the post "faction:n:k" (engine.ts `postId`) stands: 16 to 24 m from its section's stone, on dry ground of the
 * region, and at least 6 m from every faction's quest spot at that stone and from the other factions' posts there. */
export function postSpot(id: string): Spot | undefined {
  if (posts.has(id)) return posts.get(id);
  const [f, ns, ks, ...rest] = id.split(":"), n = Number(ns), k = Number(ks);
  if (!isFaction(f) || rest.length || !Number.isInteger(n) || !Number.isInteger(k)) return undefined;
  const stone = TRAILS.get(n)?.stones[k], h = hash(`post:${id}`);
  const others = [...FACTIONS.map((o) => stageSpot(o, n, k)), ...FACTIONS.slice(0, FACTIONS.indexOf(f)).map((o) => postSpot(`${o}:${n}:${k}`))].filter(defined);
  // its own distance in the ring first, then the rest of the ring a metre at a time
  const first = POST_D[0] + (Math.floor(h / 3600) % (POST_D[1] - POST_D[0] + 1));
  const dists = [first, ...Array.from({ length: POST_D[1] - POST_D[0] + 1 }, (_, i) => POST_D[0] + i).filter((d) => d !== first)];
  const at = stone && find(stone, n, ((h % 3600) / 3600) * Math.PI * 2, dists, others);
  posts.set(id, at);
  return at;
}

/** The people you have just walked up to: those of `list` within TALK_R that `reached` did not hold. `reached` is the
 * ones you are standing with, kept by the caller so each speaks once a visit; one leaves it when you are more than
 * twice TALK_R away (the contract of poi.ts `arrive`). */
export function walkedUp<T extends Spot & { id: string }>(me: Spot, list: readonly T[], reached: Set<string>): T[] {
  const out: T[] = [];
  for (const p of list) {
    const d = far(me, p);
    if (d < TALK_R && !reached.has(p.id)) { reached.add(p.id); out.push(p); }
    else if (d > TALK_R * 2) reached.delete(p.id);
  }
  return out;
}
