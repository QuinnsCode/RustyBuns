import * as THREE from "three";
import type { Hippo } from "../../sim/types.ts";
import { LOOKS, type Look } from "./looks.ts";

const GOLD = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.22, emissive: 0x6b4500, emissiveIntensity: 0.35 });
const WHITE = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 0.5 });
const OIL = new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.6, roughness: 0.1, clearcoat: 1 });
const mat = (color: number, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function ellipsoid(m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const e = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), m);
  e.scale.set(sx, sy, sz); e.position.set(x, y, z);
  return e;
}
function box(m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}

/** Local frame: the hippo faces -Z, stands on y = 0. */
export class HippoRig {
  readonly group = new THREE.Group();
  private body: THREE.Group = new THREE.Group();
  private jaw = new THREE.Group();
  private head = new THREE.Group();
  private brows: THREE.Mesh[] = [];
  private eyeCover: THREE.Object3D[] = [];
  readonly look: Look;
  /** Local point the smoke and steam come from. */
  readonly mouth = new THREE.Vector3(0, 1.3, -1.9);
  readonly ears = new THREE.Vector3(0, 2.3, -0.5);

  constructor(readonly seat: number) {
    const L = (this.look = LOOKS[seat]!);
    const skin = mat(L.skin, 0.55), suit = mat(L.suit, 0.7), accent = mat(L.suit2, 0.7);
    this.group.add(this.body);
    this.body.add(this.head);

    // torso in a suit, with shirt front and tie
    const [bw, bh, bd] = L.bulk;
    const torso = ellipsoid(suit, 1.25 * bw, 0.95 * bh, 1.4 * bd, 0, 0.95 * bh, 0.75);
    this.body.add(torso);
    this.suitDetail(torso, L, accent);
    this.body.add(box(WHITE, 0.42, 0.7 * bh, 0.12, 0, 0.95 * bh, -0.6 * bd));
    this.body.add(box(mat(L.tie, 0.4), 0.15, 0.62 * bh, 0.1, 0, 0.93 * bh, -0.68 * bd));
    // short legs, so he sits like he owns the place
    for (const x of [-0.7 * bw, 0.7 * bw]) this.body.add(ellipsoid(skin, 0.35, 0.3, 0.45, x, 0.3, 0.1));
    // arms with bling: ring on the right pinky
    for (const s of [-1, 1]) {
      const arm = ellipsoid(suit, 0.3, 0.3, 0.55, s * 1.3 * bw, 0.95 * bh, 0);
      const hand = ellipsoid(skin, 0.28, 0.24, 0.3, s * 1.3 * bw, 0.9 * bh, -0.5);
      this.body.add(arm, hand);
      if (L.chains > 0 || s > 0) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 14), GOLD);
        ring.position.set(s * 1.3 * bw + s * 0.2, 0.88 * bh, -0.62); ring.rotation.y = Math.PI / 2;
        this.body.add(ring);
      }
    }
    // chunky chains round the neck, each longer, each with a dollar pendant
    for (let i = 0; i < L.chains; i++) {
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.16, 0.075, 8, 28), GOLD);
      chain.rotation.x = Math.PI / 2 - 0.45; chain.scale.set(1.15, 1, 1);
      chain.position.set(0, 1.5 * bh - i * 0.08, -0.75 - i * 0.12);
      this.body.add(chain);
    }
    this.body.add(box(GOLD, 0.26, 0.3, 0.07, 0, 1.12 * bh - L.chains * 0.1, -0.95 - L.chains * 0.1));

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
    if (L.cigar) this.cigar();
    this.eyes(L);
    this.hat(L);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  }

  private suitDetail(torso: THREE.Mesh, L: Look, accent: THREE.Material) {
    if (L.pinstripe) for (let i = -3; i <= 3; i++) this.body.add(box(accent, 0.04, 1.3, 2.0, i * 0.3 * L.bulk[0], 0.95 * L.bulk[1], 0.75));
    if (L.checked) for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) if ((i + j) % 2 === 0) this.body.add(box(accent, 0.3, 0.3, 0.05, i * 0.38, 0.95 + j * 0.3, -0.45));
    void torso;
  }

  private teeth(L: Look) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.27 * L.snout;
      const gold = L.goldTeeth || i === 2;
      this.head.add(box(gold ? GOLD : WHITE, 0.2, 0.2, 0.12, x, 1.12, -2.05 + Math.abs(x) * 0.18));
      this.jaw.add(box(gold ? GOLD : WHITE, 0.18, 0.2, 0.1, x, 0.2, -1.3 + Math.abs(x) * 0.18));
    }
  }

  private cigar() {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 10), mat(0x6b3d1b));
    c.rotation.x = Math.PI / 2 - 0.35; c.position.set(0.42, 1.2, -2.2);
    const tip = ellipsoid(new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 1 }), 0.09, 0.09, 0.09, 0.42, 1.36, -2.58);
    // the cigar-shaped drip of oil hanging from his lip
    const drip = ellipsoid(OIL, 0.08, 0.3, 0.08, -0.45, 0.82, -1.95);
    this.head.add(c, tip, drip);
  }

  private eyes(L: Look) {
    for (const s of [-1, 1]) {
      const x = s * 0.5 * L.snout;
      if (!L.shades) {
        this.head.add(ellipsoid(WHITE, 0.2, 0.2, 0.15, x, 1.95, -1.15), ellipsoid(DARK, 0.09, 0.09, 0.07, x, 1.93, -1.27));
      }
      const brow = box(DARK, 0.62 * L.brow, 0.12 * L.brow, 0.14, x, 2.2, -1.2);
      this.brows.push(brow); this.head.add(brow);
    }
    if (L.shades) {
      const m = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, metalness: 1, roughness: 0.05, emissive: 0x2a4a66, emissiveIntensity: 0.6 });
      const bar = box(DARK, 1.5, 0.08, 0.14, 0, 1.98, -1.22);
      const l = box(m, 0.52, 0.34, 0.1, -0.42, 1.95, -1.3), r = box(m, 0.52, 0.34, 0.1, 0.42, 1.95, -1.3);
      this.head.add(bar, l, r); this.eyeCover.push(bar, l, r);
    }
  }

  private hat(L: Look) {
    const m = mat(L.hatColor, 0.35);
    if (L.hat === "derrick") {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m);
      dome.position.set(0, 2.2, -0.65); dome.scale.set(1, 0.85, 1.1);
      const brim = box(m, 1.3, 0.07, 0.6, 0, 2.2, -1.3);
      const tower = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4, wireframe: true }));
      tower.position.set(0, 3.0, -0.65);
      this.head.add(dome, brim, tower);
    } else if (L.hat === "crown") {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.35, 18, 1, true), GOLD);
      band.position.set(0, 2.35, -0.65); (band.material as THREE.Material).side = THREE.DoubleSide;
      this.head.add(band);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 5), GOLD);
        spike.position.set(Math.cos(a) * 0.74, 2.7, -0.65 + Math.sin(a) * 0.74);
        const gem = ellipsoid(new THREE.MeshStandardMaterial({ color: [0xff2a4a, 0x2affb0, 0x4a7aff][i % 3]!, emissive: 0x222222 }), 0.07, 0.07, 0.07, spike.position.x, 2.96, spike.position.z);
        this.head.add(spike, gem);
      }
      const hat = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7a1a8c, 0.5));
      hat.position.set(0, 2.3, -0.65); this.head.add(hat);
    } else if (L.hat === "cap") {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
      dome.position.set(0, 2.1, -0.65); dome.scale.set(1, 0.7, 1);
      this.head.add(dome, box(m, 1.0, 0.06, 0.55, 0, 2.12, 0.1));   // brim at the back
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
    this.brows.forEach((b, i) => {
      const s = i === 0 ? -1 : 1;
      b.rotation.z = -s * lean;
      b.position.y = 2.2 - snarl * 0.06 - roar * 0.05;
    });
  }
}
