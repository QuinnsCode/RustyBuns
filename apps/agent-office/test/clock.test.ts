import { expect, test } from "bun:test";
import { clock, zones } from "../clock/time.ts";

// 2026-10-10 22:42 UTC
const at = Date.UTC(2026, 9, 10, 22, 42);

test("the boards' clock reads in the zone you picked", () => {
  expect(clock(at, "America/Los_Angeles", "en-US")).toBe("3:42 PM PDT · ");
  expect(clock(at, "Europe/London", "en-GB")).toBe("23:42 BST · ");
  expect(clock(at, "UTC", "en-US")).toBe("10:42 PM UTC · ");
});

test("nothing fetched yet, no clock; a zone this browser doesn't know falls back to its own", () => {
  expect(clock(0, "UTC")).toBe("");
  expect(clock(at, "Mars/Olympus_Mons", "en-US")).toBe(clock(at, null, "en-US"));
});

test("Settings lists the zones", () => {
  expect(zones()).toContain("America/Los_Angeles");
});
