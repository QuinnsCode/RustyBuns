// Gear on cables: each piece of gear has jacks, a patch is the gear in the room and
// the cables between their jacks, and `compile` walks each source along the cables
// to each output. It hands back the chains the audio thread runs and the problems on
// the way (an empty input, an instrument cable used as a speaker cable, a loop, a
// tube amp with no speaker on it). Plain TS, no DOM: Q Amp's patch view and its
// lessons read the same answer.
//
// The walk goes jack to jack: a cable runs an out jack to an in jack, and inside a
// piece of gear its routes run an in jack to the out jacks it feeds. That is how the
// amp's effects loop is no loop: its input feeds its send, its return feeds the
// speaker, and with nothing in either the input goes straight through (a real
// amp's return jack is switched the same way).
//
// A patch here is the shape the sesh keeps: items with an id and a gear, cables
// between [item, jack] ends. Names follow @rustybuns/gear's patch (cable kinds,
// `wrong-cable`, `loop`) so the two can merge.
import { PEDALS } from "./amps.ts";

/** What a cable is: a quarter-inch instrument lead, a speaker cable, a mic (XLR) cable, or mains. */
export type CableKind = "instrument" | "speaker" | "xlr" | "power";

export interface Jack {
  id: string;
  kind: CableKind;
  dir: "in" | "out";
  /** What it says on the panel ("Send", "A"), when it isn't just In or Out. */
  label?: string;
  /** An input that can stay empty while another input feeds the same output (a blend box's sides). */
  optional?: boolean;
}

/** Inside a piece of gear: input `from` feeds output `to`, while every jack in `unless` is empty. */
export interface Route { from: string; to: string; unless?: string[] }

export interface Gear {
  id: string;
  name: string;
  /** A source makes the signal; an output (no out jacks) is where a chain ends; a box only routes it. */
  kind: "source" | "pedals" | "amp" | "cab" | "box";
  jacks: Jack[];
  /** Which inputs feed which outputs; left out, every input feeds every output. */
  routes?: Route[];
  knobs: string[];
  /** How it makes its sound: a solved circuit, plain DSP, or nothing of its own (a cable, a guitar's riff). */
  sound: "circuit" | "dsp" | "none";
  /** A tube amp: on with no speaker on its output, the output transformer burns. */
  tubes?: boolean;
}

const an = (kind: CableKind, cap = false) => `${/^[aeiox]/.test(kind) ? "an" : "a"} ${kind}`.replace(/^a/, cap ? "A" : "a");
const inst = (id: string, dir: Jack["dir"], more: Partial<Jack> = {}): Jack => ({ id, kind: "instrument", dir, ...more });
const stomp = (id: string, name: string, sound: Gear["sound"] = "circuit"): Gear => ({ id, name, kind: "pedals", jacks: [inst("in", "in"), inst("out", "out")], knobs: [], sound });

/** The effects loop's machines, as their own gear: between the amp's send and return is where they're made for. */
export const MACHINE_GEAR = [stomp("bbd", "Q Bucket"), stomp("tape", "Q Tape"), stomp("spring", "Q Spring")];
/** Every pedal on the board (and the bench, the board you drew) as its own box with an in and an out. */
export const PEDAL_GEAR = [...PEDALS.map((p) => stomp(p.id, p.name)), stomp("bench", "Bench")];

/** The gear on Q Amp's stage: the guitar, each pedal and machine, the A/B split and its blend, the amp head and its cabinet. */
const STAGE_GEAR: Gear[] = [
  { id: "guitar", name: "Guitar", kind: "source", jacks: [inst("out", "out")], knobs: [], sound: "none" },
  ...PEDAL_GEAR,
  {
    id: "split", name: "A/B split", kind: "box", sound: "none", knobs: [],
    jacks: [inst("in", "in"), inst("a", "out", { label: "A" }), inst("b", "out", { label: "B" })],
  },
  {
    id: "blend", name: "A/B blend", kind: "box", sound: "none", knobs: [],
    jacks: [inst("a", "in", { label: "A", optional: true }), inst("b", "in", { label: "B", optional: true }), inst("out", "out")],
  },
  {
    id: "head", name: "Amp head", kind: "amp", tubes: true, sound: "circuit",
    jacks: [inst("in", "in"), inst("send", "out", { label: "Send" }), inst("return", "in", { label: "Return", optional: true }), { id: "speaker", kind: "speaker", dir: "out" }],
    // The preamp out to the send, the return into the power tubes; with neither cabled, straight through.
    routes: [{ from: "in", to: "send" }, { from: "return", to: "speaker" }, { from: "in", to: "speaker", unless: ["send", "return"] }],
    knobs: ["gain", "bass", "mid", "treble", "master", "noise"],
  },
  ...MACHINE_GEAR,
  { id: "cab", name: "Cabinet", kind: "cab", jacks: [{ id: "in", kind: "speaker", dir: "in" }], knobs: [], sound: "dsp" },
];
export const GEAR: Record<string, Gear> = Object.fromEntries(STAGE_GEAR.map((g) => [g.id, g]));

/** An end of a cable: [item id, jack id]. */
export type End = readonly [string, string];
/** A cable between two jacks, either way round. Without a kind it is whatever the out jack takes. */
export interface Cable { from: End; to: End; kind?: CableKind }
export interface Patch { placed: readonly { id: string; gear: string }[]; cables: readonly Cable[] }

export type ProblemKind = "empty-input" | "wrong-cable" | "loop" | "no-speaker" | "no-jack" | "direction";
export interface Problem { kind: ProblemKind; items: string[]; jack?: string; message: string }

export interface Compiled {
  /** Item ids from a source to an output, one list per way through (an amp with its loop cabled shows up twice: in, then back from its return). */
  chains: string[][];
  problems: Problem[];
}

const SEP = "\u0000";

/** Walk a patch: every way from a source to an output, and what is wrong with it. */
export function compile(patch: Patch, gear: Record<string, Gear> = GEAR): Compiled {
  const items = new Map<string, Gear>();
  for (const p of patch.placed) { const g = gear[p.gear]; if (g) items.set(p.id, g); }
  const problems: Problem[] = [];
  const say = (kind: ProblemKind, ids: string[], message: string, jack?: string) => problems.push({ kind, items: ids, jack, message });
  const name = (id: string) => items.get(id)?.name ?? id;
  const jackName = (j: Jack) => j.label?.toLowerCase() ?? (j.dir === "in" ? "input" : "output");
  const node = (item: string, jack: string) => `${item}${SEP}${jack}`;
  const itemOf = (n: string) => n.slice(0, n.indexOf(SEP));

  // Each cable, turned round so it runs out to in. `plugged` is every jack with a cable in it.
  const next = new Map<string, string[]>();
  const link = (a: string, b: string) => next.set(a, [...(next.get(a) ?? []), b]);
  const plugged = new Set<string>();
  for (const c of patch.cables) {
    const ends = [c.from, c.to].map(([item, jack]) => ({ item, jack: items.get(item)?.jacks.find((j) => j.id === jack) }));
    const [a, b] = ends;
    if (!a.jack || !b.jack) {
      const bad = ends.find((e) => !e.jack) ?? a;
      say("no-jack", [bad.item], `${name(bad.item)} has no jack like that`);
      continue;
    }
    if (a.jack.dir === b.jack.dir) {
      say("direction", [a.item, b.item], `Two ${a.jack.dir}puts cabled together, ${name(a.item)} and ${name(b.item)}: a cable runs from an output to an input`);
      continue;
    }
    const [out, into] = a.jack.dir === "out" ? [a, b] : [b, a];
    if (!out.jack || !into.jack) continue;
    const kind = c.kind ?? out.jack.kind;
    if (kind !== out.jack.kind || kind !== into.jack.kind) {
      const wrongAt = kind === out.jack.kind ? into : out, wanted = wrongAt.jack?.kind ?? kind;
      say("wrong-cable", [out.item, into.item], `${an(kind, true)} cable runs from ${name(out.item)} to ${name(into.item)}, but the ${name(wrongAt.item)}'s ${wrongAt.jack ? jackName(wrongAt.jack) : "jack"} takes ${an(wanted)} cable`, wrongAt.jack?.id);
    }
    plugged.add(node(out.item, out.jack.id)).add(node(into.item, into.jack.id));
    link(node(out.item, out.jack.id), node(into.item, into.jack.id));
  }

  for (const [id, g] of items) {
    const has = (j: Jack | string) => plugged.has(node(id, typeof j === "string" ? j : j.id));
    const ins = g.jacks.filter((j) => j.dir === "in"), outs = g.jacks.filter((j) => j.dir === "out");
    const routes = (g.routes ?? ins.flatMap((i) => outs.map((o): Route => ({ from: i.id, to: o.id })))).filter((r) => !r.unless?.some(has));
    for (const r of routes) link(node(id, r.from), node(id, r.to));
    // An output in use fed only by empty inputs passes on silence; so does one with a needed input left empty.
    for (const o of outs.filter(has)) {
      const feeds = routes.filter((r) => r.to === o.id).flatMap((r) => ins.find((j) => j.id === r.from) ?? []);
      const empty = feeds.every((j) => !has(j)) ? feeds[0] : feeds.find((j) => !j.optional && !has(j));
      if (!empty || problems.some((p) => p.kind === "empty-input" && p.items[0] === id)) continue;
      const sent = g.routes && empty.label ? `, so its ${jackName(o)} gets silence` : `, so it passes on silence`;
      say("empty-input", [id], `Nothing is plugged into the ${g.name}'s ${jackName(empty)}${sent}`, empty.id);
    }
    // A tube amp with a signal in and no load on its output.
    const speaker = outs.find((j) => j.kind === "speaker");
    if (g.tubes && speaker && !has(speaker) && ins.some(has)) say("no-speaker", [id], `The ${g.name} has no speaker on it: its output transformer will burn`, speaker.id);
  }

  // Every loop once, wherever it is (one fed by no source still howls when one is).
  const done = new Set<string>(), loops = new Set<string>();
  const visit = (n: string, path: string[]) => {
    const at = path.indexOf(n);
    if (at >= 0) {
      const loop = [...new Set(path.slice(at).map(itemOf))], key = [...loop].sort().join(" ");
      if (loops.has(key)) return;
      loops.add(key);
      say("loop", loop, loop.length === 1
        ? `${name(loop[0])} is cabled into itself: its output feeds its own input, round and round until it howls. Pull that cable`
        : `A loop: ${loop.map(name).join(" into ")} and back again, round and round until it howls. Pull one of those cables`);
      return;
    }
    if (done.has(n)) return;
    for (const m of next.get(n) ?? []) visit(m, [...path, n]);
    done.add(n);
  };
  for (const [id, g] of items) for (const j of g.jacks) visit(node(id, j.id), []);

  // Each way from a source to an output (gear with no out jacks); a way round a loop never gets there.
  const chains: string[][] = [];
  const walk = (n: string, path: string[]) => {
    if (path.includes(n)) return;
    const here = [...path, n], g = items.get(itemOf(n));
    if (g && !g.jacks.some((j) => j.dir === "out")) {
      chains.push(here.map(itemOf).filter((id, i, all) => id !== all[i - 1]));
      return;
    }
    for (const m of next.get(n) ?? []) walk(m, here);
  };
  for (const [id, g] of items) if (g.kind === "source") for (const j of g.jacks) if (j.dir === "out") walk(node(id, j.id), []);
  return { chains, problems };
}

/**
 * The cables of a board laid out in a row: the guitar through `front` one after another into the amp, the amp's
 * send through `loop` into its return (no send cable when `loop` is empty), and the amp's speaker into the cabinet.
 */
export function seriesCables(front: readonly string[], loop: readonly string[]): Cable[] {
  const run = (from: End, via: readonly string[], to: End): Cable[] => {
    const ends: End[] = [from, ...via.flatMap((id): End[] => [[id, "in"], [id, "out"]]), to];
    return Array.from({ length: ends.length / 2 }, (_, i) => ({ from: ends[2 * i], to: ends[2 * i + 1], kind: "instrument" }));
  };
  return [
    ...run(["guitar", "out"], front, ["head", "in"]),
    ...(loop.length ? run(["head", "send"], loop, ["head", "return"]) : []),
    { from: ["head", "speaker"], to: ["cab", "in"], kind: "speaker" },
  ];
}

/** Q Amp's stage as it comes: the guitar through every pedal into the amp head, the machines in its loop, into the cabinet. */
export const STAGE: Patch = {
  placed: Object.values(GEAR).map((g) => ({ id: g.id, gear: g.id })),
  cables: seriesCables(PEDAL_GEAR.map((g) => g.id), MACHINE_GEAR.map((g) => g.id)),
};

/** The chains the speakers play: through an amp into a cabinet. */
export const audibleChains = (patch: Patch, compiled: Compiled, gear: Record<string, Gear> = GEAR): string[][] => {
  const kindOf = (id: string) => gear[patch.placed.find((p) => p.id === id)?.gear ?? ""]?.kind;
  if (compiled.problems.some((p) => p.kind === "loop")) return [];
  return compiled.chains.filter((c) => c.some((id) => kindOf(id) === "amp") && kindOf(c[c.length - 1]) === "cab");
};

/**
 * What the speakers play for a compiled patch: whether any chain goes through an amp into a cabinet, whether a
 * pedal is in one, and which items are (`heard`). No such chain, or a loop anywhere, is silence.
 */
export function heard(patch: Patch, compiled: Compiled, gear: Record<string, Gear> = GEAR): { audible: boolean; pedals: boolean; heard: string[] } {
  const kindOf = (id: string) => gear[patch.placed.find((p) => p.id === id)?.gear ?? ""]?.kind;
  const ids = [...new Set(audibleChains(patch, compiled, gear).flat())];
  return { audible: ids.length > 0, pedals: ids.some((id) => kindOf(id) === "pedals"), heard: ids };
}
