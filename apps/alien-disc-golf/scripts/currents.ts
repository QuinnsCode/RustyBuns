// Refresh the copy of the ocean currents shipped with the page (src/currents.bin): NOAA CoastWatch's latest
// daily blended surface currents, the same request the Worker's /api/currents makes. `bun run currents`.
import { ERDDAP_URL, decodeCurrents, packDods } from "../src/currents.ts";

const res = await fetch(ERDDAP_URL);
if (!res.ok) throw new Error(`ERDDAP answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
const pack = packDods(new Uint8Array(await res.arrayBuffer()));
const out = new URL("../src/currents.bin", import.meta.url);
await Bun.write(out, pack);
console.log(`currents for ${decodeCurrents(pack).day} -> ${out.pathname}`);
