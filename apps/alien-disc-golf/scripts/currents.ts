// Refresh the cached ocean currents: NOAA CoastWatch's latest daily blended surface currents (geostrophic,
// from satellite altimetry, 0.25°), every fourth point (1°), packed into src/currents.bin (see
// src/currents.ts for the layout, about 130 KB). `bun run currents`. One request to ERDDAP, about 3 MB of CSV.
import { encodeCurrents } from "../src/currents.ts";

const DATASET = "noaacwBLENDEDNRTcurrentsDaily";
const span = "[(last)][(-89.875):4:(89.875)][(-179.875):4:(179.875)]";
const url = `https://coastwatch.noaa.gov/erddap/griddap/${DATASET}.csv0?${encodeURIComponent(`u_current${span},v_current${span}`)}`;

const res = await fetch(url);
if (!res.ok) throw new Error(`ERDDAP answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
const rows = (await res.text()).trim().split("\n");
const ni = 360, nj = 180;
if (rows.length !== ni * nj) throw new Error(`expected ${ni * nj} rows, got ${rows.length}`);
// ERDDAP sends south to north, west to east; the pack is north first, like GFS.
const u = new Float32Array(ni * nj), v = new Float32Array(ni * nj);
let day = "";
rows.forEach((row, k) => {
  const [time, , , us, vs] = row.split(",");
  day ||= time!.slice(0, 10);
  const j = nj - 1 - Math.floor(k / ni), i = k % ni;
  u[j * ni + i] = Number(us);
  v[j * ni + i] = Number(vs);
});
const out = new URL("../src/currents.bin", import.meta.url);
await Bun.write(out, encodeCurrents(day, u, v));
console.log(`currents for ${day} -> ${out.pathname}`);
