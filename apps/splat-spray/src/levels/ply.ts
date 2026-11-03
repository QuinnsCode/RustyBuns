// Reads splat-transform's "compressed PLY" into plain arrays. No three.js, so anything can decode a room with it
// (Splat Rooms' built-room tests check their packer against this exact decoder).

export interface RawSplats {
  count: number;
  /** data space: right-handed, z-up, metres */
  pos: Float32Array;
  /** linear axis lengths */
  scale: Float32Array;
  /** x, y, z, w */
  quat: Float32Array;
  color: Float32Array;
  opacity: Float32Array;
}

const CHUNK = 256;
const unorm = (v: number, bits: number) => (v & ((1 << bits) - 1)) / ((1 << bits) - 1);

/** Reads a splat-transform compressed PLY (chunks of 256 with min/max, then 11/10/11-packed positions). Anything else is null. */
export function readPly(bytes: Uint8Array): RawSplats | null {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const end = head.indexOf("end_header\n");
  if (!head.startsWith("ply\n") || end < 0 || !head.includes("format binary_little_endian")) return null;
  let chunks = 0, n = 0;
  for (const line of head.slice(0, end).split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "element" && w[1] === "chunk") chunks = Number(w[2]);
    if (w[0] === "element" && w[1] === "vertex") n = Number(w[2]);
  }
  if (!chunks || !n || !head.includes("packed_position")) return null;
  const body = end + "end_header\n".length;
  const vertOff = body + chunks * 18 * 4;
  if (bytes.length < vertOff + n * 16) return null;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const cd = new Float32Array(buf, body, chunks * 18);
  const vd = new Uint32Array(buf, vertOff, n * 4);
  const out: RawSplats = {
    count: n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), quat: new Float32Array(n * 4),
    color: new Float32Array(n * 3), opacity: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / CHUNK) * 18, p = vd[i * 4]!, r = vd[i * 4 + 1]!, s = vd[i * 4 + 2]!, k = vd[i * 4 + 3]!;
    const pt = [unorm(p >>> 21, 11), unorm(p >>> 11, 10), unorm(p, 11)];
    const st = [unorm(s >>> 21, 11), unorm(s >>> 11, 10), unorm(s, 11)];
    const kt = [unorm(k >>> 24, 8), unorm(k >>> 16, 8), unorm(k >>> 8, 8)];
    for (let a = 0; a < 3; a++) {
      out.pos[i * 3 + a] = cd[c + a]! + (cd[c + 3 + a]! - cd[c + a]!) * pt[a]!;
      out.scale[i * 3 + a] = Math.exp(cd[c + 6 + a]! + (cd[c + 9 + a]! - cd[c + 6 + a]!) * st[a]!);
      out.color[i * 3 + a] = Math.min(1, Math.max(0, cd[c + 12 + a]! + (cd[c + 15 + a]! - cd[c + 12 + a]!) * kt[a]!));
    }
    out.opacity[i] = (k & 255) / 255;
    // rotation: the largest component's index in the top 2 bits, the other three at 10 bits each
    const which = r >>> 30;
    const q = [0, 0, 0, 0];
    let sum = 0, slot = 0;
    for (let j = 0; j < 4; j++) {
      if (j === which) continue;
      const v = (unorm(r >>> (20 - 10 * slot++), 10) - 0.5) * Math.SQRT2;
      q[j] = v;
      sum += v * v;
    }
    q[which] = Math.sqrt(Math.max(0, 1 - sum));
    // the file's order is w, x, y, z
    out.quat.set([q[1]!, q[2]!, q[3]!, q[0]!], i * 4);
  }
  return out;
}
