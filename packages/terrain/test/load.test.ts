// Every zone on disk can be asked for by id, and an id that isn't there says so.
import { readdirSync } from "node:fs";
import { expect, test } from "bun:test";
import { ZONE_FILES, loadZone } from "../src/load.ts";

test("every zones/*.json loads by its id", async () => {
  const ids = readdirSync(new URL("../src/zones", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  expect(ids.length).toBeGreaterThan(60);
  expect(Object.keys(ZONE_FILES).sort()).toEqual(ids.sort());
  const zion = await loadZone("zion");
  expect(zion.id).toBe("zion");
  expect(zion.n * zion.n * 2).toBeLessThanOrEqual(atob(zion.heights).length);
  expect(loadZone("atlantis")).rejects.toThrow("no zone atlantis");
});
