// The reference kit (scripts/beast-refs.ts): only pictures we may show with credit are fetched, and a saved
// refs/<id>.json is read through its guard, so a hand-edited one with a missing trait fails loudly.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { freeLicense } from "../scripts/commons.ts";
import { Refs } from "../scripts/beast-refs.ts";

test("only public domain, CC0 and CC BY / BY-SA licences pass", () => {
  const cases: [string, boolean][] = [
    ["Public domain", true], ["PD-US", true], ["CC0", true], ["CC BY 4.0", true], ["CC BY-SA 3.0", true], ["CC-BY-SA-2.5", true],
    ["CC BY-NC 2.0", false], ["CC BY-ND 4.0", false], ["CC BY-NC-SA 3.0", false], ["Fair use", false], ["", false], ["GFDL", false],
  ];
  for (const [s, ok] of cases) expect([s, freeLicense(s)]).toEqual([s, ok]);
});

test("every committed refs/<id>.json reads through the guard, and a wrong shape does not", () => {
  const dir = join(import.meta.dir, "..", "refs");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) Refs(require(join(dir, f)));
  expect(() => Refs({ id: "nessie", name: "Nessie", query: "x", images: [{ file: "../etc/passwd", from: "search" }], traits: {} })).toThrow();
});
