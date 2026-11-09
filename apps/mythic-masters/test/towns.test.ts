import { describe, expect, test } from "bun:test";
import { hasTrail, newJourney } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { arrive, poiById } from "../src/world/poi.ts";
import { CLUES, DONE, take, type Spot } from "../src/world/hunts.ts";
import { beside, BOARD, DOORSTEP, line, outside, roomAt, step, toLocal, toWorld, TOWNS, type Town } from "../src/world/towns.ts";

/** Walks town `t` through `via` in 10 cm steps, the way a held key does; where you end up. */
function walk(t: Town, from: Spot, ...via: Spot[]): Spot {
  let at = from;
  for (const to of via) for (let i = 0; i < 400; i++) {
    const dx = to.x - at.x, dz = to.z - at.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    at = step(t, at, (dx / d) * Math.min(0.1, d), (dz / d) * Math.min(0.1, d));
  }
  return at;
}

describe("towns as pockets (#3966)", () => {
  test("every sighting board hangs in a town whose front door is the board's place, two per playable region", () => {
    for (const g of REGIONS.filter(hasTrail)) expect([g.n, [...TOWNS.values()].filter((t) => t.n === g.n).length]).toEqual([g.n, 2]);
    for (const t of TOWNS.values()) {
      expect(poiById(t.id)?.kind).toBe("board");
      // the door is the place you walk up to on the open ground, and the town turns round it
      expect(arrive(t.door, new Set()).map((p) => p.id)).toContain(t.id);
      const back = toLocal(t, toWorld(t, BOARD.read));
      expect([+back.x.toFixed(6), +back.z.toFixed(6)]).toEqual([BOARD.read.x, BOARD.read.z]);
    }
  });

  test("a visit: in at the door, the board past the counter, a word with everyone through the three rooms, and out", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!, t = TOWNS.values().next().value!;
    // the counter is in the way of a beeline to the back wall
    expect(walk(t, DOORSTEP, { x: 0, z: -8 }).z).toBeCloseTo(-6, 1);
    // round the end of it to the board
    const atBoard = walk(t, DOORSTEP, { x: 2.6, z: -4.4 }, { x: 4.6, z: -4.4 }, BOARD.read);
    expect(beside(t, atBoard)).toEqual({ board: true });
    // the witness is one of the people inside, and says something different once the contract is taken and once it's closed
    const witness = t.people.find((p) => p.who === t.hunt.witness)!;
    const said = [line(t, witness, undefined)];
    take(j, t.id);
    said.push(line(t, witness, j.hunts![t.id]), line(t, witness, CLUES), line(t, witness, DONE));
    expect(new Set(said).size).toBe(4);
    // the gas station on the left, the motel office on the right, each through its doorway (behind the witness, who
    // leans on the counter)
    const gas = walk(t, atBoard, { x: 4.6, z: -4.8 }, { x: -8, z: -4.8 }, { x: -8.3, z: -4.2 });
    expect([roomAt(gas)?.id, beside(t, gas)]).toEqual(["gas", { person: t.people.find((p) => p.id === "clerk")! }]);
    const motel = walk(t, gas, { x: -8, z: -4.8 }, { x: 7, z: -4.8 }, { x: 7, z: -3.7 }, { x: 9.7, z: -3.9 });
    expect([roomAt(motel)?.id, beside(t, motel)]).toEqual(["motel", { person: t.people.find((p) => p.id === "manager")! }]);
    // and back out of the front door onto the street
    const out = walk(t, motel, { x: 7, z: -3.7 }, { x: 7, z: -4.8 }, { x: 0, z: -4.8 }, { x: 0, z: 1.5 });
    expect(outside(out)).toBe(true);
  });
});
