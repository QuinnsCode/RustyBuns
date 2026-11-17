// A patch: gear placed on the floor, the cables between their jacks, and the wall outlets.
// `compile` says which speakers are fed (power where they need it, and signal from a source)
// and lists every problem a roadie would get yelled at for, each naming the items and the jack.

import { gear as catalog, jackNames, type Gear } from "./catalog.ts";
import { ampWatts, circuitLoad, generatorLoad, parallel, type Circuit } from "./power.ts";

/** One box on the floor: its own id (two tops are two items) and the catalog gear it is. `lift`: a DI's ground lift is pressed. */
export type Placed = { id: string; gear: string; lift?: boolean };

/** What a cable is: mains, speaker, mic (XLR), a quarter-inch instrument/line lead, a DJ deck's RCA pair, a turntable's
 * ground wire, or a deck's digital (coax) lead. */
export type CableKind = "power" | "speaker" | "xlr" | "instrument" | "rca" | "ground" | "digital";

/** An end of a cable: [item or outlet id, jack name]. */
export type End = readonly [string, string];

/** A cable run between two jacks. Either end may be the output; `compile` turns it round. */
export type Cable = { kind: CableKind; lengthM: number; from: End; to: End };

/** A wall outlet on a named circuit; outlets that share a circuit share its breaker. `off` when its breaker has tripped. */
export type Outlet = { id: string; circuit: string; breaker: Circuit; jacks?: number; off?: boolean };

export type ProblemKind = "no-jack" | "wrong-cable" | "jack-twice" | "direction" | "low-load" | "breaker" | "loop" | "no-power" | "hum" | "level";

/** `circuit` is set on a breaker problem: the outlet circuit's name, or the generator's id. */
export type Problem = { kind: ProblemKind; items: string[]; jack?: string; circuit?: string; message: string };

export type Compiled = { fed: Map<string, boolean>; problems: Problem[] };

/** The kind of jack a name is: `power-out-3` is `power-out`. */
export function jackKind(name: string): string {
  return name.replace(/-\d+$/, "");
}

/** Which cable fits a jack. */
export function cableFor(kind: string): CableKind {
  if (kind.startsWith("power")) return "power";
  if (kind.startsWith("speaker")) return "speaker";
  if (kind.startsWith("xlr")) return "xlr";
  if (kind.startsWith("rca") || kind.startsWith("phono")) return "rca";
  if (kind.startsWith("ground")) return "ground";
  if (kind.startsWith("digital")) return "digital";
  return "instrument";
}

const isOut = (kind: string) => kind.endsWith("-out");

/** Gear that makes a signal of its own when it has power. */
const SOURCES = new Set(["mixer-small", "guitar", "amp-head", "deck-media", "turntable"]);

const DJ_INS = ["phono-in", "rca-in"].flatMap((k) => [1, 2, 3, 4].map((n) => `${k}-${n}`));
/** Gear that passes a signal through: each output jack and the inputs it carries (any one of them with sound will do). */
const THROUGH: Record<string, Record<string, readonly string[]>> = {
  "di-box": { "xlr-out": ["inst-in"], "line-out": ["inst-in"] },
  "mixer-dj": Object.fromEntries([1, 2, 3, 4].map((n) => [`xlr-out-${n}`, DJ_INS])),
};

type Link = { cable: Cable; out: End; in: End };

/** Walk a patch: who is fed, and what is wrong with it. */
export function compile(placed: readonly Placed[], cables: readonly Cable[], opts: { outlets?: readonly Outlet[] } = {}): Compiled {
  const outlets = new Map((opts.outlets ?? []).map((o) => [o.id, o]));
  const items = new Map<string, Gear>();
  for (const p of placed) items.set(p.id, catalog(p.gear));
  const problems: Problem[] = [];
  const say = (kind: ProblemKind, ids: string[], message: string, jack?: string) => problems.push({ kind, items: ids, jack, message });

  const jacksOf = (id: string): string[] | undefined => {
    const g = items.get(id);
    if (g) return jackNames(g);
    const o = outlets.get(id);
    return o && Array.from({ length: o.jacks ?? 2 }, (_, i) => `power-out-${i + 1}`);
  };

  // Check every cable end, then turn each cable so it runs out -> in.
  const links: Link[] = [];
  const used = new Map<string, number>();
  for (const cable of cables) {
    let ok = true;
    for (const [id, jack] of [cable.from, cable.to]) {
      const jacks = jacksOf(id);
      if (!jacks?.includes(jack)) {
        say("no-jack", [id], jacks ? `${id} has no ${jack} jack` : `nothing called ${id} is placed`, jack);
        ok = false;
        continue;
      }
      const key = `${id}\0${jack}`;
      used.set(key, (used.get(key) ?? 0) + 1);
      if (used.get(key) === 2) say("jack-twice", [id], `${id} ${jack} has two cables in it`, jack);
      const want = cableFor(jackKind(jack));
      if (want !== cable.kind) {
        say("wrong-cable", [id], `a ${cable.kind} cable is in ${id} ${jack}, which takes a ${want} cable`, jack);
        ok = false;
      }
    }
    if (!ok) continue;
    const a = isOut(jackKind(cable.from[1]));
    const b = isOut(jackKind(cable.to[1]));
    if (a === b) {
      say("direction", [cable.from[0], cable.to[0]], `${cable.from[0]} ${cable.from[1]} and ${cable.to[0]} ${cable.to[1]} are both ${a ? "outputs" : "inputs"}`, cable.to[1]);
      continue;
    }
    links.push(a ? { cable, out: cable.from, in: cable.to } : { cable, out: cable.to, in: cable.from });
  }

  // What plugs into each input jack, and what each output jack drives.
  const into = new Map<string, End>();
  const drives = new Map<string, End[]>();
  for (const l of links) {
    into.set(`${l.in[0]}\0${l.in[1]}`, l.out);
    const k = `${l.out[0]}\0${l.out[1]}`;
    drives.set(k, [...(drives.get(k) ?? []), l.in]);
  }
  const from = (id: string, jack: string) => into.get(`${id}\0${jack}`);

  // Loops: a cycle through cables of one domain (mains, or signal and speaker).
  for (const domain of ["power", "signal"] as const) {
    const next = new Map<string, Set<string>>();
    for (const l of links) {
      if (l.cable.kind === "ground" || (l.cable.kind === "power") !== (domain === "power")) continue;
      next.set(l.out[0], (next.get(l.out[0]) ?? new Set()).add(l.in[0]));
    }
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string) => {
      state.set(id, 1);
      stack.push(id);
      for (const n of next.get(id) ?? []) {
        if (state.get(n) === 1) {
          const loop = stack.slice(stack.indexOf(n));
          say("loop", loop, `${[...loop, n].join(" -> ")} is a ${domain === "power" ? "power" : "feedback"} loop`);
        } else if (!state.has(n)) visit(n);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of next.keys()) if (!state.has(id)) visit(id);
  }

  // Mains: where an item's power comes from, an outlet or a generator (through any distros).
  const roots = new Map<string, string | null>();
  const rootOf = (id: string, seen = new Set<string>()): string | null => {
    if (outlets.has(id)) return outlets.get(id)?.off ? null : id;
    if (items.get(id)?.generator) return id;
    if (roots.has(id)) return roots.get(id) ?? null;
    if (seen.has(id)) return null;
    seen.add(id);
    const up = from(id, "power-in");
    const root = up ? rootOf(up[0], seen) : null;
    roots.set(id, root);
    return root;
  };
  const powered = (id: string) => !items.get(id)?.draw || rootOf(id) !== null;

  for (const [id, g] of items) if (g.draw && !powered(id)) say("no-power", [id], `${id} has no power`, "power-in");

  // Ground loops: a DI whose thru and XLR both land on gear earthed through the mains hums, unless it is lifted.
  const earthed = (end: End) => items.get(end[0])?.draw !== undefined && rootOf(end[0]) !== null;
  for (const p of placed) {
    if (p.gear !== "di-box" || p.lift) continue;
    const amp = drives.get(`${p.id}\0line-out`)?.find(earthed);
    const desk = drives.get(`${p.id}\0xlr-out`)?.find(earthed);
    if (amp && desk) say("hum", [p.id, amp[0], desk[0]], `${amp[0]} and ${desk[0]} make a ground loop through ${p.id}: it hums. Lift its ground`, "xlr-out");
  }

  // DJ decks into a mixer: a turntable's millivolts want a phono input (a line input barely hears it) and its ground wire
  // on that mixer's post, or the channel hums; a media player's line level into a phono input overloads it.
  for (const l of links) {
    const deck = items.get(l.out[0])?.deck, kind = jackKind(l.in[1]);
    if (!deck || l.cable.kind !== "rca" || (kind !== "phono-in" && kind !== "rca-in")) continue;
    const id = l.out[0], mixer = l.in[0];
    if (deck.out === "line" && kind === "phono-in") say("level", [id, mixer], `${id} is line level into ${mixer} ${l.in[1]}: the phono stage overloads and it distorts. Use a line input`, l.in[1]);
    if (deck.out === "phono" && kind === "rca-in") say("level", [id, mixer], `${id} is phono level into ${mixer} ${l.in[1]}: a line input barely hears it. Use a phono input`, l.in[1]);
    const grounded = links.some((g) => g.cable.kind === "ground" && g.out[0] === id && g.in[0] === mixer);
    if (deck.out === "phono" && !grounded) say("hum", [id, mixer], `${id} has no ground wire on ${mixer}'s post: it hums at the mains frequency (50/60 Hz)`, "ground-out");
  }

  // Each breaker and generator against what hangs off it.
  const loads = new Map<string, string[]>();
  for (const [id, g] of items) {
    const root = g.draw ? rootOf(id) : null;
    if (!root) continue;
    const key = outlets.get(root)?.circuit ?? root;
    loads.set(key, [...(loads.get(key) ?? []), id]);
  }
  for (const [key, on] of loads) {
    const outlet = [...outlets.values()].find((o) => o.circuit === key);
    const gen = items.get(key);
    const gearOn = on.flatMap((id) => items.get(id) ?? []);
    const f = outlet ? circuitLoad(gearOn, outlet.breaker) : gen ? generatorLoad(gen, gearOn) : null;
    if (f?.trips) {
      say("breaker", on, `${on.join(", ")}: ${Math.round(f.watts)} W on ${outlet ? `circuit ${key}` : key}, rated ${Math.round(f.limit)} W: it trips`);
      problems[problems.length - 1]!.circuit = key;
    }
  }

  // Signal: does an output jack carry sound?
  const memo = new Map<string, boolean>();
  const outSignal = (id: string, jack: string, seen: Set<string>): boolean => {
    const key = `${id}\0${jack}`;
    if (memo.has(key)) return memo.get(key)!;
    if (seen.has(key)) return false;
    seen.add(key);
    const g = items.get(id);
    let on = false;
    if (g && powered(id)) {
      const kind = jackKind(jack);
      const via = THROUGH[g.id]?.[jack];
      if (SOURCES.has(g.id)) on = true;
      else if (via) on = via.some((j) => inSignal(id, j, seen));
      else if (g.amp) on = inSignal(id, jack.replace("speaker-out", "xlr-in"), seen);
      else if (kind === "xlr-out") on = inSignal(id, "xlr-in", seen);
      else if (kind === "speaker-out") on = inSignal(id, "speaker-in", seen);
    }
    memo.set(key, on);
    return on;
  };
  const inSignal = (id: string, jack: string, seen: Set<string>): boolean => {
    const up = from(id, jack);
    return up !== undefined && outSignal(up[0], up[1], seen);
  };

  // Amp channels: every passive box on a channel's speaker chain, in parallel.
  const ampOf = new Map<string, string>();
  for (const [id, g] of items) {
    if (!g.amp) continue;
    const channels = new Map<string, string[]>();
    for (const jack of jackNames(g).filter((j) => jackKind(j) === "speaker-out")) {
      const ch = g.amp.channels === 1 ? "1" : (jack.match(/\d+$/)?.[0] ?? "1");
      const boxes = channels.get(ch) ?? [];
      const walk = (end: End) => {
        for (const [box, j] of drives.get(`${end[0]}\0${end[1]}`) ?? []) {
          if (j !== "speaker-in" || boxes.includes(box)) continue;
          boxes.push(box);
          walk([box, "speaker-out"]);
        }
      };
      walk([id, jack]);
      channels.set(ch, boxes);
    }
    for (const [ch, boxes] of channels) {
      const ohms = boxes.map((b) => items.get(b)?.speaker?.ohms).filter((o): o is number => typeof o === "number");
      if (ohms.length === 0) continue;
      const { problem } = ampWatts(g.amp, parallel(...ohms));
      if (problem) say("low-load", [id, ...boxes], `${id} channel ${ch}: ${problem}`, g.amp.channels === 1 ? "speaker-out" : `speaker-out-${ch}`);
      else for (const b of boxes) ampOf.set(b, id);
    }
  }

  const fed = new Map<string, boolean>();
  for (const [id, g] of items) {
    if (!g.speaker) continue;
    if (g.speaker.ohms === null) fed.set(id, powered(id) && inSignal(id, "xlr-in", new Set()));
    else fed.set(id, ampOf.has(id) && inSignal(id, "speaker-in", new Set()));
  }
  return { fed, problems };
}
