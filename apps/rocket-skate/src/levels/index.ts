// Every level the picker offers: the training plaza, then the parks on real ground.
import type { Level } from "../level.ts";
import { plaza } from "./plaza.ts";
import { elCapitan } from "./el-capitan.ts";
import { glacierPoint } from "./glacier-point.ts";
import { mariposaGrove } from "./mariposa-grove.ts";
import { oldFaithful } from "./old-faithful.ts";
import { type ParkLevel, parkLevel } from "./park.ts";

export type Entry = { id: string; name: string; blurb: string; load: () => Level | ParkLevel };

const park = (spec: Parameters<typeof parkLevel>[0]): Entry => ({ id: spec.id, name: spec.name, blurb: spec.blurb, load: () => parkLevel(spec) });

export const LEVELS: Entry[] = [
  { id: "plaza", name: "Training Plaza", blurb: "An 80 m walled plaza: a kicker, a funbox, a rail and the gap the roadster clears.", load: () => plaza },
  park(elCapitan),
  park(glacierPoint),
  park(oldFaithful),
  park(mariposaGrove),
];
