import { expect, test } from "bun:test";
import { clashes } from "./migration-numbers.ts";

test("two files sharing a number clash; timestamps and other files don't", () => {
  expect(clashes(["0003_meta.sql", "0003_oauth.sql", "0004_demo.sql"])).toEqual(["0003"]);
  expect(clashes(["20261103120000_a.sql", "20261103120000_b.sql", "0001_init.sql", "README.md"])).toEqual([]);
});
