// A sound system's plan, from where its stacks stand and how they are aimed: the sources that makes (the one list the
// coverage map, a room's PA and Sound Guy Simulator's rigs all read, so what you see on the map is what you hear), how
// even the floor is, what the amps, breakers and generator make of it with the reason when one gives out, and the gear
// list a crew loads the truck from. Pure: no DOM.
import { gear } from "./catalog.ts";
import { circuitLoad, generatorLoad, type Circuit, type Feed } from "./power.ts";
import { source, type Grid, type Source } from "./sound.ts";
import { boxChannels, type System } from "./systems.ts";

/** One stack on the ground: where it stands (x, z), its front turned `yaw` from +z, its tops `splay` further, and a
 *  ground-stacked line array's pins (radians down from level, bottom box up). */
export type StackPlace = { at: readonly [number, number]; yaw: number; splay?: number; pins?: readonly number[] };

/** A ground-stacked line array's pins as a crew first sets them, bottom box up: the lowest aimed at the front of the floor. */
export const LINE_PINS: readonly number[] = [0.14, 0.07, 0.02];
/** The most a pin tips a box down, radians (the stacking frame's last hole). */
export const MAX_PIN = 0.3;

/** A box that carries the mids and highs (its sheet reaches past 200 Hz), not a bass bin or a sub. */
export const isTop = (id: string): boolean => (gear(id).speaker?.highCut ?? 0) > 200;
const isLine = (id: string) => id.startsWith("line-array");

/**
 * The stack's boxes that play over the floor, each a source where it stands in the column (its middle's height from
 * the boxes under it) and aimed as the stack is: its yaw, the tops' splay, a line array box tipped down by its pin.
 */
export function stackSources(sys: System, st: StackPlace): Source[] {
  const out: Source[] = [];
  let y = 0, k = 0;
  for (const id of sys.stack) {
    const h = gear(id).size.h;
    if (isLine(id)) {
      const pins = st.pins ?? LINE_PINS, aim = pins[Math.min(k++, pins.length - 1)] ?? 0;
      out.push(source(id, { x: st.at[0], y: y + (h / 2) * Math.cos(aim), z: st.at[1] }, { yaw: st.yaw, pitch: -aim }));
      y += h * Math.cos(aim);
      continue;
    }
    if (gear(id).speaker && isTop(id)) out.push(source(id, { x: st.at[0], y: y + h / 2, z: st.at[1] }, { yaw: st.yaw + (st.splay ?? 0) }));
    y += h;
  }
  return out;
}

/** A point `d` metres behind the stacks' middle and `side` metres to the crowd's left of it, where the amp racks stand. */
export function behindStacks(stacks: readonly StackPlace[], d: number, side = 0): [number, number] {
  const yaw = stacks[0]?.yaw ?? 0, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const n = Math.max(1, stacks.length), mx = stacks.reduce((t, s) => t + s.at[0], 0) / n, mz = stacks.reduce((t, s) => t + s.at[1], 0) / n;
  return [mx - fx * d + rx * side, mz - fz * d + rz * side];
}

/** How a floor sounds: its mean, quietest and loudest cells, dB, and how even it is (dB between its 10th and 90th percentile). */
export type FloorStats = { mean: number; min: number; max: number; even: number; cells: number };

/** The coverage map's cells that `keep` says are floor (all of them when left out), as one line of numbers. */
export function floorStats(grid: Grid, keep: (x: number, z: number) => boolean = () => true): FloorStats {
  const { x0, z0, x1, z1, nx, nz } = grid, dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, vals: number[] = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) if (keep(x0 + (ix + 0.5) * dx, z0 + (iz + 0.5) * dz)) vals.push(grid.db[iz * nx + ix]!);
  if (!vals.length) return { mean: 0, min: 0, max: 0, even: 0, cells: 0 };
  vals.sort((a, b) => a - b);
  const at = (q: number) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))]!;
  // the mean as a level: power averaged, then back to dB
  const mean = 10 * Math.log10(vals.reduce((t, v) => t + 10 ** (v / 10), 0) / vals.length);
  return { mean, min: vals[0]!, max: vals[vals.length - 1]!, even: at(0.9) - at(0.1), cells: vals.length };
}

// ---- power ----

export const GENERATOR_IDS = ["generator-7kva", "generator-100kva"] as const;
export type GeneratorId = (typeof GENERATOR_IDS)[number];
/** The amp rack a rig's passive boxes run off: twelve channels in each. */
export const RACK = "amp-rack-12u";
/** What one outlet carries on each generator: the small set's 30 A twist-lock at 240 V, the trailer's distro a 30 A 208 V feed. */
export const OUTLETS: Record<GeneratorId, Circuit> = { "generator-7kva": { volts: 240, amps: 30 }, "generator-100kva": { volts: 208, amps: 30 } };

/** A whole rig on the ground: the system, its stacks, the sub block, the booth monitors (a mid-high horn on a stand each),
 *  the generator (where it stands, and which set: the smallest that holds when left out) and the desk the signal comes from. */
export type RigPlan = {
  system: System;
  stacks: readonly StackPlace[];
  subs?: { at: readonly [number, number]; wide: number; high: number };
  monitors?: readonly { at: readonly [number, number] }[];
  generator?: { at?: readonly [number, number]; set?: GeneratorId };
  desk?: readonly [number, number];
};
const MONITOR = "stack-mid-high", STAND = "stand-tripod";

/** One mains circuit off the distro: what's on it and how it holds. */
export type PowerCircuit = { name: string; items: string[]; feed: Feed };
/** How the rig is fed: its amp channels and racks, the generator and whether it was picked for you, every circuit, and
 *  `why` it fails (empty when it holds) and `warn` where a feed runs past 80%. */
export type PowerPlan = { channels: number; racks: number; generator: GeneratorId; auto: boolean; feed: Feed; circuits: PowerCircuit[]; ok: boolean; why: string[]; warn: string[] };

/** Every box in the rig, one entry each: the stacks bottom to top, the sub block, the monitors on their stands. */
export function rigBoxes(rig: RigPlan): string[] {
  const out: string[] = [];
  for (let i = 0; i < rig.stacks.length; i++) out.push(...rig.system.stack);
  if (rig.subs) for (let i = 0; i < rig.subs.wide * rig.subs.high; i++) out.push(rig.system.sub);
  for (let i = 0; i < (rig.monitors?.length ?? 0); i++) out.push(MONITOR, STAND);
  return out;
}

const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`;
const genName = (g: GeneratorId) => g === "generator-7kva" ? "7 kVA generator" : "100 kVA generator";

/** The rig's power: amp racks for its passive boxes, a circuit per rack and per stack of powered boxes, and the generator. */
export function powerPlan(rig: RigPlan): PowerPlan {
  const boxes = rigBoxes(rig), channels = boxes.reduce((n, b) => n + (b === STAND ? 0 : boxChannels(b)), 0);
  const racks = channels ? Math.ceil(channels / 12) : 0;
  const powered = (ids: readonly string[]) => ids.filter((b) => gear(b).draw && !(gear(b).jacks["speaker-in"] ?? 0));
  const loads: { name: string; items: string[] }[] = [];
  for (let i = 0; i < racks; i++) loads.push({ name: `amp rack ${i + 1}`, items: [RACK] });
  rig.stacks.forEach((_, i) => { const p = powered(rig.system.stack); if (p.length) loads.push({ name: `stack ${i + 1}`, items: p }); });
  if (rig.subs) { const p = powered(Array.from({ length: rig.subs.wide * rig.subs.high }, () => rig.system.sub)); if (p.length) loads.push({ name: "sub block", items: p }); }
  const all = loads.flatMap((l) => l.items);
  const fits = (g: GeneratorId) => !generatorLoad(g, all).trips && loads.every((l) => !circuitLoad(l.items, OUTLETS[g]).trips);
  const auto = !rig.generator?.set, set: GeneratorId = rig.generator?.set ?? (fits("generator-7kva") ? "generator-7kva" : "generator-100kva");
  const feed = generatorLoad(set, all), outlet = OUTLETS[set];
  const circuits = loads.map((l) => ({ ...l, feed: circuitLoad(l.items, outlet) }));
  const why: string[] = [], warn: string[] = [];
  if (feed.trips) why.push(`The ${genName(set)} gives ${kw(feed.limit)} and the rig draws ${kw(feed.watts)} at show level: it stalls on the first drop. Bring the ${set === "generator-7kva" ? "100 kVA set" : "second set"} or fewer boxes.`);
  else if (feed.warn) warn.push(`The ${genName(set)} runs at ${Math.round((feed.watts / feed.limit) * 100)}% at show level: past the 80% a set runs all night at.`);
  for (const c of circuits) {
    if (c.feed.trips) why.push(`${c.name[0]!.toUpperCase()}${c.name.slice(1)} draws ${kw(c.feed.watts)} on a ${outlet.amps} A ${outlet.volts} V outlet that carries ${kw(c.feed.limit)}: its breaker trips.`);
    else if (c.feed.warn) warn.push(`${c.name[0]!.toUpperCase()}${c.name.slice(1)} runs its breaker at ${Math.round((c.feed.watts / c.feed.limit) * 100)}%.`);
  }
  return { channels, racks, generator: set, auto, feed, circuits, ok: !why.length, why, warn };
}

// ---- the gear list ----

/** What a crew loads: each box by id and how many, and each cable run, from where to where and its length off the reel. */
export type GearRow = { id: string; what: string; n: number };
export type CableRow = { kind: "speaker" | "power" | "signal"; from: string; to: string; m: number };
export type GearList = { boxes: GearRow[]; cables: CableRow[]; power: PowerPlan };

/** The cable lengths on the truck, metres. */
export const CABLE_LENGTHS = [5, 10, 15, 20, 25, 30, 50, 75, 100] as const;
/** The cable a run of `d` metres takes: the shortest on the truck with a fifth spare to lie loose on the ground. */
export const reelFor = (d: number): number => CABLE_LENGTHS.find((l) => l >= d * 1.2 + 1) ?? CABLE_LENGTHS[CABLE_LENGTHS.length - 1];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** The whole take-away: every box, amp rack, the generator and distro, and every cable run, with the power plan. */
export function gearList(rig: RigPlan): GearList {
  const power = powerPlan(rig), counts = new Map<string, number>();
  const add = (id: string, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);
  for (const b of rigBoxes(rig)) add(b);
  if (power.racks) add(RACK, power.racks);
  add(power.generator); add("distro-box");
  const boxes = [...counts].map(([id, n]) => ({ id, what: gear(id).what, n }));
  const cables: CableRow[] = [], rack = behindStacks(rig.stacks, 1.7, -0.6), distro = behindStacks(rig.stacks, 1.7, 0.9);
  const passive = rig.system.stack.some((b) => boxChannels(b) > 0), poweredStack = rig.system.stack.some((b) => gear(b).draw && !(gear(b).jacks["speaker-in"] ?? 0));
  if (rig.generator?.at) cables.push({ kind: "power", from: genName(power.generator), to: "distro", m: reelFor(dist(rig.generator.at, distro)) });
  for (let i = 0; i < power.racks; i++) cables.push({ kind: "power", from: "distro", to: `amp rack ${i + 1}`, m: reelFor(dist(distro, rack) + i * 0.66) });
  rig.stacks.forEach((st, i) => {
    if (passive) cables.push({ kind: "speaker", from: "amp racks", to: `stack ${i + 1}`, m: reelFor(dist(rack, st.at)) });
    if (poweredStack) {
      cables.push({ kind: "power", from: "distro", to: `stack ${i + 1}`, m: reelFor(dist(distro, st.at)) });
      cables.push({ kind: "signal", from: "processor", to: `stack ${i + 1}`, m: reelFor(dist(rack, st.at)) });
    }
  });
  if (rig.subs) for (let c = 0; c < rig.subs.wide; c++) cables.push({ kind: "speaker", from: "amp racks", to: `sub column ${c + 1}`, m: reelFor(dist(rack, rig.subs.at)) });
  rig.monitors?.forEach((m, i) => cables.push({ kind: "speaker", from: "amp racks", to: `booth monitor ${i + 1}`, m: reelFor(dist(rack, m.at)) }));
  if (rig.desk) cables.push({ kind: "signal", from: "desk", to: "processor", m: reelFor(dist(rig.desk, rack)) });
  return { boxes, cables, power };
}

/** The gear list as a plain text sheet: boxes, cables totalled by kind and length, then the power plan. */
export function gearListText(list: GearList, title = "Sound system"): string {
  const p = list.power, lines = [`${title}: gear list`, "", "Boxes"];
  for (const b of list.boxes) lines.push(`  ${String(b.n).padStart(3)} x ${b.id}  (${b.what})`);
  lines.push("", "Cables");
  const reels = new Map<string, number>();
  for (const c of list.cables) reels.set(`${c.kind} ${c.m} m`, (reels.get(`${c.kind} ${c.m} m`) ?? 0) + 1);
  for (const [k, n] of [...reels].sort()) lines.push(`  ${String(n).padStart(3)} x ${k}`);
  lines.push("", "Runs");
  for (const c of list.cables) lines.push(`  ${c.kind.padEnd(7)} ${c.from} -> ${c.to}, ${c.m} m`);
  lines.push("", "Power", `  ${p.channels} amp channels on ${p.racks} rack${p.racks === 1 ? "" : "s"}`, `  ${genName(p.generator)}${p.auto ? " (the smallest that holds)" : ""}: ${kw(p.feed.watts)} of ${kw(p.feed.limit)} at show level`);
  for (const c of p.circuits) lines.push(`  ${c.name}: ${kw(c.feed.watts)} of ${kw(c.feed.limit)}${c.feed.trips ? "  TRIPS" : c.feed.warn ? "  over 80%" : ""}`);
  lines.push(`  ${p.ok ? "Holds." : "Fails:"}`, ...p.why.map((w) => `  - ${w}`), ...p.warn.map((w) => `  ! ${w}`));
  return lines.join("\n") + "\n";
}
