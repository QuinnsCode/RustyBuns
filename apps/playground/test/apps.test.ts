import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { freshness } from "../public/fresh.js";

type Entry = { name: string; line: string; play?: string; app?: string; download?: string; note?: string; stage: number; best: string[]; store?: string };
const apps: Entry[] = await Bun.file(`${import.meta.dir}/../public/apps.json`).json();

test("every entry with a source link names an app folder that exists", () => {
  for (const a of apps) if (a.app) expect(existsSync(`${import.meta.dir}/../../${a.app}`)).toBe(true);
});

test("play links are https and names are unique", () => {
  for (const a of apps) if (a.play) expect(new URL(a.play).protocol).toBe("https:");
  expect(new Set(apps.map((a) => a.name)).size).toBe(apps.length);
});

test("every app says how far along it is and the systems it plays best on", () => {
  for (const a of apps) {
    expect([1, 2, 3, 4]).toContain(a.stage);
    expect(a.best.length).toBeGreaterThan(0);
    for (const d of a.best) expect(["phone", "tablet", "desktop", "gamepad"]).toContain(d);
    if (a.store) expect(new URL(a.store).protocol).toBe("https:");
  }
});

test("every framework example names an app folder that exists", async () => {
  const fw: { frameworks: { app: string }[] } = await Bun.file(`${import.meta.dir}/../public/frameworks.json`).json();
  for (const f of fw.frameworks) expect(existsSync(`${import.meta.dir}/../../${f.app}`)).toBe(true);
});

test.each([
  ["16.4.3", "16.4.3", 4],
  ["1.168.60", "1.168.61", 3],
  ["7.3.5", "7.4.4", 2],
  ["7.18.4", "8.5.1", 1],
  ["2.1.0-beta.1", "2.0.9", 4],
])("%s against latest %s rates %i", (pinned, latest, r) => {
  expect(freshness(pinned, latest)).toBe(r);
});

test("public/ui.js is the current packages/ui bundle", async () => {
  const { bundle } = await import("../scripts/ui.ts");
  expect(await Bun.file(`${import.meta.dir}/../public/ui.js`).text()).toBe(await bundle());
});
