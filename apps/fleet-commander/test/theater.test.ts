// The theater as a commander meets it: a dark board where rifts and the star's heat hide the Compact, scouts and the
// sensor ship that see into them, an ambush you can't answer until it fires, wells that hurry a hull along, mines,
// and strongpoints that pay for new wings. Seeded, so every run is the same system.
import { expect, setDefaultTimeout, test } from "bun:test";
import { BUY, requisition, sensors, theater, theaterBrains } from "../src/sim/theater.ts";
import { alive, step, type Ship, type World } from "../src/sim/world.ts";

setDefaultTimeout(60_000);

const run = (w: World, seconds: number) => { for (let i = 0; i < seconds * 10 && !w.outcome; i++) step(w, theaterBrains); };
const named = (w: World, name: string) => w.ships.find((s) => s.name === name)!;
const navy = (w: World) => w.ships.filter((s) => s.side === "navy");
/** Park every navy hull and wing in the far corner, out of everyone's sight. */
const parkAll = (w: World) => {
  for (const s of navy(w)) { s.x = -7900; s.z = -4900; s.order = { k: "hold" }; }
  for (const g of w.wings) if (g.side === "navy") { g.x = -7900; g.z = -4900; }
};
const place = (s: { x: number; z: number }, at: Ship, d: number) => { s.x = at.x - d; s.z = at.z; };

test("who sees into the dark: open space, a rift, the star's heat shear", () => {
  // Tidewall waits in a rift, the Ember Tithe in the shear round the star, the Gannet in open space at Kesh.
  const cases: [string, (w: World, at: Ship) => void, [boolean, boolean, boolean]][] = [
    ["a destroyer at 1200", (w, at) => place(named(w, "Vigil"), at, 1200), [true, false, false]],
    ["the scouts at 1200", (w, at) => { const g = w.wings.find((g) => g.side === "navy" && g.role === "scout")!; place(g, at, 1200); }, [true, true, false]],
    ["the sensor ship at 1200", (w, at) => place(named(w, "Argus"), at, 1200), [true, true, true]],
    ["a destroyer point blank", (w, at) => place(named(w, "Vigil"), at, 250), [true, true, true]],
    ["a destroyer with thermal sensors", (w, at) => { w.field!.tier.navy = 1; place(named(w, "Vigil"), at, 1200); }, [true, true, false]],
    ["a destroyer, the target just fired", (w, at) => { at.loudUntil = w.t + 4; place(named(w, "Vigil"), at, 1200); }, [true, true, true]],
  ];
  for (const [who, put, want] of cases) {
    const got = ["Gannet", "Tidewall", "Ember Tithe"].map((name) => {
      const w = theater(1);
      run(w, 10); // the wings are out
      parkAll(w);
      const target = named(w, name);
      put(w, target);
      sensors(w);
      return w.field!.sees.navy.has(target.id);
    });
    expect([who, got]).toEqual([who, want]);
  }
});

test("an ambush from a rift: it watches you unseen, comes out to fight, and the sensor ship sees it before it moves", () => {
  const w = theater(2);
  run(w, 10);
  parkAll(w);
  const vigil = named(w, "Vigil");
  const ambushers = w.ships.filter((s) => s.side === "rim" && s.post && Math.hypot(s.post.x + 1200, s.post.z + 3200) < 900);
  // The Vigil sits on the Corona Relay, in reach of the rift's ambushers but blind to them; they see it.
  vigil.x = -300; vigil.z = -1700;
  run(w, 2);
  expect(ambushers.some((s) => w.field!.sees.navy.has(s.id))).toBe(false);
  expect(w.field!.sees.rim.has(vigil.id)).toBe(true);
  // They leave the rift to close on it, and show as they come; then they open fire.
  let seenAt = -1, hitAt = -1;
  for (let i = 0; i < 1200 && hitAt < 0; i++) {
    step(w, theaterBrains);
    if (seenAt < 0 && ambushers.some((s) => w.field!.sees.navy.has(s.id))) seenAt = w.t;
    if (vigil.shield < vigil.shieldMax) hitAt = w.t;
  }
  expect(seenAt).toBeGreaterThan(12);
  expect(hitAt).toBeGreaterThan(0);

  // The same ambush with the sensor ship along: the rift is open to it before a shot is fired.
  const v = theater(2);
  run(v, 10);
  parkAll(v);
  const argus = named(v, "Argus");
  argus.x = -300; argus.z = -1900;
  sensors(v);
  expect(v.field!.sees.navy.has(named(v, "Tidewall").id)).toBe(true);
});

test("a hull falls along a gravity well: the same distance across the star's well takes less time than in open space", () => {
  const time = (from: [number, number], to: [number, number]) => {
    const w = theater(3);
    parkAll(w);
    const s = named(w, "Vigil");
    s.x = from[0]; s.z = from[1]; s.a = 0; s.v = 16;
    s.order = { k: "move", x: to[0], z: to[1] };
    let t = 0;
    for (; t < 600 && Math.hypot(s.x - to[0], s.z - to[1]) > 60; t += 0.1) step(w, theaterBrains);
    return t;
  };
  const open = time([-7000, -4000], [-5000, -4000]);
  const well = time([-1000, 2000], [1000, 2000]);
  expect(well).toBeLessThan(open * 0.85);
});

test("a mine breaks on a hull; point defence clears the mines it can see", () => {
  const w = theater(4);
  parkAll(w);
  const mine = w.field!.mines[0];
  const s = named(w, "Vigil");
  s.x = mine.x - 80; s.z = mine.z;
  const before = s.hull + s.shield;
  run(w, 0.2);
  expect(s.hull + s.shield).toBeLessThan(before - 300);
  expect(w.field!.mines.some((m) => m.id === mine.id)).toBe(false);

  // A hull parked outside a mine's trigger, where it can see it: the point defence picks it off. (One of the mines
  // across the relay's approach, out of every Compact gun's reach.)
  const v = theater(4);
  parkAll(v);
  const m2 = v.field!.mines.find((m) => m.z > -1400 && m.z < -1000)!, sv = named(v, "Vigil");
  sv.x = m2.x - 210; sv.z = m2.z;
  run(v, 30);
  expect(v.field!.mines.some((m) => m.id === m2.id)).toBe(false);
  expect(sv.hull).toBe(sv.hullMax);
});

test("hold a strongpoint and it pays: supply buys a wing, and the new wing launches", () => {
  const w = theater(5);
  run(w, 10);
  const vigil = named(w, "Vigil");
  const ostra = w.field!.points.find((p) => p.name === "Ostra Station")!;
  vigil.order = { k: "move", x: ostra.x, z: ostra.z };
  vigil.x = ostra.x - 200; vigil.z = ostra.z;
  expect(requisition(w, "navy", "bomber")).toContain("Needs");
  run(w, 30);
  expect(ostra.owner).toBe("navy");
  run(w, 10);
  expect(w.field!.supply.navy).toBeGreaterThanOrEqual(BUY.bomber);
  const wings = w.wings.filter((g) => g.side === "navy").length;
  expect(requisition(w, "navy", "bomber")).toBe("");
  run(w, 6);
  const fresh = w.wings.filter((g) => g.side === "navy");
  expect(fresh.length).toBe(wings + 1);
  expect(alive(fresh[fresh.length - 1]).length).toBeGreaterThan(0);
});
