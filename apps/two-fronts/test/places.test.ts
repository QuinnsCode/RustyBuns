import { expect, test } from "bun:test";
import { places } from "../src/war/places.ts";
import { attacking } from "../src/war/phases.ts";
import { galaxyOf } from "../src/war/galaxy.ts";
import { ORBIT, declareAttacks, fogged, newCampaign, type Order } from "../src/war/rules.ts";

// The short war from the Marines' seat: their ground is Open, the Wooka's Held (fog or not), a
// landing on Kessa is an attack, and once it's declared Kessa reads Contested from both seats.
test("open, held, contested through one declared attack", () => {
  const c = newCampaign(3, "marines", "short"), me = "marines" as const, view = fogged(c, me);
  const mine = places(view, me);

  expect(mine.system("corva")).toBe("open");
  expect(mine.system("kessa")).toBe("held");
  expect(mine.at({ system: "kessa", sector: ORBIT })).toBe("held");
  // Fog hides the numbers, never the state.
  for (const d of galaxyOf(c).systems) expect(mine.system(d.id)).toBe(places(c, me).system(d.id));

  const orders: Order[] = [
    { kind: "army", from: { system: "corva", sector: 1 }, to: { system: "kessa", sector: 2 }, count: 1 },
    { kind: "army", from: { system: "corva", sector: 1 }, to: { system: "corva", sector: 0 }, count: 1 },
    { kind: "fleet", from: "corva", to: "kessa", count: 1 },
    { kind: "build", unit: "army", at: { system: "corva", sector: 1 } },
  ];
  expect(orders.map((o) => mine.order(o))).toEqual(["held", "open", "held", null]);
  // The chip agrees with the rules on what's an attack.
  for (const o of orders.slice(0, 3)) expect(mine.order(o) !== "open").toBe(attacking(view, me, o));

  const attacks = declareAttacks(c, [{ faction: me, orders }]);
  for (const f of ["marines", "wooka"] as const) {
    const p = places(fogged(c, f), f, attacks);
    expect(p.at({ system: "kessa", sector: 2 })).toBe("contested");
    expect(p.system("kessa")).toBe("contested");
    expect(p.system("aster")).toBe(f === "marines" ? "open" : "held");
  }
});
