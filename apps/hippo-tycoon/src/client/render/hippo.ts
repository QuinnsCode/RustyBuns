import * as THREE from "three";
import type { Hippo } from "../../sim/types.ts";
import { LOOKS, type Look } from "./looks.ts";

const GOLD = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.2 });
const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.45 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 0.5 });
const OIL = new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.6, roughness: 0.1, clearcoat: 1 });
const GLASS = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, transparent: true, opacity: 0.28, metalness: 0, clearcoat: 1 });
const mat = (color: number, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function ellipsoid(m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const e = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), m);
  e.scale.set(sx, sy, sz); e.position.set(x, y, z);
  return e;
}
function box(m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}
function dome(m: THREE.Material, r: number, x: number, y: number, z: number, sy = 1): THREE.Mesh {
  const d = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
  d.position.set(x, y, z); d.scale.y = sy;
  return d;
}
function tube(m: THREE.Material, pts: THREE.Vector3[], r = 0.025): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 6), m);
}

/** Local frame: the hippo faces -Z, stands on y = 0. */
export class HippoRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private jaw = new THREE.Group();
  private head = new THREE.Group();
  private brows: THREE.Mesh[] = [];
  readonly look: Look;
  /** Local point the smoke and steam come from. */
  readonly mouth = new THREE.Vector3(0, 1.3, -1.9);
  readonly ears = new THREE.Vector3(0, 2.3, -0.5);

  constructor(readonly seat: number) {
    const L = (this.look = LOOKS[seat]!);
    const skin = mat(L.skin, 0.55), coat = mat(L.suit, 0.7);
    this.group.add(this.body); this.body.add(this.head);
    this.group.scale.setScalar(1.3);

    // tailcoat torso, waistcoat front with brass buttons, cravat with a pin
    const [bw, bh, bd] = L.bulk;
    this.body.add(ellipsoid(coat, 1.25 * bw, 0.95 * bh, 1.4 * bd, 0, 0.95 * bh, 0.75));
    this.waistcoat(L, bw, bh);
    this.body.add(ellipsoid(mat(L.cravat, 0.5), 0.34, 0.26, 0.26, 0, 1.38 * bh, -0.55 * bd));
    this.body.add(ellipsoid(GOLD, 0.06, 0.06, 0.06, 0, 1.3 * bh, -0.78 * bd));
    // coat tails behind
    for (const s of [-1, 1]) this.body.add(ellipsoid(coat, 0.4, 0.7, 0.28, s * 0.55 * bw, 0.5, 1.95 * bd));
    // short legs
    for (const x of [-0.7 * bw, 0.7 * bw]) this.body.add(ellipsoid(skin, 0.35, 0.3, 0.45, x, 0.3, 0.1));
    // arms in coat sleeves; a gold ring on the pinky
    for (const s of [-1, 1]) {
      this.body.add(ellipsoid(coat, 0.3, 0.3, 0.55, s * 1.3 * bw, 0.95 * bh, 0), ellipsoid(skin, 0.28, 0.24, 0.3, s * 1.3 * bw, 0.9 * bh, -0.5));
      this.body.add(box(WHITE, 0.3, 0.14, 0.3, s * 1.3 * bw, 0.95 * bh, -0.28));                                        // starched cuff
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 14), GOLD);
      ring.position.set(s * 1.3 * bw + s * 0.2, 0.88 * bh, -0.62); ring.rotation.y = Math.PI / 2; this.body.add(ring);
    }
    // neck chains, each longer, and the pocket watch swag across the waistcoat
    for (let i = 0; i < L.chains; i++) {
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.16, 0.07, 8, 28), GOLD);
      chain.rotation.x = Math.PI / 2 - 0.45; chain.scale.set(1.15, 1, 1); chain.position.set(0, 1.5 * bh - i * 0.08, -0.75 - i * 0.12);
      this.body.add(chain);
    }
    this.watch(L, bw, bh, bd);

    // head: skull, snout, hinged jaw
    this.head.position.set(0, 0.2, 0);
    this.head.add(ellipsoid(skin, 1.0 * L.snout + 0.1, 0.85, 0.95, 0, 1.45, -0.7));
    this.head.add(ellipsoid(skin, 1.15 * L.snout, 0.55, 0.95, 0, 1.38, -1.4));
    for (const x of [-0.38, 0.38]) this.head.add(ellipsoid(DARK, 0.09, 0.07, 0.07, x * L.snout, 1.72, -2.05));
    for (const x of [-0.78, 0.78]) this.head.add(ellipsoid(skin, 0.2, 0.2, 0.1, x, 2.15, -0.45));
    this.jaw.position.set(0, 1.12, -0.95);
    this.jaw.add(ellipsoid(skin, 1.05 * L.snout, 0.28, 0.85, 0, -0.08, -0.6));
    this.jaw.add(ellipsoid(mat(0x8e2b3a, 0.5), 0.8 * L.snout, 0.1, 0.65, 0, 0.12, -0.6));
    this.teeth(L);
    this.head.add(this.jaw);
    this.eyes(L);
    this.monocle(L);
    if (L.cigar) this.cigar();
    if (L.moustache !== null) this.moustache(L);
    this.hat(L);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private waistcoat(L: Look, bw: number, bh: number) {
    const vest = mat(L.waistcoat, 0.55);
    this.body.add(ellipsoid(vest, 0.78 * bw, 0.72 * bh, 0.7, 0, 0.9 * bh, -0.4));
    if (L.pinstripe) {
      const coat = mat(0x6a3a6c, 0.7);
      for (let i = -3; i <= 3; i++) this.body.add(box(coat, 0.035, 1.3, 2.0, i * 0.3 * bw, 0.95 * bh, 0.9));
    }
    if (L.checked) for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) if ((i + j) % 2 === 0) this.body.add(box(mat(0x7a1a1a, 0.6), 0.2, 0.2, 0.05, i * 0.24 * bw, 0.9 * bh + j * 0.24, -0.73));
    for (let k = 0; k < 3; k++) this.body.add(ellipsoid(GOLD, 0.055, 0.055, 0.04, 0, (1.1 - k * 0.27) * bh, -0.74));
  }

  private watch(L: Look, bw: number, bh: number, bd: number) {
    const y = 0.95 * bh;
    const swag = tube(GOLD, [new THREE.Vector3(-0.78 * bw, y + 0.12, -0.52 * bd), new THREE.Vector3(-0.4 * bw, y - 0.12, -0.74 * bd), new THREE.Vector3(0.05, y - 0.2, -0.76 * bd), new THREE.Vector3(0.45 * bw, y - 0.05, -0.7 * bd), new THREE.Vector3(0.72 * bw, y + 0.1, -0.5 * bd)], 0.035);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 18), GOLD);
    face.position.set(0.05, y - 0.27, -0.77 * bd); face.rotation.x = Math.PI / 2;
    this.body.add(swag, face);
    void L;
  }

  private teeth(L: Look) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.27 * L.snout, gold = L.goldTeeth || i === 2;
      this.head.add(box(gold ? GOLD : WHITE, 0.2, 0.2, 0.12, x, 1.12, -2.05 + Math.abs(x) * 0.18));
      this.jaw.add(box(gold ? GOLD : WHITE, 0.18, 0.2, 0.1, x, 0.2, -1.3 + Math.abs(x) * 0.18));
    }
  }

  private cigar() {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 10), mat(0x6b3d1b));
    c.rotation.x = Math.PI / 2 - 0.35; c.position.set(0.42, 1.2, -2.2);
    const tip = ellipsoid(new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 2 }), 0.09, 0.09, 0.09, 0.42, 1.36, -2.58);
    const drip = ellipsoid(OIL, 0.08, 0.3, 0.08, -0.45, 0.82, -1.95);        // the cigar-shaped drip of oil on his lip
    this.head.add(c, tip, drip);
  }

  private moustache(L: Look) {
    const m = mat(L.moustache!, 0.8);
    for (const s of [-1, 1]) {
      this.head.add(ellipsoid(m, 0.38, 0.1, 0.12, s * 0.3, 1.5, -2.05));
      const curl = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 14, Math.PI * 1.5), m);
      curl.position.set(s * 0.68, 1.6, -1.98); curl.rotation.y = Math.PI / 2; this.head.add(curl);
    }
  }

  private eyes(L: Look) {
    for (const s of [-1, 1]) {
      const x = s * 0.5 * L.snout;
      this.head.add(ellipsoid(WHITE, 0.2, 0.2, 0.15, x, 1.95, -1.15), ellipsoid(DARK, 0.09, 0.09, 0.07, x, 1.93, -1.27));
      const brow = box(DARK, 0.62 * L.brow, 0.12 * L.brow, 0.14, x, 2.2, -1.2);
      this.brows.push(brow); this.head.add(brow);
    }
  }

  /** A brass-rimmed monocle on the right eye, its chain looping to the waistcoat. */
  private monocle(L: Look) {
    const x = 0.5 * L.snout, y = 1.95, z = -1.36;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 28), GOLD);
    ring.position.set(x, y, z);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), GLASS); lens.position.set(x, y, z - 0.005); lens.rotation.y = Math.PI;
    const chain = tube(GOLD, [new THREE.Vector3(x + 0.2, y - 0.2, z + 0.02), new THREE.Vector3(x + 0.42, y - 0.5, z + 0.25), new THREE.Vector3(x + 0.55, y - 0.9, z + 0.5), new THREE.Vector3(x + 0.4, y - 1.2, z + 0.4)], 0.018);
    this.head.add(ring, lens, chain);
  }

  private hat(L: Look) {
    const m = mat(L.hatColor, 0.45);
    if (L.hat === "bowler") {                                  // a round derby with a gold band: a bowler, not a top hat
      this.head.add(dome(m, 0.8, 0, 2.2, -0.65, 0.95));
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.06, 28), m); brim.position.set(0, 2.2, -0.65); this.head.add(brim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.14, 28), GOLD); band.position.set(0, 2.3, -0.65); this.head.add(band);
    } else if (L.hat === "miner") {                            // a brass pit helmet with a glowing lamp and goggles pushed up
      this.head.add(dome(m, 0.8, 0, 2.2, -0.65, 0.85));
      const brim = box(m, 1.5, 0.07, 0.65, 0, 2.2, -1.35); this.head.add(brim);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.26, 14), GOLD); lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 2.55, -1.38); this.head.add(lamp);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 14), new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xffd36a, emissiveIntensity: 3 })); lens.position.set(0, 2.55, -1.52); lens.rotation.y = Math.PI; this.head.add(lens);
      for (const sx of [-0.3, 0.3]) { const lenz = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 8, 18), mat(0x7a5a2a, 0.5)); lenz.position.set(sx, 2.62, -0.55); lenz.rotation.x = -0.5; this.head.add(lenz); }
    } else if (L.hat === "bonnet") {                           // wide brim, ribbon, and a plume
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.15, 0.07, 30), m); brim.position.set(0, 2.18, -0.65); brim.rotation.z = 0.08; this.head.add(brim);
      this.head.add(dome(m, 0.7, 0, 2.2, -0.65, 0.8));
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.16, 24), mat(0xe9c46a, 0.5)); ribbon.position.set(0, 2.32, -0.65); this.head.add(ribbon);
      for (let i = 0; i < 5; i++) {
        const f = ellipsoid(mat(i % 2 ? 0xd4af37 : 0xc8324b, 0.8), 0.1, 0.55, 0.05, 0.5 + i * 0.12, 2.8 + i * 0.06, -0.7 - i * 0.05);
        f.rotation.z = -0.5 - i * 0.18; this.head.add(f);
      }
    } else {                                                   // newsboy cap
      this.head.add(dome(m, 0.8, 0, 2.15, -0.65, 0.6));
      this.head.add(box(m, 0.95, 0.05, 0.5, 0, 2.2, -1.5));
      this.head.add(ellipsoid(m, 0.08, 0.08, 0.08, 0, 2.6, -0.65));
    }
  }

  /** `lunge` 0..1, `jawOpen` 0..1, `snarl` 0..1 (angry brows, bared teeth). */
  pose(h: Hippo, lunge: number, jawOpen: number, snarl: number, t: number) {
    const breathe = 1 + Math.sin(t * 2.2 + this.seat) * 0.015;
    const roar = h.bellow > 0 ? h.bellow / 9 : 0;
    this.body.scale.set(1, breathe, 1 + lunge * 0.12);
    this.body.position.y = h.sputter > 0 ? Math.abs(Math.sin(t * 30)) * 0.06 : 0;
    this.body.rotation.z = h.sore > 0 ? 0.07 : 0;
    this.jaw.rotation.x = -Math.max(jawOpen * 0.95, roar * 0.8, snarl * 0.18);
    this.head.rotation.x = -roar * 0.15 + lunge * 0.1;
    this.head.scale.setScalar(1 + roar * 0.08);
    const lean = 0.28 + this.look.brow * 0.1 + snarl * 0.3 + roar * 0.2 + (h.sputter > 0 ? 0.25 : 0);
    this.brows.forEach((b, i) => { const s = i === 0 ? -1 : 1; b.rotation.z = -s * lean; b.position.y = 2.2 - snarl * 0.06 - roar * 0.05; });
  }
}
