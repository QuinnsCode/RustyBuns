// Strike and load out: after the show, break it all down. Unplug every cable and coil it over-under back into the case
// (cables.ts `coil` and `loop`: a loop the same way as the one before is a twist, and a twist is a knot at the next
// show), pack every piece into the truck so it fits and can't slide (front to back, each piece hard against the bulkhead
// or a packed piece in front of it, heavy under light), and shut the truck before curfew or pay the venue's fine.
// Plain data, no DOM, like sim.ts; the page draws the truck and the card (strike-view.ts).
import { gear } from "@rustybuns/gear";
import { curfew, type Curfew } from "./clock.ts";
import { UNTANGLE_S, type Cables } from "./cables/cables.ts";
import { dims, footprint, overlap, type Answer, type Item, type Truck, type World } from "./sim.ts";

/** The venue's own gear, never yours to pack (the bigger bar's cooler). */
export const HOUSE = new Set(["bar-cooler"]);
/** How far a piece set down in the truck is shoved forward to meet what's in front of it. */
const SHOVE = 0.3;
/** A gap this small still counts as touching. */
const TOUCH = 0.02;

const strikes = new WeakMap<World, { since: number; tally: Tally | null }>();

/** The show is over: start the load-out, and the curfew clock with it. */
export function strike(w: World): Answer {
  if (!w.level.truck) return { ok: false, why: "no truck here" };
  if (strikes.has(w)) return { ok: false, why: "already loading out" };
  strikes.set(w, { since: w.t, tally: null });
  return { ok: true };
}

export const striking = (w: World) => strikes.has(w);

const yours = (w: World) => w.items.filter((i) => !HOUSE.has(i.gear));

/** A footprint's floor extents. */
function extent(i: Item, z = i.z) {
  const c = footprint(i, i.x, z);
  return { x0: Math.min(...c.map((p) => p[0])), x1: Math.max(...c.map((p) => p[0])), z0: Math.min(...c.map((p) => p[1])), z1: Math.max(...c.map((p) => p[1])) };
}

/** Whether a piece is in the truck: its footprint on the bed and its top under the roof. */
export function inTruck(t: Truck, i: Item): boolean {
  const e = extent(i), eps = 1e-3;
  return e.x0 >= t.x0 - eps && e.x1 <= t.x1 + eps && e.z0 >= t.z0 - eps && e.z1 <= t.z1 + eps && i.y + dims(i)[1] <= t.h + eps;
}

/** Pieces whose heights overlap (side by side, not one on the other). */
const sameLayer = (a: Item, b: Item) => a.y < b.y + dims(b)[1] - 1e-3 && b.y < a.y + dims(a)[1] - 1e-3;
/** Whether `i` moved to `z` would run into the bulkhead or another piece beside it. */
function blocked(w: World, t: Truck, i: Item, z: number): boolean {
  if (extent(i, z).z1 > t.z1 + 1e-6) return true;
  const fp = footprint(i, i.x, z);
  return w.items.some((o) => o !== i && o.key !== w.held?.key && sameLayer(i, o) && overlap(fp, footprint(o)));
}

/** A piece just set down with its middle over the bed: pulled in off the walls, then shoved forward (toward the cab)
 * until it meets the bulkhead or the piece in front, as far as an arm's shove goes. Pieces on top stay where they sit. */
export function stow(w: World, key: string) {
  const t = w.level.truck, i = w.items.find((x) => x.key === key);
  if (!t || !i || i.x < t.x0 || i.x > t.x1 || i.z < t.z0 || i.z > t.z1) return;
  const e = extent(i);
  i.x += Math.max(0, t.x0 - e.x0) - Math.max(0, e.x1 - t.x1);
  i.z += Math.max(0, t.z0 - e.z0) - Math.max(0, e.z1 - t.z1);
  if (i.y > 0.01) return;
  for (let n = 0; n < Math.round(SHOVE / 0.01) && !blocked(w, t, i, i.z + 0.01); n++) i.z += 0.01;
}

/** The packed pieces that can't slide when the truck brakes: hard against the bulkhead or a braced piece in front of
 * it, or sitting on a braced piece. */
export function braced(w: World, t: Truck): Set<string> {
  const packed = yours(w).filter((i) => i.key !== w.held?.key && inTruck(t, i)), ok = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const i of packed) {
      if (ok.has(i.key)) continue;
      const fp = footprint(i, i.x, i.z + TOUCH), top = (o: Item) => Math.abs(o.y + dims(o)[1] - i.y) < 0.01;
      const front = extent(i).z1 >= t.z1 - TOUCH || packed.some((o) => o !== i && ok.has(o.key) && sameLayer(i, o) && overlap(fp, footprint(o)));
      const under = i.y > 0.01 && packed.some((o) => o !== i && ok.has(o.key) && top(o) && overlap(footprint(i), footprint(o)));
      if (front || under) { ok.add(i.key); grew = true; }
    }
  }
  return ok;
}

/** A heavier piece set on a lighter one: it crushes what's under it on the first bump. */
function crushing(w: World, t: Truck): { top: string; under: string }[] {
  const packed = yours(w).filter((i) => inTruck(t, i));
  return packed.flatMap((i) => packed
    .filter((o) => o !== i && i.y > 0.01 && Math.abs(o.y + dims(o)[1] - i.y) < 0.01 && overlap(footprint(i), footprint(o)) && gear(i.gear).kg > gear(o.gear).kg)
    .map((o) => ({ top: i.key, under: o.key })));
}

export type Tally = {
  /** Seconds from the start of the load-out to the truck shut. */
  took: number;
  late: number;
  fine: number;
  /** Pieces that will slide and bang about on the drive. */
  sliding: string[];
  crushing: { top: string; under: string }[];
  /** Twists coiled into the cables, and the seconds they'll cost to work out at the next show. */
  twists: number;
  untangle: number;
};

/** What's left of the load-out, for the card and the harness. */
export function strikeState(w: World, c: Cables) {
  const s = strikes.get(w), t = w.level.truck;
  if (!s || !t) return null;
  const since = (s.tally?.took ?? w.t - s.since), ok = braced(w, t), mine = yours(w);
  const twists = c.runs.reduce((n, r) => n + (r.twists ?? 0), 0);
  return {
    since,
    curfew: curfew(w.level.name, since) satisfies Curfew,
    /** Boxes still on a hang, flown or on its frame: lowered and taken off before they can be packed. */
    aloft: mine.filter((i) => i.hung).map((i) => i.key),
    out: mine.filter((i) => i.key === w.held?.key || !inTruck(t, i)).map((i) => i.key),
    sliding: mine.filter((i) => i.key !== w.held?.key && inTruck(t, i) && !ok.has(i.key)).map((i) => i.key),
    crushing: crushing(w, t),
    cables: c.runs.filter((r) => r.rope).map((r) => r.key),
    twists,
    untangle: twists * UNTANGLE_S,
    tally: s.tally,
  };
}

/** Pull the door down and drive: every piece in the truck and every cable in its case. The tally says what it cost. */
export function shut(w: World, c: Cables): { ok: true; tally: Tally } | { ok: false; why: string } {
  const st = strikeState(w, c), t = w.level.truck, s = strikes.get(w);
  if (!st || !t || !s) return { ok: false, why: "the show isn't over: start the load-out first" };
  if (st.tally) return { ok: true, tally: st.tally };
  if (st.cables.length) return { ok: false, why: `${st.cables.length === 1 ? "a cable is" : `${st.cables.length} cables are`} still out (${st.cables.join(", ")})` };
  if (st.aloft.length) return { ok: false, why: `still up on a hang: lower it and take the boxes off first (${st.aloft.join(", ")})` };
  if (st.out.length) return { ok: false, why: `not in the truck yet: ${st.out.join(", ")}` };
  if (w.you.z > t.z0 && w.you.x > t.x0 && w.you.x < t.x1) return { ok: false, why: "step out of the truck first" };
  s.tally = { took: st.since, late: st.curfew.late, fine: st.curfew.fine, sliding: st.sliding, crushing: st.crushing, twists: st.twists, untangle: st.untangle };
  return { ok: true, tally: s.tally };
}
