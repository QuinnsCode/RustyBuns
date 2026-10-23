// The weather, headless: a park's own mood, the URL override, and falling stuff that follows the camera.
import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60000); // seventy levels take a while on CI
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { Lightning, MOODS, moodFor, Precip } from "../src/render/weather.ts";
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

test("rain falls and snow drifts, and either stays in a box round the camera wherever it goes", () => {
  for (const kind of ["rain", "snow"] as const) {
    const p = new Precip();
    p.begin(MOODS[kind]);
    expect(p.n).toBeGreaterThan(0);
    const cam = new THREE.Vector3(500, 20, -300), v = new THREE.Vector3();
    p.update(0.1, cam);
    for (let t = 0; t < 40; t++) {
      cam.x += 5; cam.z -= 3;
      p.update(0.25, cam);
      for (let i = 0; i < p.n; i += 97) {
        p.at(i, cam, v);
        expect(Math.abs(v.x - cam.x)).toBeLessThanOrEqual(30);
        expect(Math.abs(v.z - cam.z)).toBeLessThanOrEqual(30);
        expect(v.y - cam.y).toBeGreaterThanOrEqual(-4);
        expect(v.y - cam.y).toBeLessThanOrEqual(26);
      }
    }
  }
});

test("clear weather has only a few motes, and the storm flashes then goes dark", () => {
  const clear = new Precip(), storm = new Precip();
  clear.begin(MOODS.overcast);
  storm.begin(MOODS.storm);
  expect(clear.n).toBe(0);
  expect(storm.n).toBeGreaterThan(clear.n);
  const l = new Lightning();
  let peak = 0, end = 0;
  for (let t = 0; t < 20 * 60; t++) { end = l.update(1 / 60); peak = Math.max(peak, end); }
  expect(peak).toBeGreaterThan(0.5);
  expect(end).toBeLessThan(peak);
});

test("Glacier Point's dusk keeps enough light on the ground for the board to read at spawn", () => {
  const d = MOODS.dusk, lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
  const light = (lum(d.skyFill) + lum(d.groundFill)) / 2 / 255 * d.fill + d.sunPower * Math.sin(Math.atan2(d.sun[1], Math.hypot(d.sun[0], d.sun[2])));
  expect(light * d.exposure).toBeGreaterThan(1.3);
});
