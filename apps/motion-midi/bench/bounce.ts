// bun run bench [unison...]  -> Rust vs TS bounce of the demo song at each load.
import demo from "../songs/demo.json";
import { compileSong, type SongJson } from "../src/engine/song.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { bounce } from "../src/engine/bounce.ts";
import { createRustEngine } from "../src/engine/native.ts";
const loads = process.argv.slice(2).map(Number).filter(Boolean);
console.log("unison  rust ×rt   ts ×rt   rust/ts");
for (const u of loads.length ? loads : [1, 4, 8]) {
  const song = compileSong(demo as SongJson, { unison: u });
  bounce(new TsEngine(song), 44100); // warm the JIT so TS gets its best shot
  const ts = bounce(new TsEngine(song), 44100).realtimeX;
  const re = await createRustEngine(song);
  const rust = re ? bounce(re, 44100).realtimeX : NaN;
  console.log(`${String(u).padStart(6)}  ${rust.toFixed(1).padStart(7)}  ${ts.toFixed(1).padStart(7)}  ${(rust / ts).toFixed(2).padStart(7)}×`);
}
