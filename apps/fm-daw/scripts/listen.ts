// Hear a song without opening the app: renders it with the TS engine (plus
// Space) to a WAV and plays it. `bun scripts/listen.ts [song number] [loops]`.
// Songs are listed in src/songs.ts; 1 is the demo, 2 is Night Shift.
// Renders in blocks straight to disk, so a ten-minute song stays small in memory.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TsEngine } from "../src/engine/engine.ts";
import { Sequencer } from "../src/engine/sequencer.ts";
import { Space } from "../src/engine/space.ts";
import { loopSeconds } from "../src/engine/offline.ts";
import { audible, loopBeats } from "../src/project.ts";
import { SONGS } from "../src/songs.ts";

const song = SONGS[Number(process.argv[2] ?? SONGS.length) - 1] ?? SONGS[SONGS.length - 1];
const loops = Math.min(Math.max(Number(process.argv[3] ?? 1), 1), 8);
const sr = 48000, p = song.make();
const engine = new TsEngine(sr), seq = new Sequencer(engine, sr), space = new Space(sr);
p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); seq.setAuto(ti, t.auto ?? []); });
seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
engine.setMaster(0.5); space.setTempo(p.bpm); space.setAmount(p.space);
seq.play();

const frames = Math.round(loopSeconds(p, loops) * sr);
const path = join(process.env.FM_DAW_DIR ?? tmpdir(), `${song.name.replace(/\W+/g, "-").toLowerCase()}.wav`);
const head = new DataView(new ArrayBuffer(44));
const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
str(0, "RIFF"); head.setUint32(4, 36 + frames * 4, true); str(8, "WAVE"); str(12, "fmt ");
head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 2, true);
head.setUint32(24, sr, true); head.setUint32(28, sr * 4, true); head.setUint16(32, 4, true); head.setUint16(34, 16, true);
str(36, "data"); head.setUint32(40, frames * 4, true);
const file = Bun.file(path).writer();
file.write(new Uint8Array(head.buffer));
const BLOCK = 4096;
const out = new Float32Array(BLOCK * 2), send = new Float32Array(BLOCK * 2), pcm = new Int16Array(BLOCK * 2);
let peak = 0;
for (let at = 0; at < frames; at += BLOCK) {
  const n = Math.min(BLOCK, frames - at);
  seq.process(out, n, send);
  space.process(out, send, n);
  for (let i = 0; i < n * 2; i++) { peak = Math.max(peak, Math.abs(out[i])); pcm[i] = Math.max(-1, Math.min(1, out[i])) * 32767; }
  file.write(new Uint8Array(pcm.buffer, 0, n * 4));
}
await file.end();
const mins = Math.floor(frames / sr / 60), secs = Math.round(frames / sr) % 60;
console.log(`${song.name}: ${mins}:${String(secs).padStart(2, "0")}, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS -> ${path}`);
const player = process.platform === "darwin" ? "afplay" : process.platform === "linux" ? "aplay" : null;
if (player && !process.argv.includes("--quiet")) await Bun.spawn([player, path]).exited;
