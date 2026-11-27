// The sidechain on what the engine doesn't play (#6158): a recorded bass clip, or a plugin track's sound, ducked
// under the FM kick dips on every kick, in the bounce and through the audio thread alike.
import { expect, test } from "bun:test";
import { SR, processor, run, useWorklet } from "./worklet-kit.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { bounceFrames, renderProject } from "../src/engine/offline.ts";
import { P } from "../src/engine/params.ts";
import { apply, loopBeats, type Project } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { TAKE_RATE, clipsOf, deckClips } from "../src/take.ts";
import { loadMsg } from "../src/ui/load.ts";

useWorklet();

const BASS = 5, ID = "bassline";
/** The demo groove (the kick on every beat) with the bass track's own notes gone: what's left of it is what's added. */
function groove(depth: number, clip: boolean, plugin = false): Project {
  const p0 = { ...demoProject(), space: 0, swing: 0 };
  const p = plugin ? apply(p0, { t: "plugin", track: BASS, plugin: { path: "/plugins/Steady.clap", index: 0, name: "Steady", values: [] } }) : p0;
  const frames = Math.round((loopBeats(p) * 60 / p.bpm) * TAKE_RATE);
  return { ...p, tracks: p.tracks.map((t, i) => i !== BASS ? t : {
    ...t, notes: plugin ? t.notes : [], ...(clip ? { take: { id: ID, beat: 0, frames } } : {}),
    params: t.params.map((v, j) => (j === P.DUCK_FROM ? 1 : j === P.DUCK ? depth : j === P.GAIN ? 0.8 : v)),
  }) };
}
/** A held bass note, recorded: 0.3 at 55 Hz the whole loop long. */
const held = (rate: number, n: number) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 55 * i) / rate));
const sound = (p: Project) => held(TAKE_RATE, Math.round((loopBeats(p) * 60 / p.bpm) * TAKE_RATE));
const left = (x: Float32Array) => x.filter((_, i) => i % 2 === 0);
const seconds = (p: Project) => (loopBeats(p) * 60) / p.bpm;

/** The bass alone, left side: the groove with it, less the groove without (everything after the engine adds). */
const ways: [string, (depth: number) => Promise<Float32Array>][] = [
  ["a recorded clip, bounced", async (depth) => {
    const bounce = (clip: boolean) => { const p = groove(depth, clip); return left(renderProject(new TsEngine(SR), p, SR, seconds(p), 1, () => sound(p))); };
    const a = bounce(true), b = bounce(false);
    return a.map((v, i) => v - b[i]);
  }],
  ["a recorded clip, played", async (depth) => {
    const play = async (clip: boolean) => {
      const p = groove(depth, clip), { p: proc, say } = processor();
      say(loadMsg(p));
      say({ t: "master", gain: 1 });
      say({ t: "take", track: BASS, clips: deckClips(clipsOf(p.tracks[BASS]), () => sound(p)) });
      say({ t: "play", countIn: 0 });
      return run(proc, seconds(p));
    };
    const a = await play(true), b = await play(false);
    return a.map((v, i) => v - b[i]);
  }],
  ["a plugin track, bounced", async (depth) => {
    const p = groove(depth, false, true), secs = seconds(p), n = bounceFrames(p, SR, secs);
    const mono = held(SR, n), pcm = new Float32Array(n * 2);
    for (let f = 0; f < n; f++) { pcm[2 * f] = mono[f]; pcm[2 * f + 1] = mono[f]; }
    const bounce = (heard: boolean) => left(renderProject(new TsEngine(SR), p, SR, secs, 1, undefined, (t) => (heard && t === BASS ? pcm : undefined)));
    const a = bounce(true), b = bounce(false);
    return a.map((v, i) => v - b[i]);
  }],
];

const beat = (60 / demoProject().bpm) * SR;
const rms = (a: Float32Array, from: number, len: number) => Math.sqrt(a.subarray(from, from + len).reduce((s, x) => s + x * x, 0) / len);
/** On each kick (the 30 ms after it) against 30 ms three quarters of a beat on. */
const pump = (a: Float32Array) => [1, 2, 3, 4, 5, 6, 7].map((b) => rms(a, Math.round(b * beat), SR * 0.03) / rms(a, Math.round((b + 0.75) * beat), SR * 0.03));

test.each(ways)("%s, ducked under the kick, dips on every kick and comes back between them", async (_, bass) => {
  const none = pump(await bass(0)), full = pump(await bass(1)), half = pump(await bass(0.5));
  console.log(`  on a kick against between: none ${none.map((x) => x.toFixed(2))}, full ${full.map((x) => x.toFixed(2))}, half ${half.map((x) => x.toFixed(2))}`);
  for (const r of none) expect(r).toBeGreaterThan(0.9);
  for (const r of full) expect(r).toBeLessThan(0.3);
  for (const r of half) { expect(r).toBeGreaterThan(0.4); expect(r).toBeLessThan(0.85); }
}, 60_000);
