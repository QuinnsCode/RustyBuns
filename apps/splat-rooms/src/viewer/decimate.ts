// Thins a splat-transform compressed PLY down to a splat budget before
// PlayCanvas sees it. InteriorGS scans run to 1M+ splats, and every one is
// sorted and drawn each frame; the faintest, smallest splats add the least,
// so those go first. Kept splats stay in file order (splat-transform writes
// them spatially sorted), get regrouped 256 to a chunk, and are re-quantized
// against their new chunk's bounds. Anything not in that exact layout comes
// back untouched.

const CHUNK = 256;
const CHUNK_PROPS = ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z",
  "min_scale_x", "min_scale_y", "min_scale_z", "max_scale_x", "max_scale_y", "max_scale_z",
  "min_r", "min_g", "min_b", "max_r", "max_g", "max_b"];
const VERTEX_PROPS = ["packed_position", "packed_rotation", "packed_scale", "packed_color"];

interface Element { name: string; count: number; props: { type: string; name: string }[] }

function readHeader(bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const end = head.indexOf("end_header\n");
  if (!head.startsWith("ply\n") || end < 0) return null;
  const lines = head.slice(0, end).split("\n");
  const elements: Element[] = [];
  const comments: string[] = [];
  for (const line of lines) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "element") elements.push({ name: w[1]!, count: Number(w[2]), props: [] });
    else if (w[0] === "property") elements.at(-1)?.props.push({ type: w[1]!, name: w[2]! });
    else if (w[0] === "comment") comments.push(line);
    else if (w[0] === "format" && w[1] !== "binary_little_endian") return null;
  }
  return { elements, comments, body: end + "end_header\n".length };
}

const same = (props: Element["props"], names: string[], type: string) =>
  props.length === names.length && props.every((p, i) => p.name === names[i] && p.type === type);

const unorm = (v: number, bits: number) => (v & ((1 << bits) - 1)) / ((1 << bits) - 1);
const quant = (t: number, bits: number) => Math.max(0, Math.min((1 << bits) - 1, Math.round(t * ((1 << bits) - 1))));
const norm = (v: number, lo: number, hi: number) => (hi - lo > 0 ? (v - lo) / (hi - lo) : 0);

/** The PLY with at most `budget` splats; the input itself when it is already under budget or not a compressed PLY. */
export function decimatePly(bytes: Uint8Array<ArrayBuffer>, budget: number): Uint8Array<ArrayBuffer> {
  const h = readHeader(bytes);
  if (!h) return bytes;
  const [chunk, vertex, sh] = h.elements;
  if (!chunk || !vertex || h.elements.length > 3) return bytes;
  if (chunk.name !== "chunk" || !same(chunk.props, CHUNK_PROPS, "float")) return bytes;
  if (vertex.name !== "vertex" || !same(vertex.props, VERTEX_PROPS, "uint")) return bytes;
  if (sh && (sh.name !== "sh" || sh.props.some((p) => p.type !== "uchar"))) return bytes;
  const n = vertex.count;
  if (n <= budget || budget <= 0) return bytes;

  const shBytes = sh ? sh.props.length : 0;
  const chunkOff = h.body, vertOff = chunkOff + chunk.count * CHUNK_PROPS.length * 4, shOff = vertOff + n * 16;
  if (bytes.length < shOff + n * shBytes) return bytes;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  const cd = new Float32Array(buf, chunkOff, chunk.count * CHUNK_PROPS.length);
  const vd = new Uint32Array(buf, vertOff, n * 4);

  // Decode what re-chunking needs: position, log scale, colour, opacity.
  const pos = new Float32Array(n * 3), scl = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const alpha = new Uint8Array(n), score = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / CHUNK) * 18, p = vd[i * 4]!, s = vd[i * 4 + 2]!, k = vd[i * 4 + 3]!;
    const pt = [unorm(p >>> 21, 11), unorm(p >>> 11, 10), unorm(p, 11)];
    const st = [unorm(s >>> 21, 11), unorm(s >>> 11, 10), unorm(s, 11)];
    const kt = [unorm(k >>> 24, 8), unorm(k >>> 16, 8), unorm(k >>> 8, 8)];
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = cd[c + a]! + (cd[c + 3 + a]! - cd[c + a]!) * pt[a]!;
      scl[i * 3 + a] = cd[c + 6 + a]! + (cd[c + 9 + a]! - cd[c + 6 + a]!) * st[a]!;
      col[i * 3 + a] = cd[c + 12 + a]! + (cd[c + 15 + a]! - cd[c + 12 + a]!) * kt[a]!;
    }
    alpha[i] = k & 255;
    // What a splat adds to the picture: opacity times its footprint (the two
    // largest axes; one axis of a surface splat is near zero).
    const [x, y, z] = [scl[i * 3]!, scl[i * 3 + 1]!, scl[i * 3 + 2]!];
    score[i] = (alpha[i]! / 255) * Math.exp(x + y + z - Math.min(x, y, z));
  }
  const cut = Float32Array.from(score).sort()[n - budget]!;
  const keep: number[] = [];
  for (let i = 0; i < n && keep.length < budget; i++) if (score[i]! >= cut) keep.push(i);

  const m = keep.length, chunks = Math.ceil(m / CHUNK);
  const outCd = new Float32Array(chunks * 18), outVd = new Uint32Array(m * 4), outSh = new Uint8Array(m * shBytes);
  const src = new Uint8Array(buf);
  for (let c = 0; c < chunks; c++) {
    const from = c * CHUNK, to = Math.min(m, from + CHUNK), o = c * 18;
    for (let a = 0; a < 18; a++) outCd[o + a] = a % 6 < 3 ? Infinity : -Infinity;
    for (let j = from; j < to; j++) {
      const i = keep[j]!;
      for (let a = 0; a < 3; a++) {
        const v = [pos[i * 3 + a]!, scl[i * 3 + a]!, col[i * 3 + a]!];
        for (let g = 0; g < 3; g++) {
          outCd[o + g * 6 + a] = Math.min(outCd[o + g * 6 + a]!, v[g]!);
          outCd[o + g * 6 + 3 + a] = Math.max(outCd[o + g * 6 + 3 + a]!, v[g]!);
        }
      }
    }
    for (let j = from; j < to; j++) {
      const i = keep[j]!;
      const t = (g: number, a: number) => norm([pos, scl, col][g]![i * 3 + a]!, outCd[o + g * 6 + a]!, outCd[o + g * 6 + 3 + a]!);
      outVd[j * 4] = ((quant(t(0, 0), 11) << 21) | (quant(t(0, 1), 10) << 11) | quant(t(0, 2), 11)) >>> 0;
      outVd[j * 4 + 1] = vd[i * 4 + 1]!;
      outVd[j * 4 + 2] = ((quant(t(1, 0), 11) << 21) | (quant(t(1, 1), 10) << 11) | quant(t(1, 2), 11)) >>> 0;
      outVd[j * 4 + 3] = ((quant(t(2, 0), 8) << 24) | (quant(t(2, 1), 8) << 16) | (quant(t(2, 2), 8) << 8) | alpha[i]!) >>> 0;
      if (shBytes) outSh.set(src.subarray(shOff + i * shBytes, shOff + (i + 1) * shBytes), j * shBytes);
    }
  }

  const header = ["ply", "format binary_little_endian 1.0", ...h.comments,
    `element chunk ${chunks}`, ...CHUNK_PROPS.map((p) => `property float ${p}`),
    `element vertex ${m}`, ...VERTEX_PROPS.map((p) => `property uint ${p}`),
    ...(sh ? [`element sh ${m}`, ...sh.props.map((p) => `property uchar ${p.name}`)] : []),
    "end_header", ""].join("\n");
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + outCd.byteLength + outVd.byteLength + outSh.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(outCd.buffer), head.length);
  out.set(new Uint8Array(outVd.buffer), head.length + outCd.byteLength);
  out.set(outSh, head.length + outCd.byteLength + outVd.byteLength);
  return out;
}
