// A plugged-in guitar over the World as Opus (src/studio/opus.ts): slices in from the audio thread, five packets a
// message on the live line, decoded on the far end and held for the beat a loop later. The codec is a stand-in that
// keeps Opus's shape (20 ms packets, OPUS_LAG samples late, stamped by stream position) so the stamps can be checked.
import { expect, test } from "bun:test";
import { OPUS_LAG, OpusIn, OpusOut, pack, unpack, type MakeDecoder, type MakeEncoder } from "../src/studio/opus.ts";
import { Band } from "../src/studio/band.ts";
import { decodeServer, type Live } from "../src/project.ts";
import { TAKE_RATE } from "../src/take.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

const BPM = 120, LOOP = 8, PER_SAMPLE = BPM / 60 / TAKE_RATE, PACKET = 480;

/** Opus's shape without Opus: the input OPUS_LAG samples late, cut into 20 ms packets of raw 16-bit. */
const encoder: MakeEncoder = (packet) => {
  let buf: number[] = Array(OPUS_LAG).fill(0), at = 0;
  return {
    encode(pcm) {
      buf.push(...pcm);
      while (buf.length >= PACKET) {
        packet(new Uint8Array(Int16Array.from(buf.slice(0, PACKET)).buffer), at, PACKET);
        buf = buf.slice(PACKET); at += PACKET;
      }
    },
    close() {},
  };
};
const decoder: MakeDecoder = (pcm) => ({
  decode(d) { pcm(Float32Array.from(new Int16Array(d.slice().buffer), (v) => v / 32767)); },
  close() {},
});

test("a guitar goes out as Opus packets and each slice is heard a loop late, on the beat its samples were played on", () => {
  const start = 1000.25, sent: Live[] = [];
  const opus = new OpusOut(encoder, (e) => sent.push(e), () => BPM, () => 2);
  // a second of a ramp (each sample's value says which it is) in the audio thread's 100 ms slices
  for (let k = 0; k < 10; k++) opus.slice(start + k * 2400 * PER_SAMPLE, Int16Array.from({ length: 2400 }, (_, i) => Math.round(((k * 2400 + i) / TAKE_RATE) * 32767)));
  expect(sent.length).toBe(10);

  const band = new Band(() => ({ bpm: BPM, loopBeats: LOOP }), () => 1e12);
  band.leading(true);
  const heard: Extract<ToWorklet, { t: "sound" }>[] = [];
  const far = new OpusIn(decoder, (peer, track, b, pcm) => { for (const m of band.sound(peer, track, b, pcm)) if (m.t === "sound") heard.push(m); });
  for (const e of sent) {
    const m = decodeServer({ t: "live", from: 3, e });  // through the World's guard
    if (m?.t !== "live" || m.e.t !== "sound") throw new Error("the live line turned a slice away");
    expect(m.e.c).toBe("opus");
    far.hear(3, m.e);
  }
  expect(heard.map((h) => h.pcm.length)).toEqual(Array(10).fill(5 * PACKET));
  for (const h of heard) {
    expect(h.track).toBe(2);
    // a sample past the lag's silence: the beat its stamp puts it on is the beat it was played on, within a sample
    const j = 200, played = start + Math.round(h.pcm[j] * TAKE_RATE) * PER_SAMPLE;
    expect(Math.abs(h.at - LOOP + j * PER_SAMPLE - played)).toBeLessThan(1.5 * PER_SAMPLE);
  }
});

test("a slice that isn't a whole run of packets is turned away", () => {
  const ok = pack([Uint8Array.of(1, 2, 3), Uint8Array.of(4)]);
  expect(unpack(ok)?.map((p) => [...p])).toEqual([[1, 2, 3], [4]]);
  for (const bad of [ok.slice(0, -2), "AAAA", "@@", pack(Array.from({ length: 11 }, () => Uint8Array.of(9)))]) expect(unpack(bad)).toBeNull();
  expect(decodeServer({ t: "live", from: 3, e: { t: "sound", track: 0, b: 1, c: "mp3", data: ok } })).toBeNull();
});
