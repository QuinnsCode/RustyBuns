import { expect, test } from "bun:test";
import { PHASES, banner, forecast, phaseOf, standing, summary, won } from "../src/war/phases.ts";
import { yearOf } from "../src/war/gale.ts";
import { presetDeployment } from "../src/war/fleet.ts";
import { galaxyOf } from "../src/war/galaxy.ts";
import { handIn, newTable, waitingOn, type Table } from "../src/war/table.ts";
import { enemy, type Order } from "../src/war/rules.ts";

// A new campaign as the Wooka: pick the side, place the fleet, walk the phases once, send a
// landing at the Marines, let the dice settle it, and read the recap.
test("a campaign as the Wooka: phases in order, a fight with odds up front, a recap after", () => {
  const side = "wooka" as const;
  let t: Table = newTable({ marines: "ai", wooka: "human" }, "short", 7, true);
  expect(waitingOn(t)).toEqual([side]);
  const placed = handIn(t, side, { faction: side, orders: [], deployment: presetDeployment(t.campaign, side, "line") });
  if (!placed.ok) throw new Error(placed.error);
  t = placed.table;
  expect(t.campaign.setup).toBeFalsy();

  const c = t.campaign, g = galaxyOf(c), foe = enemy(side);
  // The first Wooka sector with a spare army that sits next to Marine ground.
  const edge = g.systems.flatMap((d) => c.systems[d.id]!.sectors.flatMap((x, i) => x.owner === side && x.armies[side] > 1
    ? g.neighbours(d.id).flatMap((n) => c.systems[n]!.sectors.flatMap((y, j) => y.owner === foe ? [{ from: { system: d.id, sector: i }, to: { system: n, sector: j } }] : [])) : []))[0]!;
  const orders: Order[] = [
    { kind: "build", unit: "army", at: { system: edge.from.system, sector: edge.from.sector } },
    { kind: "army", from: edge.from, to: edge.to, count: 1 },
  ];

  // Orders sort into the phases: building is Muster, a landing on the enemy is Commit.
  expect(orders.map((o) => PHASES[phaseOf(c, side, o) - 1]!.name)).toEqual(["Muster", "Commit"]);

  const odds = forecast(c, side, orders);
  expect(odds).toHaveLength(1);
  const fight = odds[0]!;
  expect(fight.attackers).toBe(1);
  expect(fight.win).toBeGreaterThanOrEqual(0);
  expect(fight.win).toBeLessThanOrEqual(1);

  // Hand in; answer any declared attacks and deploys with nothing, as a player who just auto-resolves.
  const before = standing(c, side);
  let s = handIn(t, side, { faction: side, orders });
  for (let n = 0; s.ok && s.table.campaign.turn === 1 && waitingOn(s.table).includes(side) && n < 4; n++) s = handIn(s.table, side, { faction: side, orders: [] });
  if (!s.ok) throw new Error(s.error);
  expect(s.table.campaign.turn).toBe(2);

  const lines = summary(before, standing(s.table.campaign, side), [{ label: "the ground battle", win: fight.win, won: won(s.table.campaign, side, fight) }]);
  expect(lines[0]).toMatch(/^(Won|Lost) the ground battle, \d+% to win\.$/);
  expect(lines.length).toBe(2);
});

test("a fight against a hidden garrison has no odds to quote", () => {
  const t = newTable({ marines: "ai", wooka: "human" }, "short", 7, false), c = structuredClone(t.campaign);
  const g = galaxyOf(c), foe = "marines" as const;
  const d = g.systems.find((x) => c.systems[x.id]!.sectors.some((y) => y.owner === foe))!;
  c.systems[d.id]!.fog = true;
  const j = c.systems[d.id]!.sectors.findIndex((y) => y.owner === foe);
  const from = g.neighbours(d.id)[0]!;
  const fight = forecast(c, "wooka", [{ kind: "army", from: { system: from, sector: 0 }, to: { system: d.id, sector: j }, count: 2 }]);
  expect(fight[0]).toMatchObject({ attackers: 2, defenders: null, win: null });
});

// The banner answers, on every screen: what year and turn, whose seat, which phase and job, and who
// the turn is waiting on. One case per state a seat can find the table in.
test("the banner reads year, turn, seat, phase, job and who we wait on, in every state", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 3);
  const c = t.campaign;
  expect(yearOf(1)).toBe(1); expect(yearOf(4)).toBe(1); expect(yearOf(5)).toBe(2); expect(yearOf(6)).toBe(2);
  const b = banner({ ...c, turn: 6 }, "marines", 3, ["marines"], null);
  expect(b).toMatchObject({ year: 2, turn: 6, who: "Thunder Marines (you)", phase: "Phase 3 of 5 · Fleets", step: "Send ships, order bombardments", waiting: "you", mine: true });
  expect(banner(c, "marines", 1, ["wooka"], null)).toMatchObject({ waiting: "the Wooka", mine: false });
  expect(banner({ ...c, attacks: [] }, "marines", 1, ["marines"], null)).toMatchObject({ phase: "Phase 4 of 5 · Commit", step: "Attacks declared: answer them" });
  expect(banner({ ...c, deploying: ["wooka"] }, "marines", 5, ["wooka"], null)).toMatchObject({ phase: "Phase 2 of 5 · Deploy", step: "Move into what you took", waiting: "the Wooka" });
  expect(banner(c, "marines", 5, ["wooka"], "wooka")).toMatchObject({ phase: "Phase 5 of 5 · Battles", step: "Wooka hero battle", waiting: "the Wooka", mine: false });
  expect(banner(c, "wooka", 5, ["wooka"], "wooka")).toMatchObject({ step: "Your hero battle", waiting: "you", mine: true });
  expect(banner({ ...c, setup: ["marines", "wooka"] }, "marines", 1, ["marines", "wooka"], null)).toMatchObject({ phase: "Before the war", waiting: "you" });
  expect(banner({ ...c, turn: 9, winner: "wooka" }, "marines", 1, [], null)).toMatchObject({ year: 3, turn: 8, phase: "War over", step: "Wooka won", waiting: "nobody" });
});
