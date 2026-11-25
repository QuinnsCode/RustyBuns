// A channel's Shape draws its own spectrum: while it is open the audio thread copies that channel (an FM track, a
// hosted plugin's track, or a return) to its third output, and the channel stays in the mix as it was. The engines' listen tap is the same in TS and Rust.
import { expect, setDefaultTimeout, test } from "bun:test";
import { BLOCK, SR, posted, processor, useWorklet, type Proc } from "./worklet-kit.ts";
import { existsSync, readFileSync } from "node:fs";
import { nightShift } from "../src/songs.ts";
import { loadMsg } from "../src/ui/load.ts";
import { audible, loopBeats } from "../src/project.ts";
import { TRACKS } from "../src/engine/params.ts";
import { TsEngine, type FmEngine, type Tap } from "../src/engine/engine.ts";
import { createNativeEngine } from "../src/engine/native.ts";
import { renderPattern } from "../src/engine/sequencer.ts";
import type { ShapeAt } from "../src/desk.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

setDefaultTimeout(30_000);
useWorklet();

const rms = (x: ArrayLike<number>) => { let n = 0; for (let i = 0; i < x.length; i++) n += x[i] * x[i]; return Math.sqrt(n / x.length); };
const WASM = new URL("../public/fm_daw.wasm", import.meta.url);

/** One second of Night Shift through the audio thread on `kind`'s engine, track 3 a hosted plugin's (a tone), listening to `at`: the mix (left) and the copy. */
async function play(kind: "ts" | "rust", at: ShapeAt | null) {
  const { p, say } = processor();
  say(loadMsg(nightShift()));
  say({ t: "plugin", track: 2, on: true });
  if (kind === "rust") {
    say({ t: "engine", kind, bytes: new Uint8Array(readFileSync(WASM)).buffer });
    for (let i = 0; i < 100 && !posted.some((m) => m.t === "engine"); i++) await Bun.sleep(10);
    expect(posted.find((m) => m.t === "engine")).toEqual({ t: "engine", kind });
  }
  say({ t: "master", gain: 0.6 });
  say({ t: "listen", at });
  say({ t: "play", countIn: 0 });
  return blocks(p, SR, say);
}
function blocks(p: Proc, frames: number, say: (m: ToWorklet) => void) {
  let rendered = 0;
  const mix = new Float32Array(frames), heard = new Float32Array(frames);
  for (let at = 0; at < frames; at += BLOCK) {
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), H = new Float32Array(BLOCK).fill(NaN);
    p.process([[new Float32Array(BLOCK)]], [[L, R], Array.from({ length: TRACKS }, () => new Float32Array(BLOCK)), [H]]);
    mix.set(L.subarray(0, frames - at), at); heard.set(H.subarray(0, frames - at), at);
    for (const m of posted.splice(0)) {
      if (m.t !== "pluginAsk") continue;
      const pcm = new Float32Array(m.frames * 2);
      for (let f = 0; f < m.frames; f++, rendered++) pcm[f * 2] = pcm[f * 2 + 1] = 0.3 * Math.sin((2 * Math.PI * 330 * rendered) / SR);
      say({ t: "pluginBlock", track: m.track, pcm, ok: true });
    }
  }
  return { mix, heard };
}

test("an open Shape hears its own channel, and the mix is as it was", async () => {
  const kinds = existsSync(WASM) ? (["ts", "rust"] as const) : (console.log("  (rust skipped: run `bun run build:native`)"), ["ts"] as const);
  for (const kind of kinds) {
    const none = await play(kind, null);
    expect(none.heard.every((v) => v === 0)).toBe(true);                   // the master's Shape: nothing copied
    for (const at of [{ channel: "track-6" }, { channel: "track-3" }, { aux: 1 }] satisfies ShapeAt[]) {
      const { mix, heard } = await play(kind, at);
      expect(rms(heard)).toBeGreaterThan(0.002);
      expect(heard.every(Number.isFinite)).toBe(true);
      let d = 0;
      for (let i = 0; i < mix.length; i++) d = Math.max(d, Math.abs(mix[i] - none.mix[i]));
      expect(d).toBeLessThan(1e-5);                                         // listening takes nothing out of the mix
    }
  }
});

test("the engine's listen tap keeps the track in the sum and copies it, the same in TS and Rust", async () => {
  const song = nightShift();
  const render = (e: FmEngine, tap: Tap) => {
    const out: number[] = [], copy: number[] = [];
    renderPattern(e, SR, 1, (seq) => {
      song.tracks.forEach((t, ti) => { t.params.forEach((v, i) => e.setParam(ti, i, v)); seq.setNotes(ti, t.notes); e.setTap(ti, ti === 5 && tap); });
      seq.bpm = song.bpm; seq.setLoopBeats(loopBeats(song)); seq.setAudible(audible(song));
    }, undefined, (block, n, tp) => { for (let f = 0; f < n; f++) { out.push(block[f * 2]); copy.push(tp?.[f * TRACKS + 5] ?? 0); } }, true);
    return { out, copy };
  };
  const engines: [string, () => Promise<FmEngine | null>][] = [["ts", async () => new TsEngine(SR)], ["rust", () => createNativeEngine(SR)]];
  const copies: number[][] = [];
  for (const [name, make] of engines) {
    const a = await make(), b = await make();
    if (!a || !b) { console.log(`  (${name} skipped: run \`bun run build:native\`)`); continue; }
    const plain = render(a, false), listened = render(b, "listen");
    a.free?.(); b.free?.();
    let d = 0;
    for (let i = 0; i < plain.out.length; i++) d = Math.max(d, Math.abs(plain.out[i] - listened.out[i]));
    expect(d).toBeLessThan(1e-5);
    expect(rms(listened.copy)).toBeGreaterThan(0.01);
    copies.push(listened.copy);
  }
  if (copies.length === 2) {
    let d = 0;
    for (let i = 0; i < copies[0].length; i++) d = Math.max(d, Math.abs(copies[0][i] - copies[1][i]));
    expect(d).toBeLessThan(1e-4);
  }
});
