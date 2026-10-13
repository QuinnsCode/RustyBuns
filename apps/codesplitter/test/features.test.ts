import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { features } from "../features.ts";

// client.html and features.html fetch the built features.json at runtime, so nothing else reads
// these files: #884 merged the old single features.json with conflict markers in and the features
// page broke on main. Now each feature is its own file (#935), and this keeps them whole.
test("every feature is whole, each once, and order.txt names only real ones", () => {
  const feats = features();
  expect(feats.length).toBeGreaterThan(0);
  const ids = feats.map((f) => f.id);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
});

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "features-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
};
const f = (title: string) => JSON.stringify({ icon: "star", title, what: `${title}, in short.` });

test("order.txt sets the order, and a feature it doesn't name yet goes last", () => {
  const d = dir({ "a.json": f("A"), "b.json": f("B"), "c.json": f("C"), "order.txt": "c\n\na\n" });
  expect(features(d).map((x) => x.id)).toEqual(["c", "a", "b"]);
});

test("a feature that isn't whole, or an id with no file, fails the build", () => {
  expect(() => features(dir({ "a.json": JSON.stringify({ icon: "star", title: "A" }), "order.txt": "" }))).toThrow("a.json needs what");
  expect(() => features(dir({ "a.json": f("A"), "order.txt": "a\nghost\n" }))).toThrow("ghost");
  expect(() => features(dir({ "a.json": f("A"), "order.txt": "a\na\n" }))).toThrow("twice");
});

// The home page's whole-map tabs name features by id; a renamed or deleted feature would silently drop off its tab.
test("every id on the home page's tabs is a real feature", async () => {
  const html = await Bun.file(join(import.meta.dir, "../src/client.html")).text();
  const block = html.slice(html.indexOf("const FMAP = ["), html.indexOf("async function featureMap"));
  const named = [...block.matchAll(/ids: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  const have = new Set(features().map((x) => x.id));
  expect(named.length).toBeGreaterThan(40);
  expect(named.filter((id) => !have.has(id))).toEqual([]);
  expect(named.filter((id, i) => named.indexOf(id) !== i)).toEqual([]);
});
