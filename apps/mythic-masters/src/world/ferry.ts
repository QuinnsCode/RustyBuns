// The boat to a pack's island (src/packs.ts, #4405): a slip at the port town on the port region's coast, and a slip on
// the island at the shore nearest its landing fire. Walk to the end of either and the boat takes you over. No three.js:
// view.ts and isle-view.ts draw it, test/packs.test.ts walks it.
import { clamp01 } from "@rustybuns/util";
import type { Pack } from "../packs.ts";
import { arenaOf, COLS, heightAt, onIsland, OWNER, ROWS, STEP, type World } from "./world.ts";
import { REGIONS } from "../regions.ts";

/** Metres from a slip's end that put you on the boat. */
export const BOARD_R = 6;
/** Metres you must walk off a slip before it takes you again (so stepping off the boat doesn't sail you back). */
export const REARM_R = BOARD_R * 3;

type At = { x: number; z: number };
/** A slip: where you board (`x`, `z`), the boat moored in the water past it, the dock's two ends, `out` the unit way to
 *  the sea, and `land` where the boat puts you ashore. */
export interface Slip extends At { boat: At; dock: [At, At]; out: At; land: At }

/** Metres out along `out` from (x, z) to water deeper than a boat draws, by `step`s, up to `max`. */
function toWater(w: World, x: number, z: number, ox: number, oz: number, step: number, max: number) {
  for (let d = 0; d <= max; d += step) if (heightAt(w, x + ox * d, z + oz * d) < -0.6) return d;
  return max;
}
const along = (a: At, o: At, d: number): At => ({ x: a.x + o.x * d, z: a.z + o.z * d });

/** The port town's slip, on the port region's coast at the shore sample nearest its arena: the pier starts at the edge
 *  of the region's own ground and runs on out over the sea's (mud flats on the coarse coast) to the boat in deep water.
 *  walk() lets you onto it (`onDock`), and you board at its far end, by the boat (#4417). */
export function portSlip(w: World, p: Pick<Pack, "land">): Slip {
  const n = p.land.port, a = arenaOf(REGIONS[n - 1]!);
  let best: { at: At; out: At } | undefined, bd = Infinity;
  for (let i = 0; i < OWNER.length; i++) {
    if (OWNER[i] !== n) continue;
    const c = i % COLS, r = Math.floor(i / COLS), x = c * STEP, z = r * STEP, d = Math.hypot(x - a.x, z - a.z);
    if (d >= bd) continue;
    const sea = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dc, dr]) => c + dc >= 0 && r + dr >= 0 && c + dc < COLS && r + dr < ROWS && OWNER[(r + dr) * COLS + c + dc] === 0);
    if (!sea) continue;
    // the region owns the ground halfway to the sea sample: you board just short of that
    bd = d; best = { at: { x: x + sea[0] * (STEP / 2 - 4), z: z + sea[1] * (STEP / 2 - 4) }, out: { x: sea[0], z: sea[1] } };
  }
  if (!best) throw new Error(`pack port ${n} has no coast`);
  const { at: foot, out } = best, boat = along(foot, out, Math.max(8, toWater(w, foot.x, foot.z, out.x, out.z, 10, 900) + 6));
  return { ...along(boat, out, -6), out, boat, dock: [along(foot, out, -10), along(boat, out, -4)], land: along(foot, out, -(REARM_R + 6)) };
}

/** The island's slip: the nearest shore to its landing fire (the pack's first fire), the dock run out past the
 *  waterline to the boat. The boat puts you down beside the fire. */
export function isleSlip(w: World, p: Pick<Pack, "places">): Slip & { fire: At } {
  const fire = onIsland(p.places.find((s) => s.kind === "fire")!.at);
  let best = { d: Infinity, out: { x: 0, z: 1 } };
  for (let k = 0; k < 48; k++) {
    const out = { x: Math.cos((k / 48) * Math.PI * 2), z: Math.sin((k / 48) * Math.PI * 2) };
    for (let d = 10; d < best.d; d += 10) if (heightAt(w, fire.x + out.x * d, fire.z + out.z * d) <= 0) { best = { d, out }; break; }
  }
  const { d, out } = best, at = along(fire, out, d + 14), boat = along(at, out, 8);
  return { ...at, out, boat, dock: [along(fire, out, d - 24), along(boat, out, -4)], land: along(fire, out, 4), fire };
}

/** Whether (x, z) is close enough to the slip's end to board. */
export const atSlip = (s: At, x: number, z: number) => Math.hypot(x - s.x, z - s.z) < BOARD_R;
/** Metres along the slip's dock from its land end, and across it, at (x, z). */
function onLine(s: Slip, x: number, z: number) {
  const [a, b] = s.dock, lx = b.x - a.x, lz = b.z - a.z, len = Math.hypot(lx, lz), dx = x - a.x, dz = z - a.z;
  return { t: (dx * lx + dz * lz) / len, across: Math.abs(dx * lz - dz * lx) / len, len };
}
/** Whether (x, z) is on the slip's dock: a strip 4 m wide between its ends. */
export function onDock(s: Slip, x: number, z: number) {
  const { t, across, len } = onLine(s, x, z);
  return t > -1 && t < len + 1 && across < 2;
}
/** The top of a dock's deck at (x, z), sloping from `y0` at its land end to `y1` at the boat as isle-view.ts's pier
 *  draws it; undefined off the dock. */
export function deckY(s: Slip, y0: number, y1: number, x: number, z: number) {
  if (!onDock(s, x, z)) return undefined;
  const { t, len } = onLine(s, x, z);
  return y0 + (y1 - y0) * clamp01(t / len) + 0.15;
}
/** Where you may stand on the island: above the sea, or on its dock. */
export const isleGround = (w: World, s: Slip, x: number, z: number) => heightAt(w, x, z) > 0.15 || onDock(s, x, z);
