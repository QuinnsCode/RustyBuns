import { test, expect } from "bun:test";
import { loadMine, saveMine } from "../src/ui/mine.ts";
import { apply, sanitize } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";

const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("save my setup, let someone mess with it, and come back to it; the solo project is kept apart", () => {
  const store = fakeStore(), mine = sanitize(demoProject())!;
  expect(loadMine("setup", store)).toBeNull();
  expect(saveMine("setup", mine, store)).toBe(true);
  const messed = apply(mine, { t: "global", bpm: 200 });
  expect(saveMine("solo", messed, store)).toBe(true);
  expect(loadMine("setup", store)).toEqual(mine);
  expect(loadMine("solo", store)?.bpm).toBe(200);
});

test("a stored setup that no longer reads as a project, or a browser that won't store, gives nothing back", () => {
  const store = fakeStore();
  store.m.set("fm-daw:setup", "{not json");
  store.m.set("fm-daw:solo", JSON.stringify({ tracks: "nope" }));
  expect(loadMine("setup", store)).toBeNull();
  expect(loadMine("solo", store)).toBeNull();
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  expect(saveMine("setup", demoProject(), full)).toBe(false);
});
