// The band's inputs, the snake and line check, in the bigger bar once the speakers are up. A three-piece is set up on
// the stage; the clipboard says which input goes to which channel. Carry the stage box (the snake's reel, its other
// end already in the desk) from the desk to the stage, run an XLR from each mic and the bass's DI into its channel on
// the stage box, and the bass's lead into the DI. Then line check from the desk: each player plays alone and you
// hear where it lands. A dead cable is silence on a channel that traces right; a crackle is a worn cable (swap it);
// hum on the DI is a ground loop (lift it); a player on the wrong channel was patched into the wrong hole. Plain
// data, no DOM: the page (line-check-view.ts), the harness and the test drive the same functions.
import { mulberry32 } from "@rustybuns/util";
import { BIGGER_BAR } from "../venues/bigger-bar.ts";
import { REACH, type Answer, type Item, type Level, type World } from "../sim.ts";
import type { Cables, Run } from "../cables/cables.ts";

const XLR = (n: number) => ({ key: `xlr-${n}`, kind: "xlr" as const, lengthM: 10 });

export const LINE_CHECK: Level = {
  ...BIGGER_BAR,
  name: "line-check",
  start: { x: 1.3, z: 10.8, yaw: 0 },
  items: [
    { key: "mixer", gear: "mixer-small", x: 0, y: 0.5, z: 10.0, rot: 0 },
    { key: "stage-box", gear: "stage-box-8", x: 0.6, y: 0, z: 10.0, rot: 0 },
    { key: "kit", gear: "drum-kit", x: 0, y: 0, z: 0.9, rot: 0 },
    { key: "kick-mic", gear: "mic-stand", x: -0.3, y: 0, z: 1.8, rot: 0 },
    { key: "snare-mic", gear: "mic-stand", x: 0.6, y: 0, z: 1.6, rot: 0 },
    { key: "bass", gear: "guitar", x: -2.4, y: 0, z: 1.0, rot: 0 },
    { key: "bass-di", gear: "di-box", x: -2.0, y: 0, z: 1.6, rot: 0 },
    { key: "cab", gear: "cab-4x12", x: 2.3, y: 0, z: 0.5, rot: 0 },
    { key: "gtr-mic", gear: "mic-stand", x: 2.3, y: 0, z: 1.2, rot: 0 },
    { key: "vox-mic", gear: "mic-stand", x: 1.3, y: 0, z: 2.5, rot: 0 },
    { key: "case", gear: "road-case-m", x: -1.4, y: 0, z: 2.7, rot: 0 },
  ],
  // Seven XLRs for five inputs (two spares), and a lead for the bass.
  caseLoad: [...[1, 2, 3, 4, 5, 6, 7].map(XLR), { key: "inst-1", kind: "instrument", lengthM: 6 }],
};

/** The stage, where the stage box has to sit: the riser across the back wall. */
export const STAGE = { x0: -3.75, x1: 3.75, z0: 0, z1: 3.2 };
/** The multicore on the snake's reel, desk to stage box. */
export const SNAKE_M = 30;

/** One row on the clipboard: the channel, what it is, the input on stage, and who plays it. */
export type Row = { ch: number; name: string; input: string; player: string };
export const INPUT_LIST: readonly Row[] = [
  { ch: 1, name: "Kick", input: "kick-mic", player: "drums" },
  { ch: 2, name: "Snare", input: "snare-mic", player: "drums" },
  { ch: 3, name: "Bass DI", input: "bass-di", player: "bass" },
  { ch: 4, name: "Guitar amp", input: "gtr-mic", player: "guitar" },
  { ch: 5, name: "Vocal", input: "vox-mic", player: "vocal" },
];

/** What is wrong tonight that the roadie didn't do: cables that are dead or crackle (by key), DIs that hum until lifted. */
export type Show = { dead: Set<string>; crackle: Set<string>; hum: Set<string>; lifted: Set<string> };

/** A clean night (nothing broken), or a seeded one: one dead XLR, one that crackles, and maybe hum on the DI. */
export function newShow(seed: number | "clean" = "clean"): Show {
  const show: Show = { dead: new Set(), crackle: new Set(), hum: new Set(), lifted: new Set() };
  if (seed === "clean") return show;
  const rand = mulberry32(seed), pick = () => `xlr-${1 + Math.floor(rand() * 5)}`;
  const dead = pick();
  let crackle = pick();
  while (crackle === dead) crackle = pick();
  show.dead.add(dead);
  show.crackle.add(crackle);
  if (rand() < 0.5) show.hum.add("bass-di");
  return show;
}

const item = (w: World, key: string) => w.items.find((i) => i.key === key);
const isPlug = (e: Run["a"]): e is { plug: readonly [string, string] } => "plug" in e;
const near = (w: World, i: Item, reach = REACH) => Math.hypot(i.x - w.you.x, i.z - w.you.z) <= reach;
const close = (a: Item | undefined, b: Item | undefined, m: number) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) <= m;

/** The cable in `owner`'s `jack`, and where its other end is. */
function cableIn(c: Cables, owner: string, jack: string): { run: Run; other: readonly [string, string] | null } | null {
  for (const run of c.runs) for (const [here, there] of [[run.a, run.b], [run.b, run.a]] as const) {
    if (isPlug(here) && here.plug[0] === owner && here.plug[1] === jack) return { run, other: isPlug(there) ? there.plug : null };
  }
  return null;
}

/** Whether the snake is run: the stage box set down on the stage, within the multicore's reach of the desk. */
export function snakeRun(w: World): boolean {
  const box = item(w, "stage-box"), desk = item(w, "mixer");
  if (!box || !desk || w.held?.key === box.key) return false;
  const onStage = box.x >= STAGE.x0 && box.x <= STAGE.x1 && box.z >= STAGE.z0 && box.z <= STAGE.z1;
  return onStage && Math.hypot(box.x - desk.x, box.z - desk.z) <= SNAKE_M;
}

/** Whether an input picks anything up when its player plays: a mic by its source, a DI with the bass plugged into it. */
function hearsIts(w: World, c: Cables, input: string): { on: boolean; leads: Run[] } {
  const i = item(w, input);
  if (input === "bass-di") {
    const lead = cableIn(c, input, "inst-in");
    return { on: !!lead && lead.other?.[0] === "bass", leads: lead ? [lead.run] : [] };
  }
  const near = { "kick-mic": ["kit", 1.2], "snare-mic": ["kit", 1.2], "gtr-mic": ["cab", 1.0] } as const;
  const src = near[input as keyof typeof near];
  return { on: !src || close(i, item(w, src[0]), src[1]), leads: [] };
}

/** One input played alone: the channels it lights at the desk, and how it sounds there. */
export type Heard = { ch: number; sound: "clean" | "hum" | "crackle" };

/** Play `input` alone (its player plays) and listen at the desk. */
export function play(w: World, c: Cables, show: Show, input: string): Heard[] {
  const src = hearsIts(w, c, input), out = cableIn(c, input, "xlr-out");
  if (!src.on || !out?.other || show.dead.has(out.run.key) || src.leads.some((r) => show.dead.has(r.key))) return [];
  const [owner, jack] = out.other, n = Number(jack.match(/^xlr-in-(\d+)$/)?.[1]);
  if (!n) return [];
  // Into the stage box rides the snake to the desk; straight into the desk's own input works too, the long way.
  if (owner === "stage-box" ? !snakeRun(w) : owner !== "mixer") return [];
  const runs = [out.run, ...src.leads];
  const sound = runs.some((r) => show.crackle.has(r.key)) ? "crackle" : show.hum.has(input) && !show.lifted.has(input) ? "hum" : "clean";
  return [{ ch: n, sound }];
}

export type Result = "ok" | "silent" | "wrong channel" | "hum" | "crackle";
export type Checked = Row & { heard: Heard[]; result: Result };

/** Line check: down the clipboard, each input played alone. `clean` when every channel is where it should be, clean. */
export function lineCheck(w: World, c: Cables, show: Show): { rows: Checked[]; clean: boolean } {
  const rows = INPUT_LIST.map((row): Checked => {
    const heard = play(w, c, show, row.input), on = heard.find((h) => h.ch === row.ch);
    const result: Result = !heard.length ? "silent" : !on ? "wrong channel" : on.sound === "clean" ? "ok" : on.sound;
    return { ...row, heard, result };
  });
  return { rows, clean: rows.every((r) => r.result === "ok") };
}

/** Whether you stand at the desk, where line check is heard. */
export const atDesk = (w: World) => { const d = item(w, "mixer"); return !!d && near(w, d, 2); };

/** Line check as a roadie runs it: only from the desk. */
export function runCheck(w: World, c: Cables, show: Show): { ok: true; rows: Checked[]; clean: boolean } | { ok: false; why: string } {
  if (!atDesk(w)) return { ok: false, why: "line check is heard at the desk" };
  return { ok: true, ...lineCheck(w, c, show) };
}

/** Trace an input's cable by hand, from the input in reach: each hop it takes to the desk, or where it stops. */
export function trace(w: World, c: Cables, input: string): { ok: true; path: string[] } | { ok: false; why: string } {
  const i = item(w, input);
  if (!i) return { ok: false, why: `no ${input} here` };
  if (!near(w, i)) return { ok: false, why: `${input} is out of reach` };
  const path: string[] = [];
  if (input === "bass-di") {
    const lead = cableIn(c, input, "inst-in");
    path.push(lead?.other ? `${lead.other[0]} ${lead.other[1]} -> ${lead.run.key} -> bass-di inst-in` : "nothing in bass-di inst-in");
  }
  const out = cableIn(c, input, "xlr-out");
  if (!out) return { ok: true, path: [...path, `nothing in ${input} xlr-out`] };
  path.push(`${input} xlr-out`, `${out.run.key}, ${out.run.lengthM} m`);
  if (!out.other) return { ok: true, path: [...path, "a loose end"] };
  path.push(out.other.join(" "));
  if (out.other[0] === "stage-box") path.push(snakeRun(w) ? `the snake to desk ch ${out.other[1].replace("xlr-in-", "")}` : "the snake isn't run");
  return { ok: true, path };
}

/** Flip a DI's ground lift, in reach of it. */
export function lift(w: World, show: Show, key: string): Answer {
  const i = item(w, key);
  if (!i || i.gear !== "di-box") return { ok: false, why: `${key} is not a DI` };
  if (!near(w, i)) return { ok: false, why: `${key} is out of reach` };
  if (show.lifted.has(key)) show.lifted.delete(key); else show.lifted.add(key);
  return { ok: true };
}
