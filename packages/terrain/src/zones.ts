// The seven real zones Park Hide & Seek fetches (apps/park-hide-seek/scripts/fetch-zones.ts writes
// src/zones/*.json here): Terrarium heightmaps plus landmarks, shared by every app that rides real ground.
import elCapitan from "./zones/el-capitan.json";
import glacierPoint from "./zones/glacier-point.json";
import grandPrismatic from "./zones/grand-prismatic.json";
import halfDome from "./zones/half-dome.json";
import mariposaGrove from "./zones/mariposa-grove.json";
import oldFaithful from "./zones/old-faithful.json";
import yosemiteFalls from "./zones/yosemite-falls.json";
import type { ZoneData } from "./terrain.ts";

/** Park Hide & Seek's lobby order. Each zone also carries its park, blurb, trees and landmarks; see its zones/types.ts. */
export const ZONE_DATA = [halfDome, elCapitan, yosemiteFalls, glacierPoint, mariposaGrove, oldFaithful, grandPrismatic];

export const zoneData = (id: string): ZoneData => {
  const z = ZONE_DATA.find((d) => d.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return z as unknown as ZoneData;
};
