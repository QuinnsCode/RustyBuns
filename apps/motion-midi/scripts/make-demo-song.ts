// Writes songs/demo.json: 12 bars, Am-F-C-G. Rerun to regenerate.
import type { SongJson } from "../src/engine/song.ts";
const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const bars = 12, bpb = 4;
const bass: SongJson["tracks"][0]["notes"] = [];
const pad: typeof bass = [], arp: typeof bass = [], bell: typeof bass = [];
for (let b = 0; b < bars; b++) {
  const ch = prog[b % 4], t0 = b * bpb;
  for (let e = 0; e < 8; e++) bass.push([t0 + e / 2, 0.4, ch[0] - 24 + (e % 4 === 3 ? 12 : 0), e % 2 ? 0.6 : 0.9]);
  if (b >= 2) for (const n of ch) pad.push([t0, bpb, n, 0.5]);
  if (b >= 4) for (let s = 0; s < 16; s++) arp.push([t0 + s / 4, 0.2, ch[s % 3] + 12 + (s % 8 >= 6 ? 12 : 0), 0.35 + (s % 4 === 0 ? 0.3 : 0)]);
  if (b >= 8 && b % 2 === 0) bell.push([t0, 2, ch[2] + 24, 0.5], [t0 + 2.5, 1.5, ch[1] + 24, 0.4]);
}
const song: SongJson = {
  name: "Oxide Loop", bpm: 120, sampleRate: 44100,
  tracks: [
    { name: "bass", wave: "saw", unison: 2, detune: 8, attack: 0.003, decay: 0.2, sustain: 0.4, release: 0.08, cutoff: 180, reso: 0.35, envMod: 6, pan: 0, gain: 0.55, notes: bass },
    { name: "pad", wave: "saw", unison: 6, detune: 22, attack: 0.9, decay: 1, sustain: 0.8, release: 1.2, cutoff: 900, reso: 0.1, envMod: 1.5, pan: 0, gain: 0.22, delay: { time: 0.375, feedback: 0.3, mix: 0.25 }, notes: pad },
    { name: "arp", wave: "square", unison: 2, detune: 5, attack: 0.002, decay: 0.12, sustain: 0.2, release: 0.1, cutoff: 1400, reso: 0.5, envMod: 3, pan: 0.35, gain: 0.18, delay: { time: 0.375, feedback: 0.45, mix: 0.4 }, notes: arp },
    { name: "bell", wave: "sine", attack: 0.005, decay: 1.2, sustain: 0.15, release: 1.5, cutoff: 8000, pan: -0.4, gain: 0.3, delay: { time: 0.5, feedback: 0.5, mix: 0.45 }, notes: bell },
  ],
};
await Bun.write(new URL("../songs/demo.json", import.meta.url), JSON.stringify(song));
console.log(`songs/demo.json: ${song.tracks.reduce((a, t) => a + t.notes.length, 0)} notes`);
