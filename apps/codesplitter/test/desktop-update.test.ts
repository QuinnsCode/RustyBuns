import { test, expect } from "bun:test";
import { watched } from "../scripts/update.ts";

test("watched: a process that isn't under desktop:watch says no", async () => {
  expect(await watched(process.pid)).toBe(false);
});
