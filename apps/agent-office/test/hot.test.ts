import { expect, test } from "bun:test";
import { hot } from "../reload/hot.ts";

test("hot registers a script's dispose under its name, replacing an earlier one", () => {
  const g = globalThis as { __rbHot?: Record<string, { dispose: () => void }> };
  let n = 0;
  hot("rb-test", () => n++);
  hot("rb-test", () => (n += 10));
  g.__rbHot!["rb-test"]!.dispose();
  expect(n).toBe(10);
  delete g.__rbHot!["rb-test"];
});
