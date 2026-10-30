// A Mythic Masters beast as a skinned USD: its *.rig.json skeleton and skin weights as UsdSkel, its parts as
// meshes bound to it, packed into a USDZ. Plain TS (no Blender), so it also runs in tests.
// The pose is the rest pose: a native client moves the joints itself (see "Poses" in docs/ios-usdz.md).
import type { Model } from "../../packages/rig/src/model.ts";
import type { RigResult } from "../../packages/rig/src/index.ts";

export interface BeastSkin { tips: number[]; feet: number[]; wings: number[] }

const num = (n: number) => (Object.is(n, -0) ? "0" : String(+n.toPrecision(7)));
const list = (xs: ArrayLike<number>) => Array.from(xs, num).join(", ");
/** USD matrices are row-major with the translation in the last row. */
const translate = (x: number, y: number, z: number) => `( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (${num(x)}, ${num(y)}, ${num(z)}, 1) )`;

/** Joint paths ("j0/j1/j4") from the parent array; every joint's parent must be listed before it is needed. */
export function jointPaths(parents: ArrayLike<number>): string[] {
  const paths: string[] = [];
  const of = (j: number, depth = 0): string => {
    if (depth > parents.length) throw new Error("rig has a parent loop");
    return (paths[j] ??= parents[j]! < 0 ? `j${j}` : `${of(parents[j]!, depth + 1)}/j${j}`);
  };
  for (let j = 0; j < parents.length; j++) of(j);
  return paths;
}

export function beastUsda(name: string, model: Model, rig: RigResult, skin: BeastSkin): string {
  const J = rig.parents.length, P = jointPaths(rig.parents);
  const at = (j: number): [number, number, number] => [rig.joints[j * 3]!, rig.joints[j * 3 + 1]!, rig.joints[j * 3 + 2]!];
  const bind = Array.from({ length: J }, (_, j) => translate(...at(j)));
  const rest = Array.from({ length: J }, (_, j) => {
    const p = rig.parents[j]!, a = at(j), b = p < 0 ? [0, 0, 0] : at(p);
    return translate(a[0] - b[0]!, a[1] - b[1]!, a[2] - b[2]!);
  });
  const id = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  const out: string[] = [
    `#usda 1.0`,
    `(\n    defaultPrim = "${id}"\n    upAxis = "Y"\n    metersPerUnit = 1\n    doc = "${name}: rest pose, tips ${skin.tips.join(",")}; feet ${skin.feet.join(",")}; wings ${skin.wings.join(",")}"\n)`,
    `def SkelRoot "${id}" (\n    customData = { int[] tips = [${skin.tips.join(", ")}]; int[] feet = [${skin.feet.join(", ")}]; int[] wings = [${skin.wings.join(", ")}] }\n)\n{`,
    `    def Skeleton "Skel" (\n        prepend apiSchemas = ["SkelBindingAPI"]\n    )\n    {`,
    `        uniform token[] joints = [${P.map((p) => `"${p}"`).join(", ")}]`,
    `        uniform matrix4d[] bindTransforms = [${bind.join(", ")}]`,
    `        uniform matrix4d[] restTransforms = [${rest.join(", ")}]`,
    `    }`,
    `    def Scope "Materials"\n    {`,
  ];
  const mats: string[] = [];
  model.parts.forEach((part, i) => {
    const m = (Array.isArray(part.material) ? part.material[0] : part.material) as { color?: { r: number; g: number; b: number }; roughness?: number; metalness?: number } | undefined;
    const c = m?.color ?? { r: 0.8, g: 0.8, b: 0.8 };
    mats.push(`m${i}`);
    out.push(
      `        def Material "m${i}"\n        {`,
      `            token outputs:surface.connect = </${id}/Materials/m${i}/Shader.outputs:surface>`,
      `            def Shader "Shader"\n            {`,
      `                uniform token info:id = "UsdPreviewSurface"`,
      `                color3f inputs:diffuseColor = (${num(c.r)}, ${num(c.g)}, ${num(c.b)})`,
      `                float inputs:roughness = ${num(m?.roughness ?? 0.8)}`,
      `                float inputs:metallic = ${num(m?.metalness ?? 0)}`,
      `                token outputs:surface`,
      `            }`,
      `        }`,
    );
  });
  out.push(`    }`);
  model.parts.forEach((part, i) => {
    const g = part.geometry, pos = g.attributes.position!.array as ArrayLike<number>, nor = g.attributes.normal?.array as ArrayLike<number> | undefined;
    const idx = g.index!.array, tris = idx.length / 3;
    const si = rig.skinIndex.subarray(part.start * 4, (part.start + part.count) * 4);
    const sw = rig.skinWeight.subarray(part.start * 4, (part.start + part.count) * 4);
    out.push(
      `    def Mesh "part${i}" (\n        prepend apiSchemas = ["SkelBindingAPI", "MaterialBindingAPI"]\n    )\n    {`,
      `        int[] faceVertexCounts = [${Array(tris).fill(3).join(", ")}]`,
      `        int[] faceVertexIndices = [${list(idx)}]`,
      `        point3f[] points = [${Array.from({ length: part.count }, (_, v) => `(${num(pos[v * 3]!)}, ${num(pos[v * 3 + 1]!)}, ${num(pos[v * 3 + 2]!)})`).join(", ")}]`,
      ...(nor ? [`        normal3f[] normals = [${Array.from({ length: part.count }, (_, v) => `(${num(nor[v * 3]!)}, ${num(nor[v * 3 + 1]!)}, ${num(nor[v * 3 + 2]!)})`).join(", ")}] (\n            interpolation = "vertex"\n        )`] : []),
      `        uniform token subdivisionScheme = "none"`,
      `        int[] primvars:skel:jointIndices = [${list(si)}] (\n            elementSize = 4\n            interpolation = "vertex"\n        )`,
      `        float[] primvars:skel:jointWeights = [${list(sw)}] (\n            elementSize = 4\n            interpolation = "vertex"\n        )`,
      `        matrix4d primvars:skel:geomBindTransform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1) )`,
      `        rel skel:skeleton = </${id}/Skel>`,
      `        rel material:binding = </${id}/Materials/${mats[i]}>`,
      `    }`,
    );
  });
  out.push(`}`, ``);
  return out.join("\n");
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255];
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** A USDZ: a zip with nothing compressed and every file's data starting on a 64-byte boundary. */
export function usdz(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: number[] = [];
  let at = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = Bun.hash.crc32(f.data) >>> 0;
    const base = 30 + name.length;
    const pad = (64 - ((at + base + 4) % 64)) % 64; // extra field: 4 byte header + pad zeros, so the data lands aligned
    const extra = [0x55, 0x53, ...u16(pad), ...new Array(pad).fill(0)];
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(extra.length), ...name, ...extra]);
    central.push(0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(at), ...name);
    parts.push(head, f.data);
    at += head.length + f.data.length;
  }
  parts.push(new Uint8Array([...central, 0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(at), 0, 0]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
