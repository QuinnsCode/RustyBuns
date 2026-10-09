// 🌴 The jungle that takes the office's walls: palms and fan bushes along every wall, vines hanging off them and
// from the ceiling, and Druids Curse's blade grass over the free floor. All built in code (the palms, fronds and
// sway are hippo-tycoon's jungle.ts, the grass blade is druids-curse's proceduralCover.ts), instanced, so it's a
// handful of draw calls however thick it gets. What's on a wall (the boards, the TV, the windows, the doors)
// stays clear: vines stop above it and nothing tall stands in front of it.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FEATURES, LOFT, ROOM, type Box, type Wall } from "./room.ts";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---- textures (hippo-tycoon's) ----------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}
function texture(c: HTMLCanvasElement, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}
function bark() {
  const [c, g] = canvas(128, 256), r = rng(13);
  g.fillStyle = "#7a6c58"; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(${r() < 0.5 ? "30,24,16" : "170,155,130"},${r() * 0.25})`; g.lineWidth = 1;
    g.beginPath(); const x = r() * 128; g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 8, 256); g.stroke();
  }
  for (let y = 6; y < 256; y += 18) {
    g.fillStyle = "rgba(40,30,18,0.5)"; g.fillRect(0, y, 128, 3);
    g.fillStyle = "rgba(190,175,145,0.25)"; g.fillRect(0, y + 3, 128, 2);
  }
  return texture(c, 1, 3);
}
function frond() {
  const [c, g] = canvas(256, 512), r = rng(21);
  g.strokeStyle = "#5c7a2a"; g.lineWidth = 5; g.beginPath(); g.moveTo(128, 512); g.lineTo(128, 6); g.stroke();
  for (let y = 500; y > 14; y -= 8) {
    const t = 1 - y / 512, len = 112 * Math.sin(Math.min(1, t * 3.6) * Math.PI * 0.5) * (1 - t * 0.55);
    for (const s of [-1, 1]) {
      const g2 = g.createLinearGradient(128, y, 128 + s * len, y + len * 0.55);
      g2.addColorStop(0, "#35591d"); g2.addColorStop(1, `hsl(${92 + r() * 22} 55% ${26 + r() * 14}%)`);
      g.strokeStyle = g2; g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + s * len * 0.6, y - 6, 128 + s * len, y + len * 0.5); g.stroke();
    }
  }
  return texture(c);
}
/** A heart-shaped vine leaf. */
function leaf() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#3f7a2a";
  g.beginPath(); g.moveTo(32, 62); g.bezierCurveTo(-6, 34, 8, 2, 32, 16); g.bezierCurveTo(56, 2, 70, 34, 32, 62); g.fill();
  g.strokeStyle = "#7fb04a"; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 60); g.lineTo(32, 18); g.stroke();
  return texture(c);
}

/** A tile of ivy: overlapping leaves on transparent, to cover a wall. */
function ivy() {
  const [c, g] = canvas(256, 256), r = rng(31);
  for (let i = 0; i < 70; i++) {
    const x = r() * 256, y = r() * 256, s = 14 + r() * 18, a = r() * 6.28;
    g.save(); g.translate(x, y); g.rotate(a); g.scale(s / 32, s / 32);
    g.fillStyle = `hsl(${88 + r() * 40} ${40 + r() * 25}% ${18 + r() * 22}%)`;
    g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(-38, 2, -24, -30, 0, -16); g.bezierCurveTo(24, -30, 38, 2, 0, 30); g.fill();
    g.strokeStyle = "rgba(160,200,110,0.5)"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 28); g.lineTo(0, -14); g.stroke();
    g.restore();
  }
  return texture(c);
}

// ---- wind -------------------------------------------------------------------------------------------------

const time = { value: 0 };
/** Sway in the vertex shader: the higher a vertex, the more it leans, out of phase per instance. Foliage also
 *  opts out of the office's toon outlines, which would draw every blade and leaf in grey ink. */
function swaying<M extends THREE.Material>(m: M, amp: number, hang = false): M {
  m.userData.outlineParameters = { visible: false };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float h = ${hang ? "max(-position.y, 0.0)" : "max(position.y, 0.0)"};
      transformed.x += sin(uTime * 1.1 + ph) * ${amp.toFixed(3)} * h * h * 0.02;
      transformed.z += cos(uTime * 0.8 + ph * 1.3) * ${amp.toFixed(3)} * h * h * 0.015;`);
  };
  return m;
}

// ---- shapes -----------------------------------------------------------------------------------------------

let frondGeo: THREE.BufferGeometry | null = null;
/** One drooping frond card, bent along its length, stem at the origin. */
function frondGeometry() {
  if (frondGeo) return frondGeo;
  const g = new THREE.PlaneGeometry(2.6, 5.4, 1, 10);
  g.translate(0, 2.7, 0);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -0.075 * y * y); }
  g.computeVertexNormals();
  return (frondGeo = g);
}

/** A palm as one geometry with two groups, bark then leaves. Unit-ish: ~`height` tall. */
function palm(seed: number, height: number, lean: number) {
  const r = rng(seed);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.15, height * 0.35, 0),
    new THREE.Vector3(lean * 0.55, height * 0.7, 0), new THREE.Vector3(lean, height, 0),
  ]);
  const segs: THREE.BufferGeometry[] = [], n = 9;
  for (let i = 0; i < n; i++) {
    const a = curve.getPoint(i / n), b = curve.getPoint((i + 1) / n);
    const seg = new THREE.CylinderGeometry(0.2 * (1 - (i + 1) / n * 0.55), 0.2 * (1 - i / n * 0.55), a.distanceTo(b) * 1.04, 8);
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 0, 1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    segs.push(seg.applyMatrix4(m));
  }
  const top = curve.getPoint(1), cards: THREE.BufferGeometry[] = [], count = 11 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + r() * 0.3, pitch = 0.35 + r() * 0.75, s = 0.85 + r() * 0.45;
    const m = new THREE.Matrix4().makeTranslation(top.x, top.y, top.z).multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationX(-pitch)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    cards.push(frondGeometry().clone().applyMatrix4(m));
  }
  return mergeGeometries([mergeGeometries(segs)!, mergeGeometries(cards)!], true)!;
}

/** A fan of fronds from one point; small ones are ferns. */
function bush(seed: number, fronds: number, scale: number, upright = 0) {
  const r = rng(seed), cards: THREE.BufferGeometry[] = [];
  for (let k = 0; k < fronds; k++) {
    const s = scale * (0.7 + r() * 0.5), m = new THREE.Matrix4().makeRotationY(r() * 6.28)
      .multiply(new THREE.Matrix4().makeRotationX(-(0.75 - upright * 0.55) - r() * 0.6)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    cards.push(frondGeometry().clone().applyMatrix4(m));
  }
  return mergeGeometries(cards)!;
}

/** A vine hanging `length` metres down from its origin: a wavy stem and leaves along it. Groups: stem, leaves. */
function vine(seed: number, length: number) {
  const r = rng(seed), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(Math.sin(i * 1.3 + seed) * 0.08, -length * (i / 8), Math.cos(i * 0.9 + seed) * 0.05));
  const curve = new THREE.CatmullRomCurve3(pts);
  const stem = new THREE.TubeGeometry(curve, 24, 0.018, 4);
  const cards: THREE.BufferGeometry[] = [];
  for (let d = 0.1; d < length; d += 0.11) {
    const p = curve.getPoint(d / length), s = 0.13 + r() * 0.1;
    const card = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(r() * 6.28).multiply(new THREE.Matrix4().makeRotationX(0.5 + r() * 0.6))
        .multiply(new THREE.Matrix4().makeScale(s, s, s)));
    cards.push(card.translate(p.x, p.y, p.z));
  }
  return mergeGeometries([stem, mergeGeometries(cards)!].map((g) => g.toNonIndexed()), true)!;
}

/** Druids Curse's blade: tapered, gently bent, root planted at y = 0. */
function blade(segments = 4, width = 0.05, height = 0.2, bend = 0.06) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, y = t * height, w = width * (1 - t) * 0.85 + width * 0.15, bx = t * t * bend;
    pos.push(-w / 2 + bx, y, 0, w / 2 + bx, y, 0);
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segments; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const GRASS = [0x4a8a3f, 0x5aa04a, 0x3e7a38, 0x6ab355, 0x467a3a];

// ---- planting ---------------------------------------------------------------------------------------------

type Spot = { x: number; z: number; wall: Wall; u: number; inward: number };

/** Every `step` metres along every wall, `inset` metres into the room. */
function along(step: number, inset: number): Spot[] {
  const out: Spot[] = [];
  for (let x = ROOM.minX + 0.4; x < ROOM.maxX - 0.3; x += step) {
    out.push({ x, z: ROOM.minZ + inset, wall: "north", u: x, inward: 0 });
    out.push({ x, z: ROOM.maxZ - inset, wall: "south", u: x, inward: Math.PI });
  }
  for (let z = ROOM.minZ + 0.4; z < ROOM.maxZ - 0.3; z += step) {
    out.push({ x: ROOM.minX + inset, z, wall: "west", u: z, inward: Math.PI / 2 });
    out.push({ x: ROOM.maxX - inset, z, wall: "east", u: z, inward: -Math.PI / 2 });
  }
  return out;
}

/** The lowest thing on the wall at this spot (a board, a window, a door), or null if the wall is bare. */
function feature(s: Spot, pad = 0.35) {
  let low: { y0: number; y1: number } | null = null;
  for (const f of FEATURES) if (f.wall === s.wall && Math.abs(s.u - f.u) < f.width / 2 + pad && (!low || f.y0 < low.y0)) low = f;
  return low;
}

export function jungle(colliders: Box[], density = 1) {
  const g = new THREE.Group() as THREE.Group & { update(t: number): void };
  g.name = "druids-jungle";
  const r = rng(4242);
  const solid = colliders.filter((c) => c.top > 0.05 && c.bottom < 2.5 && (c.maxX - c.minX) * (c.maxZ - c.minZ) < 200);
  const clear = (x: number, z: number, rad: number) =>
    !solid.some((c) => x > c.minX - rad && x < c.maxX + rad && z > c.minZ - rad && z < c.maxZ + rad);
  const underLoft = (x: number, z: number) => x > LOFT.minX - 0.6 && z > LOFT.minZ - 0.6;

  const barkMat = swaying(new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 }), 0.25);
  const leafMat = swaying(new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, color: 0xbfe8a0 }), 1);
  const stemMat = swaying(new THREE.MeshStandardMaterial({ color: 0x4d5a2a, roughness: 0.9 }), 0.6, true);
  const vineLeafMat = swaying(new THREE.MeshStandardMaterial({ map: leaf(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 }), 0.6, true);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], at: { x: number; y: number; z: number; s: number; sy?: number; yaw: number }[]) => {
    if (!at.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, at.length);
    at.forEach((p, i) => {
      e.set(0, p.yaw, 0); q.setFromEuler(e);
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), q, sc.set(p.s, p.sy ?? p.s, p.s)));
    });
    mesh.frustumCulled = false;
    mesh.userData.rbForest = "skip";
    g.add(mesh);
    return mesh;
  };

  // palms: shoulder to shoulder along every bare stretch of wall, leaning into the room
  const palmShapes = [0, 1, 2, 3].map((i) => ({ geo: palm(i * 7 + 3, 8 + i * 1.2, 1.2 + i * 0.4), at: [] as Parameters<typeof instanced>[2] }));
  along(0.9, 0.75).forEach((s, i) => {
    if (r() > density || underLoft(s.x, s.z) || feature(s, 0.6) || !clear(s.x, s.z, 0.35)) return;
    const k = 0.42 + r() * 0.24; // 8–11.6 m shapes → 3.4–6.6 m, under the 6.8 m ceiling
    palmShapes[i % 4]!.at.push({ x: s.x, y: 0, z: s.z, s: k * 0.8, sy: Math.min(k, 6.5 / (8 + (i % 4) * 1.2)), yaw: s.inward - Math.PI / 2 + (r() - 0.5) * 0.8 });
  });
  for (const p of palmShapes) instanced(p.geo, [barkMat, leafMat], p.at);

  // fan bushes and ferns packed along the walls (under the boards and windows too, kept low there)
  const fans: Parameters<typeof instanced>[2] = [], ferns: Parameters<typeof instanced>[2] = [];
  along(0.55, 0.45).forEach((s) => {
    if (r() > density || !clear(s.x, s.z, 0.25)) return;
    const f = feature(s, 0.1);
    if (f && f.y0 < 0.3) return; // a door
    const low = f || underLoft(s.x, s.z);
    (low ? ferns : fans).push({ x: s.x + (r() - 0.5) * 0.3, y: 0, z: s.z + (r() - 0.5) * 0.3, s: low ? 0.1 + r() * 0.06 : 0.28 + r() * 0.22, yaw: r() * 6.28 });
  });
  instanced(bush(12, 8, 1.05, 1), leafMat, fans);
  instanced(bush(3, 7, 1), leafMat, ferns);

  // ivy over every bare stretch of wall, floor to ceiling, cut round what's on it
  const tiles: Parameters<typeof instanced>[2] = [], T = 0.55;
  along(T * 0.8, 0.04).forEach((s) => {
    for (let y = 0; y < ROOM.top; y += T * 0.8) {
      if (r() > 0.92 * density) continue;
      const hit = FEATURES.some((f) => f.wall === s.wall && Math.abs(s.u - f.u) < f.width / 2 + T * 0.5 && y + T > f.y0 - 0.05 && y < f.y1 + 0.1);
      if (!hit) tiles.push({ x: s.x, y, z: s.z, s: T * (0.9 + r() * 0.35), yaw: s.inward });
    }
  });
  const ivyMat = swaying(new THREE.MeshStandardMaterial({ map: ivy(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8 }), 0.05);
  instanced(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), ivyMat, tiles);

  // vines down every wall, stopping above whatever hangs there; and some from the ceiling
  const vines = [1.6, 2.6, 3.6, 4.8].map((len, i) => ({ len, geo: vine(i * 11 + 5, len), at: [] as Parameters<typeof instanced>[2] }));
  const hang = (x: number, y: number, z: number, room: number, yaw: number) => {
    const fit = vines.filter((v) => v.len <= room);
    if (fit.length) fit[Math.floor(r() * fit.length)]!.at.push({ x, y, z, s: 1, yaw });
  };
  along(0.26, 0.12).forEach((s) => {
    if (r() > 0.9 * density) return;
    const f = feature(s, 0.15), top = underLoft(s.x, s.z) ? 2.75 : ROOM.top;
    hang(s.x, top, s.z, top - (f ? f.y1 + 0.2 : 0.9 + r() * 1.5), r() * 6.28);
  });
  for (let n = 0; n < 140 * density; n++) {
    const x = ROOM.minX + 1 + r() * 34, z = ROOM.minZ + 1 + r() * 24;
    if (!underLoft(x, z)) hang(x, ROOM.top, z, 1.6 + r() * 1.4, r() * 6.28);
  }
  for (const v of vines) instanced(v.geo, [stemMat, vineLeafMat], v.at);

  // Druids Curse grass over the free floor, in clumps
  const blades: { x: number; z: number; s: number; yaw: number }[] = [];
  for (let tries = 0; blades.length < 26000 * density && tries < 80000; tries++) {
    const cx = ROOM.minX + 0.3 + r() * 35.4, cz = ROOM.minZ + 0.3 + r() * 25.4;
    if (!clear(cx, cz, 0.12)) continue;
    for (let k = 0; k < 18; k++) {
      const x = cx + (r() - 0.5) * 0.7, z = cz + (r() - 0.5) * 0.7;
      if (x > ROOM.minX && x < ROOM.maxX && z > ROOM.minZ && z < ROOM.maxZ) blades.push({ x, z, s: 0.6 + r() * 0.7, yaw: r() * 6.28 });
    }
  }
  const grass = instanced(blade(), swaying(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, emissive: 0x16300c }), 14),
    blades.map((b) => ({ ...b, y: 0.005 })));
  if (grass) {
    const c = new THREE.Color();
    blades.forEach((_, i) => grass.setColorAt(i, c.setHex(GRASS[i % GRASS.length]!)));
    grass.receiveShadow = true;
  }

  g.update = (t) => { time.value = t; };
  return g;
}

/** A ring of palms outside, on the street, for the view out of the windows. */
export function outerJungle(streetY: number, keep: (x: number, z: number) => boolean) {
  const g = new THREE.Group() as THREE.Group & { update(t: number): void };
  const r = rng(808);
  const barkMat = swaying(new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 }), 0.25);
  const leafMat = swaying(new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, color: 0xbfe8a0 }), 1);
  const shapes = [0, 1, 2, 3, 4].map((i) => palm(i * 5 + 1, 9 + i * 1.8, 2 + i * 0.6));
  const at: { x: number; z: number }[][] = shapes.map(() => []);
  for (let n = 0, tries = 0; n < 260 && tries < 6000; tries++) {
    const x = -75 + r() * 150, z = -60 + r() * 120;
    if (!keep(x, z)) continue;
    at[n % shapes.length]!.push({ x, z });
    n++;
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  shapes.forEach((geo, i) => {
    const mesh = new THREE.InstancedMesh(geo, [barkMat, leafMat], at[i]!.length);
    at[i]!.forEach((a, k) => {
      const sc = 0.9 + r() * 0.6;
      mesh.setMatrixAt(k, m.compose(p.set(a.x, streetY, a.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), s.set(sc, sc, sc)));
    });
    mesh.frustumCulled = false;
    mesh.userData.rbForest = "skip";
    g.add(mesh);
  });
  g.update = (t) => { time.value = t; };
  return g;
}
