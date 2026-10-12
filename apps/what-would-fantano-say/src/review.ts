// What the page sends. All of it is untrusted, so it's clamped and trimmed here, and
// the clip has to be a WAV data URL of the size a 15 s clip at 16 kHz mono comes to.

import type { Features } from "./analyze.ts";
import { CLIP_SECONDS, RATE } from "./clip.ts";

export interface ReviewRequest {
  features: Features | null;
  /** The listener's clip as a base64 WAV data URL, or "" for a link-only review. */
  clip: string;
  /** "sounds like", free text from the listener. */
  hint: string;
  /** The file name, or the YouTube title the Worker looked up. */
  title: string;
  turnstile: string;
  youtube: string;
}

const RANGES: Record<keyof Features, [number, number]> = {
  durationSec: [0, 3600], loudnessDb: [-90, 0], dynamicsDb: [0, 60], bpm: [60, 200],
  pulse: [0, 1], bass: [0, 1], brightness: [0, 1], silence: [0, 1],
};

const WAV_PREFIX = "data:audio/wav;base64,";
/** The biggest clip we take: CLIP_SECONDS of 16-bit mono at RATE, base64, with a little slack. */
export const MAX_CLIP = Math.ceil(((44 + CLIP_SECONDS * RATE * 2) * 4) / 3) + WAV_PREFIX.length + 64;

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The request body, clamped. Throws on anything that isn't the right shape. */
export function parseRequest(body: unknown): ReviewRequest {
  if (!body || typeof body !== "object") throw new Error("bad request");
  const b = body as Record<string, unknown>;
  let features: Features | null = null;
  if (b.features && typeof b.features === "object") {
    const f = b.features as Record<string, unknown>;
    features = {} as Features;
    for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof Features, [number, number]][]) {
      const n = Number(f[k]);
      if (!Number.isFinite(n)) throw new Error(`bad ${k}`);
      features[k] = Math.round(Math.max(lo, Math.min(hi, n)) * 100) / 100;
    }
  }
  const clip = typeof b.clip === "string" ? b.clip : "";
  if (clip && (!clip.startsWith(WAV_PREFIX) || clip.length > MAX_CLIP || !/^[A-Za-z0-9+/]+=*$/.test(clip.slice(WAV_PREFIX.length)))) throw new Error("bad clip");
  const req = { features, clip, hint: text(b.hint, 80), title: text(b.title, 120), turnstile: text(b.turnstile, 2048), youtube: text(b.youtube, 200) };
  if (!req.features && !req.youtube) throw new Error("send a song or a link");
  return req;
}
