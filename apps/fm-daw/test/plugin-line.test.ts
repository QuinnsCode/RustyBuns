// A player's plugin track on the live line (src/studio/plugin-line.ts), through two audio threads: the player's desk
// plays a plugin nobody else has (its host answering each ask with a 440 Hz tone), its worklet cuts the track's sound
// into stamped slices, they go out as Opus beside the same player's guitar, and a far page with the same plugin track
// but no plugin plays them a loop late, each on its own line. The codec is opus.test.ts's stand-in (Opus's shape,
// 16-bit inside), so the far end's sound can be held to the player's, sample by sample.
import { expect, test } from "bun:test";
import { SR, posted, processor, run, useWorklet } from "./worklet-kit.ts";
import { OPUS_LAG, OpusOut, type MakeDecoder, type MakeEncoder } from "../src/studio/opus.ts";
import { FarSound, PluginOut } from "../src/studio/plugin-line.ts";
import { Band } from "../src/studio/band.ts";
import { decodeServer, type Live } from "../src/project.ts";
import { TAKE_RATE } from "../src/take.ts";
import { P } from "../src/engine/params.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

useWorklet();

const BPM = 120, LOOP = 8, START = 1000, PACKET = 480, BLOCK = 128, ME = 3, TRACK = 2, FADER = 0.7;
const tone = (t: number) => 0.5 * Math.sin(2 * Math.PI * 440 * t);

const encoder: MakeEncoder = (packet) => {
  let buf: number[] = Array(OPUS_LAG).fill(0), at = 0;
  return {
    encode(pcm) {
      buf.push(...pcm);
      while (buf.length >= PACKET) { packet(new Uint8Array(Int16Array.from(buf.slice(0, PACKET)).buffer), at, PACKET); buf = buf.slice(PACKET); at += PACKET; }
    },
    close() {},
  };
};
const decoder: MakeDecoder = (pcm) => ({ decode(d) { pcm(Float32Array.from(new Int16Array(d.slice().buffer), (v) => v / 32767)); }, close() {} });

/** An audio thread on the shared clock at `beat`, with track 2 a plugin track (as everyone's project says). */
function thread(beat: number) {
  const { p, say } = processor();
  say({ t: "tempo", bpm: BPM, swing: 0, loopBeats: LOOP });
  say({ t: "master", gain: 1 });
  say({ t: "param", track: TRACK, i: P.GAIN, v: FADER });
  say({ t: "plugin", track: TRACK, on: true });
  say({ t: "grid", ctx: 0, beat });
  return { p, say };
}

/** The player's desk: 1.5 s of their plugin (the host answering each ask) and guitar; what they heard, and what they sent. */
function player() {
  const { p, say } = thread(START), sent: Live[] = [], heard = new Float32Array(1.5 * SR);
  const out = new PluginOut(TRACK, "Test Tone", (e) => sent.push(e), () => BPM, encoder);
  say({ t: "pluginSend", track: TRACK, on: true });
  let rendered = 0;
  for (let at = 0; at < heard.length; at += BLOCK) {
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
    p.process([[new Float32Array(BLOCK)]], [[L, R]]);
    heard.set(L, at);
    for (const m of posted.splice(0)) {
      if (m.t === "pluginAsk") {
        const pcm = new Float32Array(m.frames * 2);
        for (let f = 0; f < m.frames; f++, rendered++) pcm[f * 2] = pcm[f * 2 + 1] = tone(rendered / SR);
        say({ t: "pluginBlock", track: m.track, pcm, ok: true });
      } else if (m.t === "sound" && m.track === TRACK) out.slice(m.beat, m.pcm, m.rate);
    }
  }
  const guitar = new OpusOut(encoder, (e) => sent.push(e), () => BPM, () => -1);
  for (let k = 0; k < 15; k++) guitar.slice(START + (k * 2400 * BPM) / 60 / TAKE_RATE, new Int16Array(2400).fill(Math.round(0.25 * 32767)));
  return { heard, sent };
}

/** A far page a loop late: what came through the World's guard, into its FarSound and audio thread. */
async function far(sent: Live[], mine = false) {
  const { p, say } = thread(START + LOOP);
  const band = new Band(() => ({ bpm: BPM, loopBeats: LOOP }), () => 1e12);
  band.leading(true);
  const msgs: ToWorklet[] = [], sound = new FarSound(band, (m) => { msgs.push(m); say(m); }, () => mine);
  sound.decodeWith(decoder);
  for (const e of sent) {
    const m = decodeServer({ t: "live", from: ME, e });
    if (m?.t !== "live") throw new Error(`the live line turned ${e.t} away`);
    if (!sound.heard(ME, m.e)) for (const w of band.heard(ME, m.e)) say(w);
  }
  return { out: await run(p, 1.3), sound, msgs };
}

/** The largest gap from what the player heard of their plugin (none: `heard` silent), plus their guitar, over a second. */
function miss(out: Float32Array, heard: Float32Array) {
  let worst = 0;
  for (let i = Math.round(0.1 * SR); i < 1.1 * SR; i++) worst = Math.max(worst, Math.abs(out[i] - (heard[i] + 0.25)));
  return worst;
}

test("a far page hears a player's plugin track as they heard it, a loop late, beside their guitar on its own line", async () => {
  const { heard, sent } = player();
  expect(sent[0]).toEqual({ t: "plugin", track: TRACK, name: "Test Tone" });
  expect(Math.max(...heard.subarray(SR / 2, SR))).toBeCloseTo(0.5 * FADER, 2);   // the player hears it at its fader

  const { out, sound, msgs } = await far(sent);
  expect(sound.voicing(TRACK)).toEqual([{ peer: ME, name: "Test Tone" }]);
  expect(miss(out, heard)).toBeLessThan(0.01);

  // a page whose own plugin plays the track hears its own (here none), not a second copy; the guitar still
  expect(miss((await far(sent, true)).out, new Float32Array(heard.length))).toBeLessThan(0.01);

  // the plugin stops: its line goes, the guitar's stays
  msgs.length = 0;
  sound.heard(ME, { t: "plugin", track: TRACK, name: null });
  expect(msgs).toEqual([{ t: "quiet", peer: ME, track: TRACK }]);
  expect(sound.isPlugin(ME, TRACK)).toBe(false);
});

test("a plugin track is heard from the first player who voices it; as it comes, the desk's delay behind, as it has no call", () => {
  const band = new Band(() => ({ bpm: BPM, loopBeats: LOOP }), () => 1e12);
  band.leading(true);
  const got: ToWorklet[] = [], sound = new FarSound(band, (m) => got.push(m));
  const slice = (b: number): Live => ({ t: "sound", track: TRACK, b, data: "AAAAAAAA" });
  sound.heard(ME, { t: "plugin", track: TRACK, name: "Test Tone" });
  sound.heard(ME + 1, { t: "plugin", track: TRACK, name: "Test Tone" });
  sound.heard(ME + 1, slice(START));
  expect(got).toEqual([]);
  band.listen = "now";
  sound.heard(ME, slice(START));
  expect(got).toMatchObject([{ t: "sound", peer: ME, track: TRACK, at: START + 0.3 }]);
  // a guitar listening as it comes is the call's, not its slices
  expect(band.sound(ME, -1, START, new Float32Array(4))).toEqual([]);
});

test("a plugin event the World can't place is turned away", () => {
  for (const e of [{ t: "plugin", track: 12, name: "x" }, { t: "plugin", track: 0, name: "x".repeat(501) }, { t: "plugin", track: 0 }]) {
    expect(decodeServer({ t: "live", from: ME, e })).toBeNull();
  }
});
