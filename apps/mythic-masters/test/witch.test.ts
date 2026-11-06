import { describe, expect, test } from "bun:test";
import { clearSection, loadJourney, newJourney, SECTIONS, TRAIL_REGIONS } from "../src/journey.ts";
import { arrive, fireSpot, lightFire, poiById, WITCH_CAMP } from "../src/world/poi.ts";
import { spawn } from "../src/world/world.ts";
import { Lines, visit, WITCH } from "../src/witch.ts";

describe("the Bog Witch's camp", () => {
  test("her camp is a fire a short walk from where you wake up; you sit with her, clear regions, and she warms up", () => {
    const camp = poiById(WITCH_CAMP)!, me = spawn(1);
    expect([camp.kind, camp.n, camp.name]).toEqual(["fire", 1, WITCH.camp]);
    expect(Math.hypot(camp.x - me.x, camp.z - me.z)).toBeLessThan(400);
    // walk up to it: it is lit, and you can travel back to it later
    const j = newJourney(["squonk", "hodag", "jackalope"])!;
    expect(arrive({ x: camp.x, z: camp.z }, new Set()).map((p) => p.id)).toContain(WITCH_CAMP);
    lightFire(j, camp);
    expect(fireSpot(j, WITCH_CAMP)?.n).toBe(1);

    const steps = WITCH.visits;
    // nothing cleared: grumpy, then her repeat line for as long as you bring her nothing
    expect(visit(j)).toEqual({ say: steps[0]!.first, first: true, cleared: 0 });
    expect(visit(j).say).toBe(steps[0]!.again);
    // the save keeps what she last saw
    expect(loadJourney(JSON.stringify(j))?.witch).toBe(0);
    // each region cleared, mythic and all, moves her on a step: a new line once, then that step's repeat
    const said: string[] = [];
    for (const g of TRAIL_REGIONS) {
      for (let k = 0; k < SECTIONS; k++) clearSection(j, g.n, k);
      const v = visit(j);
      expect(v.first).toBe(true);
      said.push(v.say);
      expect(visit(j).first).toBe(false);
    }
    // all eight cleared: her warmest line, and every step was heard on the way
    expect(said.at(-1)).toBe(steps.at(-1)!.first);
    for (const s of steps.slice(1)) expect(said).toContain(s.first);
    // a trail half done is not a region cleared
    const k = newJourney(["squonk", "hodag", "jackalope"])!;
    for (let i = 0; i < SECTIONS - 1; i++) clearSection(k, 1, i);
    expect(visit(k).cleared).toBe(0);
  });

  test("a lines file the cms broke fails at load, not as a silent witch", () => {
    expect(() => Lines({ ...WITCH, visits: [] })).toThrow();
    expect(() => Lines({ ...WITCH, visits: [{ cleared: 0, first: "Hm." }] })).toThrow();
  });
});
