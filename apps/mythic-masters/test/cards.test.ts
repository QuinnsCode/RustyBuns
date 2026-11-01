import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PICKS } from "../src/art.ts";
import { ART } from "../src/card.ts";
import { ROSTER } from "../src/roster.ts";

// The cards show pictures other people made, so each one has to be saved, credited, and under a licence that
// lets us show it. A new pick in art.ts that nobody fetched, or one under a licence we can't use, fails here.
describe("the bestiary's pictures", () => {
  test("every pick is fetched, saved, credited and openly licensed", () => {
    const ids = new Set(ROSTER.map((c) => c.id));
    for (const [id, pick] of Object.entries(PICKS)) {
      expect(ids.has(id)).toBe(true);
      for (const side of ["bw", "color"] as const) {
        if (!pick[side]) continue;
        const pic = ART[id]?.[side];
        expect(pic, `${id} ${side}: run bun scripts/fetch-art.ts`).toBeDefined();
        expect(existsSync(join(import.meta.dir, "../public", pic!.src))).toBe(true);
        expect(pic!.license).toMatch(/^(Public domain|CC0|No restrictions|KOGL Type 1|CC BY(-SA)? [1-4]\.\d)$/);
        expect(pic!.artist.length).toBeGreaterThan(0);
      }
    }
  });

  test("every beast has a picture, and each one drawn by us has its source and a saved copy", () => {
    for (const c of ROSTER) expect(ART[c.id]?.bw ?? ART[c.id]?.color, c.id).toBeDefined();
    for (const [id, sides] of Object.entries(ART)) for (const pic of [sides.bw, sides.color]) {
      if (!pic?.page.includes("/QuinnsCode/")) continue;
      expect(existsSync(join(import.meta.dir, "../art-src", `${id}.svg`)), id).toBe(true);
      expect(existsSync(join(import.meta.dir, "../public", pic.src)), id).toBe(true);
    }
  });

  test("the first sixteen beasts all have a picture", () => {
    for (const c of ROSTER.slice(0, 16)) expect(ART[c.id]?.bw ?? ART[c.id]?.color, c.id).toBeDefined();
  });
});
