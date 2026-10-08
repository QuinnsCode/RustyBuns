// The park's weather and time of day right now, from Open-Meteo (free, no key,
// for non-commercial use: https://open-meteo.com). Only whoever hosts the match
// calls it, once per round; everyone else gets the result in their view.

import { type Sky, type TimeOfDay } from "./hunt/sim.ts";

export interface Weather {
  sky: Sky;
  tempC: number;
  /** WMO weather code. */
  code: number;
  /** Local wall-clock time at the park, "15:30". */
  local: string;
  /** "Light rain", "Fog", "Clear"… */
  label: string;
}

const API = "https://api.open-meteo.com/v1/forecast";
const FETCH_MS = 8000;
/** Open-Meteo updates every 15 minutes; rounds in between reuse a reading. */
const CACHE_MS = 10 * 60 * 1000;

export function weatherUrl(lon: number, lat: number): string {
  return `${API}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + "&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation,is_day"
    + "&daily=sunrise,sunset&forecast_days=1&timezone=auto";
}

const LABELS: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Heavy showers", 82: "Downpour", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};

/** How hard it's coming down (0..1), by weather code. */
const PRECIP: Record<number, number> = {
  51: 0.25, 53: 0.35, 55: 0.45, 56: 0.35, 57: 0.45, 61: 0.5, 63: 0.75, 65: 1, 66: 0.6, 67: 0.9,
  71: 0.3, 73: 0.5, 75: 0.7, 77: 0.3, 80: 0.55, 81: 0.8, 82: 1, 85: 0.5, 86: 0.7, 95: 0.9, 96: 1, 99: 1,
};
const SNOW = new Set([71, 73, 75, 77, 85, 86]);

const minutes = (t: string | undefined) => {
  const m = /T?(\d\d):(\d\d)/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * Day, dusk or night from the park's local time. Dusk is the half hour or so
 * either side of sunset and sunrise; without those, `is_day` decides.
 */
export function todAt(local: string, isDay: boolean, sunrise?: string, sunset?: string): TimeOfDay {
  const now = minutes(local), up = minutes(sunrise), down = minutes(sunset);
  if (Number.isFinite(now) && Number.isFinite(up) && Number.isFinite(down)) {
    if ((now >= down - 40 && now <= down + 35) || (now >= up - 35 && now <= up + 30)) return "dusk";
    return now > up && now < down ? "day" : "night";
  }
  return isDay ? "day" : "night";
}

/** Open-Meteo's answer, made into a Sky. null if it isn't one. */
export function parseWeather(j: any): Weather | null {
  const c = j?.current;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!c || !num(c.weather_code) || !num(c.temperature_2m) || typeof c.time !== "string") return null;
  const code = Math.round(c.weather_code);
  const local = /T(\d\d:\d\d)/.exec(c.time)?.[1] ?? "";
  const precip = num(c.precipitation) ? c.precipitation : 0;
  const rain = PRECIP[code] ?? Math.min(1, precip / 2);
  const kmh = num(c.wind_speed_10m) ? c.wind_speed_10m : 0;
  const sky: Sky = {
    tod: todAt(local, c.is_day === 1, j.daily?.sunrise?.[0], j.daily?.sunset?.[0]),
    // Fog codes are thick fog; a downpour hazes things a little too.
    fog: code === 45 || code === 48 ? 1 : Math.round(rain * 0.25 * 100) / 100,
    rain,
    // Calm under 8 km/h, a gale from 40.
    wind: Math.round(Math.max(0, Math.min(1, (kmh - 8) / 32)) * 100) / 100,
    overcast: (num(c.cloud_cover) ? c.cloud_cover : 0) >= 80 || code === 3,
    snow: SNOW.has(code),
  };
  return { sky, tempC: Math.round(c.temperature_2m), code, local, label: LABELS[code] ?? "Unsettled" };
}

/** "18°C, light rain, 3:30 pm" */
export function describe(w: Weather): string {
  const [h, m] = w.local.split(":").map(Number);
  const clock = Number.isFinite(h) ? ` ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}` : "";
  return `${w.tempC}°C, ${w.label.toLowerCase()},${clock}`.replace(/,$/, "");
}

const cache = new Map<string, { at: number; w: Weather }>();

/** The weather at [lon, lat] right now, or null if it can't be had (offline, slow, refused). */
export async function fetchWeather(center: [number, number], now = Date.now()): Promise<Weather | null> {
  const url = weatherUrl(center[0], center[1]);
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.w;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) return null;
    const w = parseWeather(await res.json());
    if (w) cache.set(url, { at: now, w });
    return w;
  } catch {
    return null;
  }
}
