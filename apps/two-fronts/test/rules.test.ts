import { expect, test } from "bun:test";
import type { BattleSpec } from "../src/battle/contract.ts";
import { GALAXIES, type Galaxy, type GalaxyId } from "../src/war/galaxy.ts";
import { aiOrders } from "../src/war/ai.ts";
import {
  ORBIT, applyBattleResult, applySpaceResult, canPushFromSurface, diceBattle, income, keyShare, newCampaign, planOrders, resolveTurn, rng, supplied, vehiclePool,
  type Campaign, type Orders,
} from "../src/war/rules.ts";

const kessa = (c: Campaign) => c.systems.kessa!;
const reachable = (g: Galaxy, from: string) => {
  const seen = new Set([from]), todo = [from];
  while (todo.length) for (const n of g.neighbours(todo.pop()!)) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  return seen;
};
const none = (c: Campaign): Orders[] => [{ faction: "marines", orders: [] }, { faction: "wooka", orders: [] }];

test("the short galaxy: 8 systems, joined up, Kessa in three sectors, a cannon each side of the Narrows", () => {
  const g = GALAXIES.short;
  expect(g.systems).toHaveLength(8);
  expect(reachable(g, "aster").size).toBe(8);
  expect(g.system("kessa").sectors).toEqual(["shield", "spaceport", "capital"]);
  expect(g.systems.filter((s) => s.sectors.includes("cannon")).map((s) => s.id)).toEqual(["lumen", "morrow"]);
});

test("the full galaxy: 30 systems in 7 regions, joined up, the same for both sides", () => {
  const g = GALAXIES.full;
  expect(g.systems).toHaveLength(30);
  expect(g.regions).toHaveLength(7);
  expect(reachable(g, "aster").size).toBe(30);
  for (const s of g.systems) {
    expect(g.regions.some((r) => r.id === s.region)).toBe(true);
    expect(g.start[s.id]).toBeDefined();
  }
  expect(g.systems.filter((s) => s.sectors.length > 1).length).toBeGreaterThanOrEqual(8);
  const has = (k: string) => g.systems.filter((s) => s.sectors.includes(k as never)).map((s) => s.id).sort();
  expect(has("canyon")).toEqual(["tarn", "umber"]);
  expect(has("jungle")).toEqual(["rook", "xan"]);
  // Turn the map half a turn around its centre and every world, lane and army lands on its twin.
  const at = new Map(g.systems.map((s) => [`${s.x},${s.y}`, s]));
  const twin = (id: string) => {
    const s = g.system(id), t = at.get(`${g.width - s.x},${98 - s.y}`);
    if (!t) throw new Error(`${id} has no twin`);
    return t;
  };
  for (const s of g.systems) {
    const t = twin(s.id), a = g.start[s.id]!, b = g.start[t.id]!;
    expect(t.sectors).toEqual(s.sectors);
    expect({ ...b, owner: a.owner }).toEqual(a);
    expect(b.owner).not.toBe(a.owner);
  }
  for (const [a, b] of g.lanes) expect(g.adjacent(twin(a).id, twin(b).id)).toBe(true);
  const c = newCampaign(1, "marines", "full");
  expect(keyShare(c, "marines")).toBe(0.5);
  expect(income(c, "marines")).toBe(income(c, "wooka"));
});

test("income counts sectors and the region bonus, and halves when morale breaks", () => {
  const c = newCampaign();
  // Thunder Marines: four capitals (12), Lumen's cannon (1) and the whole Thunder Reach (2).
  expect(income(c, "marines")).toBe(15);
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (s.id !== "aster") x.owner = "wooka";
  expect(keyShare(c, "marines")).toBeLessThan(0.3);
  expect(income(c, "marines")).toBe(1); // 3 halved, rounded down
});

test("orders are checked against what the earlier ones left", () => {
  const c = newCampaign();
  const d = planOrders(c, [{ faction: "marines", orders: [
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 0 } },
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 0 } },
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 0 } }, // out of credits
    { kind: "fleet", from: "corva", to: "kessa", count: 5 },
    { kind: "fleet", from: "aster", to: "kessa", count: 1 },                 // no lane
    { kind: "build", unit: "army", at: { system: "kessa", sector: 0 } },   // not ours
  ] }]);
  expect(d.errors).toEqual([null, null, "Not enough credits", null, "No hyperlane between them", "You don't hold that sector"]);
});

test("ships come from a spaceport, and a blockade stops building", () => {
  const c = newCampaign();
  const k = kessa(c);
  const build = (unit: "fleet" | "army", sector: number) => planOrders(c, [{ faction: "wooka", orders: [{ kind: "build", unit, at: { system: "kessa", sector } }] }]).errors[0];
  expect(build("fleet", 2)).toBe("Ships are built at a spaceport");
  expect(build("fleet", 1)).toBeNull();
  expect(build("army", 2)).toBeNull();
  k.orbit = "marines";
  expect(build("army", 2)).toBe("Blockaded: the enemy holds the orbit");
});

test("dice battles end with one side gone, and air cover helps", () => {
  const r = rng(7);
  let withCover = 0, without = 0;
  for (let i = 0; i < 400; i++) {
    const [a, d] = diceBattle(5, 5, r);
    expect(a === 0 || d === 0).toBe(true);
    if (a) without++;
    if (diceBattle(5, 5, r, { att: true })[0]) withCover++;
  }
  expect(withCover).toBeGreaterThan(without);
});

test("troops land only under their own orbit", () => {
  const c = newCampaign();
  const lands = resolveTurn(c, [{ faction: "marines", orders: [
    { kind: "fleet", from: "lumen", to: "kessa", count: 1 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  // One ship against two: the landing almost always turns back.
  if (lands.systems.kessa!.orbit !== "marines") {
    expect(lands.systems.corva!.sectors[0]!.armies.marines).toBe(3);
    expect(lands.log.some((l) => l.includes("turned back"))).toBe(true);
  }
  const won = newCampaign();
  won.systems.kessa!.fleets.wooka = 0;
  won.systems.kessa!.orbit = null;
  const t = resolveTurn(won, [{ faction: "marines", orders: [
    { kind: "fleet", from: "corva", to: "kessa", count: 3 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  expect(t.systems.kessa!.orbit).toBe("marines");
  expect(t.systems.corva!.sectors[0]!.armies.marines).toBe(1);
  expect(t.log.some((l) => l.startsWith("Ground battle at Kessa shield generator"))).toBe(true);
});

test("the shield generator holds off bombardment", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.fleets = { marines: 4, wooka: 0 };
  k.orbit = "marines";
  const shielded = resolveTurn(c, none(c));
  expect(shielded.systems.kessa!.sectors.map((x) => x.armies.wooka)).toEqual([1, 1, 1]);
  k.sectors[0]!.owner = "marines";
  k.sectors[0]!.armies = { marines: 1, wooka: 0 };
  const open = resolveTurn(c, none(c));
  expect(open.systems.kessa!.sectors.map((x) => x.armies.wooka)).toEqual([0, 0, 0]);
  expect(open.systems.kessa!.sectors[0]!.owner).toBe("marines");
});

test("a third of a planet without the orbit can't push out from the surface", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.sectors[0]!.owner = "marines";
  k.sectors[0]!.armies = { marines: 5, wooka: 0 };
  expect(canPushFromSurface(k, "marines")).toBe(false);
  const push = { kind: "army" as const, from: { system: "kessa", sector: 0 }, to: { system: "kessa", sector: 1 }, count: 4 };
  expect(planOrders(c, [{ faction: "marines", orders: [push] }]).errors[0]).toBe("Cut off: take the orbit or more of the planet first");
  k.orbit = "marines";
  expect(planOrders(c, [{ faction: "marines", orders: [push] }]).errors[0]).toBeNull();
});

test("the hero battle pauses the turn on a BattleSpec and the result writes back", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.fleets = { marines: 3, wooka: 0 };
  k.orbit = "marines";
  const at = { system: "kessa", sector: 0 };
  const paused = resolveTurn(c, [{ faction: "marines", hero: at, orders: [
    { kind: "army", from: { system: "corva", sector: 0 }, to: at, count: 2 },
  ] }]);
  expect(paused.pending?.kind).toBe("ground");
  const spec = paused.pending!.spec as BattleSpec;
  expect(paused.turn).toBe(1);
  expect(spec).toMatchObject({ sector: "shield", hero: "attacker", factions: { attacker: "marines", defender: "wooka" }, armies: { attacker: 2, defender: 1 }, tickets: { attacker: 100, defender: 50 } });
  // Orbit means strikes and drop pods; the defender's shield cuts the strikes to one.
  expect(spec.strikes).toEqual({ attacker: 1, defender: 0 });
  expect(spec.reinforcements).toEqual({ attacker: 24, defender: 0 });
  expect(spec.vehicles).toEqual({ attacker: { tank: 1 }, defender: {} });
  expect(resolveTurn(paused, none(paused))).toBe(paused); // nothing moves until it's fought

  expect(() => applyBattleResult(paused, { id: "nope", winner: "attacker", tickets: { attacker: 1, defender: 0 }, heroDown: false })).toThrow();
  const after = applyBattleResult(paused, { id: spec.id, winner: "attacker", tickets: { attacker: 70, defender: 0 }, heroDown: false });
  expect(after.turn).toBe(2);
  expect(after.pending).toBeNull();
  expect(after.systems.kessa!.sectors[0]).toMatchObject({ owner: "marines", armies: { marines: 1, wooka: 0 } });
  expect(after.heroes.marines.xp).toBe(2);
  // With the shield gone, the orbit bombards the rest of Kessa.
  expect(after.systems.kessa!.sectors[1]!.armies.wooka).toBe(0);

  const lost = applyBattleResult(paused, { id: spec.id, winner: "defender", tickets: { attacker: 0, defender: 10 }, heroDown: true });
  expect(lost.systems.kessa!.sectors[0]!.owner).toBe("wooka");
  expect(lost.heroes.marines.woundedUntil).toBe(4);
  const wounded = resolveTurn(lost, [{ faction: "marines", hero: { system: "kessa", sector: 1 }, orders: [] }]);
  expect(wounded.pending).toBeNull();
});

test("the hero can fly the space battle instead: the landings wait on who wins the orbit", () => {
  const c = newCampaign();
  c.systems.corva!.fleets.marines = 3;
  c.systems.corva!.sectors[0]!.armies.marines = 3;
  const k = kessa(c);
  k.fleets = { marines: 0, wooka: 2 };
  k.orbit = "wooka";
  const at = { system: "kessa", sector: 0 };
  const orders: Orders[] = [{ faction: "marines", hero: { system: "kessa", sector: ORBIT }, orders: [
    { kind: "fleet", from: "corva", to: "kessa", count: 3 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: at, count: 2 },
  ] }];
  const paused = resolveTurn(c, orders);
  expect(paused.pending?.kind).toBe("space");
  const spec = paused.pending!.spec;
  expect(spec).toMatchObject({ id: "1-kessa-orbit", system: "Kessa", hero: "attacker", factions: { attacker: "marines", defender: "wooka" }, fleets: { attacker: 3, defender: 2 } });
  expect(paused.systems.kessa!.sectors[0]!.armies.marines).toBe(0); // still in the transports
  expect(resolveTurn(paused, none(paused))).toBe(paused);
  expect(() => applyBattleResult(paused, { id: spec.id, winner: "attacker", tickets: { attacker: 1, defender: 0 }, heroDown: false })).toThrow();

  // Win the orbit: the cruisers fit to fly keep it, and the troops land under it.
  const won = applySpaceResult(paused, { id: spec.id, winner: "attacker", fleets: { attacker: 2, defender: 1 }, heroDown: false });
  expect(won.turn).toBe(2);
  expect(won.pending).toBeNull();
  expect(won.systems.kessa!).toMatchObject({ orbit: "marines", fleets: { marines: 2, wooka: 0 } });
  expect(won.log.some((l) => l.startsWith("Hero space battle over Kessa: Thunder Marines holds the orbit with 2 ships left."))).toBe(true);
  expect(won.log.some((l) => l.startsWith("Ground battle at Kessa shield generator"))).toBe(true);
  expect(won.heroes.marines.xp).toBe(2);

  // Lose it: the troops turn back, and the hero, shot down, sits out three turns.
  const lost = applySpaceResult(paused, { id: spec.id, winner: "defender", fleets: { attacker: 0, defender: 0 }, heroDown: true });
  expect(lost.systems.kessa!).toMatchObject({ orbit: "wooka", fleets: { marines: 0, wooka: 1 } });
  expect(lost.log).toContain("Thunder Marines troops for Kessa shield generator turned back: no orbit there.");
  expect(lost.systems.corva!.sectors[0]!.armies.marines).toBe(3);
  expect(lost.heroes.marines.woundedUntil).toBe(4);
});

test("an anti-ship cannon knocks a ship a turn out of a blockade, and can break it", () => {
  const c = newCampaign();
  const lumen = c.systems.lumen!;
  lumen.fleets = { marines: 0, wooka: 2 };
  lumen.orbit = "wooka";
  const one = resolveTurn(c, none(c));
  expect(one.systems.lumen!.fleets.wooka).toBe(1);
  expect(one.systems.lumen!.orbit).toBe("wooka");
  expect(one.log).toContain("The cannon on Lumen knocks out 1 Wooka ship.");
  const two = resolveTurn(one, none(one));
  expect(two.systems.lumen!.fleets.wooka).toBe(0);
  expect(two.systems.lumen!.orbit).toBeNull();
  expect(two.log).toContain("Wooka's blockade of Lumen is broken.");
  // Taken by the enemy, the cannon turns on its old owner's fleet.
  const lost = newCampaign();
  lost.systems.lumen!.sectors[0]!.owner = "wooka";
  lost.systems.lumen!.sectors[0]!.armies = { marines: 0, wooka: 1 };
  expect(resolveTurn(lost, none(lost)).systems.lumen!.fleets.marines).toBe(0);
});

test("forces cut off from a capital lose an army a turn, down to one", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.sectors[0]!.owner = "marines";
  k.sectors[0]!.armies = { marines: 4, wooka: 0 };
  // Wooka's own orbit over Kessa cuts Thunder Marines's foothold off from Corva and Lumen.
  expect(supplied(c, "marines").has("kessa")).toBe(false);
  expect(supplied(c, "wooka").has("kessa")).toBe(true);
  let t = resolveTurn(c, none(c));
  expect(t.systems.kessa!.sectors[0]!.armies.marines).toBe(3);
  expect(t.log.some((l) => l.includes("cut off from supply"))).toBe(true);
  for (let i = 0; i < 4; i++) t = resolveTurn(t, none(t));
  expect(t.systems.kessa!.sectors[0]!.armies.marines).toBe(1);
  // Clear the orbit and the line runs again.
  const open = structuredClone(c);
  open.systems.kessa!.fleets.wooka = 0;
  open.systems.kessa!.orbit = null;
  expect(supplied(open, "marines").has("kessa")).toBe(true);
  expect(resolveTurn(open, none(open)).systems.kessa!.sectors[0]!.armies.marines).toBe(4);
  // A blockade further back cuts off everything past it: no Thunder Marines capital, no supply.
  const deep = newCampaign();
  for (const id of ["aster", "brill", "corva"]) deep.systems[id]!.sectors[0]!.owner = "wooka";
  deep.systems.corva!.orbit = "wooka";
  expect([...supplied(deep, "marines")].sort()).toEqual(["lumen"]);
});

test("the AI's orders are all legal, and a whole war is deterministic", () => {
  const play = (seed: number) => {
    let c = newCampaign(seed);
    for (let i = 0; i < 40 && !c.winner; i++) {
      const orders = [aiOrders(c, "marines"), aiOrders(c, "wooka")];
      expect(planOrders(c, orders).errors.every((e) => e === null)).toBe(true);
      c = resolveTurn(c, orders);
    }
    return c;
  };
  const a = play(3), b = play(3);
  expect(a).toEqual(b);
  expect(a.turn).toBeGreaterThan(5);
});

// Pacing, AI against AI: every war ends, a full one runs longer than a short one, and the AI
// spends the bigger galaxy's income rather than banking it. These seeds' wars run 5-17 turns on
// the short map and 10-36 on the full one.
test("a full campaign runs longer than the short war, still ends, and the AI spends its income", () => {
  const war = (galaxy: GalaxyId, seed: number) => {
    let c = newCampaign(seed, "marines", galaxy);
    while (!c.winner && c.turn < 100) {
      c = resolveTurn(c, [aiOrders(c, "marines"), aiOrders(c, "wooka")]);
      if (galaxy === "full" && c.turn === 6) for (const f of ["marines", "wooka"] as const) expect(c.credits[f]).toBeLessThan(2 * income(c, f) + 10);
    }
    expect(c.winner).not.toBeNull();
    return c.turn;
  };
  const median = (galaxy: GalaxyId) => Array.from({ length: 10 }, (_, i) => war(galaxy, i + 1)).sort((a, b) => a - b)[5]!;
  expect(median("full")).toBeGreaterThan(median("short"));
}, 30_000);

test("the vehicle pool comes from the map: gunships from the orbit, walkers from the capital", () => {
  const k = kessa(newCampaign(1));
  k.orbit = "marines";
  for (const x of k.sectors) x.owner = x.kind === "capital" ? "marines" : "wooka";
  expect(vehiclePool(k, "marines", 6)).toEqual({ tank: 1, gunship: 1, walker: 1 });
  expect(vehiclePool(k, "wooka", 6)).toEqual({ tank: 2, speeder: 1 });
  expect(vehiclePool(k, "marines", 1)).toEqual({});
});
