import { describe, expect, test } from "bun:test";
import { creature, learnset, ROSTER, SLOTS, teach } from "../src/roster.ts";
import { FIELDS, STRONG, typeMul } from "../src/fields.ts";
import { REGIONS } from "../src/regions.ts";

describe("the folklore roster", () => {
  test("76 creatures, each from its region's legends, with one move per slot and its signature as the ultimate", () => {
    expect(ROSTER).toHaveLength(76);
    expect(new Set(ROSTER.map((c) => c.id)).size).toBe(76);
    for (const c of ROSTER) {
      expect(REGIONS[c.region - 1]!.folklore.map((b) => b.name.toLowerCase())).toContain(c.name.toLowerCase());
      expect(c.moves.map((m) => m.slot)).toEqual([...SLOTS]);
      expect(c.moves[5]!.id).toBe(`${c.id}-signature`);
    }
  });

  test("creatures that share a field share its moves", () => {
    const [devil, howler] = [creature("jersey-devil"), creature("ozark-howler")];
    expect(devil.fields[0]).toBe("shadow");
    expect(howler.fields[0]).toBe("shadow");
    expect(devil.moves[0]!.id).toBe(howler.moves[0]!.id);
  });

  test("a creature can be taught a neighbouring field's move, but not just anything", () => {
    const hodag = creature("hodag"), { born, taught } = learnset(hodag);
    expect(born.map((m) => m.id)).toContain("stone-heavy");
    const iron = teach(hodag, "iron-heavy");            // stone's neighbour
    expect(iron?.moves.find((m) => m.slot === "heavy")?.id).toBe("iron-heavy");
    expect(taught.map((m) => m.id)).toContain("iron-heavy");
    expect(teach(hodag, "spirit-beam")).toBeNull();     // nothing in its fields leads there
    expect(teach(hodag, "jersey-devil-signature")).toBeNull();
  });

  test("every field is strong against something and something is strong against it", () => {
    for (const f of FIELDS) {
      expect(STRONG[f].length).toBeGreaterThan(0);
      expect(FIELDS.some((g) => STRONG[g].includes(f))).toBe(true);
    }
    expect(typeMul("tide", ["ember"])).toBeGreaterThan(1);
    expect(typeMul("ember", ["tide"])).toBeLessThan(1);
  });
});
