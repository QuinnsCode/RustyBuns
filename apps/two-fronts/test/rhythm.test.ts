// The fight's rhythm through whole battles: surges, dig-ins, and the fall-back when a post is overrun.
import { expect, setDefaultTimeout, test } from "bun:test";
import { NO_PODS, type BattleSpec, type MatchMode } from "../src/battle/contract.ts";
import { DT, PANIC, POST_RADIUS, startBattle, step, type Battle } from "../src/battle/sim.ts";

setDefaultTimeout(30_000);

// The Marines hold, as the hero's side; the Wooka come at them in surges.
const spec = (mode: MatchMode, over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "wooka", defender: "marines" }, hero: "defender", heroLevel: 1,
  armies: { attacker: 4, defender: 2 }, tickets: { attacker: 75, defender: 75 },
  vehicles: { attacker: {}, defender: {} }, strikes: { attacker: 0, defender: 1 },
  reinforcements: { attacker: NO_PODS, defender: NO_PODS }, turrets: 2, seed: 7, mode, ...over,
});
const mine = (b: Battle) => b.units.filter((u) => u.side === b.spec.hero && u.kind !== "turret");

// Plays on till the radio calls a fall-back (or the clock says it won't).
function untilFall(mode: MatchMode, seed: number) {
  const b = startBattle(spec(mode, { seed }));
  while (!b.over && !b.beat.fall && b.time < 240) step(b, null);
  return b;
}

test("a surge overruns a post, the radio calls a fall-back, and getting out in time costs far fewer tickets than dying in place", () => {
  const a = untilFall("holdout", 7), left = untilFall("holdout", 7);
  // The same battle up to the call: a surge came out of the treeline, and a post fell under it.
  expect(a.beat.surge).toBeGreaterThanOrEqual(1);
  expect(a.beat.fall).not.toBeNull();
  step(a, null); step(left, null); // the radio gets the call out
  expect(a.events.some((e) => e.startsWith("Surge 1"))).toBe(true);
  expect(a.events.some((e) => e.includes("FALL BACK"))).toBe(true);
  expect(left.beat.fall).toEqual(a.beat.fall);
  const fall = a.beat.fall!, post = a.posts[fall.from]!;
  const before = a.tickets.defender;

  // The squad is on the post when the call goes out, wherever the fields put them.
  for (const b of [a, left]) b.beat.fall!.ids = mine(b).map((u) => u.id);
  // One squad runs for it; the other dies where it stands.
  for (const u of mine(a)) { u.x = fall.x + (u.id % 5) - 2; u.z = fall.z + (u.id % 3) - 1; }
  for (const u of mine(left)) { u.x = post.x; u.z = post.z; u.hp = 0; } // they die where they stand
  while (!a.over && a.beat.fall && a.time < 300) step(a, null);
  // The horde stays on the post it took, as it did when the posts were close together.
  while (!left.over && left.beat.fall && left.time < 300) {
    left.units.filter((u) => u.side !== left.spec.hero && u.kind !== "turret" && u.hp > 0).slice(0, 8).forEach((u, i) => { u.x = post.x + (i % 4) - 2; u.z = post.z + (i >> 2); });
    step(left, null);
  }

  expect(a.beat.out).toBe(1);
  expect(a.beat.lost).toBe(0);
  expect(left.beat.lost).toBe(1);
  expect(left.beat.out).toBe(0);
  // Heavily, in a hold-out, for the one left behind.
  expect(left.beat.cost).toBeGreaterThanOrEqual(a.beat.cost * 3);
  expect(a.events.some((e) => e.startsWith("Out in time"))).toBe(true);
  expect(left.events.some((e) => e.startsWith("Left behind"))).toBe(true);
  expect(a.tickets.defender).toBeLessThan(before);
  void DT; void POST_RADIUS;
});

test("between surges the radio calls a dig-in, and holding the post pays out a drop, then a strike", () => {
  const b = startBattle(spec("conquest", { factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", tickets: { attacker: 400, defender: 400 }, turrets: 0, armies: { attacker: 3, defender: 1 } }));
  // The Marines have taken a post and sit on it, and nothing comes at them: no pressure, only the countdown.
  b.posts[0]!.owner = "attacker"; b.posts[0]!.progress = 1;
  b.beat.arty = { attacker: 1e9, defender: 1e9 };
  b.beat.nextPass = 1e9;
  const strikes = b.strikesLeft.attacker;
  let drops = 0, last = b.tickets.attacker;
  for (let i = 0; i < 160 / DT && b.beat.digs < 2 && !b.over; i++) {
    for (const u of b.units) if (u.side === "defender") u.hp = 0; // keep it calm; the point is the hold
    const hold = b.posts[b.beat.dig?.post ?? 0]!;
    b.posts[0]!.owner = "attacker";
    for (const u of mine(b)) { u.x = hold.x + (u.id % 4); u.z = hold.z + (u.id % 3); }
    step(b, null);
    if (b.tickets.attacker > last + 4) drops++;
    last = b.tickets.attacker;
  }
  expect(b.beat.digs).toBe(2);
  expect(drops).toBeGreaterThanOrEqual(1);
  expect(b.strikesLeft.attacker).toBe(strikes + 1);
  expect(b.events.some((e) => e.startsWith("Dig in at"))).toBe(true);
  expect(b.events.some((e) => e.includes("held: a drop"))).toBe(true);
  expect(b.events.some((e) => e.includes("held: an orbital strike"))).toBe(true);
});

test("every mode has the rhythm: surges, guns and gunships, and the same battle twice is the same", () => {
  for (const mode of ["conquest", "assault", "hill", "holdout", "escort"] as MatchMode[]) {
    const run = () => {
      const b = startBattle(spec(mode));
      while (!b.over && b.time < 130) step(b, null);
      return b;
    };
    const a = run(), c = run();
    expect(a.beat.surge).toBeGreaterThanOrEqual(a.over ? 1 : 2); // a battle can end first
    expect(a.events.some((e) => e.startsWith("Surge"))).toBe(true);
    expect(a.events).toEqual(c.events);
    expect(a.tickets).toEqual(c.tickets);
    expect(a.units.map((u) => [u.id, Math.round(u.x * 100), Math.round(u.z * 100)])).toEqual(c.units.map((u) => [u.id, Math.round(u.x * 100), Math.round(u.z * 100)]));
  }
});

test("a Mossback walks out of the later surges, the radio panics over itself, and the surge costs the horde no tickets", () => {
  let found: Battle | null = null;
  for (let seed = 1; seed <= 12 && !found; seed++) {
    const b = startBattle(spec("holdout", { seed, tickets: { attacker: 400, defender: 400 } }));
    while (!b.over && b.time < 200 && !b.units.some((u) => u.role === "mossback")) step(b, null);
    if (b.units.some((u) => u.role === "mossback")) found = b;
  }
  expect(found).not.toBeNull();
  const b = found!;
  const m = b.units.find((u) => u.role === "mossback")!;
  expect(m.wild).toBe(true);
  expect(m.side).toBe("attacker");
  // The lines come one on top of the next.
  for (let i = 0; i < 2 / DT; i++) step(b, null);
  const at = b.events.map((e, i) => [e, b.eventAt[i]!] as const).filter(([e]) => PANIC.includes(e));
  expect(at.length).toBeGreaterThanOrEqual(2);
  expect(Math.abs(at[1]![1] - at[0]![1])).toBeLessThan(1);
  // Fell, it's no ticket for them: surge Wooka cost their side nothing.
  const t = b.tickets.attacker;
  m.hp = 0;
  step(b, null);
  expect(b.tickets.attacker).toBeGreaterThanOrEqual(t);
});
