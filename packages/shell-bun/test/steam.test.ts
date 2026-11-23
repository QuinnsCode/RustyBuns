// The game's Steam API (#2877): the bridge inside the Steam build, the no-op twin everywhere else.
import { test, expect } from "bun:test";
import { noSteam, steam } from "../src/steam.ts";

test("no bridge (web, plain desktop) gets the no-op twin", async () => {
  expect(steam({})).toBe(noSteam);
  expect(steam({ rbSteam: { info: 1 } })).toBe(noSteam);
  expect(await steam({}).info()).toEqual({ available: false, deck: false });
  expect(await steam({}).achievement("A")).toBe(false);
});

test("the Steam build's bridge answers, and a null answer reads as off", async () => {
  const calls: unknown[][] = [];
  const rbSteam = {
    info: async () => null,
    achievement: async (id: string) => { calls.push(["a", id]); return true; },
    presence: async (k: string, v?: string) => { calls.push(["p", k, v]); return true; },
    invite: async () => { calls.push(["i"]); return true; },
  };
  const s = steam({ rbSteam });
  expect(await s.info()).toEqual({ available: false, deck: false });
  expect(await s.achievement("FIRST_HIPPO")).toBe(true);
  await s.presence("steam_display", "#Status");
  await s.invite();
  expect(calls).toEqual([["a", "FIRST_HIPPO"], ["p", "steam_display", "#Status"], ["i"]]);
});
