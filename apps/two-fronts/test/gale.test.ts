import { expect, test } from "bun:test";
import { aiDeploys, aiOrders } from "../src/war/ai.ts";
import { eventNow, galeAt, galeNext, galeSeen, yearEvent, type EventKind } from "../src/war/gale.ts";
import { ORBIT, buildSpec, deployTurn, fogged, groundEdges, newCampaign, planOrders, resolveTurn, scoredHolds, type Campaign, type Card, type Order } from "../src/war/rules.ts";
import type { Ground } from "../src/war/galaxy.ts";

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

test("the Gale blows 1 to 3 sectors round every ring of 3 or more each turn, and its forecast holds", () => {
  let c = newCampaign(7);
  expect(galeAt(c, "aster")).toBeNull(); // one sector: no Gale
  expect(galeAt(c, "corva")).toBeNull(); // two sectors: no Gale
  expect(galeAt(c, "lumen")).toBe(galeAt(c, "kessa")); // twin worlds share the weather
  for (let i = 0; i < 12 && !c.winner; i++) {
    const soon = galeNext(c, "kessa");
    expect(soon).toHaveLength(3);
    c = turn(c); // no cards: the Gale deck can move it off its track (below)
    expect(soon).toContain(galeAt(c, "kessa")!);
  }
  expect(galeAt(newCampaign(7), "kessa", 9)).toBe(galeAt(c, "kessa", 9)); // the same seed, the same storm
  expect(galeAt({ ...newCampaign(7), calm: true }, "kessa")).toBeNull();
});

test("under the Gale, a force in the open loses 1 in 3 at Collect and a shelter keeps it whole", () => {
  for (const [kind, armies, left] of [["capital", 6, 4], ["canyon", 5, 4], ["spaceport", 2, 2], ["shield", 6, 6], ["warren", 6, 6]] as [Ground, number, number][]) {
    const c = newCampaign(3), at = galeAt(c, "kessa")!, x = c.systems.kessa!.sectors[at]!;
    x.kind = kind;
    x.armies.wooka = armies;
    expect(turn(c).systems.kessa!.sectors[at]!.armies.wooka, kind).toBe(left);
  }
});

test("nothing lands under the Gale and nothing is bombarded there, but a neighbour may attack into it", () => {
  const c = newCampaign(3), k = c.systems.kessa!, g = galeAt(c, "kessa")!, next = (n: number) => (g + n) % k.sectors.length;
  // The Marines hold a warren beside the Gale, and the sky; the Wooka hold the rest with 2 apiece.
  for (const x of k.sectors) x.armies.wooka = 2;
  k.sectors[next(1)] = { kind: "warren", owner: "marines", armies: { marines: 4, wooka: 0 } };
  Object.assign(k, { orbit: "marines", fleets: { marines: 3, wooka: 0 } });
  const lands = (to: number) => planOrders(c, [{ faction: "marines", orders: [
    { kind: "fleet", from: "corva", to: "kessa", count: 1 },
    { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: to }, count: 2 },
  ] }]).errors[1];
  const bombs = (at: number) => planOrders(c, [{ faction: "marines", orders: [{ kind: "bombard", at: { system: "kessa", sector: at }, count: 1 }] }]).errors[0];
  expect([lands(g), lands(next(2))]).toEqual(["The Gale is over it: nothing lands there this turn", null]);
  expect([bombs(g), bombs(next(2))]).toEqual(["The Gale hides the ground: no bombardment there", null]);
  expect(planOrders(c, [{ faction: "marines", orders: [{ kind: "army", from: { system: "kessa", sector: next(1) }, to: { system: "kessa", sector: g }, count: 3 }] }]).errors).toEqual([null]);
  expect(groundEdges(c, { system: "kessa", sector: g }).cover.def).toBe(true); // the sand covers its holder
  // A hero battle fought there gets no strikes, no gunships and short sight; one next door is clear.
  const there = buildSpec(c, { system: "kessa", sector: g }, 1), clear = buildSpec(c, { system: "kessa", sector: next(2) }, 1);
  expect([there.storm, there.strikes.attacker, there.vehicles.attacker.gunship]).toEqual([true, 0, undefined]);
  expect(clear.storm).toBeUndefined();
});

test("the AI walks a garrison out from under the Gale to a shelter next door, leaving two", () => {
  const c = newCampaign(3), k = c.systems.kessa!, at = galeAt(c, "kessa")!, n = k.sectors.length;
  k.sectors.forEach((x, i) => Object.assign(x, { kind: i === at ? "capital" : x.kind, owner: "wooka" }));
  k.sectors[at]!.armies.wooka = 6;
  const near = (at + n - 1) % n, far = (at + 3) % n;
  k.sectors[near]!.kind = "shield";
  Object.assign(k.sectors[far]!, { kind: "warren", armies: { marines: 0, wooka: 9 } }); // more troops, but not next door
  const walk = aiOrders(c, "wooka").orders.find((o) => o.kind === "army" && o.from.system === "kessa" && o.from.sector === at);
  expect(walk).toMatchObject({ to: { system: "kessa", sector: near }, count: 4 });
  // With a shelter in hand it stays where it is and shelters.
  c.hands = { marines: [], wooka: ["shelter"] };
  const sheltering = aiOrders(c, "wooka").orders;
  expect(sheltering).toContainEqual({ kind: "card", card: "shelter", at: { system: "kessa", sector: at } });
  expect(sheltering.some((o) => o.kind === "army" && o.from.system === "kessa" && o.from.sector === at)).toBe(false);
});

test("the Gale deck: shelter, steer the Gale, stillness, a forecast and a read of the weather", () => {
  // Kessa is the Wooka's; the Gale sits on a capital of theirs with 6 armies, and the sector after it too.
  const board = (hands: Partial<Record<"marines" | "wooka", Card[]>>) => {
    const c = newCampaign(3), k = c.systems.kessa!, at = galeAt(c, "kessa")!, n = k.sectors.length;
    for (const i of [at, (at + 1) % n]) Object.assign(k.sectors[i]!, { kind: "capital", armies: { marines: 0, wooka: 6 } });
    c.hands = { marines: [], wooka: [], ...hands };
    return { c, at, n, next: (at + 1) % n };
  };
  const play = (c: Campaign, f: "marines" | "wooka", orders: Order[]) => resolveTurn(c, [{ faction: f, orders }]);
  const kessa = (at: number): Order => ({ kind: "card", card: "shelter", at: { system: "kessa", sector: at } });
  const orbit = (card: Card): Order => ({ kind: "card", card, at: { system: "kessa", sector: ORBIT } });

  // Shelter: the armies under it keep all six.
  const sh = board({ wooka: ["shelter"] });
  expect(play(sh.c, "wooka", []).systems.kessa!.sectors[sh.at]!.armies.wooka).toBe(4);
  expect(play(sh.c, "wooka", [kessa(sh.at)]).systems.kessa!.sectors[sh.at]!.armies.wooka).toBe(6);

  // Steer: the Marines push it onto the next sector before it takes its share, and it blows on from there.
  const st = board({ marines: ["steer"] }), plain = play(st.c, "marines", []);
  const steered = play(st.c, "marines", [{ kind: "card", card: "steer", at: { system: "kessa", sector: st.next } }]);
  expect([steered.systems.kessa!.sectors[st.at]!.armies.wooka, steered.systems.kessa!.sectors[st.next]!.armies.wooka]).toEqual([6, 4]);
  expect(galeAt(steered, "kessa")).toBe((galeAt(plain, "kessa")! + 1) % st.n);
  expect(planOrders(st.c, [{ faction: "marines", orders: [{ kind: "card", card: "steer", at: { system: "kessa", sector: (st.at + 3) % st.n } }] }]).errors[0]).toBe("Steer it onto a sector next to the Gale");

  // Stillness: it stays put for a turn, then blows on as before.
  const sl = board({ wooka: ["still"] }), still = play(sl.c, "wooka", [orbit("still")]);
  expect(galeAt(still, "kessa")).toBe(sl.at);
  expect(galeNext(still, "kessa")).toContain(galeAt(turn(still), "kessa")!);
  expect(planOrders(sl.c, [{ faction: "wooka", orders: [{ kind: "card", card: "still", at: { system: "aster", sector: ORBIT } }] }]).errors[0]).toBe("No Gale on that world");

  // A forecast narrows the Marines' arc to the one sector it blows to, this turn and the next; the
  // Wooka still see three. A read of the weather shows them the Wooka's numbers there for as long.
  const fc = board({ marines: ["forecast", "weather"] });
  const looks = [orbit("forecast"), orbit("weather")], told = play(fc.c, "marines", looks);
  for (const c of [planOrders(fc.c, [{ faction: "marines", orders: looks }]).c, told]) {
    expect(galeSeen(c, "marines", "kessa")).toEqual([galeAt(turn(c), "kessa")!]);
    expect(galeSeen(c, "wooka", "kessa")).toHaveLength(3);
    expect(fogged(c, "marines").systems.kessa!.fog).toBeUndefined();
  }
  expect(fogged(turn(told), "marines").systems.kessa!.fog).toBe(true);
  expect(planOrders(fc.c, [{ faction: "marines", orders: [{ kind: "card", card: "weather", at: { system: "lumen", sector: ORBIT } }] }]).errors[0]).toBe("You can see that world already");

  // Eye of the storm, scored: more armies under the Gale than theirs.
  expect([scoredHolds(sh.c, "wooka", "eye"), scoredHolds(sh.c, "marines", "eye")]).toEqual([true, false]);
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
