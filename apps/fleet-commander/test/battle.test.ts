// A battle as a commander fights it: plays called on a marked ship, the interdictor on the lane, the flagship
// trading broadsides and then raking the world. Seeded, so every run of a test is the same battle.
import { expect, setDefaultTimeout, test } from "bun:test";
import { autoCommander, brains } from "../src/sim/ai.ts";
import { runFleetPlay, runPlay, wingsOf } from "../src/sim/plays.ts";
import { armada, battle } from "../src/sim/scenarios.ts";
import { alive, flagship, step, type World } from "../src/sim/world.ts";

setDefaultTimeout(60_000);

const run = (w: World, seconds: number, each?: (w: World) => void) => { for (let i = 0; i < seconds * 10 && !w.outcome; i++) { each?.(w); step(w, brains); } };
const rim = (w: World, kind: string) => w.ships.find((s) => s.side === "rim" && s.kind === kind && !s.dead)!;

test("commanded, the fleet burns the base; left alone, the flagship dies", () => {
  for (const temper of ["zealot", "pragmatist", "cagey"] as const) {
    const led = battle({ seed: 4, kind: "assault", strength: 2, temper });
    run(led, 600, (w) => autoCommander(w));
    expect([temper, led.outcome]).toEqual([temper, "win"]);
    expect(led.planet.base <= 0 || !led.ships.some((s) => s.side === "rim" && !s.dead)).toBe(true);

    const idle = battle({ seed: 4, kind: "assault", strength: 2, temper });
    run(idle, 600);
    expect([temper, idle.outcome]).toEqual([temper, "loss"]);
  }
});

test("a pincer holds both arms at the flanks, then both run in together and split the shields", () => {
  const w = battle({ seed: 2, kind: "assault", strength: 2 });
  run(w, 8);
  const carrier = rim(w, "carrier");
  const fl = flagship(w)!;
  runPlay(w, "pincer", wingsOf(w, fl.id), carrier.id);
  const bombers = wingsOf(w, fl.id).filter((g) => g.role === "bomber");
  expect(bombers.map((g) => g.approach).sort()).toEqual(["left", "right"]);
  // Until the group is released, no bomber has loosed a torpedo.
  let released = -1;
  run(w, 40, () => {
    if (released < 0 && bombers.every((g) => !g.waypoint)) released = w.t;
    if (released < 0) expect(bombers.every((g) => alive(g).every((c) => c.torps === 2))).toBe(true);
  });
  expect(released).toBeGreaterThan(0);
  expect(w.stats.splits).toBeGreaterThan(0);
});

test("the interdictor on the lane drags reinforcements onto itself, shields down; without it they land behind you", () => {
  const held = battle({ seed: 3, kind: "assault", strength: 2 });
  held.ships.find((s) => s.kind === "frigate")!.order = { k: "lane" };
  run(held, 81);
  const caught = held.ships.filter((s) => s.side === "rim" && s.stunUntil > 0);
  expect(caught.length).toBe(2);
  for (const s of caught) { expect(Math.hypot(s.x - held.lane.x, s.z - held.lane.z)).toBeLessThan(400); expect(s.shield).toBeLessThan(s.shieldMax * 0.2); }

  const open = battle({ seed: 3, kind: "assault", strength: 2 });
  run(open, 79);
  const before = new Set(open.ships.map((s) => s.id));
  run(open, 2);
  const fl = flagship(open)!;
  const dropped = open.ships.filter((s) => !before.has(s.id));
  expect(dropped.length).toBe(2);
  expect(dropped.length).toBeGreaterThan(0);
  for (const s of dropped) expect(s.stunUntil).toBe(0);
  // Behind the flagship: on the far side from where it points.
  for (const s of dropped) expect(Math.cos(fl.a) * (s.x - fl.x) + Math.sin(fl.a) * (s.z - fl.z)).toBeLessThan(0);
});

test("rake the world and the Rim's temper answers: a zealot shields the land, a pragmatist broadsides your flagship", () => {
  const answer = (temper: "zealot" | "pragmatist") => {
    const w = battle({ seed: 5, kind: "assault", strength: 2, temper });
    run(w, 5);
    flagship(w)!.order = { k: "rake" };
    run(w, 6);
    return { doctrine: w.rimDoctrine, orders: w.ships.filter((s) => s.side === "rim" && s.kind !== "station" && !s.dead).map((s) => s.order.k) };
  };
  const z = answer("zealot"), p = answer("pragmatist");
  expect(z.doctrine).toBe("shield");
  expect(z.orders.every((k) => k === "guard")).toBe(true);
  expect(p.doctrine).toBe("press");
  expect(p.orders.every((k) => k === "engage")).toBe(true);
});

test("the Armada: your captains run their own wings, and a fleet pincer sends destroyers round both flanks", () => {
  const w = armada(1);
  run(w, 20);
  const destroyers = w.ships.filter((s) => s.side === "navy" && s.kind === "destroyer");
  expect(destroyers.length).toBe(3);
  // Each captain has called a play for its wings on its own.
  for (const d of destroyers) expect(wingsOf(w, d.id).some((g) => g.order.k === "attack" || g.waypoint)).toBe(true);
  const target = rim(w, "cruiser");
  runFleetPlay(w, "pincer", destroyers, target.id);
  expect(destroyers.map((d) => d.order.k)).toEqual(["flank", "flank", "flank"]);
  const sides = destroyers.map((d) => (d.order.k === "flank" ? Math.sign((d.order.wz - target.z) * Math.cos(target.a) - (d.order.wx - target.x) * Math.sin(target.a)) : 0));
  expect(new Set(sides).size).toBe(2);
});
