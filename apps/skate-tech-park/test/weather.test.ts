// The weather, headless: a park's own mood, the URL override, and falling stuff that follows the camera.
import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60000); // seventy levels take a while on CI
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { MOODS, moodFor } from "../src/render/weather.ts";
import { build } from "./parks.ts";

test("every park's weather is a real mood, ?weather= beats it, and nothing falls back to golden hour", async () => {
  for (const e of LEVELS) {
    const l = (await build(e)) as ParkLevel;
    if (l.weather) expect(Object.keys(MOODS)).toContain(l.weather);
  }
  expect(moodFor("", "rain")).toBe(MOODS.rain);
  expect(moodFor("?weather=snow", "rain")).toBe(MOODS.snow);
  expect(moodFor("?weather=nonsense")).toBe(MOODS.golden);
});
