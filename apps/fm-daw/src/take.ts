// Audio takes: what came in on the input (a guitar, the desk's out) while recording,
// laid on a track at the beat it started. The project only names a take ({ id, beat,
// frames }); its sound is 16-bit mono at TAKE_RATE, sent through the sesh in chunks
// beside the groove and kept by the world under the id. No DOM, no Bun: the page,
// the audio thread, the world and the tests all use it.
import { b64url, unb64url } from "@rustybuns/util/bytes";
import { Bad, int, num, obj, oneOf, str, type Guard } from "@rustybuns/util/guard";

/** Samples a second a take is kept at: a guitar cab is done well below its 12 kHz top. */
export const TAKE_RATE = 24000;
/** The longest take: a loop's worth, up to this many seconds (16 bars at 120). */
export const MAX_TAKE_SECONDS = 32;
export const MAX_TAKE_FRAMES = TAKE_RATE * MAX_TAKE_SECONDS;
/** Tracks in a sesh that may hold a take at once: each is up to 1.5 MB in the room's storage. */
export const MAX_TAKES = 4;
/** Raw bytes in one chunk on the wire: about 128 KB as base64, under the socket's 256 KB message. */
export const CHUNK_BYTES = 96 * 1024;
export const MAX_CHUNKS = Math.ceil((MAX_TAKE_FRAMES * 2) / CHUNK_BYTES);

export interface TakeRef { id: string; beat: number; frames: number }
export const TAKE_ID = str(16, { min: 8, re: /^[a-z0-9]+$/ });
/** A take as the project names it, `beat` inside a loop of `beats`. */
export const takeRef = (beats: number): Guard<TakeRef> => (v) => {
  const t = obj({ id: TAKE_ID, beat: num(0, Infinity), frames: int(1, MAX_TAKE_FRAMES) })(v);
  if (t.beat >= beats) throw new Bad("a take past the loop's end");
  return t;
};

/** One chunk of a take's sound: part `i` of `n`, base64url of little-endian 16-bit samples. */
export interface TakeBytes { t: "takeBytes"; id: string; i: number; n: number; data: string }
export const TakeBytesGuard: Guard<TakeBytes> = (v) => {
  const m = obj({ t: oneOf(["takeBytes"]), id: TAKE_ID, i: int(0, MAX_CHUNKS - 1), n: int(1, MAX_CHUNKS), data: str(Math.ceil((CHUNK_BYTES * 4) / 3), { min: 1, re: /^[A-Za-z0-9_-]+$/ }) })(v);
  if (m.i >= m.n) throw new Bad("a chunk past its take's end");
  return m;
};

export const newTakeId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);

/** `pcm` at `rate`, resampled (straight lines between samples) to TAKE_RATE and cut to 16 bits. */
export function encodeTake(pcm: Float32Array, rate: number): Int16Array<ArrayBuffer> {
  const frames = Math.min(MAX_TAKE_FRAMES, Math.floor((pcm.length * TAKE_RATE) / rate));
  const out = new Int16Array(frames), step = rate / TAKE_RATE;
  for (let i = 0; i < frames; i++) {
    const x = i * step, j = Math.floor(x), f = x - j;
    const a = pcm[j] ?? 0, b = pcm[j + 1] ?? a;
    const s = a + (b - a) * f;
    out[i] = Math.round(Math.max(-1, Math.min(1, Number.isFinite(s) ? s : 0)) * 32767);
  }
  return out;
}

export function toChunks(id: string, s: Int16Array): TakeBytes[] {
  const bytes = new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  return Array.from({ length: n }, (_, i) => ({ t: "takeBytes" as const, id, i, n, data: b64url(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) }));
}

/** Chunks gathered by part number until every one of a take's is in. */
export class TakeInbox {
  private parts = new Map<string, { n: number; got: string[] }>();
  /** The take's samples once its last chunk arrives, else null. */
  add(m: TakeBytes): Float32Array | null {
    let p = this.parts.get(m.id);
    if (!p || p.n !== m.n) this.parts.set(m.id, (p = { n: m.n, got: [] }));
    p.got[m.i] = m.data;
    for (let i = 0; i < p.n; i++) if (p.got[i] === undefined) return null;
    this.parts.delete(m.id);
    return decodeTake(p.got);
  }
}

export function decodeTake(chunks: string[]): Float32Array {
  const parts = chunks.map((c) => unb64url(c));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  const view = new DataView(bytes.buffer), out = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32767;
  return out;
}

/**
 * The takes playing on the audio thread, one slot per track. Each sounds from its beat
 * for as long as it lasts, wrapping round the loop end with the transport.
 */
export class TakeDeck {
  private slots: ({ pcm: Float32Array; beat: number } | null)[];
  constructor(tracks: number, private sr: number) { this.slots = Array.from({ length: tracks }, () => null); }
  set(track: number, pcm: Float32Array | null, beat = 0) { if (track >= 0 && track < this.slots.length) this.slots[track] = pcm && pcm.length ? { pcm, beat } : null; }
  get any() { return this.slots.some((s) => s); }
  has(track: number) { return !!this.slots[track]; }

  /** Add `frames` of the takes into interleaved stereo `out`, the transport at `pos` beats when the block starts. */
  mix(out: Float32Array, frames: number, pos: number, bpm: number, loopBeats: number, audible: (t: number) => boolean, gain: number) {
    for (let t = 0; t < this.slots.length; t++) if (audible(t)) this.play(t, out, 2, frames, pos, bpm, loopBeats, gain);
  }

  /** Add `frames` of one track's take into mono `out` (its Amp insert plays it from there). */
  one(track: number, out: Float32Array, frames: number, pos: number, bpm: number, loopBeats: number, gain: number) {
    this.play(track, out, 1, frames, pos, bpm, loopBeats, gain);
  }

  private play(track: number, out: Float32Array, chans: 1 | 2, frames: number, pos: number, bpm: number, loopBeats: number, gain: number) {
    const s = this.slots[track];
    if (!s) return;
    const beatsPerFrame = bpm / 60 / this.sr, takePerBeat = (60 / bpm) * TAKE_RATE, { pcm } = s;
    for (let f = 0; f < frames; f++) {
      const since = (((pos + f * beatsPerFrame - s.beat) % loopBeats) + loopBeats) % loopBeats;
      const x = since * takePerBeat, j = Math.floor(x);
      if (j >= pcm.length) continue;
      const a = pcm[j], v = (a + ((pcm[j + 1] ?? a) - a) * (x - j)) * gain;
      out[f * chans] += v;
      if (chans === 2) out[f * 2 + 1] += v;
    }
  }
}

/**
 * The input while recording: one pass of the loop at most, from the beat it started.
 * `beat` is where the player was in what they heard, so the take lines up with the groove.
 */
export class TakeCapture {
  private buf: Float32Array;
  private len = 0;
  beat = 0;
  constructor(private sr: number) { this.buf = new Float32Array(Math.ceil(sr * MAX_TAKE_SECONDS)); }
  /** Mono samples in; true once a whole pass of `loopSeconds` (or the longest take) is in. */
  push(input: Float32Array, n: number, loopSeconds: number): boolean {
    const want = Math.min(this.buf.length, Math.floor(loopSeconds * this.sr));
    const k = Math.min(n, want - this.len);
    if (k > 0) { this.buf.set(input.subarray(0, k), this.len); this.len += k; }
    return this.len >= want;
  }
  /** What came in, emptied out (null if nothing did). */
  take(): Float32Array | null {
    if (!this.len) return null;
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }
}

/**
 * A page's takes' sound by id, and what each track's take on its audio thread is, so only changes go there.
 * The sesh page and the jam room both keep one: chunks in from the sesh, takes recorded here, the project's tracks out.
 */
export class TakeShelf {
  private sounds = new Map<string, Float32Array>();
  private inbox = new TakeInbox();
  /** Each track's take on the audio thread now, as "id@beat". */
  private sent: (string | null)[] = [];
  get(id: string) { return this.sounds.get(id); }
  keep(id: string, pcm: Float32Array) { this.sounds.set(id, pcm); }
  /** A chunk from the sesh: true once it finished a take. */
  add(m: TakeBytes): boolean {
    const pcm = this.inbox.add(m);
    if (pcm) this.sounds.set(m.id, pcm);
    return !!pcm;
  }
  /** A new audio thread knows no takes: the next sync sends them all. */
  forget() { this.sent = []; }
  /** Each track's take whose sound is here, to the audio thread where it changed. */
  sync(p: { tracks: readonly { take?: TakeRef }[] }, send: (m: { t: "take"; track: number; pcm: Float32Array | null; beat: number }) => void) {
    p.tracks.forEach((t, i) => {
      const pcm = t.take ? this.sounds.get(t.take.id) : undefined;
      const key = t.take && pcm ? `${t.take.id}@${t.take.beat}` : null;
      if (key === (this.sent[i] ?? null)) return;
      this.sent[i] = key;
      send({ t: "take", track: i, pcm: pcm && key ? pcm : null, beat: t.take?.beat ?? 0 });
    });
  }
}
