// A plugged-in guitar's slices for listeners a loop late or at the desk, as Opus instead of 16-bit PCM (#5252).
// PCM at TAKE_RATE is 384 kb/s, about 64 KB/s of base64 on the live line; Opus at OPUS_BITRATE is a quarter of
// that. One encoder per plugged-in guitar runs for as long as it is plugged in, so packets carry on from slice to
// slice with no click at the seams, and one decoder per far end does the same. Five 20 ms packets go in each
// message, still ten a second, stamped with the beat their first sample was played on. The codec is passed in,
// so the tests run the line with a stand-in; webOpus() is WebCodecs' own (null where the browser has none: PCM then).
import { b64url, unb64url } from "@rustybuns/util/bytes";
import { SOUND_FRAMES } from "../clock.ts";
import { TAKE_RATE } from "../take.ts";
import type { Live } from "../project.ts";

/** Bits a second for a guitar slice: a quarter of 16-bit PCM at TAKE_RATE. */
export const OPUS_BITRATE = 96_000;
/** Opus's lookahead at TAKE_RATE (2.5 ms + 4 ms): decoded sound comes out this many samples after it went in. */
export const OPUS_LAG = Math.round(0.0065 * TAKE_RATE);
/** Packets in one message, at most: twice a slice's worth of 20 ms packets. */
export const MAX_PACKETS = Math.ceil((2 * SOUND_FRAMES) / (0.02 * TAKE_RATE));

/** One or more Opus packets as the live line carries them: each a 2-byte little-endian length, then its bytes. */
export function pack(packets: readonly Uint8Array[]): string {
  const out = new Uint8Array(packets.reduce((n, p) => n + 2 + p.length, 0));
  let at = 0;
  for (const p of packets) { out[at] = p.length & 0xff; out[at + 1] = p.length >> 8; out.set(p, at + 2); at += 2 + p.length; }
  return b64url(out);
}
/** The packets in `data`, or null when it isn't a whole run of them. */
export function unpack(data: string): Uint8Array[] | null {
  let bytes: Uint8Array;
  try { bytes = unb64url(data); } catch { return null; }
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length;) {
    if (at + 2 > bytes.length) return null;
    const n = bytes[at] | (bytes[at + 1] << 8);
    if (n === 0 || at + 2 + n > bytes.length || out.length === MAX_PACKETS) return null;
    out.push(bytes.subarray(at + 2, at + 2 + n));
    at += 2 + n;
  }
  return out.length ? out : null;
}

/** An encoder fed 16-bit mono at TAKE_RATE, sample `at` of the stream first; each packet out says where it starts and how long it is. */
export interface Encoder { encode(pcm: Int16Array<ArrayBuffer>, at: number): void; close(): void }
export type MakeEncoder = (packet: (data: Uint8Array, at: number, frames: number) => void, fail: () => void) => Encoder;
/** A decoder of one far end's packets, in order, into mono at TAKE_RATE. */
export interface Decoder { decode(data: Uint8Array): void; close(): void }
export type MakeDecoder = (pcm: (samples: Float32Array) => void, fail: () => void) => Decoder;

type Sound = Extract<Live, { t: "sound" }>;
/** A message's packets on their way through the decoder. */
interface Pending { track: number; b: number; want: number; got: Float32Array[] }

/** Your guitar going out: slices in from the audio thread, messages out to the live line. */
export class OpusOut {
  private enc: Encoder;
  private n = 0;
  /** Where recent slices started on the stream, and the beat each was played on. */
  private marks: { n: number; beat: number }[] = [];
  private pend: Uint8Array[] = [];
  private pendAt = 0;
  private pendFrames = 0;
  /** The encoder failed: the caller sends PCM from here on. */
  broken = false;
  constructor(make: MakeEncoder, private send: (e: Sound) => void, private bpm: () => number, private track: () => number | null) {
    this.enc = make((d, at, f) => this.packet(d, at, f), () => { this.broken = true; this.close(); });
  }

  /** A slice of your input (16-bit at TAKE_RATE) starting on `beat`. */
  slice(beat: number, pcm: Int16Array<ArrayBuffer>) {
    if (this.broken) return;
    this.marks.push({ n: this.n, beat });
    if (this.marks.length > 8) this.marks.shift();
    this.enc.encode(pcm, this.n);
    this.n += pcm.length;
  }

  /** The beat sample `i` of the stream was played on, from the latest slice that started at or before it. */
  private beatAt(i: number) {
    const m = this.marks.findLast((x) => x.n <= i) ?? this.marks[0];
    return m ? m.beat + ((i - m.n) * this.bpm()) / 60 / TAKE_RATE : 0;
  }

  private packet(data: Uint8Array, at: number, frames: number) {
    if (!this.pend.length) this.pendAt = at;
    this.pend.push(data);
    this.pendFrames += frames;
    if (this.pendFrames < SOUND_FRAMES) return;
    const track = this.track();
    // what decodes from these packets went in OPUS_LAG samples earlier: its stamp is that sample's beat
    if (track !== null) this.send({ t: "sound", track, b: Math.max(0, this.beatAt(this.pendAt - OPUS_LAG)), c: "opus", data: pack(this.pend) });
    this.pend = [];
    this.pendFrames = 0;
  }

  close() { this.enc.close(); }
}

/** Everyone else's guitar and plugin tracks coming in: a decoder per far end and track, each message's sound out whole on its beat. */
export class OpusIn {
  private lines = new Map<string, { dec: Decoder; queue: Pending[]; peer: number; track: number }>();
  constructor(private make: MakeDecoder, private heard: (peer: number, track: number, b: number, pcm: Float32Array) => void) {}

  hear(peer: number, e: Sound) {
    const packets = unpack(e.data);
    if (!packets) return;
    const key = `${peer}:${e.track}`;
    let line = this.lines.get(key);
    if (!line) {
      const queue: Pending[] = [];
      line = { dec: this.make((pcm) => this.out(peer, queue, pcm), () => this.drop(peer, e.track)), queue, peer, track: e.track };
      this.lines.set(key, line);
    }
    line.queue.push({ track: e.track, b: e.b, want: packets.length, got: [] });
    for (const p of packets) line.dec.decode(p);
  }

  private out(peer: number, queue: Pending[], pcm: Float32Array) {
    const head = queue[0];
    if (!head) return;
    head.got.push(pcm);
    if (head.got.length < head.want) return;
    queue.shift();
    const all = new Float32Array(head.got.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of head.got) { all.set(p, at); at += p.length; }
    this.heard(peer, head.track, head.b, all);
  }

  /** They unplugged or stopped the plugin on `track`, or left (no track), or their stream broke: the next message starts a fresh decoder. */
  drop(peer: number, track?: number) {
    for (const [k, line] of this.lines) {
      if (line.peer !== peer || (track !== undefined && line.track !== track)) continue;
      this.lines.delete(k);
      line.dec.close();
    }
  }
}

/** Opus in WebCodecs, mono at TAKE_RATE: null where this browser can't encode and decode it. */
export async function webOpus(): Promise<{ encoder: MakeEncoder; decoder: MakeDecoder } | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return null;
  const enc: AudioEncoderConfig = { codec: "opus", sampleRate: TAKE_RATE, numberOfChannels: 1, bitrate: OPUS_BITRATE };
  const dec: AudioDecoderConfig = { codec: "opus", sampleRate: TAKE_RATE, numberOfChannels: 1 };
  try {
    const [a, b] = await Promise.all([AudioEncoder.isConfigSupported(enc), AudioDecoder.isConfigSupported(dec)]);
    if (!a.supported || !b.supported) return null;
  } catch { return null; }
  const us = (frames: number) => (frames * 1e6) / TAKE_RATE, frames = (us: number) => Math.round((us * TAKE_RATE) / 1e6);
  return {
    encoder: (packet, fail) => {
      const e = new AudioEncoder({
        output: (c) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); packet(d, frames(c.timestamp), frames(c.duration ?? 20_000)); },
        error: fail,
      });
      e.configure(enc);
      return {
        encode: (pcm, at) => {
          if (e.state !== "configured") return;
          const d = new AudioData({ format: "s16", sampleRate: TAKE_RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: us(at), data: pcm });
          e.encode(d);
          d.close();
        },
        close: () => { if (e.state !== "closed") e.close(); },
      };
    },
    decoder: (pcm, fail) => {
      let n = 0;
      const d = new AudioDecoder({
        output: (a) => {
          const got = new Float32Array(a.numberOfFrames);
          a.copyTo(got, { planeIndex: 0, format: "f32-planar" });
          const rate = a.sampleRate;
          a.close();
          pcm(rate === TAKE_RATE ? got : resample(got, rate));
        },
        error: fail,
      });
      d.configure(dec);
      return {
        decode: (data) => { if (d.state === "configured") d.decode(new EncodedAudioChunk({ type: "key", timestamp: us(n), data })); n += 480; },
        close: () => { if (d.state !== "closed") d.close(); },
      };
    },
  };
}

/** `x` at `rate` to TAKE_RATE, straight lines between samples (a decoder that answers at 48 kHz anyway). */
function resample(x: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(Math.floor((x.length * TAKE_RATE) / rate)), step = rate / TAKE_RATE;
  for (let i = 0; i < out.length; i++) { const p = i * step, j = Math.floor(p), a = x[j] ?? 0; out[i] = a + ((x[j + 1] ?? a) - a) * (p - j); }
  return out;
}
