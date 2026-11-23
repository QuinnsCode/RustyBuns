// The campaign as a player walks it: take a mine and supply follows, chase the bases down lane by lane, and refit
// after a beating. Battles are settled by hand here; battle.test.ts fights them.
import { expect, test } from "bun:test";
import { FULL_FLEET } from "../src/sim/scenarios.ts";
import { jump, neighbours, newSector, refit, rimTurn, settle, type Sector } from "../src/sector.ts";

/** The next world on the shortest lane path from where the fleet is to any world that matches. */
function toward(s: Sector, want: (id: string) => boolean): string {
  const prev = new Map<string, string>([[s.at, ""]]), queue = [s.at];
  while (queue.length) {
    const id = queue.shift()!;
    if (id !== s.at && want(id)) { let step = id; while (prev.get(step) !== s.at) step = prev.get(step)!; return step; }
    for (const n of neighbours(id)) if (!prev.has(n)) { prev.set(n, id); queue.push(n); }
  }
  return s.at;
}

test("a campaign: seize a mine and supply follows, chase every base down, and the sector is won", () => {
  const s = newSector(11);
  const spec = jump(s, "kell");
  expect(spec?.kind).toBe("seize");
  settle(s, "win", structuredClone(FULL_FLEET));
  expect(s.held).toContain("kell");
  // A mine pays three a turn on top of the yard's two.
  const before = s.supply;
  rimTurn(s);
  expect(s.supply - before).toBe(5);

  for (let turn = 0; turn < 40 && !s.outcome; turn++) {
    const next = toward(s, (id) => !!s.bases[id] || s.forming[id] !== undefined);
    const fight = jump(s, next);
    if (fight) settle(s, "win", structuredClone(FULL_FLEET));
  }
  expect(s.outcome).toBe("won");
  expect(Object.keys(s.bases)).toEqual([]);
});

test("left alone, the Rim finishes its base on Ilk and spreads; beaten, the fleet limps home and refits", () => {
  const s = newSector(5);
  for (let i = 0; i < 9; i++) rimTurn(s);
  expect(s.bases.ilk).toBeGreaterThan(0);
  expect(Object.keys(s.bases).length + Object.keys(s.forming).length).toBeGreaterThan(3);

  const t = newSector(5);
  jump(t, "kell");
  settle(t, "loss", structuredClone(FULL_FLEET));
  expect(t.at).toBe("aster");
  expect(t.fleet.hull).toBeLessThan(0.5);
  t.supply = 100;
  expect(refit(t)).toBe(true);
  expect(t.fleet).toEqual(FULL_FLEET);
  // Half price at the yard: 16 craft and 13 steps of hull cost about 15 supply, not 29.
  expect(100 - t.supply).toBeLessThan(16);
});
