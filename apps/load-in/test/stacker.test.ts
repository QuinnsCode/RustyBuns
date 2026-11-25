// The stack builder's model (src/stacker/plan.ts): what "Just do it" builds, gravity when you drop a box, the warnings
// a bad stack gets, the stage plan's coverage, and a save that comes back wrong.
import { describe, expect, test } from "bun:test";
import { EVEN, RIGS, TARGET, cover, justDoIt, readDesign, settle, sizeFor, sources, stats, wallFor, type Box } from "../src/stacker/plan.ts";

describe("stack builder", () => {
  test("Just do it: every rig, sized for a 25 m floor, makes the targets and stands up", () => {
    for (const r of RIGS.filter((r) => r.id !== "bar-pair")) {
      const s = stats(wallFor(r, 25), 25);
      expect({ rig: r.id, high: s.back.highOk, low: s.back.lowOk, count: s.count.sub > 0 && s.count.top > 0 }).toEqual({ rig: r.id, high: true, low: true, count: true });
      expect(s.warnings.filter((w) => w.kind === "overhang" || w.kind === "heavy-high" || w.kind === "buried")).toEqual([]);
    }
    // A deeper floor wants more boxes.
    const horn = RIGS[0]!;
    expect(sizeFor(horn, 50).subs).toBeGreaterThan(sizeFor(horn, 25).subs);
    expect(stats(wallFor(horn, 50), 50).boxes).toBeGreaterThan(stats(wallFor(horn, 25), 25).boxes);
  });

  test("gravity: a box lands on what is under it, and one dropped low goes in underneath", () => {
    const bin: Box = { gear: "horn-sub-21", x: 0, y: 0 };
    const top = settle([bin, { gear: "stack-mid-high", x: 0, y: 5 }]);
    expect(top[1]!.y).toBeCloseTo(0.8);
    // dropped beside the bin, a box stays on the ground
    expect(settle([bin, { gear: "sub-18", x: 1.5, y: 3 }])[1]!.y).toBe(0);
    // a mid-bass dropped at 0.5 m goes under the horn sitting at 0.8 m and lifts it
    const lifted = settle([...top, { gear: "stack-mid-bass", x: 0, y: 0.5 }]);
    expect(lifted.map((b) => [b.gear, Math.round(b.y * 100)])).toEqual([["horn-sub-21", 0], ["stack-mid-bass", 80], ["stack-mid-high", 155]]);
    expect(stats({ name: "", boxes: lifted }).layers).toBe(3);
  });

  test("a bad stack says what is wrong with it", () => {
    const kinds = (boxes: Box[]) => stats({ name: "", boxes }).warnings.map((w) => w.kind).sort();
    expect(kinds([{ gear: "stack-mid-high", x: 0, y: 0 }, { gear: "horn-sub-21", x: 0, y: 1 }])).toEqual(["buried", "heavy-high"]);
    expect(kinds([{ gear: "horn-sub-21", x: 0, y: 0 }, { gear: "stack-mid-high", x: 0.75, y: 1 }])).toEqual(["overhang"]);
    expect(kinds([{ gear: "horn-sub-21", x: 0, y: 0 }])).toEqual(["no-top"]);
  });

  test("the plan: two stacks cover the floor, and the bass makes an alley down the middle", () => {
    const d = justDoIt("dance-stack");
    expect(d.plan.placed.map((p) => Math.sign(p.yaw))).toEqual([1, -1]); // toed in
    const c = cover(d);
    expect(c.back).toBeGreaterThanOrEqual(TARGET.high - 3);
    const mid = c.low[Math.floor(c.nz / 2) * c.nx + Math.floor(c.nx / 2)]!;
    expect(mid).toBeGreaterThan(c.bass); // the middle of the floor is the power alley
    // gear's floor numbers: the horn stacks spread wide, the bar pair stays even
    expect(c.tops.even).toBeGreaterThan(EVEN.tops);
    expect(cover(justDoIt("bar-pair")).tops.even).toBeLessThanOrEqual(EVEN.tops);
    // with nothing placed, nothing plays
    expect(cover({ ...d, plan: { ...d.plan, placed: [] } }).tops.mean).toBeLessThan(0);
  });

  test("a line array stands as one column, each box tipped down by its pin, the bins playing where they stand", () => {
    const d = justDoIt("line-array"), src = sources(d), lines = src.filter((s) => s.speaker.highCut > 200);
    expect(lines.length).toBeGreaterThanOrEqual(6); // three or more a side
    expect(lines.every((s) => s.pitch < 0)).toBe(true);
    // the bottom box aims lowest, and every box sits higher than the one under it
    const left = lines.slice(0, lines.length / 2);
    expect(left[0]!.pitch).toBeLessThan(left[1]!.pitch);
    expect(left.every((s, i) => i === 0 || s.pos.y > left[i - 1]!.pos.y)).toBe(true);
    expect(src.length).toBe(d.stacks[0]!.boxes.length * 2); // every box plays, both sides
  });

  test("a save that comes back wrong is refused, or loses only what doesn't fit", () => {
    for (const bad of [null, "x", { stacks: [] }, { stacks: [{ name: "A", boxes: [] }] }]) expect(readDesign(bad)).toBeNull();
    const d = justDoIt();
    const saved = JSON.parse(JSON.stringify(d));
    saved.stacks[0].boxes.push({ gear: "not-a-box", x: 0, y: 0 }, { gear: "sub-18", x: "left", y: 0 });
    saved.plan.placed.push({ stack: 7, x: 0, z: 0, yaw: 0 });
    const back = readDesign(saved)!;
    expect(back.stacks[0]!.boxes).toEqual(d.stacks[0]!.boxes);
    expect(back.plan.placed).toEqual(d.plan.placed);
  });
});
