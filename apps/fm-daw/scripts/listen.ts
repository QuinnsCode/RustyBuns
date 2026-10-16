// Hear a song without opening the app: renders it with the TS engine (plus
// Space) to a WAV and plays it. `bun scripts/listen.ts [song number] [loops]`.
// Songs are listed in src/songs.ts; 1 is the demo, 2 is Nebula Drift.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TsEngine } from "../src/engine/engine.ts";
import { renderProject, loopSeconds } from "../src/engine/offline.ts";
import { encodeWav } from "../src/engine/wav.ts";
import { SONGS } from "../src/songs.ts";

const song = SONGS[Number(process.argv[2] ?? SONGS.length) - 1] ?? SONGS[SONGS.length - 1];
const loops = Math.min(Math.max(Number(process.argv[3] ?? 2), 1), 8);
const sr = 48000, p = song.make();
const pcm = renderProject(new TsEngine(sr), p, sr, loopSeconds(p, loops), 0.5);
let peak = 0;
for (const x of pcm) peak = Math.max(peak, Math.abs(x));
const path = join(process.env.FM_DAW_DIR ?? tmpdir(), `${song.name.replace(/\W+/g, "-").toLowerCase()}.wav`);
await Bun.write(path, encodeWav(pcm, sr));
console.log(`${song.name}: ${(pcm.length / 2 / sr).toFixed(1)} s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS -> ${path}`);
const player = process.platform === "darwin" ? "afplay" : process.platform === "linux" ? "aplay" : null;
if (player && !process.argv.includes("--quiet")) await Bun.spawn([player, path]).exited;
