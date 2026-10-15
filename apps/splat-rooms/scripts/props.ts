// Our own stand-ins for the things a room hunt asks you to find: plain flat-shaded models, one per InteriorGS
// label, made from boxes and prisms so they ship under our licence (the scenes' own chairs are splats baked
// into each room). Metres, y up, standing on y = 0, sized like the real boxes in labels.json.
// `bun scripts/props.ts` writes assets/props/<label>.glb.

export type Part =
  | { box: [number, number, number]; at: [number, number, number]; color: string }
  /** an upright prism: radius, height, sides, base centre */
  | { round: [number, number, number]; at: [number, number, number]; color: string; sides?: number };

const WOOD = "#b98a58", DARK = "#5b4636", METAL = "#9aa3ab", FABRIC = "#4f6d8f", WHITE = "#ecebe6", LEAF = "#4d8a4b", POT = "#b5643c";

/** A table or desk top on four legs. */
const topped = (w: number, d: number, h: number, color = WOOD): Part[] => {
  const t = 0.04, l = 0.05, x = w / 2 - l / 2 - 0.02, z = d / 2 - l / 2 - 0.02;
  return [
    { box: [w, t, d], at: [0, h - t / 2, 0], color },
    ...([[-x, -z], [x, -z], [-x, z], [x, z]] as const).map(([px, pz]): Part => ({ box: [l, h - t, l], at: [px, (h - t) / 2, pz], color: DARK })),
  ];
};

/** Open shelving: two sides, a back, and `n` boards. */
const shelving = (w: number, d: number, h: number, n: number, color = WOOD): Part[] => [
  { box: [0.03, h, d], at: [-w / 2 + 0.015, h / 2, 0], color },
  { box: [0.03, h, d], at: [w / 2 - 0.015, h / 2, 0], color },
  { box: [w, h, 0.02], at: [0, h / 2, -d / 2 + 0.01], color: DARK },
  ...Array.from({ length: n }, (_, i): Part => ({ box: [w, 0.03, d], at: [0, (i * (h - 0.03)) / (n - 1) + 0.015, 0], color })),
];

const books = (w: number, y: number, z: number): Part[] => {
  const colors = ["#a33b3b", "#3b6ea3", "#d0a53a", "#4c8a5b", "#7a4c8a"];
  return Array.from({ length: Math.floor(w / 0.05) }, (_, i): Part => {
    const h = 0.2 + ((i * 7) % 5) * 0.02;
    return { box: [0.04, h, 0.2], at: [-w / 2 + 0.03 + i * 0.05, y + h / 2, z], color: colors[i % colors.length]! };
  });
};

export const PROPS: Record<string, Part[]> = {
  chair: [
    { box: [0.45, 0.05, 0.45], at: [0, 0.45, 0], color: FABRIC },
    { box: [0.45, 0.45, 0.04], at: [0, 0.7, -0.205], color: FABRIC },
    ...([[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as const).map(([x, z]): Part => ({ box: [0.04, 0.45, 0.04], at: [x, 0.225, z], color: DARK })),
  ],
  stool: [{ round: [0.18, 0.04, 12], at: [0, 0.6, 0], color: FABRIC }, ...[0, 1, 2, 3].map((i): Part => ({ box: [0.04, 0.6, 0.04], at: [Math.cos(i * 1.571 + 0.785) * 0.14, 0.3, Math.sin(i * 1.571 + 0.785) * 0.14], color: DARK }))],
  table: topped(1.4, 0.8, 0.75),
  desk: [
    ...topped(1.4, 0.7, 0.75),
    { box: [0.4, 0.5, 0.6], at: [0.45, 0.25, 0], color: WOOD },
  ],
  shelf: shelving(0.9, 0.3, 1.5, 4),
  bookshelf: [...shelving(0.9, 0.3, 2, 5), ...books(0.8, 0.03, 0), ...books(0.8, 0.43, 0)],
  cabinet: [
    { box: [0.9, 0.9, 0.45], at: [0, 0.45, 0], color: WOOD },
    { box: [0.02, 0.8, 0.02], at: [-0.03, 0.45, 0.235], color: METAL },
    { box: [0.02, 0.8, 0.02], at: [0.03, 0.45, 0.235], color: METAL },
  ],
  wardrobe: [{ box: [1.2, 2.0, 0.55], at: [0, 1, 0], color: WOOD }, { box: [0.02, 0.4, 0.02], at: [-0.04, 1, 0.285], color: METAL }, { box: [0.02, 0.4, 0.02], at: [0.04, 1, 0.285], color: METAL }],
  sofa: [
    { box: [1.9, 0.4, 0.85], at: [0, 0.2, 0], color: FABRIC },
    { box: [1.9, 0.45, 0.2], at: [0, 0.62, -0.325], color: FABRIC },
    { box: [0.2, 0.3, 0.85], at: [-0.85, 0.55, 0], color: FABRIC },
    { box: [0.2, 0.3, 0.85], at: [0.85, 0.55, 0], color: FABRIC },
  ],
  monitor: [
    { box: [0.6, 0.35, 0.03], at: [0, 0.38, 0], color: "#222a33" },
    { box: [0.05, 0.2, 0.05], at: [0, 0.1, 0], color: METAL },
    { box: [0.25, 0.02, 0.18], at: [0, 0.01, 0], color: METAL },
  ],
  computer: [
    { box: [0.36, 0.02, 0.25], at: [0, 0.01, 0.1], color: METAL },
    { box: [0.36, 0.24, 0.015], at: [0, 0.13, -0.025], color: "#222a33" },
  ],
  book: [{ box: [0.15, 0.03, 0.22], at: [0, 0.015, 0], color: "#a33b3b" }, { box: [0.14, 0.024, 0.21], at: [0.005, 0.015, 0.002], color: WHITE }],
  cup: [{ round: [0.04, 0.09, 12], at: [0, 0, 0], color: WHITE }, { box: [0.015, 0.05, 0.02], at: [0.052, 0.045, 0], color: WHITE }],
  plant: [{ round: [0.12, 0.25, 10], at: [0, 0, 0], color: POT }, { round: [0.2, 0.5, 6], at: [0, 0.25, 0], color: LEAF }, { round: [0.12, 0.3, 6], at: [0, 0.75, 0], color: LEAF }],
  trash_can: [{ round: [0.15, 0.4, 12], at: [0, 0, 0], color: METAL }],
  cart: [
    { box: [0.8, 0.03, 0.45], at: [0, 0.15, 0], color: METAL },
    { box: [0.8, 0.03, 0.45], at: [0, 0.8, 0], color: METAL },
    ...([[-0.38, -0.2], [0.38, -0.2], [-0.38, 0.2], [0.38, 0.2]] as const).map(([x, z]): Part => ({ box: [0.03, 0.8, 0.03], at: [x, 0.4, z], color: METAL })),
    ...([[-0.38, -0.2], [0.38, -0.2], [-0.38, 0.2], [0.38, 0.2]] as const).map(([x, z]): Part => ({ round: [0.05, 0.05, 8], at: [x, 0, z], color: DARK })),
  ],
};

interface Mesh { pos: number[]; nor: number[]; idx: number[] }

function addQuad(m: Mesh, c: number[][], n: number[]) {
  const base = m.pos.length / 3;
  for (const p of c) { m.pos.push(...p); m.nor.push(...n); }
  m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Wind a face so it points along `n` whatever order the corners came in. */
function face(m: Mesh, c: number[][], n: number[]) {
  const [a, b, d] = c as [number[], number[], number[]];
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
  const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  addQuad(m, cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]! >= 0 ? c : [...c].reverse(), n);
}

function prism(m: Mesh, ring: [number, number][], y0: number, y1: number) {
  const n = ring.length;
  ring.forEach(([x, z], i) => {
    const [x2, z2] = ring[(i + 1) % n]!;
    const nx = (x + x2) / 2, nz = (z + z2) / 2, l = Math.hypot(nx, nz) || 1;
    face(m, [[x, y0, z], [x2, y0, z2], [x2, y1, z2], [x, y1, z]], [nx / l, 0, nz / l]);
  });
  for (const [y, s] of [[y0, -1], [y1, 1]] as const) {
    for (let i = 1; i < n - 1; i++) {
      const base = m.pos.length / 3;
      for (const k of [0, i, i + 1]) { m.pos.push(ring[k]![0], y, ring[k]![1]); m.nor.push(0, s, 0); }
      m.idx.push(...(s > 0 ? [base, base + 2, base + 1] : [base, base + 1, base + 2]));
    }
  }
}

/** The model as one binary glTF: a mesh per colour, so each part keeps its own flat material. */
export function glb(parts: Part[]): Uint8Array {
  const byColor = new Map<string, Mesh>();
  for (const p of parts) {
    const m = byColor.get(p.color) ?? { pos: [], nor: [], idx: [] };
    byColor.set(p.color, m);
    const [x, y, z] = p.at;
    if ("box" in p) {
      const [w, h, d] = p.box;
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
      prism(m, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1);
    } else {
      const [r, h] = p.round, n = p.sides ?? p.round[2];
      prism(m, Array.from({ length: n }, (_, i): [number, number] => [x + Math.cos((i / n) * Math.PI * 2) * r, z + Math.sin((i / n) * Math.PI * 2) * r]), y, y + h);
    }
  }
  const bin: number[] = [];
  const views: object[] = [], accessors: object[] = [], primitives: object[] = [], materials: object[] = [];
  const push = (data: ArrayBuffer, target: number) => {
    while (bin.length % 4) bin.push(0);
    views.push({ buffer: 0, byteOffset: bin.length, byteLength: data.byteLength, target });
    bin.push(...new Uint8Array(data));
    return views.length - 1;
  };
  for (const [color, m] of byColor) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, m.pos[i]!); hi[i % 3] = Math.max(hi[i % 3]!, m.pos[i]!); }
    const count = m.pos.length / 3;
    accessors.push({ bufferView: push(new Float32Array(m.pos).buffer, 34962), componentType: 5126, count, type: "VEC3", min: lo, max: hi });
    accessors.push({ bufferView: push(new Float32Array(m.nor).buffer, 34962), componentType: 5126, count, type: "VEC3" });
    accessors.push({ bufferView: push(new Uint16Array(m.idx).buffer, 34963), componentType: 5123, count: m.idx.length, type: "SCALAR" });
    const rgb = [1, 3, 5].map((i) => Math.pow(parseInt(color.slice(i, i + 2), 16) / 255, 2.2));
    materials.push({ pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 } });
    const a = accessors.length;
    primitives.push({ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: materials.length - 1 });
  }
  while (bin.length % 4) bin.push(0);
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0", generator: "splat-rooms props" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }],
  }));
  const jsonLen = Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + bin.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(json, 20);
  dv.setUint32(20 + jsonLen, bin.length, true); dv.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out;
}

if (import.meta.main) {
  const dir = new URL("../assets/props/", import.meta.url).pathname;
  for (const [name, parts] of Object.entries(PROPS)) await Bun.write(`${dir}${name}.glb`, glb(parts));
  console.log(`wrote ${Object.keys(PROPS).length} props to assets/props/`);
}
