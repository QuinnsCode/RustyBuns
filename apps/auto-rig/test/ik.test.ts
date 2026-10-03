import { expect, test } from "bun:test";
import { analyze } from "../src/rig/analyze.ts";
import { gingerbread } from "../src/rig/samples.ts";
import { IkRig } from "../src/ui/ik.ts";

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function setup() {
  const m = gingerbread();
  const r = analyze(m.positions, m.indices);
  const ik = new IkRig(r.joints, r.parents);
  // the tip furthest to the left is a hand
  const hand = ik.tips.reduce((a, b) => (ik.worldPosition(b)[0] < ik.worldPosition(a)[0] ? b : a));
  return { ik, hand };
}

function solveFor(ik: IkRig, steps = 60) { for (let i = 0; i < steps; i++) ik.solve(); }

test("a dragged hand reaches its goal and the other tips hold still", () => {
  const { ik, hand } = setup();
  const others = ik.tips.filter((t) => t !== hand).map((t) => [t, ik.worldPosition(t)] as const);
  const start = ik.worldPosition(hand);
  const goal = [start[0] + 0.25, start[1] + 0.3, start[2] + 0.2];
  ik.moveGoal(hand, goal[0], goal[1], goal[2]);
  solveFor(ik);
  expect(dist(ik.worldPosition(hand), goal)).toBeLessThan(0.01);
  for (const [t, p] of others) expect(dist(ik.worldPosition(t), p)).toBeLessThan(0.01);
});

test("clasping pulls one hand to the other", () => {
  const { ik, hand } = setup();
  const other = ik.tips.reduce((a, b) => (ik.worldPosition(b)[0] > ik.worldPosition(a)[0] ? b : a));
  ik.setRootPinned(false);
  ik.clasp(hand, other);
  // bring the anchor hand in front of the chest so the other can reach it
  ik.moveGoal(hand, 0, 1.3, 0.35);
  solveFor(ik, 200);
  expect(dist(ik.worldPosition(hand), ik.worldPosition(other))).toBeLessThan(0.02);
});

test("reset returns to the rest pose", () => {
  const { ik, hand } = setup();
  const rest = ik.worldPosition(hand);
  const p = ik.goalPosition(hand)!;
  ik.moveGoal(hand, p[0], p[1] + 0.3, p[2]);
  solveFor(ik);
  ik.reset();
  expect(dist(ik.worldPosition(hand), rest)).toBeLessThan(1e-4);
});
