// Typed arrays over the action's JSON as base64. Works in the page and on the host.
import type { RigResult } from "./analyze.ts";

export function toB64(a: ArrayBufferView): string {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function bytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8.buffer;
}
export const f32 = (b64: string) => new Float32Array(bytes(b64));
export const u32 = (b64: string) => new Uint32Array(bytes(b64));

export interface WireRig {
  joints: string; parents: string; skinIndex: string; skinWeight: string;
  grid: RigResult["grid"]; timings: RigResult["timings"];
}

export const rigToWire = (r: RigResult): WireRig => ({
  joints: toB64(r.joints), parents: toB64(r.parents), skinIndex: toB64(r.skinIndex), skinWeight: toB64(r.skinWeight),
  grid: r.grid, timings: r.timings,
});

export const rigFromWire = (w: WireRig): RigResult => ({
  joints: f32(w.joints), parents: new Int32Array(bytes(w.parents)),
  skinIndex: new Uint16Array(bytes(w.skinIndex)), skinWeight: f32(w.skinWeight),
  grid: w.grid, timings: w.timings,
});
