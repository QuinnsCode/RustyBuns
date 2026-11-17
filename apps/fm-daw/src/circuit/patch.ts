// Gear on cables: each piece of gear has jacks, a patch is the gear in the room and
// the cables between their jacks, and `compile` walks each source along the cables
// to each output. It hands back the chains the audio thread runs and the problems on
// the way (an empty input, an instrument cable used as a speaker cable, a loop, a
// tube amp with no speaker on it). Plain TS, no DOM: Q Amp's patch view, the 3D
// studio and Load In's roadie all read the same answer.
//
// A patch here is the shape the sesh keeps (src/studio.ts once #4840 lands): items
// with an id and a gear, cables between [item, jack] ends. Names follow
// @rustybuns/gear's patch (cable kinds, `wrong-cable`, `loop`) so the two can merge.

/** What a cable is: a quarter-inch instrument lead, a speaker cable, a mic (XLR) cable, or mains. */
export type CableKind = "instrument" | "speaker" | "xlr" | "power";

export interface Jack { id: string; kind: CableKind; dir: "in" | "out" }

export interface Gear {
  id: string;
  name: string;
  /** A source makes the signal; an output (no out jacks) is where a chain ends. */
  kind: "source" | "pedals" | "amp" | "cab";
  jacks: Jack[];
  knobs: string[];
  /** How it makes its sound: a solved circuit, plain DSP, or nothing of its own (a cable, a guitar's riff). */
  sound: "circuit" | "dsp" | "none";
  /** A tube amp: on with no speaker on its output, the output transformer burns. */
  tubes?: boolean;
}

const an = (kind: CableKind, cap = false) => `${/^[aeiox]/.test(kind) ? "an" : "a"} ${kind}`.replace(/^a/, cap ? "A" : "a");
const inst = (id: string, dir: Jack["dir"]): Jack => ({ id, kind: "instrument", dir });

/** The gear on Q Amp's stage. The pedalboard is one box: its slots and their order (#4827) are inside it. */
export const GEAR: Record<string, Gear> = {
  guitar: { id: "guitar", name: "Guitar", kind: "source", jacks: [inst("out", "out")], knobs: [], sound: "none" },
  pedalboard: { id: "pedalboard", name: "Pedalboard", kind: "pedals", jacks: [inst("in", "in"), inst("out", "out")], knobs: ["drive"], sound: "circuit" },
  head: {
    id: "head", name: "Amp head", kind: "amp", tubes: true, sound: "circuit",
    jacks: [inst("in", "in"), { id: "speaker", kind: "speaker", dir: "out" }],
    knobs: ["gain", "bass", "mid", "treble", "master", "noise"],
  },
  cab: { id: "cab", name: "Cabinet", kind: "cab", jacks: [{ id: "in", kind: "speaker", dir: "in" }], knobs: [], sound: "dsp" },
};

/** An end of a cable: [item id, jack id]. */
export type End = readonly [string, string];
/** A cable between two jacks, either way round. Without a kind it is whatever the out jack takes. */
export interface Cable { from: End; to: End; kind?: CableKind }
export interface Patch { placed: readonly { id: string; gear: string }[]; cables: readonly Cable[] }

export type ProblemKind = "empty-input" | "wrong-cable" | "loop" | "no-speaker" | "no-jack" | "direction";
export interface Problem { kind: ProblemKind; items: string[]; jack?: string; message: string }

export interface Compiled {
  /** Item ids from a source to an output, one list per way through. */
  chains: string[][];
  problems: Problem[];
}

/** Walk a patch: every way from a source to an output, and what is wrong with it. */
export function compile(patch: Patch, gear: Record<string, Gear> = GEAR): Compiled {
  const items = new Map<string, Gear>();
  for (const p of patch.placed) { const g = gear[p.gear]; if (g) items.set(p.id, g); }
  const problems: Problem[] = [];
  const say = (kind: ProblemKind, ids: string[], message: string, jack?: string) => problems.push({ kind, items: ids, jack, message });
  const name = (id: string) => items.get(id)?.name ?? id;

  // Each cable, turned round so it runs out to in. `plugged` is every jack with a cable in it.
  const next = new Map<string, string[]>();
  const plugged = new Set<string>();
  for (const c of patch.cables) {
    const ends = [c.from, c.to].map(([item, jack]) => ({ item, jack: items.get(item)?.jacks.find((j) => j.id === jack) }));
    const [a, b] = ends;
    if (!a.jack || !b.jack) {
      const bad = ends.find((e) => !e.jack) ?? a;
      say("no-jack", [bad.item], `${name(bad.item)} has no jack like that`);
      continue;
    }
    if (a.jack.dir === b.jack.dir) { say("direction", [a.item, b.item], `Two ${a.jack.dir}puts cabled together: ${name(a.item)} and ${name(b.item)}`); continue; }
    const [out, into] = a.jack.dir === "out" ? [a, b] : [b, a];
    if (!out.jack || !into.jack) continue;
    const kind = c.kind ?? out.jack.kind;
    if (kind !== out.jack.kind || kind !== into.jack.kind) {
      const wanted = kind === out.jack.kind ? into.jack.kind : out.jack.kind;
      say("wrong-cable", [out.item, into.item], `${an(kind, true)} cable where ${an(wanted)} cable goes, ${name(out.item)} to ${name(into.item)}`, (kind === out.jack.kind ? into : out).jack?.id);
    }
    plugged.add(`${out.item}:${out.jack.id}`).add(`${into.item}:${into.jack.id}`);
    next.set(out.item, [...(next.get(out.item) ?? []), into.item]);
  }

  for (const [id, g] of items) {
    const has = (j: Jack) => plugged.has(`${id}:${j.id}`);
    const ins = g.jacks.filter((j) => j.dir === "in"), outs = g.jacks.filter((j) => j.dir === "out");
    // Gear in use (something cabled out of it) with an input left empty passes on silence.
    const empty = ins.find((j) => !has(j));
    if (empty && outs.some(has)) say("empty-input", [id], `Nothing in the ${g.name}'s input`, empty.id);
    // A tube amp with a signal in and no load on its output.
    const speaker = outs.find((j) => j.kind === "speaker");
    if (g.tubes && speaker && !has(speaker) && ins.some(has)) say("no-speaker", [id], `The ${g.name} has no speaker on it: its output transformer will burn`, speaker.id);
  }

  // Every loop once, wherever it is (one fed by no source still howls when one is).
  const done = new Set<string>(), loops = new Set<string>();
  const visit = (id: string, path: string[]) => {
    const at = path.indexOf(id);
    if (at >= 0) {
      const loop = path.slice(at), key = [...loop].sort().join(" ");
      if (!loops.has(key)) { loops.add(key); say("loop", loop, `A loop: ${loop.map(name).join(" to ")} and back`); }
      return;
    }
    if (done.has(id)) return;
    for (const n of next.get(id) ?? []) visit(n, [...path, id]);
    done.add(id);
  };
  for (const id of items.keys()) visit(id, []);

  // Each way from a source to an output (gear with no out jacks); a way round a loop never gets there.
  const chains: string[][] = [];
  const walk = (id: string, path: string[]) => {
    if (path.includes(id)) return;
    const here = [...path, id], g = items.get(id);
    if (g && !g.jacks.some((j) => j.dir === "out")) { chains.push(here); return; }
    for (const n of next.get(id) ?? []) walk(n, here);
  };
  for (const [id, g] of items) if (g.kind === "source") walk(id, []);
  return { chains, problems };
}

/** Q Amp's stage as it comes: guitar into the pedalboard, into the amp head, into the cabinet. */
export const STAGE: Patch = {
  placed: [{ id: "guitar", gear: "guitar" }, { id: "pedalboard", gear: "pedalboard" }, { id: "head", gear: "head" }, { id: "cab", gear: "cab" }],
  cables: [
    { from: ["guitar", "out"], to: ["pedalboard", "in"], kind: "instrument" },
    { from: ["pedalboard", "out"], to: ["head", "in"], kind: "instrument" },
    { from: ["head", "speaker"], to: ["cab", "in"], kind: "speaker" },
  ],
};

/**
 * What the speakers play for a compiled patch: the first chain that goes through an
 * amp into a cabinet, and whether the pedalboard is in it. No such chain, or a loop
 * anywhere, is silence.
 */
export function heard(patch: Patch, compiled: Compiled, gear: Record<string, Gear> = GEAR): { audible: boolean; pedals: boolean } {
  const kindOf = (id: string) => gear[patch.placed.find((p) => p.id === id)?.gear ?? ""]?.kind;
  if (compiled.problems.some((p) => p.kind === "loop")) return { audible: false, pedals: false };
  const chain = compiled.chains.find((c) => c.some((id) => kindOf(id) === "amp") && kindOf(c[c.length - 1]) === "cab");
  return { audible: !!chain, pedals: !!chain?.some((id) => kindOf(id) === "pedals") };
}
