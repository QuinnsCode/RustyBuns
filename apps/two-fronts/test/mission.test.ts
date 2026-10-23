// The mission card: what the hero is told to do, and where they stand against it.
import { expect, test } from "bun:test";
import type { BattleSpec, MatchMode } from "../src/battle/contract.ts";
import { AREA, mission, standing } from "../src/battle/mission.ts";
import { DT, startBattle, step } from "../src/battle/sim.ts";

const spec = (mode: MatchMode, hero: "attacker" | "defender" = "attacker"): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero, heroLevel: 1,
  armies: { attacker: 3, defender: 3 }, tickets: { attacker: 75, defender: 75 },
  vehicles: { attacker: {}, defender: {} }, strikes: { attacker: 1, defender: 0 },
  reinforcements: { attacker: 0, defender: 0 }, turrets: 2, seed: 42, mode,
});

test("assault: take the live post, defend it once it's ours, then on to the next", () => {
  const b = startBattle(spec("assault")), first = b.posts[0]!.name;
  expect(mission(b, "attacker")).toMatchObject({ verb: "Take", name: first });
  expect(mission(b, "defender")).toMatchObject({ verb: "Defend", name: first });
  Object.assign(b.posts[0]!, { owner: "attacker", progress: 1 });
  step(b, null);
  expect(mission(b, "attacker")).toMatchObject({ verb: "Defend", name: first });
  b.phase = DT / 2;
  step(b, null);
  expect(mission(b, "attacker")).toMatchObject({ verb: "Take", name: b.posts[1]!.name });
});

test("arriving puts you in the area; stepping out warns you; going far is travelling again", () => {
  const m = mission(startBattle(spec("conquest", "defender")), "defender");
  const at = (d: number) => ({ x: m.x + d, z: m.z });
  expect(standing(m, at(AREA * 3), "travel")).toBe("travel");
  expect(standing(m, at(AREA * 1.5), "travel")).toBe("travel"); // never arrived, so no warning
  expect(standing(m, at(5), "travel")).toBe("in");
  expect(standing(m, at(AREA * 1.5), "in")).toBe("leaving");
  expect(standing(m, at(AREA * 1.5), "leaving")).toBe("leaving");
  expect(standing(m, at(AREA * 3), "leaving")).toBe("travel");
});

test("escort: walk the champion in, stop them, or as the champion, reach the keep", () => {
  const b = startBattle(spec("escort"));
  expect(mission(b, "attacker").verb).toBe("Reach"); // the attacking hero is the champion
  expect(mission(startBattle(spec("escort", "defender")), "defender")).toMatchObject({ verb: "Stop", name: "Gumpert" });
});
