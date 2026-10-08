import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashState } from "../src/sim/hash.ts";
import { hippoPoint } from "../src/sim/geom.ts";
import { newState, step } from "../src/sim/step.ts";
import * as R from "../src/sim/rules.ts";
import { NO_INPUT, type Input, type State } from "../src/sim/types.ts";

const press: Input = { move: 0, gulp: true, bellow: false };
const none = [NO_INPUT, NO_INPUT, NO_INPUT, NO_INPUT];
/** A quiet state: no spawns, so a test places its own drops. */
function quiet(seed = 1): State { const s = newState(seed); s.spawnCd = 1e9; return s; }
const dropAt = (s: State, kind: number, x: number, y: number, vx = 0, vy = 0) => {
  s.drops.push({ id: s.nextId++, kind, x, y, vx, vy, age: 0 });
};
/** Seat 0 chomps with a drop dead centre in its jaws; returns once the chomp has landed. */
function chompOn(kind: number, s = quiet()) {
  const j = hippoPoint(0, 0, 1);
  dropAt(s, kind, j.x, j.y);
  const events = step(s, [press, NO_INPUT, NO_INPUT, NO_INPUT]);
  for (let i = 0; i < R.GULP_OUT; i++) events.push(...step(s, none));
  return { s, events };
}

// A tiny LCG for scripted inputs; the test must not use Math.random either.
function scripted(seed: number) {
  let x = seed >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return (): Input[] => Array.from({ length: 4 }, () => ({ move: Math.round(r() * 2 - 1), gulp: r() < 0.12, bellow: r() < 0.01 }));
}
function play(seed: number, ticks: number, inputs = scripted(99)) {
  const s = newState(seed);
  for (let i = 0; i < ticks; i++) step(s, inputs());
  return s;
}

test("determinism: same seed and inputs give the same state after 1800 ticks", () => {
  const a = play(7, 1800), b = play(7, 1800);
  expect(hashState(a)).toBe(hashState(b));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(hashState(play(8, 1800))).not.toBe(hashState(a));
  expect(a.over).toBe(true);
});

test("scoring per drop type", () => {
  const pts = [[R.OIL, 1], [R.GOLD, 3]] as const;
  for (const [kind, want] of pts) {
    const { s, events } = chompOn(kind);
    expect(s.hippos[0]!.score).toBe(want);
    expect(events).toContainEqual({ t: "eat", seat: 0, kind, pts: want, x: expect.any(Number), y: expect.any(Number) });
    expect(s.drops.length).toBe(0);
  }
  // bad drops take points off, floored at MIN_SCORE
  const s = quiet(); s.hippos[0]!.score = 5;
  expect(chompOn(R.SLUDGE, s).s.hippos[0]!.score).toBe(4);
  const t = quiet(); t.hippos[0]!.score = 5;
  expect(chompOn(R.NAIL, t).s.hippos[0]!.score).toBe(3);
  expect(chompOn(R.NAIL).s.hippos[0]!.score).toBe(0);
  const w = quiet(); w.hippos[0]!.score = 5;
  expect(chompOn(R.WATER, w).s.hippos[0]!.score).toBe(5);
});

test("a chomp only eats what is inside the jaws at the peak", () => {
  const s = quiet();
  const j = hippoPoint(0, 0, 1);
  dropAt(s, R.OIL, j.x + R.SCOOP_R + 1.5, j.y);
  step(s, [press, NO_INPUT, NO_INPUT, NO_INPUT]);
  for (let i = 0; i < R.GULP_OUT; i++) step(s, none);
  expect(s.hippos[0]!.score).toBe(0);
  expect(s.drops.length).toBe(1);
});

test("sludge: sputter blocks sliding and chomping, then wears off", () => {
  const { s } = chompOn(R.SLUDGE);
  const h = s.hippos[0]!;
  expect(h.sputter).toBe(R.SPUTTER_TICKS);
  const before = h.slide;
  step(s, [{ move: 1, gulp: true, bellow: false }, NO_INPUT, NO_INPUT, NO_INPUT]);
  expect(h.slide).toBe(before);
  for (let i = 0; i < R.SPUTTER_TICKS + R.GULP_COOLDOWN; i++) step(s, none);
  expect(h.sputter).toBe(0);
  step(s, [{ move: 1, gulp: false, bellow: false }, NO_INPUT, NO_INPUT, NO_INPUT]);
  expect(h.slide).toBeGreaterThan(before);
});

test("nail: sore jaw halves slide speed for a while", () => {
  const { s } = chompOn(R.NAIL);
  const h = s.hippos[0]!;
  expect(h.sore).toBe(R.SORE_TICKS);
  h.slide = 0;
  step(s, [{ move: 1, gulp: false, bellow: false }, NO_INPUT, NO_INPUT, NO_INPUT]);
  expect(h.slide).toBeCloseTo(R.SLIDE_SPEED * R.SORE_FACTOR, 9);
  for (let i = 0; i < R.SORE_TICKS; i++) step(s, none);
  h.slide = 0;
  step(s, [{ move: 1, gulp: false, bellow: false }, NO_INPUT, NO_INPUT, NO_INPUT]);
  expect(h.slide).toBeCloseTo(R.SLIDE_SPEED, 9);
});

test("water: the next chomp is a dud, the one after works", () => {
  const { s } = chompOn(R.WATER);
  const h = s.hippos[0]!;
  expect(h.flooded).toBe(true);
  for (let i = 0; i < R.GULP_COOLDOWN + R.GULP_BACK; i++) step(s, none);
  const j = hippoPoint(0, h.slide, 1);
  dropAt(s, R.OIL, j.x, j.y);
  let evs = step(s, [press, NO_INPUT, NO_INPUT, NO_INPUT]);
  for (let i = 0; i < R.GULP_OUT; i++) evs.push(...step(s, none));
  expect(evs).toContainEqual({ t: "dud", seat: 0 });
  expect(h.score).toBe(0);
  expect(h.flooded).toBe(false);
  for (let i = 0; i < R.GULP_COOLDOWN + R.GULP_BACK; i++) step(s, none);
  const j2 = hippoPoint(0, h.slide, 1);
  s.drops = []; dropAt(s, R.OIL, j2.x, j2.y);
  step(s, [press, NO_INPUT, NO_INPUT, NO_INPUT]);
  for (let i = 0; i < R.GULP_OUT; i++) step(s, none);
  expect(h.score).toBe(1);
});

test("cooldown: holding gulp chomps once per cooldown, not every tick", () => {
  const s = quiet();
  let gulps = 0;
  for (let i = 0; i < 100; i++) gulps += step(s, [press, NO_INPUT, NO_INPUT, NO_INPUT]).filter((e) => e.t === "gulp").length;
  expect(gulps).toBe(Math.ceil(100 / R.GULP_COOLDOWN));
});

test("two hippos reaching one drop: the nearer one eats it", () => {
  // slide seat 0 to the right and seat 1 to the left so their jaws overlap at the south-east
  const s = quiet();
  s.hippos[0]!.slide = 1; s.hippos[1]!.slide = -1;
  const a = hippoPoint(0, 1, 1), b = hippoPoint(1, -1, 1);
  const x = a.x * 0.55 + b.x * 0.45, y = a.y * 0.55 + b.y * 0.45;   // a little nearer seat 0
  expect(Math.hypot(x - a.x, y - a.y)).toBeLessThan(R.SCOOP_R);
  expect(Math.hypot(x - b.x, y - b.y)).toBeLessThan(R.SCOOP_R);
  dropAt(s, R.OIL, x, y);
  s.hippos[0]!.gulp = R.GULP_OUT - 1; s.hippos[1]!.gulp = R.GULP_OUT - 1;   // both land this tick
  step(s, none);
  expect(s.hippos.map((h) => h.score)).toEqual([1, 0, 0, 0]);
  const t = quiet();
  t.hippos[0]!.slide = 1; t.hippos[1]!.slide = -1;
  dropAt(t, R.OIL, a.x * 0.45 + b.x * 0.55, a.y * 0.45 + b.y * 0.55);      // a little nearer seat 1
  t.hippos[0]!.gulp = R.GULP_OUT - 1; t.hippos[1]!.gulp = R.GULP_OUT - 1;
  step(t, none);
  expect(t.hippos.map((h) => h.score)).toEqual([0, 1, 0, 0]);
});

test("uneaten gold splatters into a slick that speeds drops up", () => {
  const s = quiet();
  dropAt(s, R.GOLD, 2, 2);
  s.drops[0]!.age = R.SLICK_AGE - 1;
  const evs = step(s, none);
  expect(evs.some((e) => e.t === "slick")).toBe(true);
  expect(s.drops.length).toBe(0);
  expect(s.slicks.length).toBe(1);
  const k = s.slicks[0]!;
  dropAt(s, R.OIL, k.x + 0.5, k.y, 0.1, 0);
  const v0 = Math.hypot(s.drops[0]!.vx, s.drops[0]!.vy);
  step(s, none);
  expect(Math.hypot(s.drops[0]!.vx, s.drops[0]!.vy)).toBeGreaterThan(v0);
  for (let i = 0; i < R.SLICK_LIFE; i++) step(s, none);
  expect(s.slicks.length).toBe(0);
});

test("drops stay in the pan and the count is capped", () => {
  const s = newState(3);
  for (let i = 0; i < 1800; i++) {
    step(s, none);
    for (const d of s.drops) expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(R.WALL_R + 1e-9);
    expect(s.drops.length).toBeLessThanOrEqual(R.MAX_DROPS);
  }
  const kinds = new Set(s.drops.map((d) => d.kind));
  expect(kinds.size).toBeGreaterThan(1);
});

test("round clock: overflow once, end once, then the sim is inert", () => {
  const s = newState(5, 30);
  let overflow = 0, end = 0;
  for (let i = 0; i < s.roundTicks + 20; i++) for (const e of step(s, none)) { if (e.t === "overflow") overflow++; if (e.t === "end") end++; }
  expect(overflow).toBe(1);
  expect(end).toBe(1);
  expect(s.over).toBe(true);
  const h = hashState(s);
  step(s, none);
  expect(hashState(s)).toBe(h);
});

test("spawning ramps up and overflow spawns more", () => {
  const count = (from: number, to: number) => {
    const s = newState(11, 60); s.tick = from; let n = 0;
    while (s.tick < to) for (const e of step(s, none)) if (e.t === "spawn") n++;
    return n;
  };
  const early = count(0, 300), late = count(900, 1200), over = count(1500, 1800);
  expect(late).toBeGreaterThan(early);
  expect(over).toBeGreaterThan(late);
});

test("sim purity: no DOM, console, clocks, Math.random, or imports from outside src/sim", () => {
  const dir = join(import.meta.dir, "../src/sim");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code, f).not.toMatch(/Math\.random|Date\.now|performance\.now|\bconsole\.|\bdocument\b|\bwindow\b|\bsetTimeout\b/);
    for (const m of code.matchAll(/from\s+"([^"]+)"/g)) expect(m[1]!, f).toMatch(/^\.\//);
    expect(src.split("\n").length, f).toBeLessThan(400);
  }
});
