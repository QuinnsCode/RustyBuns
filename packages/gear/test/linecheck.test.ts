// A band's inputs through a stage box and snake, line-checked with each fault a real night throws up.
import { expect, test } from "bun:test";
import { type Fault, type KeyedCable, type Line, type Placed, type Sound, lineCheck, lineProblems } from "../src/index.ts";

const placed: Placed[] = [
  { id: "desk", gear: "mixer-small", phantom: true },
  { id: "box", gear: "stage-box-12" },
  { id: "fan", gear: "snake-fan-12" },
  { id: "kick", gear: "mic-kick" },
  { id: "di", gear: "di-box" },
  { id: "vox", gear: "mic-condenser" },
];
const lines: Line[] = [
  { channel: 1, what: "Kick", source: "kick" },
  { channel: 2, what: "Bass DI", source: "di" },
  { channel: 3, what: "Vocal", source: "vox" },
];
const xlr = (key: string, from: string, input: number): KeyedCable => ({ key, kind: "xlr", lengthM: 10, from: [from, "xlr-out"], to: ["box", `xlr-in-${input}`] });
const snake: KeyedCable = { key: "snake", kind: "multi", lengthM: 30, from: ["box", "multi-out"], to: ["fan", "multi-in"] };
const patch = [xlr("a", "kick", 1), xlr("b", "di", 2), xlr("c", "vox", 3), snake];
const desk = { id: "desk", powered: true };
const sounds = (h: ReturnType<typeof lineCheck>) => h.map((x) => [x.on, x.sound]);

test.each<{ name: string; faults: Fault[]; patch?: KeyedCable[]; placed?: Placed[]; powered?: boolean; heard: [number | null, Sound][] }>([
  { name: "a clean night: every input comes up clean on its own channel", faults: [], heard: [[1, "clean"], [2, "clean"], [3, "clean"]] },
  { name: "a dead cable: nothing comes up for the kick", faults: [{ kind: "dead", cable: "a" }], heard: [[null, "silent"], [2, "clean"], [3, "clean"]] },
  { name: "the dead cable swapped for a spare: the kick is back", faults: [{ kind: "dead", cable: "a" }], patch: [xlr("g", "kick", 1), xlr("b", "di", 2), xlr("c", "vox", 3), snake], heard: [[1, "clean"], [2, "clean"], [3, "clean"]] },
  { name: "a crackling connector: the vocal comes up, crackling", faults: [{ kind: "crackle", cable: "c" }], heard: [[1, "clean"], [2, "clean"], [3, "crackle"]] },
  { name: "inputs 1 and 2 crossed: the kick is on 2 and the bass on 1", faults: [{ kind: "crossed", a: 1, b: 2 }], heard: [[2, "clean"], [1, "clean"], [3, "clean"]] },
  { name: "crossed, repatched: kick into 2 and the DI into 1 lands each on its own channel", faults: [{ kind: "crossed", a: 1, b: 2 }], patch: [xlr("a", "kick", 2), xlr("b", "di", 1), xlr("c", "vox", 3), snake], heard: [[1, "clean"], [2, "clean"], [3, "clean"]] },
  { name: "a ground loop: the bass DI hums", faults: [{ kind: "hum", di: "di" }], heard: [[1, "clean"], [2, "hum"], [3, "clean"]] },
  { name: "the DI's ground lift pressed: the hum is gone", faults: [{ kind: "hum", di: "di" }], placed: placed.map((p) => (p.id === "di" ? { ...p, lift: true } : p)), heard: [[1, "clean"], [2, "clean"], [3, "clean"]] },
  { name: "48 V off: the condenser vocal is silent", faults: [], placed: placed.map((p) => (p.id === "desk" ? { ...p, phantom: false } : p)), heard: [[1, "clean"], [2, "clean"], [null, "silent"]] },
  { name: "no snake: nothing reaches the desk", faults: [], patch: patch.slice(0, 3), heard: [[null, "silent"], [null, "silent"], [null, "silent"]] },
  { name: "the desk off: nothing on any channel", faults: [], powered: false, heard: [[null, "silent"], [null, "silent"], [null, "silent"]] },
])("$name", (c) => {
  const heard = lineCheck(c.placed ?? placed, c.patch ?? patch, lines, c.faults, { ...desk, powered: c.powered ?? true });
  expect(sounds(heard)).toEqual(c.heard);
  // What is left wrong is a problem naming its input; a clean night has none.
  expect(lineProblems(heard).length).toBe(heard.filter((h) => !h.ok).length);
});
