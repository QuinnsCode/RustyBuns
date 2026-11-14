// A solo round as the page plays it: frames from the LocalDriver through earned(), the ids the page would send to eqosys.
import { expect, test } from "bun:test";
import { earned, newTally } from "../src/client/achievements.ts";
import { LocalDriver, type Frame } from "../src/client/driver.ts";
import { learn, lessons, newLearnt } from "../src/client/lessons.ts";
import { stepAt } from "@rustybuns/util/tutorial";
import { COUNTDOWN_TICKS, TICK_HZ } from "../src/sim/rules.ts";

const TICK_MS = 1000 / TICK_HZ;

test("a solo round against hard bots: played, alpha, chomps, the podium's", () => {
  const d = new LocalDriver([{ name: "Ada", human: true }, { name: "", human: false }, { name: "", human: false }, { name: "", human: false }], { secs: 30, difficulty: "hard" }, 7);
  const t = newTally(), got = new Set<string>();
  let f: Frame | undefined;
  for (let i = 0; i < COUNTDOWN_TICKS + 30 * TICK_HZ + 10; i++) {
    d.input(0, Math.sin(i / 20), i % 12 === 0, false);
    f = d.advance(TICK_MS);
    for (const id of earned(t, f)) got.add(id);
  }
  expect(f!.phase).toBe("podium");
  expect(got).toContain("played");
  expect(got).toContain("alpha");
  expect(got).toContain("first-chomp");
  expect(got.has("couch") || got.has("online") || got.has("full-park")).toBe(false);
  const scores = f!.cur.hippos.map((h) => h.score);
  expect(got.has("profitable")).toBe(scores[0]! > 0);
  expect(got.has("first-win")).toBe(scores.every((s, i) => i === 0 || s < scores[0]!));
});

test("the tutorial: a first round walks every step, in order, and a round of standing still walks none", () => {
  const seats = [{ name: "Ada", human: true }, { name: "", human: false }, { name: "", human: false }, { name: "", human: false }];
  const play = (act: boolean) => {
    const d = new LocalDriver(seats, { secs: 30, difficulty: "easy" }, 7);
    const l = newLearnt(), steps = lessons(l), order: number[] = [];
    for (let i = 0; i < COUNTDOWN_TICKS + 30 * TICK_HZ + 10; i++) {
      d.input(0, act ? Math.sin(i / 20) : 0, act && i % 12 === 0, act && i % 200 === 0);
      learn(l, d.advance(TICK_MS));
      const at = stepAt(steps, order.at(-1) ?? 0);
      if (at !== order.at(-1)) order.push(at);
    }
    return order;
  };
  expect(play(true).at(-1)).toBe(5);
  expect(play(false)).toEqual([0]);
});
