import { expect, test } from "bun:test";
import { newestSupported, nodeFloors, nodeSupported } from "../src/node-version.ts";

test("node versions against Alchemy's floors (#3743)", () => {
  const floors = nodeFloors(">=22.22.3 <23 || >=24.11.1");
  expect(floors).toEqual(["22.22.3", "24.11.1"]);
  expect(nodeFloors(undefined)).toEqual(["22.22.3", "24.11.1"]);
  for (const [v, ok] of [["v22.21.1", false], ["v22.22.3", true], ["v22.23.4", true], ["v20.17.0", false],
    ["v23.9.0", false], ["v24.11.0", false], ["v24.11.1", true], ["v25.0.0", true]] as const) {
    expect([v, nodeSupported(v, floors)]).toEqual([v, ok]);
  }
  // What nvm had on the machine that hit it: name the one to `nvm use`.
  expect(newestSupported(["v20.14.0", "v22.21.1", "v22.23.4"], floors)).toBe("v22.23.4");
  expect(newestSupported(["v20.14.0", "v22.21.1"], floors)).toBeUndefined();
});
