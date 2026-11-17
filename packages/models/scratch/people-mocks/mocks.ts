// Three quick mock figures for the people climb (#5009, round 2): stylised adults, not toys. Each one is believable
// adult anatomy pushed in one or two directions (a lantern jaw with huge hands on broad shoulders and short legs; a
// pear body with a big nose and soft chin; a beanpole with long limbs, high cheekbones and a long nose), in chunky low
// poly with a face painted onto the head (small eyes, heavy brows, a little grit) and streetwear. A scratch harness for
// the owner to pick a direction from, not the real model: `character.ts` is reworked around the pick next round.
// The caricature lives only in the shapes: `skin` is a colour each figure takes, and swapping it changes nothing else.
// Browser only (the face and the cloth are painted on canvases). Feet at y 0, facing +z.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

export interface Mock {
  name: string;
  /** What it is pushed toward, in a few words, for the label under it. */
  push: string;
  height: number;
  skin: string;
  hair: string;
  /** Head radius (m) and its shape: jaw width, how square the jaw is, chin forward, cheekbones out, how long the head is. */
  head: { r: number; jaw: number; square: number; chin: number; cheek: number; long: number; narrow: number };
  nose: { w: number; len: number; out: number };
  /** Brow tilt (radians, + is a scowl) and thickness. */
  brow: { tilt: number; thick: number };
  /** Lengths in metres: hip height, hip to shoulders, shoulder half-width, neck. */
  body: { hip: number; torso: number; shoulders: number; neck: number; neckR: number };
  /** The torso's outline as [radius, height 0..1 from hips to shoulders], before the depth squash. */
  outline: [number, number][];
  arm: { upper: number; fore: number; r: number; hand: number };
  leg: { r: number; baggy: number };
  wear: {
    top: "tank" | "flannel" | "longtee"; topColor: string; under?: string;
    bottom: "jeans" | "track"; bottomColor: string;
    shoes: "hightop" | "skate" | "chunky"; shoeColor: string;
    hat: "snapback" | "beanie" | "bucket"; hatColor: string;
    chain?: boolean; glasses?: boolean;
  };
  face: { stubble: number; moustache?: boolean; goatee?: boolean; hollow: number; ruddy: number; lids: number };
}

export const MOCKS: Mock[] = [
  {
    name: "Lantern", push: "lantern jaw, huge hands, broad shoulders on short legs", height: 1.72,
    skin: "#8d5a3b", hair: "#1c1612",
    head: { r: 0.145, jaw: 1.32, square: 0.85, chin: 0.18, cheek: 0.06, long: 1.02, narrow: 1 },
    nose: { w: 0.05, len: 0.07, out: 0.05 }, brow: { tilt: 0.28, thick: 0.022 },
    body: { hip: 0.6, torso: 0.62, shoulders: 0.3, neck: 0.08, neckR: 0.085 },
    outline: [[0.17, 0], [0.18, 0.15], [0.2, 0.4], [0.25, 0.7], [0.27, 0.88], [0.2, 1]],
    arm: { upper: 0.29, fore: 0.27, r: 0.06, hand: 1.9 },
    leg: { r: 0.075, baggy: 1.2 },
    wear: { top: "tank", topColor: "#f2efe8", bottom: "jeans", bottomColor: "#3d5a80", shoes: "hightop", shoeColor: "#c0392b", hat: "snapback", hatColor: "#1f2a36", chain: true },
    face: { stubble: 0.55, hollow: 0.15, ruddy: 0.1, lids: 0.55 },
  },
  {
    name: "Pear", push: "pear body, big nose, soft chin, short arms", height: 1.62,
    skin: "#e2b48f", hair: "#6b4a2b",
    head: { r: 0.138, jaw: 1.08, square: 0.1, chin: -0.04, cheek: 0.12, long: 0.98, narrow: 1 },
    nose: { w: 0.075, len: 0.09, out: 0.085 }, brow: { tilt: -0.12, thick: 0.016 },
    body: { hip: 0.68, torso: 0.54, shoulders: 0.17, neck: 0.03, neckR: 0.07 },
    outline: [[0.25, 0], [0.29, 0.12], [0.3, 0.3], [0.27, 0.55], [0.21, 0.8], [0.16, 0.95], [0.12, 1]],
    arm: { upper: 0.24, fore: 0.22, r: 0.05, hand: 1.05 },
    leg: { r: 0.085, baggy: 1.2 },
    wear: { top: "flannel", topColor: "#a8322d", under: "#2b2b2b", bottom: "jeans", bottomColor: "#5577a0", shoes: "skate", shoeColor: "#222222", hat: "beanie", hatColor: "#d9a23a", glasses: true },
    face: { stubble: 0.1, moustache: true, hollow: 0, ruddy: 0.45, lids: 0.3 },
  },
  {
    name: "Beanpole", push: "beanpole build, long limbs, high cheekbones, long nose", height: 1.98,
    skin: "#c08552", hair: "#140f0c",
    head: { r: 0.128, jaw: 0.92, square: 0.35, chin: 0.1, cheek: 0.16, long: 1.18, narrow: 0.86 },
    nose: { w: 0.04, len: 0.1, out: 0.06 }, brow: { tilt: 0.05, thick: 0.014 },
    body: { hip: 1.06, torso: 0.6, shoulders: 0.19, neck: 0.11, neckR: 0.045 },
    outline: [[0.13, 0], [0.12, 0.25], [0.13, 0.55], [0.16, 0.85], [0.12, 1]],
    arm: { upper: 0.35, fore: 0.33, r: 0.036, hand: 1.25 },
    leg: { r: 0.06, baggy: 1.05 },
    wear: { top: "longtee", topColor: "#2f6f5e", bottom: "track", bottomColor: "#1d1d22", shoes: "chunky", shoeColor: "#ecebe6", hat: "bucket", hatColor: "#d8cfb8", chain: true },
    face: { stubble: 0.2, goatee: true, hollow: 0.6, ruddy: 0.05, lids: 0.7 },
  },
];

const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return { c, g: c.getContext("2d")! }; };
const texture = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

/** A little grit over a painted surface: speckles lighter and darker than it. */
function grit(g: CanvasRenderingContext2D, w: number, h: number, seed: number, amount: number) {
  const rand = mulberry32(seed);
  for (let i = 0; i < w * h * 0.02; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${amount * rand()})` : `rgba(255,255,255,${amount * 0.6 * rand()})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** The face, painted on the head's sphere map: the front of the head (+z) is a quarter of the way across. */
function paintFace(m: Mock, seed: number) {
  const W = 1024, H = 512, { c, g } = canvas(W, H);
  // a point on the front of a unit head (x right, y up) as canvas pixels
  const at = (x: number, y: number): [number, number] => [(0.25 + Math.asin(THREE.MathUtils.clamp(x, -1, 1)) / (2 * Math.PI)) * W, (Math.acos(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI) * H];
  const px = 1024 / (2 * Math.PI); // pixels per radian across, near the front
  const blob = (x: number, y: number, rx: number, ry: number, color: string, alpha: number) => {
    const [cx, cy] = at(x, y), grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx * px);
    const col = new THREE.Color(color), rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    grad.addColorStop(0, `rgba(${rgb},${alpha})`); grad.addColorStop(1, `rgba(${rgb},0)`);
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx); g.translate(-cx, -cy); g.fillStyle = grad; g.fillRect(cx - rx * px, cy - rx * px, rx * px * 2, rx * px * 2); g.restore();
  };
  g.fillStyle = m.skin; g.fillRect(0, 0, W, H);
  const dark = mix(m.skin, "#2a1208", 0.55), warm = mix(m.skin, "#d0453a", 0.6), light = mix(m.skin, "#fff4e0", 0.5);
  // planes of the face: lit forehead and cheekbones, sunk eye sockets, a hollow under the cheekbones, a warm nose
  blob(0, 0.55, 0.6, 0.3, light, 0.35);
  for (const s of [-1, 1]) {
    blob(s * 0.33, 0.13, 0.22, 0.14, dark, 0.55);
    blob(s * 0.55, -0.12, 0.2, 0.12, light, 0.3 + m.head.cheek);
    blob(s * 0.5, -0.38, 0.22, 0.18, dark, m.face.hollow * 0.6);
    blob(s * 0.5, -0.25, 0.2, 0.15, warm, m.face.ruddy * 0.5);
  }
  blob(0, -0.15, 0.12, 0.2, warm, 0.25 + m.face.ruddy * 0.4);
  blob(0, -0.78, 0.35, 0.18, dark, 0.25);
  // stubble over the jaw and the lip
  const rand = mulberry32(seed + 7);
  for (let i = 0; i < 9000 * m.face.stubble; i++) {
    const x = (rand() * 2 - 1) * 0.85, y = -0.35 - rand() * 0.6;
    if (Math.hypot(x / 0.85, (y + 0.95) / 0.6) > 1.05 || (Math.abs(x) < 0.22 && y > -0.62 && y < -0.48)) continue;
    const [cx, cy] = at(x, y); g.fillStyle = `rgba(20,12,8,${0.25 + rand() * 0.3})`; g.fillRect(cx, cy, 1.5, 1.5);
  }
  if (m.face.moustache) { const [cx, cy] = at(0, -0.43); g.fillStyle = m.hair; g.beginPath(); g.ellipse(cx, cy, 0.3 * px, 0.06 * px, 0, 0, Math.PI * 2); g.fill(); }
  if (m.face.goatee) { const [cx, cy] = at(0, -0.8); g.fillStyle = m.hair; g.beginPath(); g.ellipse(cx, cy, 0.13 * px, 0.16 * px, 0, 0, Math.PI * 2); g.fill(); const [mx, my] = at(0, -0.44); g.beginPath(); g.ellipse(mx, my, 0.2 * px, 0.035 * px, 0, 0, Math.PI * 2); g.fill(); }
  // the mouth: a firm line with a fuller lower lip
  { const [cx, cy] = at(0, -0.55), w = 0.2 * px; g.fillStyle = mix(m.skin, "#5a1e1a", 0.45); g.beginPath(); g.ellipse(cx, cy + 4, w * 0.8, 0.045 * px, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#2a1410"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - w, cy); g.quadraticCurveTo(cx, cy + (m.brow.tilt > 0.2 ? 3 : -2), cx + w, cy - (m.brow.tilt > 0.2 ? 2 : 0)); g.stroke(); }
  // small eyes under heavy lids, looking a touch to the side
  for (const s of [-1, 1]) {
    const [cx, cy] = at(s * 0.32, 0.12), w = 0.11 * px, h = 0.055 * px;
    g.fillStyle = "#efe6da"; g.beginPath(); g.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3b2a1c"; g.beginPath(); g.arc(cx + w * 0.12, cy + 1, h * 0.95, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0b0806"; g.beginPath(); g.arc(cx + w * 0.12, cy + 1, h * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(cx + w * 0.22, cy - 3, 3, 3);
    // the upper lid comes down over the iris; its line is the heaviest stroke on the face
    g.fillStyle = mix(m.skin, "#3a2014", 0.3); g.beginPath(); g.ellipse(cx, cy - h * (1 - m.face.lids), w * 1.08, h * 1.02, 0, Math.PI, Math.PI * 2); g.fill();
    g.strokeStyle = "#140c08"; g.lineWidth = 4; g.beginPath(); g.ellipse(cx, cy - h * (1 - m.face.lids) + h, w * 1.05, h * 0.25, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.strokeStyle = mix(m.skin, "#2a1208", 0.4); g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, cy + h * 1.3, w * 0.8, h * 0.4, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  // nostrils, the nose's own shadow, and a laugh line each side
  for (const s of [-1, 1]) {
    const [nx, ny] = at(s * 0.08 * (m.nose.w / 0.05), -0.32); g.fillStyle = "rgba(30,12,8,0.55)"; g.beginPath(); g.ellipse(nx, ny, 4, 2.5, 0, 0, Math.PI * 2); g.fill();
    const [ax, ay] = at(s * 0.22, -0.3), [bx, by] = at(s * 0.3, -0.58); g.strokeStyle = `rgba(40,16,8,${0.25 + m.face.hollow * 0.2})`; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax + s * 10, (ay + by) / 2, bx, by); g.stroke();
  }
  grit(g, W, H, seed, 0.06);
  return texture(c);
}

/** Cloth: a flat colour with a weave or a plaid, and grit. */
function paintCloth(kind: "plain" | "denim" | "plaid" | "jersey", color: string, seed: number, strip?: string) {
  const W = 256, H = 256, { c, g } = canvas(W, H);
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  if (kind === "denim") { g.strokeStyle = "rgba(255,255,255,0.08)"; for (let i = -H; i < W; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); } }
  if (kind === "plaid") {
    const dark = mix(color, "#000000", 0.55), pale = mix(color, "#ffffff", 0.35);
    g.fillStyle = `${dark}99`; for (let i = 0; i < W; i += 32) { g.fillRect(i, 0, 11, H); g.fillRect(0, i, W, 11); }
    g.fillStyle = `${pale}55`; for (let i = 20; i < W; i += 32) { g.fillRect(i, 0, 2, H); g.fillRect(0, i, W, 2); }
  }
  if (kind === "jersey") { g.fillStyle = "rgba(0,0,0,0.05)"; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2); }
  // a strip down the front (a lathe's seam is its front): the tee under an open shirt, and the shirt's edges
  if (strip) { g.fillStyle = strip; g.fillRect(0, 0, W * 0.07, H); g.fillRect(W * 0.93, 0, W, H); g.fillStyle = mix(color, "#000000", 0.4); g.fillRect(W * 0.07, 0, 3, H); g.fillRect(W * 0.93 - 3, 0, 3, H); }
  grit(g, W, H, seed, 0.08);
  const t = texture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(strip ? 1 : 3, strip ? 1 : 3);
  return t;
}

export interface Figure { group: THREE.Group; head: THREE.Object3D; height: number; dispose(): void }

export function figure(m: Mock, seed = 1): Figure {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const flat = (o: { color?: string; map?: THREE.Texture; rough?: number; metal?: number }) =>
    keep(new THREE.MeshStandardMaterial({ color: o.color ?? "#ffffff", map: o.map ?? null, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, flatShading: true }));
  const skin = flat({ color: m.skin }), hairM = flat({ color: m.hair });
  const w = m.wear;
  const topTex = w.top === "flannel" ? paintCloth("plaid", w.topColor, seed, w.under) : paintCloth("jersey", w.topColor, seed);
  // the sleeves take the cloth without the front strip
  const arm = w.top === "flannel" ? flat({ map: keep(paintCloth("plaid", w.topColor, seed)) }) : null;
  const top = flat({ map: keep(topTex) }), under = flat({ map: keep(paintCloth("jersey", w.under ?? w.topColor, seed + 1)) });
  const bottom = flat({ map: keep(paintCloth(w.bottom === "jeans" ? "denim" : "jersey", w.bottomColor, seed + 2)) });
  const shoe = flat({ color: w.shoeColor, rough: 0.6 }), sole = flat({ color: "#f4f2ec", rough: 0.6 }), hatM = flat({ map: keep(paintCloth("jersey", w.hatColor, seed + 3)) });
  const gold = flat({ color: "#e0b440", rough: 0.3, metal: 0.8 }), lens = flat({ color: "#1a1a1a", rough: 0.3 });

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, at?: [number, number, number], parent?: THREE.Object3D) => {
    keep(geo); const x = new THREE.Mesh(geo, mat); if (at) x.position.set(...at); x.castShadow = true; parent?.add(x); return x;
  };
  const node = (parent: THREE.Object3D, at: [number, number, number]) => { const n = new THREE.Object3D(); n.position.set(...at); parent.add(n); return n; };
  /** A tapered limb hanging down from its top. */
  const taper = (rTop: number, rBot: number, len: number, seg = 7) => new THREE.CylinderGeometry(rTop, rBot, len, seg).translate(0, -len / 2, 0);

  const group = new THREE.Group();
  const { hip, torso, shoulders, neck: neckL, neckR } = m.body;
  const hips = node(group, [0, hip, 0]);

  // the torso: a low-poly lathe from the hips to the shoulders, squashed front to back
  const pts = m.outline.map(([r, y]) => new THREE.Vector2(r, y * torso));
  const hem = w.top === "longtee" ? [new THREE.Vector2(0, -0.2), new THREE.Vector2(m.outline[0]![0] * 1.08, -0.19)] : [new THREE.Vector2(0, -0.04)];
  const trunk = new THREE.LatheGeometry([...hem, ...pts, new THREE.Vector2(0, torso + 0.01)], 9).scale(1, 1, 0.72);
  const spine = node(hips, [0, 0, 0]);
  mesh(trunk, w.top === "tank" ? under : top, undefined, spine);
  // a seat in the trousers so the top's hem sits over a waist
  if (w.top !== "longtee") mesh(new THREE.CylinderGeometry(m.outline[0]![0] * 1.01, m.outline[0]![0] * 0.9, 0.14, 9).scale(1, 1, 0.74), bottom, [0, -0.03, 0], spine);
  if (w.top === "tank") {
    // a white tank: skin shows at the chest top and the shoulders, a gold chain over it
    const t = m.outline, tank = new THREE.LatheGeometry(t.filter(([, y]) => y <= 0.82).map(([r, y]) => new THREE.Vector2(r * 1.015, y * torso)), 9).scale(1, 1, 0.73);
    mesh(tank, top, undefined, spine);
  }

  // neck and head
  const neckN = node(spine, [0, torso - 0.01, 0]);
  mesh(new THREE.CylinderGeometry(neckR, neckR * 1.15, neckL + 0.06, 8), skin, [0, (neckL + 0.06) / 2, 0.005], neckN);
  if (w.chain) { const c = mesh(new THREE.TorusGeometry(neckR * 1.5, 0.006, 5, 18), gold, [0, 0.0, 0.035], neckN); c.rotation.x = Math.PI / 2 - 0.55; }
  const r = m.head.r, hd = m.head;
  const head = node(neckN, [0, neckL + r * 0.95 * hd.long, r * 0.12]);
  const skull = new THREE.SphereGeometry(r, 16, 12), sp = skull.attributes.position!, v = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) {
    v.fromBufferAttribute(sp, i).divideScalar(r);
    const low = THREE.MathUtils.clamp(-v.y, 0, 1);
    // the jaw widens (and squares off) below the cheekbones; the chin comes forward
    let x = v.x * hd.narrow * (1 + (hd.jaw - 1) * Math.min(1, low * 1.6));
    if (hd.square > 0 && v.y < 0) x = THREE.MathUtils.lerp(x, Math.sign(x) * Math.max(Math.abs(x), Math.min(hd.narrow * hd.jaw * 0.95, Math.abs(x) * 1.35)), hd.square * low);
    let z = v.z * 0.98;
    if (v.z > 0) z += hd.chin * Math.max(0, low - 0.55) * 2.2 * v.z;
    // cheekbones out at the sides just under the eyes
    const cb = Math.max(0, 1 - Math.abs(v.y + 0.12) / 0.25) * Math.max(0, Math.abs(v.x) - 0.4) * Math.max(0, v.z + 0.3);
    x += Math.sign(v.x) * cb * hd.cheek * 1.4;
    // a flatter face and a fuller back of the skull
    if (v.z > 0.6) z = 0.6 + (z - 0.6) * 0.7;
    if (v.z < 0 && v.y > -0.3) z *= 1.08;
    sp.setXYZ(i, x * r, v.y * r * hd.long, z * r);
  }
  skull.computeVertexNormals();
  const face = flat({ map: keep(paintFace(m, seed)) });
  mesh(skull, face, undefined, head);
  const front = (x: number, y: number) => r * 0.98 * Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.92;
  // the nose: a four-sided wedge, its tip low and forward
  const n = mesh(new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2 + 0.35).scale(m.nose.w, m.nose.len, m.nose.out), skin, [0, -r * 0.2 * hd.long, front(0, -0.2) - 0.005], head);
  n.position.z += m.nose.out * 0.2;
  // a brow ridge, and bold brows on it
  mesh(new THREE.BoxGeometry(r * 1.25 * hd.narrow, r * 0.12, r * 0.25), skin, [0, r * 0.26 * hd.long, front(0, 0.26) - r * 0.09], head);
  for (const s of [-1, 1]) {
    const b = mesh(new THREE.BoxGeometry(r * 0.48, m.brow.thick, r * 0.1), hairM, [s * r * 0.33 * hd.narrow, r * 0.28 * hd.long, front(0.33, 0.28) + r * 0.03], head);
    b.rotation.z = -s * m.brow.tilt; b.rotation.y = s * 0.3;
    mesh(new THREE.SphereGeometry(r * 0.2, 6, 5).scale(0.45, 0.9, 0.7), skin, [s * r * (0.98 * hd.narrow + 0.02), 0, -r * 0.05], head);
  }
  if (w.glasses) for (const s of [-1, 1]) { const g = mesh(new THREE.TorusGeometry(r * 0.2, r * 0.025, 5, 14), lens, [s * r * 0.33, r * 0.1 * hd.long, front(0.33, 0.1) + r * 0.08], head); g.rotation.y = s * 0.3; }
  // short hair under the hat, at the sides and back
  const cap = new THREE.SphereGeometry(r * 1.03, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4).scale(hd.narrow * 1.03, hd.long, 1.05);
  mesh(cap, hairM, [0, r * 0.08, -r * 0.06], head);
  // the hat
  const hatAt = node(head, [0, r * 0.44 * hd.long, -r * 0.04]);
  if (w.hat === "snapback") {
    mesh(new THREE.SphereGeometry(r * 1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(hd.narrow, 0.85, 1.05), hatM, [0, 0, 0], hatAt);
    // worn backwards: the brim over the back of the neck
    mesh(new THREE.BoxGeometry(r * 1.2, r * 0.06, r * 0.9).translate(0, 0, -r * 0.45), hatM, [0, 0, -r * 0.8], hatAt).rotation.x = -0.15;
  }
  if (w.hat === "beanie") {
    mesh(new THREE.SphereGeometry(r * 1.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1.05), hatM, [0, 0, 0], hatAt);
    mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 0.3, 12).scale(1, 1, 1.07), hatM, [0, 0, 0], hatAt);
  }
  if (w.hat === "bucket") {
    mesh(new THREE.CylinderGeometry(r * 0.85, r * 1.1, r * 0.75, 10).scale(hd.narrow * 1.05, 1, 1.05), hatM, [0, r * 0.3, 0], hatAt);
    mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.55, r * 0.22, 12).scale(hd.narrow * 1.05, 1, 1.05), hatM, [0, -r * 0.05, 0], hatAt);
  }

  // arms: shoulder, elbow and a hand of four fingers and a thumb, `hand` times life size
  const widest = Math.max(...m.outline.map(([r]) => r));
  const sleeve = w.top === "tank" ? null : w.top === "longtee" ? 0.55 : 1.02;
  for (const s of [-1, 1]) {
    const sh = node(spine, [s * shoulders, torso * 0.9, 0]);
    // out from the shoulder far enough to clear the widest part of the body (a belly, a chest)
    sh.rotation.z = s * (0.1 + Math.atan2(Math.max(0, widest - shoulders + m.arm.r * 1.4), m.arm.upper * 0.9));
    mesh(new THREE.SphereGeometry(m.arm.r * 1.5, 8, 6), sleeve ? arm ?? top : skin, [0, 0, 0], sh);
    mesh(taper(m.arm.r * 1.2, m.arm.r, m.arm.upper), sleeve ? arm ?? top : skin, [0, 0, 0], sh);
    if (sleeve && sleeve < 1) mesh(taper(m.arm.r * 1.45, m.arm.r * 1.4, m.arm.upper * sleeve), top, [0, 0, 0], sh);
    const el = node(sh, [0, -m.arm.upper, 0]);
    el.rotation.x = -0.15; el.rotation.z = -sh.rotation.z * 0.6;
    mesh(taper(m.arm.r * (m.arm.hand > 1.5 ? 1.25 : 0.95), m.arm.r * 0.75, m.arm.fore), sleeve && sleeve >= 1 ? arm ?? top : skin, [0, 0, 0], el);
    const k = m.arm.hand, wr = node(el, [0, -m.arm.fore, 0]);
    wr.rotation.y = -s * 0.9; // the backs of the hands half to the front, so their size reads
    mesh(new THREE.BoxGeometry(0.042 * k, 0.085 * k, 0.08 * k).translate(0, -0.04 * k, 0), skin, [0, 0, 0], wr);
    for (let f = 0; f < 4; f++) {
      const kn = node(wr, [0, -0.083 * k, (-0.028 + f * 0.019) * k]);
      kn.rotation.z = s * 0.25; kn.rotation.x = 0.05 * (f - 1.5);
      mesh(taper(0.009 * k, 0.008 * k, (f === 3 ? 0.045 : 0.06) * k, 5), skin, [0, 0, 0], kn);
    }
    const th = node(wr, [s * -0.01 * k, -0.03 * k, 0.04 * k]);
    th.rotation.set(0.5, 0, s * -0.4);
    mesh(taper(0.011 * k, 0.009 * k, 0.05 * k, 5), skin, [0, 0, 0], th);
  }

  // legs: baggy to the ankle, then the shoes
  const thigh = hip * 0.5, shin = hip * 0.5 - 0.06;
  for (const s of [-1, 1]) {
    const hp = node(hips, [s * m.outline[0]![0] * 0.5, 0, 0]);
    hp.rotation.z = s * 0.03;
    mesh(taper(m.leg.r * 1.2 * m.leg.baggy, m.leg.r * m.leg.baggy, thigh, 8), bottom, [0, 0, 0], hp);
    const kn = node(hp, [0, -thigh, 0]);
    mesh(taper(m.leg.r * m.leg.baggy, m.leg.r * 0.95 * m.leg.baggy * (w.bottom === "jeans" ? 1.1 : 0.75), shin, 8), bottom, [0, 0, 0], kn);
    const an = node(kn, [0, -shin, 0]);
    const big = w.shoes === "chunky" ? 1.3 : 1, L = 0.27 * big;
    mesh(new THREE.BoxGeometry(0.1 * big, 0.04 * big, L), sole, [0, -0.04, L * 0.25], an);
    mesh(new THREE.BoxGeometry(0.095 * big, 0.06 * big, L * 0.92).translate(0, 0.02, 0), shoe, [0, -0.04 + 0.025 * big, L * 0.24], an);
    if (w.shoes === "hightop") mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.1, 8), shoe, [0, 0.02, 0], an);
  }
  if (m.name === "Beanpole") { spine.rotation.x = 0.1; neckN.rotation.x = 0.15; head.rotation.x = -0.18; }
  if (m.name === "Lantern") { head.rotation.x = 0.06; }
  // scale the whole figure to its height, so the head's top lands where the mock says
  group.updateMatrixWorld(true);
  const top_ = new THREE.Box3().setFromObject(head).max.y, k = m.height / top_;
  group.scale.setScalar(k);
  return { group, head, height: m.height, dispose: () => disposables.forEach((d) => d.dispose()) };
}
