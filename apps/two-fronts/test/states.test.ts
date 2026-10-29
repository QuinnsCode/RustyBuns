import { expect, test } from "bun:test";
import { ORBIT, fogged, newCampaign, type Attack, type Campaign, type Order } from "../src/war/rules.ts";
import { placeStates, systemState, type PlaceState } from "../src/war/states.ts";

// Kessa set by hand: who holds the orbit and its first sector, and whose pieces are there. The
// marines' seat looks at it through the fog, from Corva next door.
function kessa(orbit: "marines" | "wooka" | null, ships: [number, number], owner: "marines" | "wooka", armies: [number, number]) {
  const c: Campaign = newCampaign(1, "marines", "short"), s = c.systems.kessa!;
  s.orbit = orbit;
  s.fleets = { marines: ships[0], wooka: ships[1] };
  s.sectors = s.sectors.map((x, i) => ({ ...x, owner: i === 0 ? owner : "wooka", armies: i === 0 ? { marines: armies[0], wooka: armies[1] } : { marines: 0, wooka: 1 } }));
  return fogged(c, "marines");
}
const into: Order = { kind: "army", from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 };
const fleetIn: Order = { kind: "fleet", from: "corva", to: "kessa", count: 2 };
const theirAttack: Attack = { faction: "wooka", from: "kessa", to: { system: "kessa", sector: 0 } };

test.each<[string, Campaign, Order[], Attack[], PlaceState, PlaceState, PlaceState]>([
  //                                         view                                   orders      attacks         orbit        sector 0      badge
  ["your ground",                            kessa("marines", [2, 0], "marines", [3, 0]), [],       [],             "open",      "open",      "held"],
  ["empty sky over your ground",             kessa(null, [0, 0], "marines", [0, 0]),     [],         [],             "open",      "open",      "held"],
  ["enemy ground, no order (fogged)",        kessa("wooka", [0, 0], "wooka", [0, 0]),    [],         [],             "held",      "held",      "held"],
  ["enemy ground, your order into it",       kessa("wooka", [0, 0], "wooka", [0, 0]),    [into],     [],             "held",      "contested", "contested"],
  ["enemy orbit, your fleet order",          kessa("wooka", [0, 0], "wooka", [0, 0]),    [fleetIn],  [],             "contested", "held",      "contested"],
  ["both sides' ships there now",            kessa("wooka", [1, 2], "marines", [1, 0]),  [],         [],             "contested", "open",      "contested"],
  ["their declared attack on you",           kessa("marines", [2, 0], "marines", [3, 0]), [],       [theirAttack],  "open",      "contested", "contested"],
])("%s", (_, v, orders, attacks, orbit, sector, badge) => {
  const st = placeStates(v, "marines", orders, attacks).kessa!;
  expect([st.orbit, st.sectors[0], systemState(st)]).toEqual([orbit, sector, badge]);
});

test("the fog hides their numbers, not who holds the place", () => {
  const v = kessa("wooka", [0, 3], "wooka", [0, 4]);
  expect(v.systems.kessa!.fog).toBe(true);
  expect(v.systems.kessa!.fleets.wooka).toBe(0);
  expect(placeStates(v, "marines", [], []).kessa!.orbit).toBe("held");
  expect(placeStates(v, "marines", [], [{ faction: "marines", from: "corva", to: { system: "kessa", sector: ORBIT } }]).kessa!.orbit).toBe("contested");
});
