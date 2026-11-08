// Just enough glTF to move a skeleton and its clips between files: read a GLB's nodes, skin, animations and
// accessors (each checked), and write a new GLB from typed parts. scripts/bearer.ts uses it to lift a humanoid
// rig and its animations out of a character file and to stretch that rig to new proportions.
import { arr, int, num, obj, opt, str, raw, type Of } from "@rustybuns/util/guard";

const Vec = (n: number) => arr(num(-1e9, 1e9), n, { min: n });
const Node = obj({
  name: opt(str(200)), translation: opt(Vec(3)), rotation: opt(Vec(4)), scale: opt(Vec(3)),
  children: opt(arr(int(0, 1e6), 1000)), mesh: opt(int(0, 1e6)), skin: opt(int(0, 1e6)),
});
const Accessor = obj({ bufferView: opt(int(0, 1e6)), byteOffset: opt(int(0, 1e9)), componentType: int(5120, 5126), count: int(0, 1e9), type: str(8), min: opt(raw), max: opt(raw) });
const View = obj({ byteOffset: opt(int(0, 1e10)), byteLength: int(0, 1e10), byteStride: opt(int(0, 255)) });
const Channel = obj({ sampler: int(0, 1e6), target: obj({ node: opt(int(0, 1e6)), path: str(20) }) });
const Sampler = obj({ input: int(0, 1e6), output: int(0, 1e6), interpolation: opt(str(20)) });
const Animation = obj({ name: opt(str(200)), channels: arr(Channel, 10000), samplers: arr(Sampler, 10000) });
const Skin = obj({ joints: arr(int(0, 1e6), 1000), inverseBindMatrices: opt(int(0, 1e6)), skeleton: opt(int(0, 1e6)) });
const Gltf = obj({
  scenes: arr(obj({ nodes: opt(arr(int(0, 1e6), 1000)) }), 100), nodes: arr(Node, 100000), skins: opt(arr(Skin, 100)),
  animations: opt(arr(Animation, 1000)), accessors: arr(Accessor, 1e6), bufferViews: arr(View, 1e6),
});
export type GNode = Of<typeof Node>;
export type GSkin = Of<typeof Skin>;

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** One read GLB: its checked JSON, and each float accessor read out (a non-float one throws). */
export function readGlb(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = dv.getUint32(12, true), binAt = 20 + jsonLen + 8;
  const json = Gltf(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))));
  const floats = (i: number) => {
    const a = json.accessors[i];
    if (!a || a.bufferView === undefined) throw new Error(`accessor ${i} missing`);
    if (a.componentType !== 5126) throw new Error(`accessor ${i} is not float`);
    const v = json.bufferViews[a.bufferView]!, n = SIZE[a.type]!, stride = v.byteStride ?? n * 4;
    const out = new Float32Array(a.count * n), at = binAt + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv.getFloat32(at + k * stride + c * 4, true);
    return out;
  };
  return { json, floats, size: (i: number) => SIZE[json.accessors[i]!.type]!, bytes: (i: number) => BYTES[json.accessors[i]!.componentType]! };
}

type Kind = "SCALAR" | "VEC3" | "VEC4" | "MAT4";
/** A GLB being written: add accessors (each its own tightly packed view), then `glb()` for the file. */
export class GlbWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  readonly accessors: Record<string, unknown>[] = [];
  readonly views: Record<string, unknown>[] = [];

  private push(data: Uint8Array, target?: number) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: data.byteLength, ...(target ? { target } : {}) });
    this.chunks.push(data); this.length += data.byteLength;
    return this.views.length - 1;
  }

  /** A float accessor; `bounds` writes min and max (glTF wants them on positions and animation inputs). */
  floats(data: Float32Array, type: Kind, bounds = false) {
    const n = SIZE[type]!, count = data.length / n;
    const view = this.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const a: Record<string, unknown> = { bufferView: view, componentType: 5126, count, type };
    if (bounds) {
      const lo = Array<number>(n).fill(Infinity), hi = Array<number>(n).fill(-Infinity);
      for (let k = 0; k < count; k++) for (let c = 0; c < n; c++) { lo[c] = Math.min(lo[c]!, data[k * n + c]!); hi[c] = Math.max(hi[c]!, data[k * n + c]!); }
      a.min = lo; a.max = hi;
    }
    this.accessors.push(a);
    return this.accessors.length - 1;
  }

  /** An integer accessor (joints as bytes, indices as shorts). */
  ints(data: Uint8Array | Uint16Array, type: "SCALAR" | "VEC4", target?: number) {
    const view = this.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target);
    this.accessors.push({ bufferView: view, componentType: data instanceof Uint8Array ? 5121 : 5123, count: data.length / SIZE[type]!, type });
    return this.accessors.length - 1;
  }

  /** The GLB, with `parts` (nodes, skins, meshes, animations, scenes...) laid over the accessors written. */
  glb(parts: Record<string, unknown>) {
    const bin = new Uint8Array(Math.ceil(this.length / 4) * 4);
    let at = 0;
    for (const c of this.chunks) { bin.set(c, at); at += c.byteLength; }
    const doc = { asset: { version: "2.0", generator: "mythic-masters gltf-lite" }, scene: 0, ...parts, accessors: this.accessors, bufferViews: this.views, buffers: [{ byteLength: bin.byteLength }] };
    let js = new TextEncoder().encode(JSON.stringify(doc));
    const pad = (4 - (js.length % 4)) % 4;
    if (pad) { const p = new Uint8Array(js.length + pad).fill(0x20); p.set(js); js = p; }
    const out = new Uint8Array(12 + 8 + js.length + 8 + bin.length), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
    dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
    dv.setUint32(20 + js.length, bin.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(bin, 28 + js.length);
    return out;
  }
}
