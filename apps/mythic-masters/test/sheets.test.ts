import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { check } from "@rustybuns/util/guard";
import { SheetWho } from "../src/roster.ts";

// Who a beast sheet is (beasts/<id>.json): the build reads it and a generator that rewrites a sheet keeps it, both
// through one guard. Every authored sheet passes; a hand-edit that breaks one is caught here, not in Blender.
const DIR = join(import.meta.dir, "..", "beasts");

test("every authored sheet says who it is", async () => {
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    const who = check(SheetWho, await Bun.file(join(DIR, f)).json());
    expect(who?.id, f).toBe(f.slice(0, -5));
  }
});

test.each([
  ["no about", { id: "hodag", name: "Hodag", archetype: "tank" }],
  ["an archetype the roster lacks", { id: "hodag", name: "Hodag", about: "x", archetype: "wizard" }],
  ["an id that isn't a file name", { id: "../hodag", name: "Hodag", about: "x", archetype: "tank" }],
  ["a list", [{ id: "hodag" }]],
])("a sheet with %s is refused", (_, raw) => { expect(check(SheetWho, raw)).toBeNull(); });
