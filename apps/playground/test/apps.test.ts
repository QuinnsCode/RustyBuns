import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

type Entry = { name: string; line: string; play?: string; app?: string; download?: string };
const apps: Entry[] = await Bun.file(`${import.meta.dir}/../public/apps.json`).json();

test("every entry with a source link names an app folder that exists", () => {
  for (const a of apps) if (a.app) expect(existsSync(`${import.meta.dir}/../../${a.app}`)).toBe(true);
});

test("play links are https and names are unique", () => {
  for (const a of apps) if (a.play) expect(new URL(a.play).protocol).toBe("https:");
  expect(new Set(apps.map((a) => a.name)).size).toBe(apps.length);
});
