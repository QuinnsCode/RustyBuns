// Radio questions: the ranger asks, every camper's radio answers truthfully,
// and each answer is a clue that rules out part of the zone on the radio map.
// Answered on a grid (see grid.ts), so the answer and the shading always agree.
// Campers keep moving, so a clue is true where they were when it was asked.

import { dist, type Pt } from "./geo.ts";
import { cellAt, cellX, cellY, gridFor, type Grid, type MatchCat, type MeasureWhat } from "./grid.ts";
import type { ParkData } from "./parks/types.ts";
import { SCALE, type Zone } from "./zones/zone.ts";

export const RADIO = {
  /** Fractions of the zone's size. */
  radar: [0.08, 0.16, 0.3],
  thermoMin: 0.08,
  cooldownSecs: 15,
  limits: { radar: 2, compass: 2, thermo: 1, match: 1, measure: 1 } as Record<AskKind, number>,
};

export type Ask =
  | { kind: "radar"; r: number }
  | { kind: "compass"; axis: "ns" | "ew" }
  | { kind: "thermo" }
  | { kind: "match"; cat: MatchCat }
  | { kind: "measure"; what: MeasureWhat };
export type AskKind = Ask["kind"];

export type Clue =
  | { kind: "radar"; x: number; y: number; r: number; yes: boolean }
  | { kind: "compass"; axis: "ns" | "ew"; v: number; plus: boolean }
  | { kind: "thermo"; ax: number; ay: number; bx: number; by: number; hotter: boolean }
  | { kind: "match"; cat: MatchCat; idx: number; same: boolean }
  | { kind: "measure"; what: MeasureWhat; d: number; closer: boolean };

export interface RadioState { x: number; y: number; cooldownUntil: number; used: Record<AskKind, number>; lastAsk: Pt | null }

export const NO_ASKS = (): Record<AskKind, number> => ({ radar: 0, compass: 0, thermo: 0, match: 0, measure: 0 });

/** Game metres to the radio grid's units (real km) and back. */
export const toKm = (m: number) => (m * SCALE) / 1000;
export const toGame = (km: number) => (km * 1000) / SCALE;

/** The zone as a "park" the grid understands: a circle, its signposts, no water data. */
export function radioGrid(z: Zone): Grid {
  const R = toKm(z.R);
  const outline: Pt[] = Array.from({ length: 64 }, (_, k) => [Math.cos((k / 64) * Math.PI * 2) * R, Math.sin((k / 64) * Math.PI * 2) * R]);
  const park: ParkData = {
    code: `zone:${z.data.id}`, name: z.data.name, state: "", center: z.data.center,
    outline: [outline], lakes: [], rivers: [], roads: [],
    landmarks: z.landmarks.map((m) => ({ ...m, x: m.x / 1000, y: m.y / 1000 })),
    start: { name: "Ranger station", kind: "start", x: toKm(z.station.x), y: toKm(z.station.y) },
  };
  return gridFor(park);
}

export function allAsks(g: Grid): Ask[] {
  return [
    ...RADIO.radar.map((f): Ask => ({ kind: "radar", r: radarKm(g, f) })),
    { kind: "compass", axis: "ns" }, { kind: "compass", axis: "ew" },
    { kind: "thermo" },
    { kind: "match", cat: "peak" }, { kind: "match", cat: "sight" },
  ];
}

export function radarKm(g: Grid, frac: number): number {
  const v = frac * g.S;
  const p = 10 ** Math.floor(Math.log10(v));
  return (Math.round((v / p) * 2) / 2) * p;
}

/** Why this can't be asked now (positions in km), or null. */
export function askBlocked(g: Grid, s: RadioState, ask: Ask, now: number): string | null {
  if (s.used[ask.kind] >= RADIO.limits[ask.kind]) return "none left this round";
  if (now < s.cooldownUntil) return "radio cooling down";
  switch (ask.kind) {
    case "radar": if (!RADIO.radar.some((f) => Math.abs(radarKm(g, f) - ask.r) < 1e-9)) return "not a radar size"; break;
    case "compass": break;
    case "thermo":
      if (!s.lastAsk) return "ask something first, then move";
      if (dist(s.lastAsk[0], s.lastAsk[1], s.x, s.y) < RADIO.thermoMin * g.S) return `move ${fmtKm(RADIO.thermoMin * g.S)} from your last question`;
      break;
    case "match": if (!g.nearest[ask.cat]) return `too few named ${ask.cat}s here`; break;
    case "measure": if (!g.distTo[ask.what]) return "no data here"; break;
  }
  return null;
}

/** A question asked from (sx, sy) km, answered by whoever is in `cell`. */
export function resolve(g: Grid, ask: Ask, sx: number, sy: number, lastAsk: Pt | null, cell: number): Clue {
  const hx = cellX(g, cell), hy = cellY(g, cell);
  const here = cellAt(g, sx, sy);
  switch (ask.kind) {
    case "radar": return { kind: "radar", x: sx, y: sy, r: ask.r, yes: dist(hx, hy, sx, sy) <= ask.r };
    case "compass": return ask.axis === "ns"
      ? { kind: "compass", axis: "ns", v: sy, plus: hy > sy }
      : { kind: "compass", axis: "ew", v: sx, plus: hx > sx };
    case "thermo": { const [ax, ay] = lastAsk!; return { kind: "thermo", ax, ay, bx: sx, by: sy, hotter: dist(hx, hy, sx, sy) < dist(hx, hy, ax, ay) }; }
    case "match": { const near = g.nearest[ask.cat]!; return { kind: "match", cat: ask.cat, idx: near[here], same: near[cell] === near[here] }; }
    case "measure": { const d = g.distTo[ask.what]!; return { kind: "measure", what: ask.what, d: d[here], closer: d[cell] < d[here] }; }
  }
}

export function fits(g: Grid, c: Clue, cell: number): boolean {
  const x = cellX(g, cell), y = cellY(g, cell);
  switch (c.kind) {
    case "radar": return (dist(x, y, c.x, c.y) <= c.r) === c.yes;
    case "compass": return ((c.axis === "ns" ? y : x) > c.v) === c.plus;
    case "thermo": return (dist(x, y, c.bx, c.by) < dist(x, y, c.ax, c.ay)) === c.hotter;
    case "match": return (g.nearest[c.cat]![cell] === c.idx) === c.same;
    case "measure": return (g.distTo[c.what]![cell] < c.d) === c.closer;
  }
}

/** Cells (1) that fit every clue. */
export function possible(g: Grid, clues: Clue[]): Uint8Array {
  const out = new Uint8Array(g.cols * g.rows);
  for (const i of g.parkCells) {
    let ok = true;
    for (const c of clues) if (!fits(g, c, i)) { ok = false; break; }
    if (ok) out[i] = 1;
  }
  return out;
}

export function fmtKm(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : km >= 1 ? `${Math.round(km * 10) / 10} km` : `${Math.round(km * 1000)} m`;
}

export function askText(a: Ask): string {
  switch (a.kind) {
    case "radar": return `Are you within ${fmtKm(a.r)} of me?`;
    case "compass": return a.axis === "ns" ? "Are you north or south of me?" : "Are you east or west of me?";
    case "thermo": return "Am I hotter or colder than at my last call?";
    case "match": return `Is your nearest ${a.cat === "peak" ? "peak" : "signpost"} the same as mine?`;
    case "measure": return a.what === "water" ? "Are you closer to water than me?" : "Are you closer to a road than me?";
  }
}

export function answerText(g: Grid, c: Clue): string {
  switch (c.kind) {
    case "radar": return c.yes ? `Yes, within ${fmtKm(c.r)}` : `No, farther than ${fmtKm(c.r)}`;
    case "compass": return c.axis === "ns" ? (c.plus ? "North of you" : "South of you") : (c.plus ? "East of you" : "West of you");
    case "thermo": return c.hotter ? "Hotter" : "Colder";
    case "match": { const f = g.features[c.cat][c.idx]; return c.same ? `Yes, also ${f?.name ?? "yours"}` : `No, not ${f?.name ?? "yours"}`; }
    case "measure": return c.closer ? "Closer than you" : "Farther than you";
  }
}

export function parseAsk(a: any): Ask | null {
  if (!a || typeof a !== "object") return null;
  if (a.kind === "radar" && typeof a.r === "number" && Number.isFinite(a.r)) return { kind: "radar", r: a.r };
  if (a.kind === "compass" && (a.axis === "ns" || a.axis === "ew")) return { kind: "compass", axis: a.axis };
  if (a.kind === "thermo") return { kind: "thermo" };
  if (a.kind === "match" && (a.cat === "peak" || a.cat === "sight" || a.cat === "lake")) return { kind: "match", cat: a.cat };
  if (a.kind === "measure" && (a.what === "water" || a.what === "road")) return { kind: "measure", what: a.what };
  return null;
}
