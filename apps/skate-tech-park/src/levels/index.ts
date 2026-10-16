// Every level the picker offers: the training plaza, then the parks on real ground.
import type { Level } from "../level.ts";
import { plaza } from "./plaza.ts";
import { elCapitan } from "./el-capitan.ts";
import { grandCanyon } from "./grand-canyon.ts";
import { glacierPoint } from "./glacier-point.ts";
import { grandPrismatic } from "./grand-prismatic.ts";
import { halfDome } from "./half-dome.ts";
import { mariposaGrove } from "./mariposa-grove.ts";
import { oldFaithful } from "./old-faithful.ts";
import { yosemiteFalls } from "./yosemite-falls.ts";
import { type ParkLevel, parkLevel } from "./park.ts";

export type Entry = { id: string; name: string; blurb: string; load: () => Level | ParkLevel };

const park = (spec: Parameters<typeof parkLevel>[0]): Entry => ({ id: spec.id, name: spec.name, blurb: spec.blurb, load: () => parkLevel(spec) });

export const LEVELS: Entry[] = [
  { id: "plaza", name: "Training Plaza", blurb: "An 80 m walled plaza to learn on: a kicker, a funbox, a rail and a gap.", load: () => plaza },
  park(elCapitan),
  park(glacierPoint),
  park(oldFaithful),
  park(mariposaGrove),
  park(halfDome),
  park(yosemiteFalls),
  park(grandPrismatic),
  park(grandCanyon),
];

/** The level a query string asks for (`?level=el-capitan`), else the first. */
export const pick = (search: string): Entry => LEVELS.find((l) => l.id === new URLSearchParams(search).get("level")) ?? LEVELS[0]!;

/** The start screen shows when the page was opened without choosing a level (or asking for the showroom). */
export const needsStartScreen = (search: string) => {
  const q = new URLSearchParams(search);
  return !q.has("level") && !q.has("showroom");
};
