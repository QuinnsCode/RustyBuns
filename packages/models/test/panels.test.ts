// Each speaker's connector panel (#6029): its sockets are real connectors in genders they come in, on the face, and
// the sockets a cable goes into are the catalog's jacks. A box newly copied from a product gets its panel after (#6029's
// follow-up), so this holds each panel there is rather than asking every speaker for one.
import { expect, test } from "bun:test";
import { CONNECTORS } from "@rustybuns/util/connectors";
import { GEAR_SIZES, type GearId } from "../src/gear.ts";
import { PANELS } from "../src/panels.ts";
import { GEAR_IDS as catalogIds, gear as catalogGear, jackNames } from "../../gear/src/catalog.ts";

const ids = Object.keys(PANELS) as GearId[];

test.each(ids)("%s's panel is real connectors on its face, wired to the catalog's jacks", (id) => {
  const panel = PANELS[id];
  expect(catalogIds).toContain(id);
  expect(panel!.drive === "amp" ? catalogGear(id).amp : catalogGear(id).speaker).toBeDefined();
  const [w, h, d] = GEAR_SIZES[id].map((m) => m * 1000);
  for (const s of panel!.sockets) {
    expect(CONNECTORS[s.type].genders, `${id} ${s.role}`).toContain(s.gender);
    expect(Math.abs(s.at[0]), `${id} ${s.role}`).toBeLessThan(w! / 2);
    if (panel!.face === "bottom") expect(Math.abs(s.at[1])).toBeLessThan(d! / 2);
    else expect(s.at[1] > 0 && s.at[1] < h!, `${id} ${s.role}`).toBe(true);
  }
  const wired = panel!.sockets.flatMap((s) => (s.jack ? [s.jack] : []));
  expect(new Set(wired).size).toBe(wired.length);
  expect(wired.sort()).toEqual(jackNames(catalogGear(id)).sort());
});
