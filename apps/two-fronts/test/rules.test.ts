import { expect, test } from "bun:test";
import { LANES, SYSTEMS, neighbours } from "../src/war/galaxy.ts";
import { aiOrders } from "../src/war/ai.ts";
import {
  applyBattleResult, canPushFromSurface, diceBattle, income, keyShare, newCampaign, planOrders, resolveTurn, rng,
  type Campaign, type Orders,
} from "../src/war/rules.ts";

const kessa = (c: Campaign) => c.systems.kessa!;
const none = (c: Campaign): Orders[] => [{ faction: "concord", orders: [] }, { faction: "hegemony", orders: [] }];

test("the first slice's galaxy: 8 systems, joined up, Kessa in three sectors", () => {
  expect(SYSTEMS).toHaveLength(8);
  const seen = new Set(["aster"]), todo = ["aster"];
  while (todo.length) for (const n of neighbours(todo.pop()!)) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  expect(seen.size).toBe(8);
  for (const [a, b] of LANES) expect(SYSTEMS.some((s) => s.id === a) && SYSTEMS.some((s) => s.id === b)).toBe(true);
  expect(SYSTEMS.find((s) => s.id === "kessa")!.sectors).toEqual(["shield", "spaceport", "capital"]);
});

test("income counts sectors and the region bonus, and halves when morale breaks", () => {
  const c = newCampaign();
  // Concord: four capitals (12) plus the whole Concord Reach (2).
  expect(income(c, "concord")).toBe(14);
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (s.id !== "aster") x.owner = "hegemony";
  expect(keyShare(c, "concord")).toBeLessThan(0.3);
  expect(income(c, "concord")).toBe(1); // 3 halved, rounded down
});

test("orders are checked against what the earlier ones left", () => {
  const c = newCampaign();
  const d = planOrders(c, [{ faction: "concord", orders: [
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
  const build = (unit: "fleet" | "army", sector: number) => planOrders(c, [{ faction: "hegemony", orders: [{ kind: "build", unit, at: { system: "kessa", sector } }] }]).errors[0];
  expect(build("fleet", 2)).toBe("Ships are built at a spaceport");
  expect(build("fleet", 1)).toBeNull();
  expect(build("army", 2)).toBeNull();
  k.orbit = "concord";
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
  const lands = resolveTurn(c, [{ faction: "concord", orders: [
    { kind: "fleet", from: "lumen", to: "kessa", count: 1 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  // One ship against two: the landing almost always turns back.
  if (lands.systems.kessa!.orbit !== "concord") {
    expect(lands.systems.corva!.sectors[0]!.armies.concord).toBe(3);
    expect(lands.log.some((l) => l.includes("turned back"))).toBe(true);
  }
  const won = newCampaign();
  won.systems.kessa!.fleets.hegemony = 0;
  won.systems.kessa!.orbit = null;
  const t = resolveTurn(won, [{ faction: "concord", orders: [
    { kind: "fleet", from: "corva", to: "kessa", count: 3 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  expect(t.systems.kessa!.orbit).toBe("concord");
  expect(t.systems.corva!.sectors[0]!.armies.concord).toBe(1);
  expect(t.log.some((l) => l.startsWith("Ground battle at Kessa shield generator"))).toBe(true);
});

test("the shield generator holds off bombardment", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.fleets = { concord: 4, hegemony: 0 };
  k.orbit = "concord";
  const shielded = resolveTurn(c, none(c));
  expect(shielded.systems.kessa!.sectors.map((x) => x.armies.hegemony)).toEqual([1, 1, 1]);
  k.sectors[0]!.owner = "concord";
  k.sectors[0]!.armies = { concord: 1, hegemony: 0 };
  const open = resolveTurn(c, none(c));
  expect(open.systems.kessa!.sectors.map((x) => x.armies.hegemony)).toEqual([0, 0, 0]);
  expect(open.systems.kessa!.sectors[0]!.owner).toBe("concord");
});

test("a third of a planet without the orbit can't push out from the surface", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.sectors[0]!.owner = "concord";
  k.sectors[0]!.armies = { concord: 5, hegemony: 0 };
  expect(canPushFromSurface(k, "concord")).toBe(false);
  const push = { kind: "army" as const, from: { system: "kessa", sector: 0 }, to: { system: "kessa", sector: 1 }, count: 4 };
  expect(planOrders(c, [{ faction: "concord", orders: [push] }]).errors[0]).toBe("Cut off: take the orbit or more of the planet first");
  k.orbit = "concord";
  expect(planOrders(c, [{ faction: "concord", orders: [push] }]).errors[0]).toBeNull();
});

test("the hero battle pauses the turn on a BattleSpec and the result writes back", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.fleets = { concord: 3, hegemony: 0 };
  k.orbit = "concord";
  const at = { system: "kessa", sector: 0 };
  const paused = resolveTurn(c, [{ faction: "concord", hero: at, orders: [
    { kind: "army", from: { system: "corva", sector: 0 }, to: at, count: 2 },
  ] }]);
  const spec = paused.pending!.spec;
  expect(paused.turn).toBe(1);
  expect(spec).toMatchObject({ sector: "shield", hero: "attacker", factions: { attacker: "concord", defender: "hegemony" }, armies: { attacker: 2, defender: 1 }, tickets: { attacker: 100, defender: 50 } });
  // Orbit means strikes and drop pods; the defender's shield cuts the strikes to one.
  expect(spec.strikes).toEqual({ attacker: 1, defender: 0 });
  expect(spec.reinforcements).toEqual({ attacker: 24, defender: 0 });
  expect(resolveTurn(paused, none(paused))).toBe(paused); // nothing moves until it's fought

  expect(() => applyBattleResult(paused, { id: "nope", winner: "attacker", tickets: { attacker: 1, defender: 0 }, heroDown: false })).toThrow();
  const after = applyBattleResult(paused, { id: spec.id, winner: "attacker", tickets: { attacker: 70, defender: 0 }, heroDown: false });
  expect(after.turn).toBe(2);
  expect(after.pending).toBeNull();
  expect(after.systems.kessa!.sectors[0]).toMatchObject({ owner: "concord", armies: { concord: 1, hegemony: 0 } });
  expect(after.hero.xp).toBe(2);
  // With the shield gone, the orbit bombards the rest of Kessa.
  expect(after.systems.kessa!.sectors[1]!.armies.hegemony).toBe(0);

  const lost = applyBattleResult(paused, { id: spec.id, winner: "defender", tickets: { attacker: 0, defender: 10 }, heroDown: true });
  expect(lost.systems.kessa!.sectors[0]!.owner).toBe("hegemony");
  expect(lost.hero.woundedUntil).toBe(4);
  const wounded = resolveTurn(lost, [{ faction: "concord", hero: { system: "kessa", sector: 1 }, orders: [] }]);
  expect(wounded.pending).toBeNull();
});

test("the AI's orders are all legal, and a whole war is deterministic", () => {
  const play = (seed: number) => {
    let c = newCampaign(seed);
    for (let i = 0; i < 40 && !c.winner; i++) {
      const orders = [aiOrders(c, "concord"), aiOrders(c, "hegemony")];
      expect(planOrders(c, orders).errors.every((e) => e === null)).toBe(true);
      c = resolveTurn(c, orders);
    }
    return c;
  };
  const a = play(3), b = play(3);
  expect(a).toEqual(b);
  expect(a.turn).toBeGreaterThan(5);
});
