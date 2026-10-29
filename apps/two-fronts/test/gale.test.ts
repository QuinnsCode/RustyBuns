import { expect, test } from "bun:test";
import { aiDeploys, aiOrders } from "../src/war/ai.ts";
import { eventNow, galeAt, galeNext, yearEvent, type EventKind } from "../src/war/gale.ts";
import { deployTurn, fogged, newCampaign, planOrders, resolveTurn, type Campaign } from "../src/war/rules.ts";
import type { SectorKind } from "../src/battle/contract.ts";

const none = () => [{ faction: "marines" as const, orders: [] }, { faction: "wooka" as const, orders: [] }];
const turn = (c: Campaign, ai = false) => {
  const after = resolveTurn(c, ai ? [aiOrders(c, "marines"), aiOrders(c, "wooka")] : none());
  return after.deploying ? deployTurn(after, after.deploying.map((f) => ({ faction: f, orders: [], deploys: aiDeploys(after, f) }))) : after;
};
// The first seed whose year-2 event is this kind.
const seedFor = (kind: EventKind) => {
  for (let seed = 1; seed < 500; seed++) if (yearEvent(newCampaign(seed), 2)?.kind === kind) return seed;
  throw new Error(`no seed opens year 2 with ${kind}`);
};
// Four turns of nothing, to the first turn of year 2.
const toYear2 = (c: Campaign) => { for (let i = 0; i < 4; i++) c = turn(c); return c; };

test("the Gale blows 1 to 3 sectors round every 3-sector world each turn, and its forecast holds", () => {
  let c = newCampaign(7);
  expect(galeAt(c, "aster")).toBeNull(); // one sector: no Gale
  expect(galeAt(c, "corva")).toBeNull(); // two sectors: no Gale
  for (let i = 0; i < 12; i++) {
    const soon = galeNext(c, "kessa");
    expect(soon).toHaveLength(3);
    c = turn(c, true);
    expect(soon).toContain(galeAt(c, "kessa")!);
  }
  // The same seed, the same storm.
  expect(galeAt(newCampaign(7), "lumen", 9)).toBe(galeAt(c, "lumen", 9));
});

test("under the Gale, a force in the open loses 1 in 3 at Collect and a shelter keeps it whole", () => {
  for (const [kind, armies, left] of [["spaceport", 6, 4], ["capital", 5, 4], ["spaceport", 2, 2], ["shield", 6, 6]] as [SectorKind, number, number][]) {
    const c = newCampaign(3), at = galeAt(c, "kessa")!, x = c.systems.kessa!.sectors[at]!;
    x.kind = kind;
    x.armies.wooka = armies;
    expect(turn(c).systems.kessa!.sectors[at]!.armies.wooka).toBe(left);
  }
});

test("nothing lands under the Gale and nothing is bombarded there, but a neighbour may attack into it", () => {
  const c = newCampaign(3), at = galeAt(c, "kessa")!;
  c.systems.lumen!.sectors[2]!.armies.marines = 4;
  c.systems.kessa!.fleets.wooka = 0;
  c.systems.kessa!.orbit = "marines";
  c.systems.kessa!.fleets.marines = 3;
  const errors = planOrders(c, [{ faction: "marines", orders: [
    { kind: "army", from: { system: "lumen", sector: 2 }, to: { system: "kessa", sector: at }, count: 2 },
    { kind: "bombard", at: { system: "kessa", sector: at }, count: 1 },
  ] }]).errors;
  expect(errors).toEqual(["The Gale is over it: nothing lands there this turn", "The Gale hides the ground: no bombardment there"]);
  // Not under it: both go.
  const other = (at + 1) % 3;
  expect(planOrders(c, [{ faction: "marines", orders: [
    { kind: "army", from: { system: "lumen", sector: 2 }, to: { system: "kessa", sector: other }, count: 2 },
    { kind: "bombard", at: { system: "kessa", sector: other }, count: 1 },
  ] }]).errors).toEqual([null, null]);
});

test("a year's event is announced at its last turn and lands on the next year's first", () => {
  let c = newCampaign(seedFor("lanes"));
  for (let i = 0; i < 3; i++) c = turn(c);
  expect(c.turn).toBe(4);
  expect(c.log.some((l) => l.startsWith("Next year: Lane storm between"))).toBe(true);
  c = turn(c);
  const lane = eventNow(c)!.lane!;
  expect(c.log.some((l) => l.startsWith("Lane storm between"))).toBe(true);
  const from = c.systems[lane[0]]!, f = from.orbit ?? "marines";
  from.orbit = f;
  from.fleets[f] = 3;
  expect(planOrders(c, [{ faction: f, orders: [{ kind: "fleet", from: lane[0], to: lane[1], count: 1 }] }]).errors[0]).toBe("A lane storm closes that hyperlane this turn");
  expect(eventNow(turn(c))).toBeNull(); // one turn only
});

test("clear skies lift the fog for the turn", () => {
  const c = toYear2(newCampaign(seedFor("clear")));
  expect(Object.values(fogged(c, "marines").systems).some((s) => s.fog)).toBe(false);
  expect(Object.values(fogged(turn(c), "marines").systems).some((s) => s.fog)).toBe(true);
});
