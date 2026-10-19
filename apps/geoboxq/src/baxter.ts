// Baxter the Boxer: opt-in, and he lives in the browser. He remembers the shapes you pack (in cm, turned so the
// longest side comes first) and suggests box sizes for them. What he learned is never sent anywhere.
import type { Row, State } from "./model.ts";

export interface Memory { on: boolean; seen: Seen[] }
/** A product shape he has met, longest side first, in cm, and how many of it went through. */
export interface Seen { d: [number, number, number]; n: number }
export interface Suggestion { name: string; size: [number, number, number]; covers: number }

export const CM = (unit: State["unit"]) => (unit === "in" ? 2.54 : 1);
const round = (x: number) => Math.round(x * 100) / 100;
const MAX_SEEN = 200;

export const sorted = (r: { l: number; w: number; h: number }) => [r.l, r.w, r.h].sort((a, b) => b - a) as [number, number, number];

/** Fold the products of one answer into what he knows; the same shape adds to its count, not a new entry. */
export function learn(mem: Memory, items: Row[], unit: State["unit"]): Memory {
  if (!mem.on) return mem;
  const seen = mem.seen.map((s) => ({ ...s, d: [...s.d] as Seen["d"] }));
  for (const r of items) {
    if (![r.l, r.w, r.h].every((d) => d > 0)) continue;
    const d = sorted(r).map((v) => round(v * CM(unit))) as Seen["d"];
    const n = Math.max(1, Math.floor(r.qty) || 1);
    const hit = seen.find((s) => s.d.every((v, k) => v === d[k]));
    if (hit) hit.n = Math.max(hit.n, n); // seeing the same order again is not more orders
    else seen.push({ d, n });
  }
  return { ...mem, seen: seen.slice(-MAX_SEEN) };
}

/**
 * Up to `k` box sizes (in the page's unit) that would hold what he has seen: the shapes are ranked by volume,
 * split into `k` groups of equal weight, and each group gets a box as big as its biggest on every axis.
 * A group an existing box already takes without much air (under a quarter more volume) gets no suggestion.
 */
export function suggest(seen: Seen[], boxes: Row[], unit: State["unit"], k = 3): Suggestion[] {
  if (!seen.length) return [];
  const byVol = [...seen].sort((a, b) => a.d[0] * a.d[1] * a.d[2] - b.d[0] * b.d[1] * b.d[2]);
  const total = byVol.reduce((t, s) => t + s.n, 0);
  const groups: Seen[][] = [[]];
  let run = 0;
  for (const s of byVol) {
    if (groups.length < k && run >= (total * groups.length) / k) groups.push([]);
    groups.at(-1)!.push(s);
    run += s.n;
  }
  const have = boxes.filter((b) => b.l > 0 && b.w > 0 && b.h > 0).map(sorted);
  const out: Suggestion[] = [];
  for (const g of groups) {
    const size = [0, 1, 2].map((a) => round(Math.max(...g.map((s) => s.d[a]!)) / CM(unit))) as Suggestion["size"];
    const vol = size[0] * size[1] * size[2];
    const snug = have.some((b) => b.every((v, a) => v >= size[a]!) && b[0] * b[1] * b[2] <= vol * 1.25);
    if (!snug) out.push({ name: `Baxter ${size.join("x")}`, size, covers: g.reduce((t, s) => t + s.n, 0) });
  }
  return out;
}
