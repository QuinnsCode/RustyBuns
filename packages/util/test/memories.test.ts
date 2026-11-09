import { expect, test } from "bun:test";
import { Director, playNamed, type Scene } from "../src/director.ts";
import { Memories, readMemories, type Keep } from "../src/memories.ts";

const tape = (id: string): Scene => ({ id, seconds: 3, skip: true, hold: true, lines: [[0, "Gary: Is this thing on?"]] });
const box = (): Keep & { v: string | null } => { const k = { v: null as string | null, get: () => k.v, set: (v: string) => { k.v = v; } }; return k; };
const run = (d: Director, mem: Memories, s: number, skip = false) => { for (let i = 0; i < Math.round(s * 60); i++) mem.step(d.step(1 / 60, skip && i === 0)); };

test("a scene is a memory once seen to its end (a skip counts, walking off doesn't), kept across a reload, played back by name", () => {
  const keep = box(), mem = new Memories(keep), d = new Director(0.4);
  // Walked off halfway: the scene was cut, so it isn't kept.
  d.play(mem.mark(tape("found"), { id: "tape:gary", scene: "found", title: "Is this thing on?", args: { lines: ["Gary: hi"], n: 2 } }));
  run(d, mem, 1); d.cut(); run(d, mem, 3);
  expect(mem.list()).toEqual([]);
  // Played again and skipped: you were there.
  d.play(mem.mark(tape("found"), { id: "tape:gary", scene: "found", title: "Is this thing on?", args: { lines: ["Gary: hi"], n: 2 } }));
  run(d, mem, 0.2, true); run(d, mem, 1);
  // A scene nobody marked (a passing gag) never is one.
  d.play(tape("gag")); run(d, mem, 4);
  expect(mem.list().map((m) => m.id)).toEqual(["tape:gary"]);
  // Watched a second time, it stays where it was; and a reload finds it.
  d.play(mem.mark(tape("found"), { id: "tape:gary", scene: "found", title: "again" })); run(d, mem, 4);
  const back = new Memories(keep);
  expect(back.list()).toEqual([{ id: "tape:gary", scene: "found", title: "Is this thing on?", args: { lines: ["Gary: hi"], n: 2 } }]);
  // Recalled: its scene plays from the game's table with what it kept.
  const m = back.get("tape:gary")!;
  expect(playNamed(d, { found: (w: { lines: readonly string[] }) => ({ ...tape("found"), lines: w.lines.map((l, i) => [i, l] as const) }) }, m.scene, { lines: m.args!.lines as string[] })).toBe(true);
  expect(d.step(0).line).toEqual({ who: "Gary", text: "hi" });
});

test("a stored list that's been tampered with or broken keeps only real memories", () => {
  expect(readMemories(null)).toEqual([]);
  expect(readMemories("{not json")).toEqual([]);
  expect(readMemories(JSON.stringify({ id: "x" }))).toEqual([]);
  const rows = readMemories(JSON.stringify([
    { id: "a", scene: "arrival", title: "Pine Barrens", args: { n: 1, bad: { deep: true }, lines: ["ok", 3] } },
    { id: "a", scene: "arrival", title: "a duplicate" },
    { id: 7, scene: "x", title: "no" },
    "junk",
    { id: "b", scene: "credits", title: "Credits", sub: "The end" },
  ]));
  expect(rows).toEqual([{ id: "a", scene: "arrival", title: "Pine Barrens", args: { n: 1 } }, { id: "b", scene: "credits", title: "Credits", sub: "The end" }]);
});
