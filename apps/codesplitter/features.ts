// The home page's feature strip, built from one file per feature (#935): src/features/<id>.json
// holds a feature's icon, title and what, and src/features/order.txt lists the ids in the order
// the strip shows them, one per line. A new feature is a new file, and a line in order.txt if it
// should sit anywhere but last, so two branches that each add one merge clean. build.ts writes
// the result to dist/client/features.json, which client.html and features.html fetch.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Feature { id: string; icon: string; title: string; what: string }

export const FEATURES_DIR = join(import.meta.dir, "src/features");

/** Every feature, in order.txt's order, then any it doesn't name yet, by id. Throws on a feature that isn't whole, or an id in order.txt with no file. */
export function features(dir = FEATURES_DIR): Feature[] {
  const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const order = readFileSync(join(dir, "order.txt"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const missing = order.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`src/features/order.txt names features with no file: ${missing.join(", ")}`);
  const twice = order.filter((id, i) => order.indexOf(id) !== i);
  if (twice.length) throw new Error(`src/features/order.txt names these twice: ${twice.join(", ")}`);
  return [...order, ...ids.filter((id) => !order.includes(id))].map((id) => {
    const f = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    for (const k of ["icon", "title", "what"]) {
      if (!(typeof f[k] === "string" && f[k].trim() !== "")) throw new Error(`src/features/${id}.json needs ${k}`);
    }
    return { id, icon: f.icon, title: f.title, what: f.what };
  });
}
