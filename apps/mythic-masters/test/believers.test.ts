import { describe, expect, test } from "bun:test";
import { bind, clearSection, loadJourney, newJourney, SECTIONS, sections } from "../src/journey.ts";
import { arrive, fireSpot, lightFire, poiById } from "../src/world/poi.ts";
import { BELIEVERS, campOf, CAMPS, Lines, visit } from "../src/believers.ts";
import { REGIONS } from "../src/regions.ts";
import { creature } from "../src/roster.ts";

describe("the believers at each region's first campfire", () => {
  test("every group has a camp you can walk up to and travel back to, named for them on the map", () => {
    expect(CAMPS.size).toBe(BELIEVERS.groups.length);
    const j = newJourney(["squonk", "hodag", "jackalope"])!;
    for (const g of BELIEVERS.groups) {
      const camp = poiById(campOf(g.id)!)!;
      expect([camp.kind, camp.n, camp.k, camp.name]).toEqual(["fire", g.n, 0, g.camp]);
      expect(arrive({ x: camp.x, z: camp.z }, new Set()).map((p) => p.id)).toContain(camp.id);
      lightFire(j, camp);
      expect(fireSpot(j, camp.id)?.n).toBe(g.n);
    }
  });

  test("the Hatters meet you, point you down the trail, and warm up as you beat the Pine Barrens' keepers", () => {
    const g = BELIEVERS.groups.find((x) => x.id === "hatters")!, pines = sections(REGIONS[0]!);
    const j = newJourney(["squonk", "hodag", "jackalope"])!;
    // first sit: who they are, their first line, and a hint at a cryptid on the trail you don't hold
    const first = visit(j, g);
    expect(first.met).toBe(true);
    expect(first.said[0]).toBe(g.meet);
    expect(first.said[1]).toBe(g.visits[0]!.first);
    const want = pines[0]!.wilds.find((id) => !j.party.some((m) => m.id === id))!;
    expect(first.said[2]).toContain(creature(want).name);
    expect(first.said[2]).toContain(pines[0]!.name);
    // again: no introduction, their repeat line, and the save keeps what they saw
    const again = visit(j, g);
    expect(again.said).toEqual([g.visits[0]!.again, first.said[2]]);
    expect(loadJourney(JSON.stringify(j))?.believers?.hatters).toBe(0);
    // bind that one and the hint moves on to another
    bind(j, want, 5);
    expect(visit(j, g).said.at(-1)).not.toContain(creature(want).name);
    // each step of keepers beaten is a new line once
    const said: string[] = [];
    for (let k = 0; k < SECTIONS; k++) {
      clearSection(j, 1, k);
      const step = g.visits.find((s) => s.cleared === k + 1);
      const v = visit(j, g).said[0]!;
      if (!step) continue;
      said.push(v);
      expect(visit(j, g).said[0]).toBe(step.again);
    }
    expect(said).toEqual(g.visits.slice(1).map((s) => s.first));
    // the whole trail cleared: they no longer point anywhere on it
    expect(visit(j, g).said.at(-1)).toBe(g.allHeld);
  });

  test("with the trail's wilds all held, they send you to the mythic's lair", () => {
    const g = BELIEVERS.groups.find((x) => x.id === "porchlight")!, hollows = sections(REGIONS[1]!);
    const j = newJourney(["squonk", "hodag", "jackalope"])!;
    for (const id of new Set(hollows.flatMap((s) => s.wilds))) bind(j, id, 5);
    const hint = visit(j, g).said.at(-1)!;
    expect(hint).toContain(creature(hollows.at(-1)!.keeper).name);
    expect(hint).toContain(hollows.at(-1)!.name);
    bind(j, hollows.at(-1)!.keeper, 20);
    expect(visit(j, g).said.at(-1)).toBe(g.allHeld);
  });

  test("a lines file the cms broke fails at load, not as a silent camp", () => {
    expect(() => Lines({ ...BELIEVERS, groups: [] })).toThrow();
    expect(() => Lines({ ...BELIEVERS, groups: [{ ...BELIEVERS.groups[0]!, visits: [] }] })).toThrow();
    expect(() => Lines({ ...BELIEVERS, groups: [{ ...BELIEVERS.groups[0]!, hint: 3 }] })).toThrow();
  });
});
