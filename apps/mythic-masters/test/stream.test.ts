import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import coarse from "../src/world/coarse.json";
import { BEAST_CAP, loadBeast, loadedBeasts } from "../src/beasts.ts";
import { ROSTER } from "../src/roster.ts";
import { cellAt, createStream, LOAD_R } from "../src/world/stream.ts";
import { buildWorld, CELL, cell, heightAt, refine, TICK_R, wildsNear, groundFrom } from "../src/world/world.ts";
import { REGIONS } from "../src/regions.ts";

setDefaultTimeout(60_000);
const file = (p: string) => new URL(`../public/${p}`, import.meta.url);

describe("streaming the world", () => {
  test("walking across eight regions keeps the loaded regions and the beast cache under their caps", async () => {
    // Beasts come off disk as the page would fetch them.
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request) => {
      try { return new Response(readFileSync(file(String(u).replace(/^\//, "").split("?")[0]!))); } catch { return new Response(null, { status: 404 }); }
    }) as typeof fetch;
    try {
      const w = buildWorld(coarse), moved: number[] = [];
      const stream = createStream(w, async (n) => { try { return new Uint8Array(readFileSync(file(`ground/${n}.bin`))); } catch { return undefined; } }, (n) => moved.push(n));
      const row = 4 * CELL + CELL / 2, ids = ROSTER.map((c) => c.id), most = { loaded: 0, beasts: 0 };
      let met = 0;
      // West to east along one row of the grid: every cell on it, one beast met a cell.
      for (let x = CELL / 2; x < 8 * CELL; x += 160) {
        stream.update(x, row);
        await stream.settled();
        most.loaded = Math.max(most.loaded, stream.loaded().length);
        if (Math.floor(x / CELL) >= met) { for (let k = 0; k < 4; k++) await loadBeast(ids[(met * 4 + k) % ids.length]!); met++; }
        most.beasts = Math.max(most.beasts, loadedBeasts().length);
      }
      expect(met).toBe(8);
      expect(most.loaded).toBeLessThanOrEqual((2 * LOAD_R + 1) ** 2);
      expect(most.loaded).toBeGreaterThan(3);
      expect(loadedBeasts().length).toBeLessThanOrEqual(BEAST_CAP);
      expect(most.beasts).toBeLessThanOrEqual(BEAST_CAP);
      // Everything still loaded is round the last cell; the regions behind went back to their coarse ground.
      const here = cellAt(7 * CELL + CELL / 2, row);
      expect(here[0]).toBe(7);
      for (const n of stream.loaded()) expect(Math.abs(cell(REGIONS.find((r) => r.n === n)!)[0] - here[0])).toBeLessThanOrEqual(LOAD_R);
      expect(most.beasts).toBe(BEAST_CAP); // the cap was reached, so it did evict
      expect(moved.length).toBeGreaterThan(stream.loaded().length);
    } finally { globalThis.fetch = real; }
  });

  test("a region's file refines its heights in place, and leaving puts the coarse ground back", () => {
    const w = buildWorld(coarse), g = REGIONS[0]!, at = { x: 2.5 * CELL, z: 2.5 * CELL };
    const before = Float32Array.from(w.y);
    expect(refine(w, g.n, groundFrom(readFileSync(file(`ground/${g.n}.bin`))))).not.toBeNull();
    expect(w.y.some((v, i) => v !== before[i])).toBe(true);
    refine(w, g.n);
    for (let i = 0; i < w.y.length; i++) expect(w.y[i]!).toBeCloseTo(before[i]!, 4);
    expect(Number.isFinite(heightAt(w, at.x, at.z))).toBe(true);
  });

  test("dens more than two regions away do not tick", () => {
    const w = buildWorld(coarse), all = new Set(REGIONS.map((g) => g.n));
    const x = 3 * CELL, z = 3 * CELL, far = wildsNear(w, x, z, 0, all, 20 * CELL);
    expect(far.length).toBeGreaterThan(0);
    for (const c of far) expect(Math.max(Math.abs(Math.floor(c.x / CELL) - 3), Math.abs(Math.floor(c.z / CELL) - 3))).toBeLessThanOrEqual(TICK_R);
  });
});
