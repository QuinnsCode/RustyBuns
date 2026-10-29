// Layout (features.ts, src/features/): the home page's feature strip: a file per feature and their order, built into `features.json`
// The home page's feature strip, built from one file per feature (#935): src/features/<id>.json
// holds a feature's icon, title and what, and src/features/order.txt lists the ids in the order
// the strip shows them, one per line. A new feature is a new file, and a line in order.txt if it
// should sit anywhere but last, so two branches that each add one merge clean. build.ts writes
// the result to dist/client/features.json, which client.html and features.html fetch.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { obj, str, type Of } from "@rustybuns/util/guard";
import { ordered } from "@rustybuns/util/features";

const Feature = obj({ icon: str(Infinity), title: str(Infinity), what: str(Infinity) });
export type Feature = Of<typeof Feature> & { id: string };

export const FEATURES_DIR = join(import.meta.dir, "src/features");

/** Every feature, in order.txt's order, then any it doesn't name yet, by id. Throws on a feature that isn't whole, or an id in order.txt with no file. */
export function features(dir = FEATURES_DIR): Feature[] {
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown]));
  return ordered(files, readFileSync(join(dir, "order.txt"), "utf8"), Feature, "src/features");
}
