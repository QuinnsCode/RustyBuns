// Picked file -> 16 kHz mono samples. The browser's own decoder goes first; only when it
// refuses the file (wma, ALAC on Chrome, odd aiff) does src/app/ffmpeg.ts fetch ffmpeg.wasm
// and convert it on the device. Pure, so bun tests the fallback with fake decoders.

import { RATE } from "./clip.ts";

export interface Decoders {
  /** Web Audio's decodeAudioData, mixed to mono at RATE. It may detach the buffer it's given. */
  native(bytes: ArrayBuffer): Promise<Float32Array>;
  /** ffmpeg.wasm, loaded on the first call. */
  convert(bytes: Uint8Array, name: string, onProgress: (ratio: number) => void): Promise<Float32Array>;
}

export interface Picked { name: string; arrayBuffer(): Promise<ArrayBuffer> }

/** Decode `file`, falling back to the converter; `onConvert` hears when that starts and how far it is. */
export async function decode(file: Picked, d: Decoders, onConvert: (ratio: number) => void = () => {}): Promise<{ samples: Float32Array; converted: boolean }> {
  try {
    const samples = await d.native(await file.arrayBuffer());
    if (samples.length) return { samples, converted: false };
  } catch { /* the browser can't play it: convert below */ }
  onConvert(0);
  // decodeAudioData detached the first buffer, so read the file again.
  const samples = await d.convert(new Uint8Array(await file.arrayBuffer()), file.name, onConvert);
  if (!samples.length) throw new Error("no audio in that file");
  return { samples, converted: true };
}

/** ffmpeg's arguments: drop any video, mix to mono, resample, raw little-endian float32 out. */
export function ffmpegArgs(input: string, output: string): string[] {
  return ["-i", input, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", output];
}

/** A name ffmpeg can probe by: the original extension, nothing a shell or FS would trip on. */
export function inputName(name: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? `in.${ext}` : "in";
}

/** ffmpeg's f32le bytes as samples (copied, since the bytes may not be 4-aligned). */
export function f32le(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(Math.floor(bytes.length / 4));
  const v = new DataView(bytes.buffer, bytes.byteOffset, out.length * 4);
  for (let i = 0; i < out.length; i++) out[i] = v.getFloat32(i * 4, true);
  return out;
}
