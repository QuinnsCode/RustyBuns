import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { surfaceFor, surfaceOf } from "../src/hide.ts";

const dir = join(import.meta.dir, "../beasts");
const sheets = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; material: string; palette: Record<string, unknown> });

test("a beast's hide detail follows what its sheet says it is covered in", () => {
  const wrong = sheets.filter((s) => (s.material === "fur" || s.material === "scale") && surfaceOf(Object.keys(s.palette)) !== s.material).map((s) => s.id);
  expect(wrong).toEqual([]);
});

test("horns, claws and eyes stay smooth; a mane is fur on any beast", () => {
  expect([surfaceFor("horn", "hide"), surfaceFor("claw", "fur"), surfaceFor("eye", "scale")]).toEqual([null, null, null]);
  expect(surfaceFor("mane", "scale")).toBe("fur");
});
