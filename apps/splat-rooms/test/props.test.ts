import { expect, test } from "bun:test";
import { PROPS, glb } from "../scripts/props.ts";

function read(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer);
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jl)));
  const bin = bytes.slice(28 + jl);
  return { dv, json, bin };
}

test("every prop is a valid glb that stands on the floor, with triangles facing out", () => {
  for (const [name, parts] of Object.entries(PROPS)) {
    const bytes = glb(parts);
    expect(new DataView(bytes.buffer).getUint32(8, true)).toBe(bytes.length);
    const { json, bin } = read(bytes);
    let lowest = Infinity;
    for (const p of json.meshes[0].primitives) {
      const [pa, na, ia] = [json.accessors[p.attributes.POSITION], json.accessors[p.attributes.NORMAL], json.accessors[p.indices]];
      const f = (a: any) => { const v = json.bufferViews[a.bufferView]; return new Float32Array(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + v.byteLength)); };
      const iv = json.bufferViews[ia.bufferView];
      const idx = new Uint16Array(bin.buffer.slice(bin.byteOffset + iv.byteOffset, bin.byteOffset + iv.byteOffset + iv.byteLength));
      const pos = f(pa), nor = f(na);
      lowest = Math.min(lowest, pa.min[1]);
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((i) => i * 3) as [number, number, number];
        const u = [0, 1, 2].map((k) => pos[b + k]! - pos[a + k]!), v = [0, 1, 2].map((k) => pos[c + k]! - pos[a + k]!);
        const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        expect(cross[0]! * nor[a]! + cross[1]! * nor[a + 1]! + cross[2]! * nor[a + 2]!, `${name} triangle ${t / 3}`).toBeGreaterThan(0);
      }
    }
    expect(lowest, name).toBeCloseTo(0, 5);
  }
});
