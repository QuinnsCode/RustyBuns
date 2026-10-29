// Where the page's wind comes from: /api/wind (the Worker's copy of NOAA's GFS grid) decoded here, or the
// synthetic field when that fails, labelled so nobody mistakes one for the other.
import { readGrib2, windLevels, type WindLevel } from "./grib2.ts";
import { syntheticWind } from "./flight.ts";

export interface Wind {
  levels: WindLevel[];
  source: "noaa" | "synthetic";
  label: string;   // "NOAA GFS 2026-10-28 06z +3h" or why it's synthetic
}

export async function loadWind(force?: string | null): Promise<Wind> {
  if (force === "synthetic") return { levels: syntheticWind(), source: "synthetic", label: "synthetic wind (asked for with ?wind=synthetic)" };
  try {
    const res = await fetch("/api/wind", { headers: { Accept: "application/octet-stream" } });
    if (!res.ok) throw new Error(`the wind relay answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const levels = windLevels(readGrib2(bytes));
    if (levels.length === 0) throw new Error("no u/v pair in the grid");
    const cycle = res.headers.get("X-GFS-Cycle"), hour = res.headers.get("X-GFS-Hour");
    const when = cycle ? new Date(cycle) : levels.length ? null : null;
    const stamp = when && !Number.isNaN(when.getTime())
      ? `${when.toISOString().slice(0, 10)} ${String(when.getUTCHours()).padStart(2, "0")}z${hour ? ` +${hour}h` : ""}`
      : "latest run";
    return { levels, source: "noaa", label: `NOAA GFS ${stamp}${res.headers.get("X-GFS-Stale") ? " (stale copy)" : ""}` };
  } catch (e) {
    return { levels: syntheticWind(), source: "synthetic", label: `synthetic wind (${e instanceof Error ? e.message : String(e)})` };
  }
}
