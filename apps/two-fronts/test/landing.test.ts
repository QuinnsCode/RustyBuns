import { expect, test } from "bun:test";
import { GALAXIES } from "../src/war/galaxy.ts";
import { admitLandings, landingCap } from "../src/war/landing.ts";
import { aiDeploys, aiOrders } from "../src/war/ai.ts";
import { deployTurn, newCampaign, resolveTurn, type Campaign, type Orders } from "../src/war/rules.ts";

const turn = (c: Campaign, marines: Orders["orders"]) => {
  const after = resolveTurn(c, [{ faction: "marines", orders: marines }, { faction: "wooka", orders: [] }]);
  return after.deploying ? deployTurn(after, []) : after;
};

test("the intro world: fight over the empty middle, then land on a beachhead you can fight out of", () => {
  const g = GALAXIES.intro;
  expect(g.systems.map((s) => s.id)).toEqual(["haven", "gap", "ridge"]);
  expect(g.neighbours("gap").sort()).toEqual(["haven", "ridge"]);

  let c = newCampaign(1, "marines", "intro");
  expect(c.systems.gap).toMatchObject({ orbit: null, sectors: [] });
  // Rushing Ridge straight from Haven: its three ships seal the sky, so the troops come home.
  c.systems.ridge!.orbit = "wooka";
  const rush = turn(c, [{ kind: "army", from: { system: "haven", sector: 1 }, to: { system: "ridge", sector: 1 }, count: 2 }]);
  expect(rush.systems.haven!.sectors[1]!.armies.marines).toBe(2);
  expect(rush.log.some((l) => l.includes("no way through the sky"))).toBe(true);

  // Win the sky above Ridge, and the same landing gets down.
  c = newCampaign(1, "marines", "intro");
  c.systems.ridge!.fleets.wooka = 0;
  c.systems.ridge!.orbit = null;
  c.systems.ridge!.sectors.forEach((x) => (x.armies.wooka = 0));
  const won = turn(c, [
    { kind: "fleet", from: "haven", to: "ridge", count: 3 },
    { kind: "army", from: { system: "haven", sector: 1 }, to: { system: "ridge", sector: 1 }, count: 2 },
  ]);
  expect(won.systems.ridge!).toMatchObject({ orbit: "marines" });
  expect(won.systems.ridge!.sectors[1]!.owner).toBe("marines");
});

const sky = (orbit: "marines" | "wooka" | null, marines: number, wooka: number) => ({
  id: "x", orbit, fleets: { marines, wooka },
  sectors: [{ kind: "capital", owner: "wooka", armies: { marines: 0, wooka: 1 } }, { kind: "capital", owner: "wooka", armies: { marines: 0, wooka: 1 } }],
}) as never;

test("the sky sets the landing: how many, and how wide", () => {
  const cases: [string, ReturnType<typeof sky>, number, boolean][] = [
    ["a big fleet over the world", sky("marines", 3, 0), Infinity, true],
    ["a small fleet over the world", sky("marines", 1, 0), Infinity, false],
    ["nobody's sky", sky(null, 0, 0), 4, false],
    ["one enemy ship", sky("wooka", 0, 1), 2, false],
    ["enemy fleet seals it", sky("wooka", 0, 3), 0, false],
  ];
  for (const [what, s, troops, wide] of cases) expect(landingCap(s, "marines"), what).toEqual({ troops, wide });
});

test("a beachhead is one place; extra transports and other sectors turn back", () => {
  const systems = { x: sky(null, 0, 0) } as Record<string, never>;
  const at = (sector: number, count: number) => ({ faction: "marines" as const, to: { system: "x", sector }, count });
  expect(admitLandings(systems, [at(0, 3), at(1, 1), at(0, 3)])).toEqual([3, 0, 1]);
});

test("holding the orbit for turns squeezes the other side's landings", () => {
  const s = sky("wooka", 0, 2) as { held?: number };
  const caps = [0, 2, 4, 6].map((held) => { s.held = held; return landingCap(s as never, "marines").troops; });
  expect(caps).toEqual([1, 0, 0, 0]);
});

test("the AI plays whole wars on the intro world, and they end with a winner", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    let c = newCampaign(seed, "marines", "intro");
    for (let i = 0; i < 60 && !c.winner; i++) {
      c = resolveTurn(c, (["marines", "wooka"] as const).map((f) => aiOrders(c, f)));
      if (c.deploying) c = deployTurn(c, c.deploying.map((f) => ({ faction: f, orders: [], deploys: aiDeploys(c, f) })));
    }
    expect(c.winner, `seed ${seed}`).not.toBeNull();
  }
});
