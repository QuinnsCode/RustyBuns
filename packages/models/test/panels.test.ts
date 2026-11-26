// Each speaker's connector panel (#6029): every speaker has one, its sockets are real connectors in genders they come
// in, on the face, and the sockets a cable goes into are the catalog's jacks.
import { expect, test } from "bun:test";
import { CONNECTORS } from "@rustybuns/util/connectors";
import { GEAR_SIZES, type GearId } from "../src/gear.ts";
import { PANELS } from "../src/panels.ts";
import { GEAR_IDS as catalogIds, gear as catalogGear, jackNames } from "../../gear/src/catalog.ts";

const speakers = catalogIds.filter((id) => catalogGear(id).speaker && id !== "cab-4x12" && id !== "synergy-horn" && id !== "tapped-horn-18");

test.each(speakers)("%s has its real panel", (id) => {
  const panel = PANELS[id as GearId];
  expect(panel).toBeDefined();
  const [w, h, d] = GEAR_SIZES[id as GearId].map((m) => m * 1000);
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
