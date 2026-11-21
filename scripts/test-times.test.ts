import { expect, test } from "bun:test";
import { timesFromLog } from "./test-times.ts";

// A file's time is its tests added up, or its wall time to the next header when a slow setup makes that longer.
test("a CI job's log becomes ms per test file", () => {
  const log = [
    "2026-11-21T04:34:32.000Z bun test v1.4.3 (c6da4a4d3)",
    "2026-11-21T04:34:32.000Z ##[group]test/quick.test.ts:",
    "2026-11-21T04:34:32.100Z (pass) one [0.55ms]",
    "2026-11-21T04:34:32.200Z (pass) two [1.50s]",
    "2026-11-21T04:34:33.700Z ##[endgroup]",
    "2026-11-21T04:34:33.700Z ##[group]test/browser.test.ts:",
    "2026-11-21T04:35:13.700Z (fail) a journey [9000.00ms]",
    "2026-11-21T04:35:14.000Z ##[endgroup]",
    "2026-11-21T04:35:14.000Z  1 pass",
  ].join("\n");
  expect(timesFromLog(log)).toEqual({ "test/browser.test.ts": 40300, "test/quick.test.ts": 1700 });
});
