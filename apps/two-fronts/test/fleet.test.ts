import { expect, test } from "bun:test";
import { PRESET_IDS, loadoutOf, planDeployment, presetDeployment, totals, valueOf } from "../src/war/fleet.ts";
import { handIn, newTable, waitingOn } from "../src/war/table.ts";
import { newCampaign, planOrders, resolveTurn, type Campaign, type Deployment } from "../src/war/rules.ts";

const count = (c: Campaign, f: "marines" | "wooka") => Object.values(c.systems).reduce((n, s) => ({
  ships: n.ships + s.fleets[f], armies: n.armies + s.sectors.reduce((a, x) => a + x.armies[f], 0),
}), { ships: 0, armies: 0 });

test("a war with a setup opens on an empty map, and begins once both sides have placed a fleet", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 7, true);
  expect(count(t.campaign, "marines")).toEqual({ ships: 0, armies: 0 });
  expect(waitingOn(t)).toEqual(["marines"]);
  expect(handIn(t, "marines", { faction: "marines", orders: [] })).toEqual({ ok: false, error: "Place your fleet first" });

  const mine = presetDeployment(t.campaign, "marines", "armada");
  const s = handIn(t, "marines", { faction: "marines", orders: [], deployment: mine });
  if (!s.ok) throw new Error(s.error);
  const c = s.table.campaign;
  expect(c.setup).toBeNull();
  expect(c.turn).toBe(1);
  expect(count(c, "marines")).toEqual(totals(mine));
  expect(count(c, "wooka").ships + count(c, "wooka").armies).toBeGreaterThan(0); // the AI placed its own
  // The sky belongs to whoever put ships there.
  for (const sys of Object.values(c.systems)) expect(sys.orbit).toBe(sys.fleets.marines ? "marines" : sys.fleets.wooka ? "wooka" : null);
  expect(waitingOn(s.table)).toEqual(["marines"]);
});

test("the presets spend the pool, and trade ships for troops", () => {
  for (const galaxy of ["short", "full", "horde"] as const) {
    const c = newCampaign(1, "marines", galaxy, true);
    for (const f of ["marines", "wooka"] as const) {
      const loads = Object.fromEntries(PRESET_IDS.map((id) => [id, loadoutOf(c, f, id)]));
      for (const l of Object.values(loads)) {
        expect(valueOf(l)).toBeLessThanOrEqual(c.pool![f]);
        expect(valueOf(l)).toBeGreaterThan(c.pool![f] - 3);
      }
      expect(loads.armada!.ships).toBeGreaterThan(loads.line!.ships);
      expect(loads.horde!.armies).toBeGreaterThan(loads.line!.armies);
      for (const id of PRESET_IDS) expect(planDeployment(c, f, presetDeployment(c, f, id))).toBeNull();
    }
  }
});

test("a vanguard goes only where the front is", () => {
  const c = newCampaign(1, "marines", "full", true), d = presetDeployment(c, "marines", "vanguard");
  const front = new Set(["pell", "quarry", "lumen", "kessa", "tarn", "wick", "xan"]); // the Marines' worlds next to a Wooka one
  const owned = new Set(Object.keys(d.ships).concat(Object.keys(d.armies).map((k) => k.split(":")[0]!)));
  expect(owned.size).toBeGreaterThan(0);
  for (const id of owned) expect(front.has(id)).toBe(true);
});

test("a placement can't be more than the fleet is worth or on ground you don't hold", () => {
  const c = newCampaign(1, "marines", "short", true);
  const ok: Deployment = { ships: { aster: 2 }, armies: { "aster:0": 3 } };
  expect(planDeployment(c, "marines", ok)).toBeNull();
  expect(planDeployment(c, "marines", { ships: { aster: 99 }, armies: {} })).toBe("That's more than your fleet is worth");
  expect(planDeployment(c, "marines", { ships: { nyx: 1 }, armies: {} })).toBe("Ships go to worlds you hold");
  expect(planDeployment(c, "marines", { ships: {}, armies: { "nyx:0": 1 } })).toBe("Armies go to sectors you hold");
  expect(planDeployment(c, "marines", { ships: {}, armies: { "aster:9": 1 } })).toBe("Armies go to sectors you hold");
  expect(planDeployment(c, "marines", { ships: { aster: -1 }, armies: {} })).toBe("Ships come in whole numbers");
});

test("what a side leaves unplaced goes into the treasury", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 7, true);
  const s = handIn(t, "marines", { faction: "marines", orders: [], deployment: { ships: { aster: 1 }, armies: {} } });
  if (!s.ok) throw new Error(s.error);
  expect(s.table.campaign.credits.marines).toBe(6 + t.campaign.pool!.marines - 3);
});

// Kessa's orbit held by four Marine ships, with no Wooka ship left, over a garrison of six a sector.
// The Wooka hold its shield generator; `open` hands the generator to the Marines.
function skyOverKessa(open = false) {
  const c = newCampaign();
  const k = c.systems.kessa!;
  k.fleets = { marines: 4, wooka: 0 };
  k.orbit = "marines";
  for (const x of k.sectors) x.armies.wooka = 6;
  if (open) k.sectors[0] = { ...k.sectors[0]!, owner: "marines", armies: { marines: 1, wooka: 0 } };
  return c;
}
const bombard = (sector: number, count: number) => ({ kind: "bombard" as const, at: { system: "kessa", sector }, count });
const hit = (c: Campaign, sector: number, n: number) => resolveTurn(c, [{ faction: "marines", orders: [bombard(sector, n)] }, { faction: "wooka", orders: [] }]);

test("a bombardment kills an army a ship below, and half as many through a shield", () => {
  const open = hit(skyOverKessa(true), 1, 3); // the spaceport, no shield against it
  expect(open.log).toContain("Thunder Marines bombards Kessa space station from orbit: 3 armies killed.");
  expect(open.systems.kessa!.sectors.map((x) => x.armies.wooka)).toEqual([0, 2, 5]); // and the usual one a sector a turn for the blockade
  const shielded = hit(skyOverKessa(), 1, 4);
  expect(shielded.log).toContain("Thunder Marines bombards Kessa space station from orbit, through the shield: 2 armies killed.");
  expect(shielded.systems.kessa!.sectors[1]!.armies.wooka).toBe(4); // the shield holds off the blockade's own bombardment
});

test("a bombardment needs the sky to be yours alone, and the ships it uses can't sail", () => {
  const c = skyOverKessa();
  const plan = (...orders: Parameters<typeof planOrders>[1][number]["orders"]) => planOrders(c, [{ faction: "marines", orders }]).errors;
  expect(plan(bombard(1, 5))).toEqual(["Not that many ships are free to bombard"]);
  expect(plan(bombard(1, 3), { kind: "fleet", from: "kessa", to: "corva", count: 2 })).toEqual([null, "Not that many ships there, or they're bombarding"]);
  expect(plan(bombard(1, 3), { kind: "fleet", from: "kessa", to: "corva", count: 1 })).toEqual([null, null]);
  c.systems.kessa!.fleets.wooka = 1;
  expect(plan(bombard(1, 1))).toEqual(["Their ships still hold the sky: beat the fleet first"]);
  expect(planOrders(newCampaign(), [{ faction: "marines", orders: [bombard(1, 1)] }]).errors).toEqual(["Bombard from an orbit you hold"]);
});

test("a bombardment fizzles if the orbit changes hands first", () => {
  const c = skyOverKessa(true);
  c.systems.morrow!.fleets.wooka = 40;
  const r = resolveTurn(c, [{ faction: "marines", orders: [bombard(1, 2)] }, { faction: "wooka", orders: [{ kind: "fleet", from: "morrow", to: "kessa", count: 40 }] }]);
  expect(r.systems.kessa!.orbit).toBe("wooka");
  expect(r.log).toContain("The bombardment of Kessa space station fizzles: the orbit is contested.");
});
