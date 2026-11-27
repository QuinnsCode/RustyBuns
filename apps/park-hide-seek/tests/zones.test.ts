// Every zone a round can land on reads through the ZoneData guard, and a zone file of the wrong shape says which field.
import { expect, test } from "bun:test";
import { Bad } from "@rustybuns/util/guard";
import { zoneById } from "../src/zones/zone.ts";
import { ZONE_INDEX } from "../src/zones/index.ts";
import { ZoneData } from "../src/zones/types.ts";
import { ZONE_DATA, loadZone } from "@rustybuns/terrain";

// Reads the files straight through the guard rather than loadZoneData: what's loaded is module state shared with
// the other files in a lane, and hunt.test.ts needs a zone that hasn't come in yet.
test("every zone file reads through the guard, and the bundled ones build their ground", async () => {
  for (const row of ZONE_INDEX) expect(ZoneData({ ...(await loadZone(row.id)), ...row }).center).toHaveLength(2);
  for (const z of ZONE_DATA) expect(Number.isFinite(zoneById(z.id).height(0, 0))).toBe(true);
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
