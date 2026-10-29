// A list built from one JSON file per item plus an order.txt (codeSplitter's feature strip, qCRM's tour): a new item is
// a new file and a line in order.txt, so two branches that each add one merge clean. This takes the files already read
// (the caller reads a folder, or a bundler's glob), so it has no filesystem in it.
import { Bad, type Guard } from "./guard.ts";

/**
 * Every file's guarded content with its id, in order.txt's order, then any the order doesn't name, by id.
 * `files` maps an id to the parsed JSON. Throws when a file isn't whole, or order.txt names an id with no file or names one twice.
 */
export function ordered<T>(files: Record<string, unknown>, order: string, guard: Guard<T>, where: string): (T & { id: string })[] {
  const ids = Object.keys(files).sort();
  const names = order.split("\n").map((l) => l.trim()).filter(Boolean);
  const missing = names.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`${where}/order.txt names items with no file: ${missing.join(", ")}`);
  const twice = names.filter((id, i) => names.indexOf(id) !== i);
  if (twice.length) throw new Error(`${where}/order.txt names these twice: ${twice.join(", ")}`);
  return [...names, ...ids.filter((id) => !names.includes(id))].map((id) => {
    try { return { id, ...guard(files[id]) }; }
    catch (e) { throw e instanceof Bad ? new Error(`${where}/${id}.json needs ${e.path.join(".") || e.why}`) : e; }
  });
}
