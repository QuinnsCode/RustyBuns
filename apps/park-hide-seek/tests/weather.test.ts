import { describe, expect, test } from "bun:test";
import { HUNT, Hunt, parseMsg } from "../src/hunt/game.ts";
import { SIGHT, clearSky, sightRange, soundJitter, stepReach, type Sky } from "../src/hunt/sim.ts";
import { Room, TICK_MS } from "../src/room.ts";
import { describe as say, parseWeather, todAt, weatherUrl, type Weather } from "../src/weather.ts";

/** Open-Meteo's answer, as checked from Yosemite. */
const reply = (current: Record<string, unknown>, sun = { sunrise: "2026-10-08T06:59", sunset: "2026-10-08T18:30" }) => ({
  timezone: "America/Los_Angeles",
  current: { time: "2026-10-08T15:30", temperature_2m: 18.7, weather_code: 0, cloud_cover: 14, wind_speed_10m: 17.6, precipitation: 0, is_day: 1, ...current },
  daily: { time: ["2026-10-08"], sunrise: [sun.sunrise], sunset: [sun.sunset] },
});

describe("reading the weather", () => {
  test("the request asks for what the game uses, at the zone", () => {
    const u = new URL(weatherUrl(-119.5332, 37.7459));
    expect(u.searchParams.get("latitude")).toBe("37.746");
    expect(u.searchParams.get("longitude")).toBe("-119.533");
    expect(u.searchParams.get("current")).toBe("temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation,is_day");
    expect(u.searchParams.get("timezone")).toBe("auto");
  });

  test("a clear afternoon", () => {
    const w = parseWeather(reply({}))!;
    expect(w.sky).toEqual({ tod: "day", fog: 0, rain: 0, wind: 0.3, overcast: false, snow: false });
    expect(w.local).toBe("15:30");
    expect(say(w)).toBe("19°C, clear, 3:30 pm");
  });

  test("dusk round sunset and sunrise, night in between", () => {
    expect(todAt("18:10", true, "06:59", "18:30")).toBe("dusk");
    expect(todAt("2026-10-08T19:00", false, "2026-10-08T06:59", "2026-10-08T18:30")).toBe("dusk");
    expect(todAt("21:00", false, "06:59", "18:30")).toBe("night");
    expect(todAt("03:00", false, "06:59", "18:30")).toBe("night");
    expect(todAt("06:45", false, "06:59", "18:30")).toBe("dusk");
    expect(todAt("12:00", true, "06:59", "18:30")).toBe("day");
    // No sun times: is_day decides.
    expect(todAt("12:00", false)).toBe("night");
  });

  test("rain, fog, snow, wind and cloud", () => {
    const rain = parseWeather(reply({ weather_code: 65, precipitation: 6, cloud_cover: 100 }))!.sky;
    expect(rain.rain).toBe(1);
    expect(rain.overcast).toBe(true);
    expect(rain.snow).toBe(false);
    expect(parseWeather(reply({ weather_code: 45 }))!.sky.fog).toBe(1);
    expect(parseWeather(reply({ weather_code: 73 }))!.sky.snow).toBe(true);
    expect(parseWeather(reply({ wind_speed_10m: 70 }))!.sky.wind).toBe(1);
    expect(parseWeather(reply({ wind_speed_10m: 3 }))!.sky.wind).toBe(0);
  });

  test("junk is not weather", () => {
    expect(parseWeather(null)).toBeNull();
    expect(parseWeather({ error: true, reason: "nope" })).toBeNull();
    expect(parseWeather({ current: { time: "2026-10-08T15:30", temperature_2m: "warm", weather_code: 0 } })).toBeNull();
  });
});

describe("weather in the sim", () => {
  const sky = (s: Partial<Sky>): Sky => ({ ...clearSky("day"), ...s });

  test("fog shortens sight and the flashlight; a cloudy night has no moon", () => {
    expect(sightRange(sky({})).open).toBe(SIGHT.range.day);
    expect(sightRange(sky({ fog: 1 })).open).toBeLessThan(SIGHT.range.day * 0.5);
    expect(sightRange(sky({ tod: "night", fog: 1 })).torch).toBeLessThan(SIGHT.torch.range * 0.6);
    expect(sightRange(sky({ tod: "night", overcast: true })).open).toBeLessThan(SIGHT.range.night);
    // Clouds alone don't change the day.
    expect(sightRange(sky({ overcast: true })).open).toBe(SIGHT.range.day);
  });

  test("rain hushes footsteps; wind blurs where sounds come from", () => {
    expect(stepReach(sky({ rain: 1 }), 45)).toBeLessThan(25);
    expect(stepReach(sky({}), 45)).toBe(45);
    expect(soundJitter(sky({ wind: 1 }), 2)).toBeGreaterThan(4);
    expect(soundJitter(sky({}), 2)).toBe(2);
  });
});

const storm: Weather = { sky: { tod: "night", fog: 0.25, rain: 1, wind: 0.8, overcast: true, snow: false }, tempC: 6, code: 65, local: "22:10", label: "Heavy rain" };

function lobby(live = true) {
  const g = new Hunt(5);
  const now = 1_000_000;
  g.join("a", "A", now, { host: true });
  g.join("b", "B", now);
  g.handle("a", { t: "settings", zone: "half-dome", tod: "day", live }, now);
  return { g, now };
}

describe("live weather in a round", () => {
  test("the host's reading goes to everyone, and plays", () => {
    const { g, now } = lobby();
    g.handle("a", { t: "start" }, now);
    const want = g.wantsWeather()!;
    expect(want.center).toEqual([-119.5332, 37.7459]);
    // Until it arrives, the lobby's pick shows.
    expect(g.view("b", now).round!.sky.tod).toBe("day");
    g.setWeather(want.round, storm, now + 500);
    expect(g.wantsWeather()).toBeNull();
    for (const who of ["a", "b"]) {
      const v = g.view(who, now + 600).round!;
      expect(v.sky).toEqual(storm.sky);
      expect(v.weather!.label).toBe("Heavy rain");
    }
    expect(g.log.at(-1)).toContain("Live from Half Dome: 6°C, heavy rain, 10:10 pm");
    // A second answer for the same round changes nothing.
    g.setWeather(want.round, null, now + 700);
    expect(g.sky()).toEqual(storm.sky);
  });

  test("no weather (offline): the lobby's time of day, clear", () => {
    const { g, now } = lobby();
    g.handle("a", { t: "start" }, now);
    g.setWeather(g.round!.id, null, now);
    expect(g.sky()).toEqual(clearSky("day"));
  });

  test("weather that never comes is settled when the hunt starts, and too late after", () => {
    const { g, now } = lobby();
    g.handle("a", { t: "start" }, now);
    const id = g.round!.id;
    let t = now;
    while (g.phase !== "hunt") { t += TICK_MS; g.tick(t); }
    expect(g.sky()).toEqual(clearSky("day"));
    g.setWeather(id, storm, t);
    expect(g.sky()).toEqual(clearSky("day"));
  });

  test("live off: the lobby decides and nothing is fetched", () => {
    const { g, now } = lobby(false);
    g.handle("a", { t: "start" }, now);
    expect(g.wantsWeather()).toBeNull();
    expect(g.view("a", now).live).toBe(false);
  });

  test("the room fetches once per round, and only when hosting asks it to", async () => {
    const calls: [number, number][] = [];
    const room = new Room(5, async (c) => { calls.push(c); return storm; });
    const g = room.game;
    let now = 1_000_000;
    g.join("a", "A", now, { host: true });
    g.handle("a", { t: "settings", zone: "el-capitan" }, now);
    g.handle("a", { t: "bot", level: "easy" }, now);
    g.handle("a", { t: "start" }, now);
    for (let i = 0; i < 10; i++) { now += TICK_MS; room.tick(now); }
    await Bun.sleep(0);
    expect(calls).toHaveLength(1);
    expect(g.sky()).toEqual(storm.sky);
    // A guest's page runs no Room of its own: a Room without a fetcher never calls out.
    const quiet = new Room(5);
    quiet.game.join("a", "A", now, { host: true });
    quiet.game.handle("a", { t: "bot", level: "easy" }, now);
    quiet.game.handle("a", { t: "start" }, now);
    for (let t = 0; t < (HUNT.dropSecs + HUNT.hideSecs + 1) * 1000; t += TICK_MS) { now += TICK_MS; quiet.tick(now); }
    expect(quiet.game.sky()).toEqual(clearSky("night"));
  });

  test("the lobby's live switch comes over the wire", () => {
    expect(parseMsg({ t: "settings", live: true })).toEqual({ t: "settings", zone: undefined, tod: undefined, live: true, laps: undefined });
    expect((parseMsg({ t: "settings", live: "yes" }) as any).live).toBeUndefined();
  });
});

describe("rain in the hunt", () => {
  test("a ranger 30 m off hears a running camper in the dry, not in a downpour", () => {
    for (const [weather, heard] of [[null, true], [storm, false]] as const) {
      const { g, now } = lobby();
      g.handle("a", { t: "start" }, now);
      g.setWeather(g.round!.id, weather, now);
      let t = now;
      while (g.phase !== "hunt") { t += TICK_MS; g.tick(t); }
      const r = g.round!;
      const ranger = r.actors.get(r.rangers[0])!, camper = [...r.actors.values()].find((a) => a.role === "camper")!;
      camper.x = ranger.x + 30; camper.y = ranger.y;
      camper.run = true; camper.crouch = false; camper.movedAt = t;
      t += 500;
      camper.movedAt = t;
      g.tick(t);
      expect(r.cues.some((c) => c.kind === "step")).toBe(heard);
    }
  });
});
