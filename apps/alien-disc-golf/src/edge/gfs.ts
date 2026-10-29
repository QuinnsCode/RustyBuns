// Which GFS file to ask NOMADS for. GFS runs at 00, 06, 12 and 18 UTC and a run's files appear about
// four hours after its hour. The latest run that should be out comes first; the one before it is the
// fallback when NOMADS is late. The forecast hour is the one nearest to now, so the wind is today's.

export const NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl";
const LAG_H = 4;
const LEVELS = "lev_10_m_above_ground=on&lev_250_mb=on";

export interface GfsPick { cycle: Date; hour: number; url: string }

export function gfsCandidates(now: Date, n = 3): GfsPick[] {
  const out: GfsPick[] = [];
  const latest = new Date(now.getTime() - LAG_H * 3600e3);
  latest.setUTCMinutes(0, 0, 0);
  latest.setUTCHours(Math.floor(latest.getUTCHours() / 6) * 6);
  for (let k = 0; k < n; k++) {
    const cycle = new Date(latest.getTime() - k * 6 * 3600e3);
    const ahead = (now.getTime() - cycle.getTime()) / 3600e3;
    const hour = Math.min(48, Math.round(ahead / 3) * 3);
    out.push({ cycle, hour, url: gfsUrl(cycle, hour) });
  }
  return out;
}

export function gfsUrl(cycle: Date, hour: number): string {
  const y = cycle.getUTCFullYear(), m = String(cycle.getUTCMonth() + 1).padStart(2, "0"), d = String(cycle.getUTCDate()).padStart(2, "0");
  const hh = String(cycle.getUTCHours()).padStart(2, "0");
  const dir = encodeURIComponent(`/gfs.${y}${m}${d}/${hh}/atmos`);
  return `${NOMADS}?dir=${dir}&file=gfs.t${hh}z.pgrb2.1p00.f${String(hour).padStart(3, "0")}&var_UGRD=on&var_VGRD=on&${LEVELS}`;
}

export const isGrib = (b: Uint8Array) => b.length > 1000 && b[0] === 0x47 && b[1] === 0x52 && b[2] === 0x49 && b[3] === 0x42;
