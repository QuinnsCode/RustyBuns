// Scene info: how many splats a file holds, its spherical-harmonics detail
// level, and its bounding box. Read on the host, straight from disk, so
// multi-GB files never pass through the browser.
//
// This is the worked example in EXTENDING.md: a host function, a route in
// host.ts, a panel in Workspace.tsx, and tests/scene-info.test.ts.

export type Vec3 = [number, number, number];
export interface SceneInfo {
  format: string;
  splats: number | null;
  /** 0 (flat color) to 3 (view-dependent color, the full 3DGS detail level). */
  shDegree: number | null;
  bounds: { min: Vec3; max: Vec3 } | null;
  /** Why something is unknown. */
  note?: string;
}

const PLY_TYPES: Record<string, [number, (v: DataView, o: number) => number]> = {
  char: [1, (v, o) => v.getInt8(o)], int8: [1, (v, o) => v.getInt8(o)],
  uchar: [1, (v, o) => v.getUint8(o)], uint8: [1, (v, o) => v.getUint8(o)],
  short: [2, (v, o) => v.getInt16(o, true)], int16: [2, (v, o) => v.getInt16(o, true)],
  ushort: [2, (v, o) => v.getUint16(o, true)], uint16: [2, (v, o) => v.getUint16(o, true)],
  int: [4, (v, o) => v.getInt32(o, true)], int32: [4, (v, o) => v.getInt32(o, true)],
  uint: [4, (v, o) => v.getUint32(o, true)], uint32: [4, (v, o) => v.getUint32(o, true)],
  float: [4, (v, o) => v.getFloat32(o, true)], float32: [4, (v, o) => v.getFloat32(o, true)],
  double: [8, (v, o) => v.getFloat64(o, true)], float64: [8, (v, o) => v.getFloat64(o, true)],
};

interface PlyElement { name: string; count: number; props: { name: string; type: string; list: boolean }[] }

export function parsePlyHeader(text: string): { format: string; elements: PlyElement[]; headerBytes: number } | null {
  const end = text.indexOf("end_header\n");
  if (!text.startsWith("ply\n") || end < 0) return null;
  const elements: PlyElement[] = [];
  let format = "";
  for (const line of text.slice(0, end).split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "format") format = w[1] ?? "";
    else if (w[0] === "element") elements.push({ name: w[1]!, count: Number(w[2]), props: [] });
    else if (w[0] === "property" && elements.length) {
      const list = w[1] === "list";
      elements.at(-1)!.props.push({ name: list ? w[4]! : w[2]!, type: list ? w[3]! : w[1]!, list });
    }
  }
  // header length in bytes: the header is ASCII, so characters == bytes
  return { format, elements, headerBytes: end + "end_header\n".length };
}

/** SH degree from the number of f_rest_* coefficients: 3 * ((d+1)^2 - 1). */
export function shDegreeFrom(restCount: number): number | null {
  const d = Math.sqrt(restCount / 3 + 1) - 1;
  return Number.isInteger(d) ? d : null;
}

async function plyInfo(path: string): Promise<SceneInfo> {
  const file = Bun.file(path);
  const head = new TextDecoder("latin1").decode(await file.slice(0, 64 * 1024).arrayBuffer());
  const ply = parsePlyHeader(head);
  if (!ply) return { format: "ply", splats: null, shDegree: null, bounds: null, note: "not a readable PLY header" };
  const vertex = ply.elements.find((e) => e.name === "vertex");
  if (!vertex) return { format: "ply", splats: null, shDegree: null, bounds: null, note: "no vertex element" };
  const names = new Set(vertex.props.map((p) => p.name));
  const rest = vertex.props.filter((p) => p.name.startsWith("f_rest_")).length;
  const compressed = ply.elements.some((e) => e.name === "chunk");
  const info: SceneInfo = {
    format: compressed ? "compressed ply" : "ply",
    splats: vertex.count,
    shDegree: compressed ? null : names.has("f_dc_0") ? shDegreeFrom(rest) : null,
    bounds: null,
  };
  // Bounds need a plain binary layout: vertex first, fixed-size properties, x/y/z present.
  if (compressed) return { ...info, note: "compressed: positions are quantized per chunk" };
  if (ply.format !== "binary_little_endian") return { ...info, note: `bounds not read for ${ply.format} PLY` };
  if (ply.elements[0] !== vertex || vertex.props.some((p) => p.list || !PLY_TYPES[p.type])) {
    return { ...info, note: "bounds not read for this PLY layout" };
  }
  let stride = 0;
  const offsets: Record<string, [number, (v: DataView, o: number) => number]> = {};
  for (const p of vertex.props) { const [size, read] = PLY_TYPES[p.type]!; offsets[p.name] = [stride, read]; stride += size; }
  if (!offsets.x || !offsets.y || !offsets.z) return { ...info, note: "no x/y/z positions" };

  // Stream the vertex block in chunks; a record can straddle two chunks.
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const axes = [offsets.x, offsets.y, offsets.z];
  let carry: Uint8Array = new Uint8Array(0);
  let seen = 0;
  const reader = file.slice(ply.headerBytes, ply.headerBytes + vertex.count * stride).stream().getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    const buf: Uint8Array = carry.length ? new Uint8Array(carry.length + chunk.length) : chunk;
    if (carry.length) { buf.set(carry); buf.set(chunk, carry.length); }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const whole = Math.floor(buf.length / stride);
    for (let r = 0; r < whole; r++) {
      const base = r * stride;
      for (let a = 0; a < 3; a++) {
        const v = axes[a]![1](view, base + axes[a]![0]);
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
    }
    seen += whole;
    carry = buf.slice(whole * stride);
  }
  if (seen < vertex.count) return { ...info, note: `file is truncated: ${seen} of ${vertex.count} splats present` };
  return { ...info, bounds: seen ? { min, max } : null };
}

const cache = new Map<string, SceneInfo>();

export async function readSceneInfo(path: string): Promise<SceneInfo> {
  const file = Bun.file(path);
  const stat = await file.stat();
  const key = `${path}:${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const info: SceneInfo =
    ext === "ply" ? await plyInfo(path)
    // .splat is a fixed 32 bytes per splat, no header
    : ext === "splat" ? { format: "splat", splats: stat.size % 32 === 0 ? stat.size / 32 : null, shDegree: 0, bounds: null }
    : { format: ext, splats: null, shDegree: null, bounds: null, note: `details for .${ext} aren't read yet` };
  cache.set(key, info);
  return info;
}
