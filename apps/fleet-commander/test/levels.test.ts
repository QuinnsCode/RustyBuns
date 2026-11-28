// Every level as a player meets it: the intended play (the level's own `plan`) wins it, and a fleet left with no
// orders loses it. Seeded, so each run is the same battle. The levels that teach a mechanic also lose to the obvious
// wrong play.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS, levelBrains, levelById, startLevel } from "../src/sim/levels.ts";
import { flagship, nearestShip, step, type Brain, type World } from "../src/sim/world.ts";

setDefaultTimeout(30_000);

const play = (w: World, brain?: Brain) => { while (!w.outcome) { brain?.(w); step(w, levelBrains(w)); } return w.outcome; };

test("each level: the intended play wins it, doing nothing loses it", () => {
  expect(LEVELS.length).toBeGreaterThanOrEqual(9);
  for (const l of LEVELS) for (const seed of [1, 2]) {
    expect([l.id, seed, play(startLevel(l, seed), l.plan)]).toEqual([l.id, seed, "win"]);
    expect([l.id, seed, play(startLevel(l, seed))]).toEqual([l.id, seed, "loss"]);
  }
});

/** The destroyer sent to the gate, by way of a half circle `R` from the planet's middle (0: straight there). */
const toGate = (R: number): Brain => (w) => {
  const fl = flagship(w)!, gate = w.goal!.escort!;
  const via = R ? [150, 120, 90, 60, 30].map((a) => ({ x: Math.cos((a * Math.PI) / 180) * R, z: Math.sin((a * Math.PI) / 180) * R })) : [];
  if (fl.order.k !== "move") fl.order = { k: "move", x: gate.x, z: gate.z, via };
};

test("the mechanic levels: the intended play wins and the obvious wrong one loses, over four seeds", () => {
  const plan = (id: string) => levelById(id)!.plan;
  const wrong: [string, string, Brain][] = [
    ["slingshot", "straight there", toGate(0)],
    ["slingshot", "wide round the well", toGate(1500)],
    // The plan, but the scouts are never sent: they stay on their picket at the start.
    ["into-the-rift", "the guns in blind", (w) => { plan("into-the-rift")(w); for (const g of w.wings) if (g.side === "navy" && g.role === "scout") g.order = { k: "patrol", x: -2600, z: 0 }; }],
    // The plan, but the interdictor fights beside the destroyer.
    ["hold-the-lane", "the frigate in the gun line", (w) => {
      plan("hold-the-lane")(w);
      const fr = w.ships.find((s) => s.kind === "frigate" && !s.dead), near = fr && nearestShip(w, "rim", flagship(w)!.x, flagship(w)!.z);
      if (fr && near) fr.order = { k: "engage", target: near.id, broadside: true };
    }],
  ];
  for (const [id, what, brain] of wrong) for (const seed of [1, 2, 3, 4]) {
    const l = levelById(id)!;
    expect([id, seed, play(startLevel(l, seed), l.plan)]).toEqual([id, seed, "win"]);
    expect([id, what, seed, play(startLevel(l, seed), brain)]).toEqual([id, what, seed, "loss"]);
  }
});
