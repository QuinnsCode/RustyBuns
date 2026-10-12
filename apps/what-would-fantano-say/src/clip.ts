// The clip the critic actually hears: the listener's best few seconds, cut and
// encoded in the browser. Pure, so bun tests it; Critic.tsx feeds it decoded audio.

/** How long a clip is. Clef-omni bills ~13 tokens a second of audio, so 15 s is ~$0.00003. */
export const CLIP_SECONDS = 15;
/** Decode (and so analyse and upload) at 16 kHz mono: plenty for judging, and a 15 s WAV is 480 KB. */
export const RATE = 16000;

/** Where the loudest `seconds` of the song start, in seconds: a good default for "the best bit". */
export function loudestWindow(samples: Float32Array, rate: number, seconds = CLIP_SECONDS): number {
  const win = Math.floor(seconds * rate);
  if (samples.length <= win) return 0;
  const hop = Math.floor(rate / 4);
  // Energy per quarter second, then a sliding sum over the window.
  const energy: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += samples[j]! * samples[j]!;
    energy.push(s);
  }
  const span = Math.floor(win / hop);
  let sum = energy.slice(0, span).reduce((a, b) => a + b, 0);
  let best = 0, bestSum = sum;
  for (let k = 1; k + span <= energy.length; k++) {
    sum += energy[k + span - 1]! - energy[k - 1]!;
    if (sum > bestSum) { bestSum = sum; best = k; }
  }
  return (best * hop) / rate;
}

/** `seconds` of audio from `start`, clamped inside the song. */
export function cut(samples: Float32Array, rate: number, start: number, seconds = CLIP_SECONDS): Float32Array {
  const len = Math.min(samples.length, Math.floor(seconds * rate));
  const from = Math.max(0, Math.min(samples.length - len, Math.floor(start * rate)));
  return samples.subarray(from, from + len);
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return out;
}

/** `n` peak heights 0–1 for drawing the waveform. */
export function peaks(samples: Float32Array, n: number): number[] {
  const step = Math.max(1, Math.floor(samples.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(samples.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(samples[j]!));
    out.push(m);
  }
  const top = Math.max(...out, 1e-6);
  return out.map((p) => p / top);
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
