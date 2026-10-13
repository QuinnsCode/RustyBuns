// The match modes the end-of-match vote picks from, each with its own way to win.
import { expect, test } from "bun:test";
import type { BattleSpec, MatchMode } from "../src/battle/contract.ts";
import { groundRecorder, replayGround } from "../src/battle/replay.ts";
import { DT, POST_RADIUS, SPAWN, championUnit, heroUnit, inPlay, startBattle, step, timeLimit } from "../src/battle/sim.ts";

const spec = (mode: MatchMode, over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 3 }, tickets: { attacker: 75, defender: 75 },
  vehicles: { attacker: { tank: 1 }, defender: {} }, strikes: { attacker: 1, defender: 0 },
  reinforcements: { attacker: 0, defender: 0 }, turrets: 2, seed: 42, mode, ...over,
});
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test("assault: one post live at a time; take it, hold it, and the next comes live", () => {
  const b = startBattle(spec("assault"));
  expect(b.posts.every((p) => p.owner === "defender")).toBe(true);
  expect(b.posts.map((_, i) => inPlay(b, i))).toEqual([true, false]);
  Object.assign(b.posts[0]!, { owner: "attacker", progress: 1 });
  step(b, null);
  expect(b.phase).toBeGreaterThan(39);
  expect(b.events).toContain("Hold Old stump for 40s");
  b.phase = DT / 2;
  step(b, null);
  expect(b.live).toBe(1);
  expect(b.posts.map((_, i) => inPlay(b, i))).toEqual([false, true]);
  // The keep falls, and so does the sector.
  Object.assign(b.posts[1]!, { owner: "attacker", progress: 1 });
  step(b, null);
  expect(b.over?.winner).toBe("attacker");
});

test("assault: lose the post while holding it and it's back to taking it; run the clock out and the defender held", () => {
  const b = startBattle(spec("assault"));
  Object.assign(b.posts[0]!, { owner: "attacker", progress: 1 });
  step(b, null);
  Object.assign(b.posts[0]!, { owner: "defender", progress: -1 });
  step(b, null);
  expect(b.phase).toBe(0);
  expect(b.live).toBe(0);
  b.time = timeLimit(b.spec);
  b.tickets = { attacker: 70, defender: 5 };
  step(b, null);
  expect(b.over?.winner).toBe("defender");
});

test("king of the hill: the first hill is as far from either spawn, and it moves on", () => {
  const b = startBattle(spec("hill"));
  const hill = b.posts[0]!;
  expect(Math.abs(dist(hill, SPAWN.attacker) - dist(hill, SPAWN.defender))).toBeLessThan(1);
  expect(b.posts.every((p) => p.owner === null)).toBe(true);
  expect(b.posts.map((_, i) => inPlay(b, i))).toEqual([true, false, false]);
  Object.assign(hill, { owner: "defender", progress: -1 });
  const before = b.tickets.attacker;
  for (let i = 0; i < 4 / DT; i++) step(b, null);
  expect(b.tickets.attacker).toBeLessThan(before);
  b.phase = DT / 2;
  step(b, null);
  expect(b.live).toBe(1);
  expect(hill).toMatchObject({ owner: null, progress: 0 });
});

test("hold-out: turrets on every post, five minutes on the clock, and the attacker has to take them all", () => {
  const b = startBattle(spec("holdout"));
  expect(timeLimit(b.spec)).toBe(300);
  expect(b.units.filter((u) => u.kind === "turret")).toHaveLength(2 * b.posts.length);
  expect(b.posts.every((p) => p.owner === "defender")).toBe(true);
  b.time = 300;
  b.tickets = { attacker: 70, defender: 5 };
  step(b, null);
  expect(b.over?.winner).toBe("defender");
  const c = startBattle(spec("holdout"));
  for (const p of c.posts) Object.assign(p, { owner: "attacker", progress: 1 });
  step(c, null);
  expect(c.over?.winner).toBe("attacker");
});

test("escort: the champion walks for the keep only with company; getting there wins, going down loses", () => {
  const b = startBattle(spec("escort"));
  const champ = championUnit(b)!;
  expect(champ).toMatchObject({ side: "attacker", kind: "champion" });
  expect(b.posts.some((_, i) => inPlay(b, i))).toBe(false);
  // Alone, it waits.
  b.units = b.units.filter((u) => u.side === "defender" || u === champ);
  b.spawnAt.attacker = 1e9;
  const at = { x: champ.x, z: champ.z };
  for (let i = 0; i < 30; i++) step(b, null);
  expect(dist(champ, at)).toBeLessThan(0.01);
  // With the hero alongside, it walks.
  const c = startBattle(spec("escort")), hero = heroUnit(c)!, ch = championUnit(c)!;
  Object.assign(hero, { x: ch.x + 2, z: ch.z });
  const keep = c.posts.at(-1)!, far = dist(ch, keep);
  for (let i = 0; i < 30; i++) step(c, null);
  expect(dist(ch, keep)).toBeLessThan(far);
  Object.assign(ch, { x: keep.x, z: keep.z + POST_RADIUS / 2 });
  step(c, null);
  expect(c.over?.winner).toBe("attacker");
  const d = startBattle(spec("escort"));
  championUnit(d)!.hp = 0;
  step(d, null);
  expect(d.over?.winner).toBe("defender");
});

test("every mode replays the same from the hero's inputs", () => {
  for (const mode of ["assault", "hill", "holdout", "escort"] as const) {
    const s = spec(mode), b = startBattle(s), rec = groundRecorder();
    for (let i = 0; !b.over; i++) step(b, i < 300 ? rec.take({ forward: 1, right: 0, yaw: 0, fire: true }) : null);
    expect(replayGround(s, rec.log())).toEqual(b.over!);
  }
});
