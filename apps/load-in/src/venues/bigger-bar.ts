// The bigger bar: a real stage at the back, passive 15" tops and two subs run off a rolling amp rack, two powered
// wedges, and a breaker panel on the right wall. Each wall outlet sits on a numbered circuit with a 15 or 20 A breaker,
// and the back-bar cooler is always plugged into circuit 3. Put the amp rack on the cooler's circuit and it trips at
// show level, killing the cooler with it: walk to the panel, reset it, move the plug. `judge` runs the patch through
// packages/gear's compile, trips what is over, and says what is fed. Plain data, no DOM.
import { assist } from "../assists.ts";
import { doors, showScore } from "../clock.ts";
import { CIRCUIT_15A, CIRCUIT_20A, type Cable, type Compiled, type Outlet, type Placed, cableLoss, compile, gear as catalog } from "@rustybuns/gear";
import { REACH, type Answer, type Level, type World } from "../sim.ts";
import type { Fed } from "../audio/hear.ts";
import { type Cables, plugged } from "../cables/cables.ts";

export const BIGGER_BAR: Level = {
  name: "bigger-bar",
  bounds: { x0: -3.75, x1: 3.75, z0: 0.25, z1: 20.55 },
  room: { x0: -4, x1: 4, z0: 0, z1: 14, height: 3.2, door: 2.4 },
  outlets: [
    { key: "stage-1", x: -0.9, y: 0.3, z: 0.01, circuit: "1", amps: 20 },
    { key: "stage-2", x: 0.9, y: 0.3, z: 0.01, circuit: "2", amps: 20 },
    { key: "bar-1", x: -3.5, y: 0.3, z: 0.01, circuit: "3", amps: 15 },
    { key: "side-1", x: 3.5, y: 0.3, z: 0.01, circuit: "4", amps: 15 },
  ],
  start: { x: 0, z: 14.8, yaw: 0 },
  truck: { x0: -1.2, x1: 1.2, z0: 15.8, z1: 20.8, h: 2.4 },
  items: [
    { key: "cooler", gear: "bar-cooler", x: -3.4, y: 0, z: 0.5, rot: 0 },
    { key: "top-l", gear: "top-15-passive", x: -1.8, y: 0, z: 13.0, rot: 0 },
    { key: "top-r", gear: "top-15-passive", x: -1.2, y: 0, z: 13.0, rot: 0 },
    { key: "sub-l", gear: "sub-18", x: -0.4, y: 0, z: 13.0, rot: 0 },
    { key: "sub-r", gear: "sub-18", x: 0.4, y: 0, z: 13.0, rot: 0 },
    { key: "wedge-1", gear: "wedge-12", x: 1.2, y: 0, z: 13.0, rot: 0 },
    { key: "wedge-2", gear: "wedge-12", x: 2.0, y: 0, z: 13.0, rot: 0 },
    { key: "rack", gear: "amp-rack-4u", x: -1.2, y: 0, z: 12.0, rot: 0 },
    { key: "mixer", gear: "mixer-small", x: 1.6, y: 0.5, z: 12.0, rot: 0 },
    { key: "distro", gear: "distro-box", x: 0.4, y: 0, z: 12.0, rot: 0 },
    { key: "case-1", gear: "road-case-m", x: 1.6, y: 0, z: 12.0, rot: 0 },
  ],
};

/** The cooler's own plug, in before you arrive and never yours to pull. */
export const HOUSE_CABLES: readonly Cable[] = [{ kind: "power", lengthM: 2, from: ["bar-1", "power-out-1"], to: ["cooler", "power-in"] }];

/** The breaker panel on the right wall, by the stage. */
export const PANEL = { x: 3.95, y: 1.4, z: 4 };

/** Which breakers are tripped, by circuit name. */
export type Panel = { tripped: Set<string> };
export const newPanel = (): Panel => ({ tripped: new Set() });

/** Speaker cable is 16 AWG unless it says otherwise. */
export const SPEAKER_AWG = 16;

export type Judged = Compiled & {
  /** Each circuit, its breaker, whether it has tripped, and whether it is over (on Cozy it warns instead of tripping). */
  circuits: { circuit: string; amps: number; tripped: boolean; over: boolean }[];
  /** Breakers that tripped on this check. */
  justTripped: string[];
  /** dB each passive speaker loses in its speaker cable. */
  lossDb: Record<string, number>;
};

/** The outlets as compile reads them, with tripped circuits dead. */
export function outlets(level: Level, panel: Panel): Outlet[] {
  return level.outlets.map((o) => {
    const circuit = o.circuit ?? level.name;
    return { id: o.key, circuit, breaker: o.amps === 20 ? CIRCUIT_20A : CIRCUIT_15A, off: panel.tripped.has(circuit) };
  });
}

/**
 * Run the patch at show level: a circuit over its breaker trips (and stays tripped until reset at the panel), which takes
 * everything on it off, the cooler included. Then what is fed, every problem left, and each passive speaker's cable loss.
 */
export function judge(w: World, placed: readonly Placed[], cables: readonly Cable[], panel: Panel): Judged {
  const all = [...HOUSE_CABLES, ...cables];
  const justTripped: string[] = [];
  let r = compile(placed, all, { outlets: outlets(w.level, panel) });
  for (let i = 0; i < 4; i++) {
    const over = r.problems.filter((p) => p.kind === "breaker" && p.circuit && !panel.tripped.has(p.circuit)).map((p) => p.circuit!);
    // The breakersTrip assist: off (Cozy), an overloaded circuit only warns and keeps playing.
    if (over.length === 0 || !assist("breakersTrip")) break;
    for (const c of over) panel.tripped.add(c), justTripped.push(c);
    r = compile(placed, all, { outlets: outlets(w.level, panel) });
  }
  const ohms = new Map(placed.map((p) => [p.id, catalog(p.gear).speaker?.ohms ?? null]));
  const lossDb: Record<string, number> = {};
  for (const c of all) {
    if (c.kind !== "speaker") continue;
    for (const [id, jack] of [c.from, c.to]) {
      const o = ohms.get(id);
      if (jack === "speaker-in" && o) lossDb[id] = Math.round(cableLoss(SPEAKER_AWG, c.lengthM, o) * 100) / 100;
    }
  }
  const seen = new Map<string, number>();
  for (const o of outlets(w.level, panel)) seen.set(o.circuit, o.breaker.amps);
  const over = new Set(r.problems.filter((p) => p.kind === "breaker" && p.circuit).map((p) => p.circuit!));
  const circuits = [...seen].map(([circuit, amps]) => ({ circuit, amps, tripped: panel.tripped.has(circuit), over: over.has(circuit) }));
  return { ...r, circuits, justTripped, lossDb };
}

/** The judge on the cables you have laid. */
export function judgeCables(w: World, c: Cables, panel: Panel): Judged {
  const { placed, runs } = plugged(w, c);
  return judge(w, placed, runs, panel);
}

/** Who plays in the bigger bar: only what the cables feed (power, a signal, an amp that holds, nothing tripped). */
export const fedByJudge = (j: Judged): Fed => (_w, key) => j.fed.get(key) === true;

/** Whether you stand at the panel, close enough to reach the breakers. */
export function atPanel(w: World): boolean {
  return Math.hypot(w.you.x - PANEL.x, w.you.z - PANEL.z) <= REACH;
}

/** Reset a tripped breaker (or every tripped one): only at the panel. If the load is still there, the next check trips it again. */
export function resetBreaker(w: World, panel: Panel, circuit?: string): Answer {
  if (!atPanel(w)) return { ok: false, why: "the breaker panel is out of reach" };
  if (panel.tripped.size === 0) return { ok: false, why: "no breaker has tripped" };
  if (circuit && !panel.tripped.has(circuit)) return { ok: false, why: `circuit ${circuit} hasn't tripped` };
  if (circuit) panel.tripped.delete(circuit);
  else panel.tripped.clear();
  return { ok: true };
}

/** The show passes at this score, as at the dive bar and the park. */
export const PASS = 85;

/**
 * Doors at the bigger bar: the sound is the share of speakers the cables feed, less 30 if the bar's cooler is off
 * (a tripped circuit 3 left the staff with warm drinks), scaled by the crowd's mood from the clock.
 */
export function show(w: World, j: Judged) {
  const speakers = [...j.fed.values()], fed = speakers.filter(Boolean).length;
  const coolerOff = j.circuits.some((c) => c.circuit === "3" && c.tripped);
  const sound = Math.max(0, Math.round((100 * fed) / Math.max(1, speakers.length)) - (coolerOff ? 30 : 0));
  const d = doors(w.level.name, w.t), total = showScore(sound, d.mood);
  return { sound, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS, coolerOff };
}
