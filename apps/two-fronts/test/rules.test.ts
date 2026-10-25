import { expect, test } from "bun:test";
import type { BattleSpec } from "../src/battle/contract.ts";
import { GALAXIES, type Galaxy, type GalaxyId } from "../src/war/galaxy.ts";
import { aiDeploys, aiOrders } from "../src/war/ai.ts";
import {
  ORBIT, applyBattleResult, applySpaceResult, canPushFromSurface, checkRetreats, declareAttacks, deployTurn, planDeploys, fogged, involved, diceBattle, income, incomeBreakdown, keyShare, regionHolder, newCampaign, planOrders, resolveTurn, rng, supplied, vehiclePool,
  type Campaign, type Order, type Orders, type Retreat, type Where,
} from "../src/war/rules.ts";

const kessa = (c: Campaign) => c.systems.kessa!;
const reachable = (g: Galaxy, from: string) => {
  const seen = new Set([from]), todo = [from];
  while (todo.length) for (const n of g.neighbours(todo.pop()!)) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  return seen;
};
// A whole turn: its combat, then the deploy phase, with the AI's deploys or none at all.
const whole = (c: Campaign, all: Orders[], ai = false) => {
  const after = resolveTurn(c, all);
  return after.deploying ? deployTurn(after, ai ? after.deploying.map((f) => ({ faction: f, orders: [], deploys: aiDeploys(after, f) })) : []) : after;
};
const finish = (c: Campaign) => (c.deploying ? deployTurn(c, []) : c);
const none = (c: Campaign): Orders[] => [{ faction: "marines", orders: [] }, { faction: "wooka", orders: [] }];
// A system's twin: where it lands when the map turns half a turn around its centre.
const twinOf = (g: Galaxy) => {
  const at = new Map(g.systems.map((s) => [`${s.x},${s.y}`, s]));
  return (id: string) => {
    const s = g.system(id), t = at.get(`${g.width - s.x},${98 - s.y}`);
    if (!t) throw new Error(`${id} has no twin`);
    return t.id;
  };
};

// Turn either map half a turn around its centre and every world, lane and army lands on its twin.
for (const id of ["short", "full"] as const) {
  test(`the ${id} galaxy is the same for both sides`, () => {
    const g = GALAXIES[id], twin = twinOf(g);
    for (const s of g.systems) {
      expect(g.start[s.id]).toBeDefined();
      const t = g.system(twin(s.id)), a = g.start[s.id]!, b = g.start[t.id]!;
      expect(t.sectors).toEqual(s.sectors);
      expect(g.regions.find((r) => r.id === t.region)!.bonus).toBe(g.regions.find((r) => r.id === s.region)!.bonus);
      expect({ ...b, owner: a.owner }).toEqual(a);
      expect(b.owner).not.toBe(a.owner);
    }
    for (const [a, b] of g.lanes) expect(g.adjacent(twin(a), twin(b))).toBe(true);
    // The list runs in twin order, so each side's AI can read it from its own end.
    expect(g.systems.map((s) => twin(s.id))).toEqual(g.systems.map((s) => s.id).reverse());
    const c = newCampaign(1, "marines", id);
    expect(keyShare(c, "marines")).toBe(0.5);
    expect(income(c, "marines")).toBe(income(c, "wooka"));
  });
}

test("the short galaxy: 8 systems, joined up, Kessa and Lumen in three sectors, a cannon on each way in", () => {
  const g = GALAXIES.short;
  expect(g.systems).toHaveLength(8);
  expect(reachable(g, "aster").size).toBe(8);
  expect(g.system("kessa").sectors).toEqual(["shield", "spaceport", "capital"]);
  expect(g.system("lumen").sectors).toEqual(["shield", "spaceport", "capital"]);
  expect(g.systems.filter((s) => s.sectors.includes("cannon")).map((s) => s.id)).toEqual(["corva", "morrow"]);
});

test("the full galaxy: 30 systems in 7 regions, joined up", () => {
  const g = GALAXIES.full;
  expect(g.systems).toHaveLength(30);
  expect(g.regions).toHaveLength(7);
  expect(reachable(g, "aster").size).toBe(30);
  for (const s of g.systems) expect(g.regions.some((r) => r.id === s.region)).toBe(true);
  expect(g.systems.filter((s) => s.sectors.length > 1).length).toBeGreaterThanOrEqual(8);
  const has = (k: string) => g.systems.filter((s) => s.sectors.includes(k as never)).map((s) => s.id).sort();
  expect(has("canyon")).toEqual(["tarn", "umber"]);
  expect(has("jungle")).toEqual(["rook", "xan"]);
});

test("income counts sectors and the region bonus, and halves when morale breaks", () => {
  const c = newCampaign();
  // Thunder Marines: four capitals (12), Lumen's shield (1) and spaceport (2), Corva's cannon (1)
  // and the whole Thunder Reach (2).
  expect(income(c, "marines")).toBe(18);
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (s.id !== "aster") x.owner = "wooka";
  expect(keyShare(c, "marines")).toBeLessThan(0.3);
  expect(income(c, "marines")).toBe(1); // 3 halved, rounded down
});

test("the income breakdown itemises sectors, region bonuses and the morale cut", () => {
  const c = newCampaign();
  expect(regionHolder(c, "west")).toBe("marines");
  expect(regionHolder(c, "core")).toBeNull();
  expect(incomeBreakdown(c, "marines")).toEqual({ sectors: 16, regions: [{ name: "Thunder Reach", bonus: 2 }], morale: 0, total: 18 });
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (s.id !== "aster") x.owner = "wooka";
  expect(incomeBreakdown(c, "marines")).toEqual({ sectors: 3, regions: [], morale: -2, total: 1 });
});

test("orders are checked against what the earlier ones left", () => {
  const c = newCampaign();
  const d = planOrders(c, [{ faction: "marines", orders: [
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 1 } },
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 1 } },
    { kind: "build", unit: "fleet", at: { system: "corva", sector: 1 } }, // out of credits
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
  const lands = whole(c, [{ faction: "marines", orders: [
    { kind: "fleet", from: "lumen", to: "kessa", count: 1 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  // One ship against two: the landing almost always turns back.
  if (lands.systems.kessa!.orbit !== "marines") {
    expect(lands.systems.corva!.sectors[0]!.armies.marines).toBe(2);
    expect(lands.log.some((l) => l.includes("turned back"))).toBe(true);
  }
  const won = newCampaign();
  won.systems.kessa!.fleets.wooka = 0;
  won.systems.kessa!.orbit = null;
  const t = whole(won, [{ faction: "marines", orders: [
    { kind: "fleet", from: "corva", to: "kessa", count: 3 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 },
  ] }]);
  expect(t.systems.kessa!.orbit).toBe("marines");
  expect(t.systems.corva!.sectors[0]!.armies.marines).toBe(0);
  expect(t.log.some((l) => l.startsWith("Ground battle at Kessa shield generator"))).toBe(true);
});

test("the shield generator holds off bombardment", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.fleets = { marines: 4, wooka: 0 };
  k.orbit = "marines";
  const shielded = whole(c, none(c));
  expect(shielded.systems.kessa!.sectors.map((x) => x.armies.wooka)).toEqual([1, 1, 1]);
  k.sectors[0]!.owner = "marines";
  k.sectors[0]!.armies = { marines: 1, wooka: 0 };
  const open = whole(c, none(c));
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
  const paused = whole(c, [{ faction: "marines", hero: at, orders: [
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
  expect(whole(paused, none(paused))).toBe(paused); // nothing moves until it's fought

  expect(() => applyBattleResult(paused, { id: "nope", winner: "attacker", tickets: { attacker: 1, defender: 0 }, heroDown: false })).toThrow();
  const after = finish(applyBattleResult(paused, { id: spec.id, winner: "attacker", tickets: { attacker: 70, defender: 0 }, heroDown: false }));
  expect(after.turn).toBe(2);
  expect(after.pending).toBeNull();
  expect(after.systems.kessa!.sectors[0]).toMatchObject({ owner: "marines", armies: { marines: 1, wooka: 0 } });
  expect(after.heroes.marines.xp).toBe(2);
  // With the shield gone, the orbit bombards the rest of Kessa.
  expect(after.systems.kessa!.sectors[1]!.armies.wooka).toBe(0);

  const lost = applyBattleResult(paused, { id: spec.id, winner: "defender", tickets: { attacker: 0, defender: 10 }, heroDown: true });
  expect(lost.systems.kessa!.sectors[0]!.owner).toBe("wooka");
  expect(lost.heroes.marines.woundedUntil).toBe(4);
  const wounded = whole(lost, [{ faction: "marines", hero: { system: "kessa", sector: 1 }, orders: [] }]);
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
  const paused = whole(c, orders);
  expect(paused.pending?.kind).toBe("space");
  const spec = paused.pending!.spec;
  expect(spec).toMatchObject({ id: "1-kessa-orbit", system: "Kessa", hero: "attacker", factions: { attacker: "marines", defender: "wooka" }, fleets: { attacker: 3, defender: 2 } });
  expect(paused.systems.kessa!.sectors[0]!.armies.marines).toBe(0); // still in the transports
  expect(whole(paused, none(paused))).toBe(paused);
  expect(() => applyBattleResult(paused, { id: spec.id, winner: "attacker", tickets: { attacker: 1, defender: 0 }, heroDown: false })).toThrow();

  // Win the orbit: the cruisers fit to fly keep it, and the troops land under it.
  const won = finish(applySpaceResult(paused, { id: spec.id, winner: "attacker", fleets: { attacker: 2, defender: 1 }, heroDown: false }));
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
  const corva = c.systems.corva!;
  corva.fleets = { marines: 0, wooka: 2 };
  corva.orbit = "wooka";
  const one = whole(c, none(c));
  expect(one.systems.corva!.fleets.wooka).toBe(1);
  expect(one.systems.corva!.orbit).toBe("wooka");
  expect(one.log).toContain("The cannon on Corva knocks out 1 Wooka ship.");
  const two = whole(one, none(one));
  expect(two.systems.corva!.fleets.wooka).toBe(0);
  expect(two.systems.corva!.orbit).toBeNull();
  expect(two.log).toContain("Wooka's blockade of Corva is broken.");
  // Taken by the enemy, the cannon turns on its old owner's fleet.
  const lost = newCampaign();
  lost.systems.corva!.sectors[0]!.owner = "wooka";
  lost.systems.corva!.sectors[0]!.armies = { marines: 0, wooka: 1 };
  lost.systems.corva!.fleets.marines = 1;
  expect(whole(lost, none(lost)).systems.corva!.fleets.marines).toBe(0);
});

test("forces cut off from a capital lose an army a turn, down to one", () => {
  const c = newCampaign();
  const k = kessa(c);
  k.sectors[0]!.owner = "marines";
  k.sectors[0]!.armies = { marines: 4, wooka: 0 };
  // Wooka's own orbit over Kessa cuts Thunder Marines's foothold off from Corva and Lumen.
  expect(supplied(c, "marines").has("kessa")).toBe(false);
  expect(supplied(c, "wooka").has("kessa")).toBe(true);
  let t = whole(c, none(c));
  expect(t.systems.kessa!.sectors[0]!.armies.marines).toBe(3);
  expect(t.log.some((l) => l.includes("cut off from supply"))).toBe(true);
  for (let i = 0; i < 4; i++) t = whole(t, none(t));
  expect(t.systems.kessa!.sectors[0]!.armies.marines).toBe(1);
  // Clear the orbit and the line runs again.
  const open = structuredClone(c);
  open.systems.kessa!.fleets.wooka = 0;
  open.systems.kessa!.orbit = null;
  expect(supplied(open, "marines").has("kessa")).toBe(true);
  expect(whole(open, none(open)).systems.kessa!.sectors[0]!.armies.marines).toBe(4);
  // A blockade further back cuts off everything past it: no Thunder Marines capital, no supply.
  const deep = newCampaign();
  for (const id of ["aster", "brill", "corva"]) for (const x of deep.systems[id]!.sectors) x.owner = "wooka";
  deep.systems.corva!.orbit = "wooka";
  expect([...supplied(deep, "marines")].sort()).toEqual(["lumen"]);
});

test("the AI's orders are all legal, and a whole war is deterministic", () => {
  const play = (seed: number) => {
    let c = newCampaign(seed);
    for (let i = 0; i < 40 && !c.winner; i++) {
      const orders = [aiOrders(c, "marines"), aiOrders(c, "wooka")];
      expect(planOrders(c, orders).errors.every((e) => e === null)).toBe(true);
      c = whole(c, orders, true);
    }
    return c;
  };
  const a = play(7), b = play(7);
  expect(a).toEqual(b);
  expect(a.turn).toBeGreaterThan(3);
});

// On a symmetric map the Wooka's first orders are the Marines' turned half a turn around: the AI
// doesn't play a better game for the side whose worlds come first in the list (#1086).
for (const [id, least] of [["short", 3], ["full", 10]] as const) test(`the AI gives each side the mirror image of the other's opening orders on the ${id} map`, () => {
  const twin = twinOf(GALAXIES[id]);
  let c = newCampaign(1, "marines", id);
  for (let i = 0; i < 3; i++) c = whole(c, none(c)); // a few quiet turns' income to spend
  const mirrored = aiOrders(c, "marines").orders.map((o) =>
    o.kind === "build" ? { ...o, at: { ...o.at, system: twin(o.at.system) } }
    : o.kind === "fleet" ? { ...o, from: twin(o.from), to: twin(o.to) }
    : o.kind === "card" || o.kind === "bombard" ? { ...o, at: { ...o.at, system: twin(o.at.system) } }
    : { ...o, from: { ...o.from, system: twin(o.from.system) }, to: { ...o.to, system: twin(o.to.system) } });
  expect(mirrored.length).toBeGreaterThan(least);
  expect(aiOrders(c, "wooka").orders).toEqual(mirrored);
});

// Pacing, AI against AI: every war ends, a full one runs longer than a short one, and the AI
// spends the bigger galaxy's income rather than banking it. These seeds' wars run 4-12 turns on
// the short map and 12-30 on the full one.
test("a full campaign runs longer than the short war, still ends, and the AI spends its income", () => {
  const war = (galaxy: GalaxyId, seed: number) => {
    let c = newCampaign(seed, "marines", galaxy);
    while (!c.winner && c.turn < 100) {
      c = whole(c, [aiOrders(c, "marines"), aiOrders(c, "wooka")], true);
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

// Corva's army heads for Kessa's shield generator, which the Wooka hold with one army.
const attackOnKessa = (): Orders => ({ faction: "marines", orders: [{ kind: "army", from: { system: "corva", sector: 1 }, to: { system: "kessa", sector: 0 }, count: 2 }] });
const underMarineOrbit = () => {
  const c = newCampaign(3);
  kessa(c).orbit = "marines";
  kessa(c).fleets = { marines: 1, wooka: 0 }; // too few to bombard
  return c;
};

test("moves into the enemy's ground or orbit are declared as attacks, with no numbers on them", () => {
  const c = newCampaign(3);
  const fleet: Orders = { faction: "wooka", orders: [{ kind: "fleet", from: "morrow", to: "lumen", count: 2 }, { kind: "fleet", from: "nyx", to: "orin", count: 1 }] };
  const attacks = declareAttacks(c, [attackOnKessa(), fleet]);
  expect(attacks).toEqual([
    { faction: "marines", from: "corva", to: { system: "kessa", sector: 0 } },
    { faction: "wooka", from: "morrow", to: { system: "lumen", sector: ORBIT } },
  ]);
  expect(JSON.stringify(attacks)).not.toContain("count");
  const declared = { ...c, attacks };
  expect(involved(declared, "marines") && involved(declared, "wooka")).toBe(true);
});

test("a defender who pulls out saves their troops and gives up the ground", () => {
  const c0 = underMarineOrbit();
  const c = { ...c0, attacks: declareAttacks(c0, [attackOnKessa()]) };
  const hold = whole(c, [attackOnKessa(), { faction: "wooka", orders: [] }]);
  const out: Orders = { faction: "wooka", orders: [], retreats: [{ kind: "withdraw", from: { system: "kessa", sector: 0 }, to: { system: "kessa", sector: 2 } }] };
  expect(checkRetreats(c, out, out.retreats!)).toEqual([null]);
  const pulled = whole(c, [attackOnKessa(), out]);
  expect(kessa(pulled).sectors[0]).toMatchObject({ owner: "marines", armies: { marines: 2, wooka: 0 } });
  expect(kessa(pulled).sectors[2]!.armies.wooka).toBe(2);
  expect(pulled.log).toContain("Wooka pull out of Kessa shield generator to Kessa ruined city.");
  expect(hold.log.some((l) => l.startsWith("Ground battle at Kessa shield generator"))).toBe(true);
  // Only from where they're attacked, only to ground they hold, and not from nothing.
  const bad = (r: Retreat) => checkRetreats(c, { faction: "wooka", orders: [] }, [r])[0];
  expect(bad({ kind: "withdraw", from: { system: "kessa", sector: 1 }, to: { system: "kessa", sector: 2 } })).toBe("Nobody is attacking there");
  expect(bad({ kind: "withdraw", from: { system: "kessa", sector: 0 }, to: { system: "corva", sector: 1 } })).toBe("Pull back to a sector you hold");
  expect(bad({ kind: "withdraw", from: { system: "kessa", sector: 0 }, to: { system: "orin", sector: 0 } })).toBe("Pull back to the same world or one next door");
  expect(checkRetreats(c, { faction: "wooka", orders: [] }, [out.retreats![0]!, out.retreats![0]!])).toEqual([null, "No troops of yours there"]);
});

test("an attacker who calls it off keeps their troops at home", () => {
  const c0 = underMarineOrbit();
  const c = { ...c0, attacks: declareAttacks(c0, [attackOnKessa()]) };
  const off: Orders = { ...attackOnKessa(), retreats: [{ kind: "calloff", to: { system: "kessa", sector: 0 } }] };
  const after = whole(c, [off, { faction: "wooka", orders: [] }]);
  expect(after.systems.corva!.sectors[1]!.armies.marines).toBe(2);
  expect(kessa(after).sectors[0]).toMatchObject({ owner: "wooka", armies: { marines: 0, wooka: 1 } });
  expect(checkRetreats(c, { faction: "wooka", orders: [] }, [{ kind: "calloff", to: { system: "kessa", sector: 0 } }])).toEqual(["No attack of yours there"]);
});

test("each side sees who holds what, but the enemy's numbers only where it has someone to count them", () => {
  const c = newCampaign(3);
  const seen = fogged(c, "marines");
  expect(seen.systems.nyx).toMatchObject({ fog: true, orbit: "wooka", fleets: { wooka: 0 }, sectors: [{ owner: "wooka", armies: { wooka: 0 } }] });
  expect(seen.systems.corva!.fog).toBeUndefined();
  expect(seen.systems.corva!.sectors[1]!.armies.marines).toBe(c.systems.corva!.sectors[1]!.armies.marines);
  expect(c.systems.nyx!.sectors[0]!.armies.wooka).toBe(2); // the real map is untouched
});

test("the Horde: 60 worlds laid out alike for both sides, but the Wooka come in force", () => {
  const g = GALAXIES.horde, twin = twinOf(g);
  expect(g.systems).toHaveLength(60);
  expect(new Set(g.systems.map((s) => s.id)).size).toBe(60);
  expect(reachable(g, "aster").size).toBe(60);
  for (const s of g.systems) {
    const t = g.system(twin(s.id));
    expect(t.sectors).toEqual(s.sectors);
    expect(g.regions.find((r) => r.id === t.region)!.bonus).toBe(g.regions.find((r) => r.id === s.region)!.bonus);
    expect(g.start[t.id]!.owner).not.toBe(g.start[s.id]!.owner);
  }
  for (const [a, b] of g.lanes) expect(g.adjacent(twin(a), twin(b))).toBe(true);
  const c = newCampaign(1, "marines", "horde");
  expect(keyShare(c, "marines")).toBe(0.5);
  const sum = (f: "marines" | "wooka", what: "armies" | "fleets") => g.systems.reduce((n, s) => n + (g.start[s.id]!.owner === f ? g.start[s.id]![what] * (what === "armies" ? s.sectors.length : 1) : 0), 0);
  expect(sum("wooka", "armies")).toBeGreaterThan(sum("marines", "armies") * 1.5);
  expect(sum("marines", "fleets")).toBeGreaterThan(sum("wooka", "fleets"));
  // The AI can play a turn of it on either side, and it resolves.
  const all = [aiOrders(c, "marines"), aiOrders(c, "wooka")];
  expect(whole(c, all).turn).toBe(2);
});

test("a cannon barrage: the leader rolls a d8, the rest d6s, highest against highest, ties to the attacker", () => {
  // One against one, the leaders' d8s: the attacker takes the ties, so wins over half.
  const r = rng(11);
  let att = 0;
  for (let i = 0; i < 2000; i++) if (diceBattle(1, 1, r)[0]) att++;
  expect(att / 2000).toBeGreaterThan(0.52);
  expect(att / 2000).toBeLessThan(0.62); // 36 of 64 rolls
  // A die never rolls past its sides: a d8 against a d6 that can't tie means a 7 or 8.
  const rolls = [0.99, 0.99]; // both leaders roll 8: a tie, the attacker wins
  expect(diceBattle(1, 1, () => rolls.shift() ?? 0)).toEqual([1, 0]);
  // Upgraded guns make every die a d8, and that tells over a long fight.
  let armed = 0, plain = 0;
  for (let i = 0; i < 1000; i++) {
    if (diceBattle(6, 6, r, {}, { def: true })[1]) armed++;
    if (diceBattle(6, 6, r)[1]) plain++;
  }
  expect(armed).toBeGreaterThan(plain);
});

test("both sides draw the same card each turn, keep it from each other, and hold no more than five", () => {
  let c = newCampaign(5);
  expect(c.hands!.marines).toHaveLength(1);
  expect(c.hands!.marines).toEqual(c.hands!.wooka);
  for (let i = 0; i < 6; i++) c = whole(c, none(c));
  expect(c.hands!.marines).toHaveLength(5);
  expect(c.hands!.marines).toEqual(c.hands!.wooka);
  expect(fogged(c, "marines").hands).toEqual({ marines: c.hands!.marines, wooka: [] });
});

test("cards are played on places you hold, from your hand, after the garrison", () => {
  const c = newCampaign();
  c.hands = { marines: ["troops", "guns", "trap"], wooka: [] };
  const corva = { system: "corva", sector: 1 };
  const play = (orders: Order[]) => planOrders(c, [{ faction: "marines", orders }]);
  const d = play([{ kind: "card", card: "troops", at: corva }, { kind: "card", card: "guns", at: corva }, { kind: "card", card: "trap", at: { system: "corva", sector: ORBIT } }]);
  expect(d.errors).toEqual([null, null, null]);
  expect(d.c.systems.corva!.sectors[1]).toMatchObject({ armies: { marines: c.systems.corva!.sectors[1]!.armies.marines + 2 }, guns: true });
  expect(d.c.hands!.marines).toEqual([]);
  expect(d.c.traps).toEqual([{ faction: "marines", at: { system: "corva", sector: ORBIT } }]);
  expect(play([{ kind: "card", card: "troops", at: { system: "nyx", sector: 0 } }]).errors[0]).toBe("You don't hold that sector");
  expect(play([{ kind: "card", card: "troops", at: corva }, { kind: "card", card: "troops", at: corva }]).errors[1]).toBe("That card isn't in your hand");
  expect(play([{ kind: "card", card: "trap", at: { system: "kessa", sector: ORBIT } }]).errors[0]).toBe("Set a trap in an orbit you hold");
});

test("a trap blows up half the attackers, and everyone of yours there", () => {
  const c = newCampaign(3);
  const k = kessa(c);
  k.orbit = "marines";
  k.fleets = { marines: 1, wooka: 0 };
  c.systems.corva!.sectors[1]!.armies.marines = 5;
  c.hands = { marines: [], wooka: ["trap"] };
  const attack: Orders = { faction: "marines", orders: [{ kind: "army", from: { system: "corva", sector: 1 }, to: { system: "kessa", sector: 0 }, count: 5 }] };
  const trap: Orders = { faction: "wooka", orders: [{ kind: "card", card: "trap", at: { system: "kessa", sector: 0 } }] };
  const after = resolveTurn(c, [attack, trap]);
  expect(after.log).toContain("A trap at Kessa shield generator blows up 3 Thunder Marines armies, and the 1 Wooka holding it.");
  expect(kessa(after).sectors[0]).toMatchObject({ owner: "marines", armies: { marines: 2, wooka: 0 } });
  expect(after.traps).toEqual([]);
  // Unsprung, it's gone by the next turn.
  expect(whole(c, [{ faction: "marines", orders: [] }, trap]).traps).toBeNull();
});

test("a trap in orbit takes half the incoming fleet down with the ships holding it", () => {
  const c = newCampaign(3);
  c.systems.corva!.fleets.marines = 4;
  kessa(c).fleets = { marines: 0, wooka: 1 };
  c.hands = { marines: [], wooka: ["trap"] };
  const after = resolveTurn(c, [
    { faction: "marines", orders: [{ kind: "fleet", from: "corva", to: "kessa", count: 4 }] },
    { faction: "wooka", orders: [{ kind: "card", card: "trap", at: { system: "kessa", sector: ORBIT } }] },
  ]);
  expect(after.log).toContain("A trap in Kessa's orbit blows up 2 Thunder Marines ships, and Wooka's 1 with it.");
  expect(kessa(after)).toMatchObject({ orbit: "marines", fleets: { marines: 2, wooka: 0 } });
});

test("taking places opens the deploy phase, and three or more earn a card", () => {
  const c = newCampaign(3);
  c.hands = { marines: [], wooka: [] };
  const k = kessa(c);
  k.orbit = "marines";
  k.fleets = { marines: 1, wooka: 0 };
  for (const x of k.sectors) x.armies.wooka = 0;
  c.systems.corva!.sectors[1]!.armies.marines = 6;
  const orders: Order[] = [0, 1, 2].map((sector) => ({ kind: "army", from: { system: "corva", sector: 1 }, to: { system: "kessa", sector }, count: 2 }));
  const fought = resolveTurn(c, [{ faction: "marines", orders }]);
  expect(fought.turn).toBe(1);
  expect(fought.deploying).toEqual(["marines"]);
  expect(fought.taken).toEqual({ marines: 3, wooka: 0 });
  expect(resolveTurn(fought, none(fought))).toBe(fought); // nothing more until the deploys are in
  // Move what's left: to a sector you hold, same world or next door, leaving one behind.
  const move = (from: number, to: Where, count: number): Order => ({ kind: "army", from: { system: "kessa", sector: from }, to, count });
  expect(planDeploys(fought, "marines", [move(0, { system: "kessa", sector: 2 }, 1)]).errors).toEqual([null]);
  expect(planDeploys(fought, "marines", [move(0, { system: "kessa", sector: 2 }, 2)]).errors).toEqual(["Leave an army to hold it"]);
  expect(planDeploys(fought, "marines", [move(0, { system: "orin", sector: 0 }, 1)]).errors).toEqual(["Armies redeploy between sectors you hold"]);
  const done = deployTurn(fought, [{ faction: "marines", orders: [], deploys: [move(0, { system: "kessa", sector: 2 }, 1)] }]);
  expect(done.turn).toBe(2);
  expect(kessa(done).sectors.map((x) => x.armies.marines)).toEqual([1, 2, 3]);
  expect(done.log).toContain("Thunder Marines took 3 places and earns a card.");
  expect(done.hands!.marines).toHaveLength(2); // the bonus, and turn 2's draw
  expect(done.hands!.wooka).toHaveLength(1);
});
