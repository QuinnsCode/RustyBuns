// The scenery strewn over a park, built in code and written out at three polygon budgets.
//
//   bun scripts/scenery.ts
//
// Writes public/models/scenery-{hi,mid,low}.glb: one object per kind, about a metre tall standing on y = 0 at the
// origin; the page (src/render/scenery.ts) scales it to its spot's size and bakes the material colours into vertex
// colours so one material draws a kind. Thousands of them are drawn as one instanced mesh per kind, so the budgets
// are tight (BUDGETS): each is built directly with fewer points round and fewer rings, not cut down from a dense mesh.
//
// The biome kinds are for the parks beyond the pine forests: a joshua tree and a saguaro for the desert, a palm for
// the swamps and the islands, an oak for the hardwood east, a snag (a dead bare trunk) and sage for the high and
// dry places. Which kinds a park uses is its biome in scenery.ts.
import * as THREE from "three";
import { R, ball, box, loft, part as gather, triangles, type Palette, type Piece } from "@rustybuns/models";
import { toGlb } from "@rustybuns/models/glb";

const c = (hex: string): [string, number, number] => [hex, 0.95, 0];
const PALETTE: Palette = Object.fromEntries(Object.entries({
  bark: "#6B4429", "bark-dark": "#4E3220", needles: "#2F5D3A", "needles-light": "#3B6E45", "needles-dark": "#24503A",
  "aspen-bark": "#E6E2D3", "aspen-leaf": "#E0B43C", "oak-leaf": "#4F7A37", "oak-leaf-dark": "#3E6530",
  stone: "#8E857A", "stone-dark": "#7D766C", "stone-light": "#9C9388",
  "cut-wood": "#C9A06A", board: "#B58A4F", canvas: "#E2572B", "canvas-dark": "#B8431F",
  leaf: "#3F6B3A", "leaf-light": "#4D7A43", frond: "#5A8A3C", "frond-dark": "#4A7A35",
  stem: "#4F7A37", "petal-yellow": "#F2D03B", "petal-white": "#F4F0E6", "petal-violet": "#8E6FD0",
  "joshua-bark": "#7A6A52", "joshua-leaf": "#6E8A52", "joshua-dead": "#A89C7A",
  saguaro: "#4F7A4A", "saguaro-dark": "#3F6A3C",
  "palm-trunk": "#8A7556", "palm-frond": "#4A8A3A", "palm-frond-dark": "#3A7030",
  snag: "#9A9082", "snag-dark": "#6E675C", sage: "#8C9A80", "sage-light": "#A3B094", "sequoia-bark": "#8A4A2B",
}).map(([k, hex]) => [k, c(hex)]));

/** Triangle targets per budget: a tree gets more than the rest. */
const BUDGETS = {
  hi: { kind: 600, tree: 900, seg: 1, rings: 5 },
  mid: { kind: 220, tree: 320, seg: 0.75, rings: 4 },
  low: { kind: 80, tree: 110, seg: 0.5, rings: 3 },
} as const;
type Budget = (typeof BUDGETS)[keyof typeof BUDGETS];
const TREES = new Set(["pine", "aspen", "oak", "joshua", "saguaro", "palm", "snag", "sequoia"]);

const { PI } = Math;
const mat = (...ms: THREE.Matrix4[]) => ms.reduce((a, m) => a.multiply(m), new THREE.Matrix4());
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const rx = (a: number) => new THREE.Matrix4().makeRotationX(a);
const ry = (a: number) => new THREE.Matrix4().makeRotationY(a);
const rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);

/** A seeded stream, so the same file comes out every run. */
function stream(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function kinds(b: Budget): Record<string, Piece[]> {
  const seg = (n: number) => Math.max(4, Math.round(n * b.seg));
  const rings = b.rings;
  const rand = stream(3);
  /** A cone or a pole standing on y = 0, `m` places it. `jag` pushes alternate points out, so it stops looking like a primitive. */
  const cone = (slot: string, r1: number, r2: number, h: number, n: number, m?: THREE.Matrix4, jag = 0) =>
    loft(slot, [R(0, r1, r1, { jag }), R(h, r2, r2, { jag })], { seg: seg(n), m });
  const lump = (slot: string, r: number, p: [number, number, number], scale: [number, number, number] = [1, 1, 1], jag = 0.12) =>
    ball(slot, r, p, { scale, seg: seg(7), rings: rings - 1, jag });
  /** A lumpy crown: overlapping balls, one on top. */
  const crown = (slot: string, r: number, [x, y, z]: [number, number, number], n: number, spread: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i * 2 * PI) / n + 0.4;
      return lump(slot, r * (0.85 + 0.3 * rand()), [x + Math.cos(a) * r * spread, y + (i ? 0.1 : 0) * r, z + Math.sin(a) * r * spread]);
    });

  const pine = () => [cone("bark", 0.07, 0.05, 0.3, 6),
    ...([[0.22, 0.36, 0.5, "needles"], [0.48, 0.28, 0.45, "needles-light"], [0.7, 0.18, 0.38, "needles-dark"]] as const)
      .map(([y, r, h, slot], k) => cone(slot, r, 0.02, h, 10, mat(at(0, y, 0), ry(k * 0.4)), 0.12))];

  // A giant sequoia: a flared red trunk, bare for most of its height, with a narrow crown of flat tiers high up. Also
  // the parks' big named trees (ground.ts), scaled to their own height.
  const sequoia = () => [cone("sequoia-bark", 0.16, 0.09, 0.14, 9), cone("sequoia-bark", 0.09, 0.05, 0.86, 9, at(0, 0.12, 0)),
    ...([[0.42, 0.3, 0.2], [0.56, 0.27, 0.18], [0.7, 0.22, 0.17], [0.83, 0.15, 0.17]] as const)
      .map(([y, r, h], k) => cone(k % 2 ? "needles-dark" : "needles", r, 0.04, h, 9, mat(at(0, y, 0), ry(k * 0.5)), 0.1))];

  const aspen = () => [cone("aspen-bark", 0.05, 0.03, 0.72, 7), ...crown("aspen-leaf", 0.22, [0, 0.78, 0], 3, 0.5)];

  const oak = () => [cone("bark-dark", 0.09, 0.06, 0.5, 8),
    ...[0.6, 2.7, 4.6].map((a) => cone("bark-dark", 0.035, 0.02, 0.32, 6, mat(at(0, 0.42, 0), ry(a), rz(0.7)))),
    ...crown("oak-leaf", 0.3, [0, 0.78, 0], 4, 0.55), ...crown("oak-leaf-dark", 0.2, [0, 0.95, 0], 1, 0.5)];

  const stump = () => [cone("bark", 0.5, 0.42, 0.6, 12, undefined, 0.05), cone("cut-wood", 0.36, 0.36, 0.02, 12, at(0, 0.59, 0))];

  const rock = () => [ball("stone", 0.5, [0, 0.35, 0], { scale: [1, 0.75, 0.9], seg: seg(10), rings, jag: 0.15 })];

  const cairn = () => Array.from({ length: 5 }, (_, i) =>
    lump(i % 2 ? "stone-light" : "stone-dark", 0.34 - i * 0.06, [0.02 * (-1) ** i, 0.17 + i * 0.16, 0], [1, 0.55, 1], 0.1));

  const sign = () => [cone("bark", 0.03, 0.03, 0.8, 6), box("board", [0.5, 0.2, 0.04], [0.05, 0.8, 0]),
    box("board", [0.1, 0.2, 0.04], [0.32, 0.8, 0], { rot: [0, 0, PI / 4] })];

  const bush = () => ([[0, 0.27, 0, 0.36, "leaf"], [0.26, 0.2, 0.1, 0.26, "leaf-light"], [-0.2, 0.18, -0.14, 0.22, "leaf-light"]] as const)
    .map(([x, y, z, r, slot]) => lump(slot, r, [x, y, z], [1, 0.78, 1], 0.2));

  const fern = () => Array.from({ length: b.seg < 1 ? 5 : 7 }, (_, i) =>
    loft(i % 2 ? "frond" : "frond-dark", [R(0, 0.07, 0.07), R(0.55, 0.005, 0.005)],
      { seg: 4, m: mat(at(0, 0.06, 0), ry((i * 2 * PI) / (b.seg < 1 ? 5 : 7)), at(0.04, 0, 0), rz(0.95)) }));

  const flower = () => ([[-0.14, "petal-yellow"], [0.1, "petal-white"], [0.0, "petal-violet"]] as const).flatMap(([dx, slot], i) => [
    cone("stem", 0.012, 0.012, 0.4, 4, at(dx, 0, i * 0.1 - 0.1)), lump(slot, 0.065, [dx, 0.42, i * 0.1 - 0.1], [1, 0.6, 1], 0)]);

  // A ridge tent: a triangular prism on a flat base, the ridge along x, with a door at one end.
  const tent = () => {
    const [w, h, len] = [1, 0.6, 1], x0 = -len / 2, x1 = len / 2;
    const v = [[x0, 0, -w / 2], [x0, 0, w / 2], [x0, h, 0], [x1, 0, -w / 2], [x1, 0, w / 2], [x1, h, 0]];
    const tris = [[0, 2, 1], [5, 3, 4], [0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4], [2, 0, 3], [2, 3, 5]];
    const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(tris.flatMap((t) => t.flatMap((i) => v[i])), 3));
    geo.computeVertexNormals();
    return [{ geo, slot: "canvas" }, box("canvas-dark", [0.02, 0.24, 0.2], [0.5, 0.12, 0])];
  };

  // --- the biomes ---
  /** A joshua tree's tuft: a ball with spikes leaning outward. */
  const tuft = (r: number, slot: string, [x, y, z]: [number, number, number]) => [
    lump(slot, r * 0.6, [x, y, z], [1, 1, 1], 0),
    ...Array.from({ length: b.seg < 0.6 ? 0 : Math.round(10 * b.seg ** 3) }, () => {
      const a = rand() * 2 * PI, t = rand() * PI;
      const d = new THREE.Vector3(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      return cone(slot, r * 0.12, 0.004, r * 1.4, 4, mat(at(x + d.x * r * 0.2, y + d.y * r * 0.2, z + d.z * r * 0.2), new THREE.Matrix4().makeRotationFromQuaternion(q)));
    })];

  const joshua = () => [cone("joshua-bark", 0.07, 0.05, 0.45, 7),
    ...([[0.3, 0.55], [2.4, 0.7], [4.3, 0.45]] as const).flatMap(([a, lean]) => {
      const turn = mat(ry(a), rz(lean)), tip = new THREE.Vector3(0, 0.38, 0).applyMatrix4(turn);
      return [cone("joshua-bark", 0.045, 0.035, 0.38, 6, mat(at(0, 0.42, 0), turn)), ...tuft(0.16, "joshua-leaf", [tip.x, 0.42 + tip.y, tip.z]),
        // dead leaves hang below the tuft as a skirt
        cone("joshua-dead", 0.1, 0.06, 0.12, 7, at(tip.x * 0.9, 0.42 + tip.y * 0.9 - 0.08, tip.z * 0.9))];
    })];

  /** A saguaro's column: ribs run up it, so every other point round the ring is pulled in. */
  const ribbed = (slot: string, r: number, h: number, n: number, m?: THREE.Matrix4) =>
    loft(slot, [R(0, r, r, { jag: -0.1 }), R(h, r * 0.85, r * 0.85, { jag: -0.1 })], { seg: seg(n) % 2 ? seg(n) + 1 : seg(n), m });
  const saguaro = () => [ribbed("saguaro", 0.11, 0.9, 14), lump("saguaro-dark", 0.095, [0, 0.9, 0], [1, 0.7, 1], 0),
    ...([[0.2, 0.42, 0.34], [3.3, 0.55, 0.26]] as const).flatMap(([a, y, h]) => {
      const turn = mat(ry(a), rz(PI / 2)), end = new THREE.Vector3(0, 0.2, 0).applyMatrix4(turn);
      return [...(b.seg < 0.6 ? [] : [ribbed("saguaro", 0.06, 0.2, 10, mat(at(0, y, 0), turn))]), ribbed("saguaro-dark", 0.06, h, 10, at(end.x, y + end.y, end.z)),
        lump("saguaro-dark", 0.052, [end.x, y + end.y + h, end.z], [1, 0.7, 1], 0)];
    })];

  const palm = () => {
    const out: Piece[] = [];
    let x = 0, y = 0;
    const stack = b.seg < 0.6 ? 2 : b.seg < 1 ? 3 : 6, step = 0.93 / stack;
    for (let i = 0; i < stack; i++) { // a trunk that leans, in stacked rings
      out.push(cone("palm-trunk", 0.06 - i * 0.004 * (6 / stack), 0.055 - i * 0.004 * (6 / stack), step + 0.005, 8, mat(at(x, y, 0), rz(-0.12))));
      y += step; x += (0.02 + i * 0.004) * (6 / stack);
    }
    const n = b.seg < 0.6 ? 5 : b.seg < 1 ? 6 : 8;
    for (let i = 0; i < n; i++) {
      // a frond arches: level at the crown, bending over toward its tip
      const rows = (b.seg < 0.6 ? [0, 0.5] : [0, 0.25, 0.5]).map((t) => R(t, 0.075 * (1 - t) + 0.005, 0.075 * (1 - t) + 0.005, { cx: -0.22 * (t / 0.5) ** 2 }));
      out.push(loft(i % 2 ? "palm-frond" : "palm-frond-dark", rows, { seg: 4, m: mat(at(x, y + 0.02, 0), ry((i * 2 * PI) / n + 0.2), rz(PI / 2 + 0.1 + 0.25 * (i % 2))) }));
    }
    out.push(lump("palm-frond-dark", 0.07, [x, y, 0], [1, 1, 1], 0));
    return out;
  };

  const snag = () => [
    // a broken top: the last ring is sheared so it ends in a splinter
    loft("snag", [R(0, 0.08, 0.08, { jag: 0.15 }), R(0.9, 0.04, 0.04, { jag: 0.15 }), R(1.02, 0.035, 0.035, { tilt: 0.12 })], { seg: seg(7) }),
    ...([[0.5, 0.55, 1.1, 0.3], [2.9, 0.7, 0.9, 0.22], [4.4, 0.4, 1.25, 0.2]] as const)
      .map(([a, y, lean, h]) => cone("snag-dark", 0.025, 0.008, h, 5, mat(at(0, y, 0), ry(a), rz(lean))))];

  const sage = () => ([[0, 0, 0.36, "sage"], [0.3, 0.12, 0.24, "sage-light"], [-0.22, -0.2, 0.26, "sage-light"], [0.05, -0.3, 0.2, "sage"]] as const)
    .map(([x, z, r, slot]) => lump(slot, r, [x, r * 0.55, z], [1, 0.6, 1], 0.2));

  return Object.fromEntries(Object.entries({ pine, rock, aspen, cairn, tent, sign, stump, bush, fern, flower, oak, joshua, saguaro, palm, snag, sage, sequoia }).map(([k, f]) => [k, f()]));
}

export async function build(name: keyof typeof BUDGETS) {
  const b = BUDGETS[name], scene = new THREE.Scene(), counts: string[] = [];
  for (const [kind, pieces] of Object.entries(kinds(b))) {
    const g = gather(kind, pieces, PALETTE);
    const cap = TREES.has(kind) ? b.tree : b.kind;
    if (triangles(g) > cap) throw new Error(`${name} ${kind} is ${triangles(g)} triangles, over its ${cap}`);
    scene.add(g);
    counts.push(`${kind} ${triangles(g)}`);
  }
  return { glb: await toGlb(scene), counts };
}

if (import.meta.main) {
  for (const name of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
    const { glb, counts } = await build(name);
    const out = new URL(`../public/models/scenery-${name}.glb`, import.meta.url);
    await Bun.write(out, glb);
    console.log(`${name}: ${counts.join(", ")} -> public/models/scenery-${name}.glb (${Math.round(glb.byteLength / 1024)} KB)`);
  }
}
