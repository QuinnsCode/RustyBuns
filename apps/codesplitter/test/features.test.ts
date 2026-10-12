import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// client.html and features.html fetch this at runtime, so nothing else parses it: #884 merged it
// with conflict markers in and the features page broke on main.
test("features.json parses and every entry is whole", () => {
  const feats = JSON.parse(readFileSync(join(import.meta.dir, "../src/features.json"), "utf8"));
  expect(Array.isArray(feats)).toBe(true);
  expect(feats.length).toBeGreaterThan(0);
  for (const f of feats) {
    for (const k of ["id", "icon", "title", "what"]) {
      expect(typeof f[k] === "string" && f[k].trim() !== "", `${f.id ?? JSON.stringify(f)} needs ${k}`).toBe(true);
    }
  }
  const ids = feats.map((f: { id: string }) => f.id);
  expect(ids.filter((id: string, i: number) => ids.indexOf(id) !== i)).toEqual([]);
});
