// Every zone a round can land on reads through the ZoneData guard, and a zone file of the wrong shape says which field.
import { expect, test } from "bun:test";
import { Bad } from "@rustybuns/util/guard";
import { ZONES, loadZoneData, zoneById } from "../src/zones/zone.ts";
import { ZoneData } from "../src/zones/types.ts";
import { ZONE_DATA } from "@rustybuns/terrain";

test("every zone loads through the guard and builds its ground", async () => {
  for (const z of ZONES) await loadZoneData(z.id);
  for (const z of ZONES) {
    const zone = zoneById(z.id);
    expect(zone.data.center).toHaveLength(2);
    expect(Number.isFinite(zone.height(0, 0))).toBe(true);
  }
});

test("a zone file of the wrong shape is refused, naming the field", () => {
  const good = ZONE_DATA[0];
  expect(ZoneData(good).id).toBe(good.id);
  const wrong: [unknown, string][] = [
    [{ ...good, trees: "palm" }, "trees"],
    [{ ...good, center: [1] }, "center"],
    [{ ...good, n: "161" }, "n"],
    [{ ...good, landmarks: [{ name: "Spire", kind: "tower", x: 0, y: 0 }] }, "landmarks"],
  ];
  for (const [v, field] of wrong) {
    try { ZoneData(v); throw new Error(`${field} let through`); } catch (e) {
      expect(e).toBeInstanceOf(Bad);
      if (e instanceof Bad) expect(e.path[0]).toBe(field);
    }
  }
});
