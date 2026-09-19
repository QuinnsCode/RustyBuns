// Offline bounce: render the whole song in 512-frame blocks. Shared by every
// lane, so the only thing that differs between them is the engine.
export const BLOCK = 512;

export interface Renderer { readonly totalFrames: number; render(out: Float32Array, frames: number): number; free?(): void }

export interface BounceResult { audio: Float32Array; frames: number; sampleRate: number; ms: number; realtimeX: number }

export function bounce(engine: Renderer, sampleRate: number, now: () => number = () => performance.now()): BounceResult {
  const audio = new Float32Array(engine.totalFrames * 2);
  const t0 = now();
  let at = 0;
  while (at < engine.totalFrames) {
    const n = engine.render(audio.subarray(at * 2, (at + BLOCK) * 2), BLOCK);
    if (n === 0) break;
    at += n;
  }
  const ms = now() - t0;
  engine.free?.();
  return { audio, frames: at, sampleRate, ms, realtimeX: at / sampleRate / (ms / 1000) };
}

/** 16-bit PCM stereo WAV. */
export function encodeWav(audio: Float32Array, sampleRate: number): Uint8Array {
  const n = audio.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 32767, true);
  return new Uint8Array(buf);
}
