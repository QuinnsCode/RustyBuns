import * as THREE from "three";
import { RAIL_HALF, SEAT_NAMES } from "../../sim/rules.ts";
import { LOOKS } from "./looks.ts";
import { barrels, derrick, pumpJack, RUST, type Animated } from "./industry.ts";
import { torch } from "./jungle.ts";
import { planks, thatch } from "./textures.ts";

/** A carved wooden sign: dark planks, cream letters. */
function sign(text: string, sub: string, accent: number): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 768; c.height = 160;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, "#5a3a1e"); grd.addColorStop(1, "#3a2410");
  g.fillStyle = grd; g.fillRect(0, 0, 768, 160);
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.25})`; g.beginPath(); const y = Math.random() * 160; g.moveTo(0, y); g.lineTo(768, y + (Math.random() - 0.5) * 6); g.stroke(); }
  g.strokeStyle = "#" + accent.toString(16).padStart(6, "0"); g.lineWidth = 6; g.strokeRect(10, 10, 748, 140);
  g.fillStyle = "#f1e2b8"; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.7)"; g.shadowBlur = 4; g.shadowOffsetY = 3;
  g.font = "700 62px Georgia, 'Times New Roman', serif"; g.fillText(text.toUpperCase(), 384, 62);
  g.font = "italic 30px Georgia, serif"; g.fillText(sub, 384, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export interface Office { group: THREE.Group; animated: Animated[] }

/** One tycoon's island outpost. Local +z points away from the pan. */
export function buildOffice(seat: number): Office {
  const L = LOOKS[seat]!, g = new THREE.Group(), animated: Animated[] = [];
  const wood = new THREE.MeshStandardMaterial({ map: planks(2, 1), roughness: 0.9 });
  const darkWood = new THREE.MeshStandardMaterial({ map: planks(1, 2, 24), roughness: 0.95, color: 0xb59a7e });
  const straw = new THREE.MeshStandardMaterial({ map: thatch(), roughness: 1, side: THREE.DoubleSide });
  const bamboo = new THREE.MeshStandardMaterial({ color: 0x9c8f3e, roughness: 0.6 });
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const W = RAIL_HALF * 2 + 3;

  // a low bamboo fence the hippo shuffles behind: poles in an instanced row, two lashed rails
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 7), bamboo, 36);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 36; i++) { m4.setPosition(-W / 2 + (i + 0.5) * (W / 36), 0.65 + ((i * 7) % 5) * 0.03, 2.1); poles.setMatrixAt(i, m4); }
  poles.castShadow = true; g.add(poles);
  for (const y of [0.35, 0.95]) put(new THREE.CylinderGeometry(0.06, 0.06, W, 6), bamboo, 0, y, 2.2).rotation.z = Math.PI / 2;

  // carved name sign on two posts, readable from the pan and from outside
  const tex = sign(SEAT_NAMES[seat]!, "Island Oil Co.", L.accent);
  for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 7), bamboo, s * 2.7, 1.2, 1.7);
  for (const back of [false, true]) {
    const p = put(new THREE.PlaneGeometry(5.0, 1.04), new THREE.MeshStandardMaterial({ map: tex ?? undefined, roughness: 0.8 }), 0, 1.95, back ? 1.78 : 1.62);
    p.rotation.y = back ? 0 : Math.PI; p.castShadow = false;
  }

  // the stilted lodge: platform, plank walls, a pyramid of thatch, lantern windows
  const bw = W + 0.6, bd = 3.8, bz = 9.6, stilt = 1.5, wh = 2.3;
  const lodge = seat !== 0;   // seat 0 sits between the camera and the pan: an open dock, nothing to block the view
  if (lodge) {
    for (const sx of [-1, -0.34, 0.34, 1]) for (const sz of [-1, 1]) put(new THREE.CylinderGeometry(0.16, 0.2, stilt, 8), darkWood, sx * (bw / 2 - 0.4), stilt / 2, bz + sz * (bd / 2 - 0.4));
    put(new THREE.BoxGeometry(bw + 0.8, 0.18, bd + 0.8), wood, 0, stilt, bz);
    put(new THREE.BoxGeometry(bw, wh, bd), wood, 0, stilt + 0.09 + wh / 2, bz);
    const roof = put(new THREE.ConeGeometry(0.7071, 1, 4), straw, 0, stilt + wh + 1.3, bz);
    roof.rotation.y = Math.PI / 4; roof.scale.set((bw + 1.6) / 1.4142 * 1.0, 2.6, (bd + 1.6) / 1.4142 * 1.0);
    for (const x of [-4.4, -1.5, 1.5, 4.4]) {
      const win = put(new THREE.PlaneGeometry(1.1, 0.95), new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff9a3a, emissiveIntensity: 1.7 }), x, stilt + 1.45, bz - bd / 2 - 0.02);
      win.rotation.y = Math.PI; win.castShadow = false;
      put(new THREE.BoxGeometry(1.35, 0.1, 0.12), darkWood, x, stilt + 1.98, bz - bd / 2 - 0.04);
    }
    // a ramp down to the yard, and a banner in the baron's colour
    const ramp = put(new THREE.BoxGeometry(2.2, 0.16, 5.4), wood, 0, 0.75, bz - bd / 2 - 2.3); ramp.rotation.x = -0.28;
    const pole = put(new THREE.CylinderGeometry(0.06, 0.08, 5.6, 6), bamboo, bw / 2 - 0.2, stilt + 3.2, bz - bd / 2 + 0.6);
    const flag = put(new THREE.PlaneGeometry(1.7, 1.0, 8, 1), new THREE.MeshStandardMaterial({ color: L.accent, roughness: 0.8, side: THREE.DoubleSide }), bw / 2 - 1.1, stilt + 5.5, bz - bd / 2 + 0.6);
    flag.castShadow = false; void pole;
    const fp = flag.geometry.attributes.position!, fx0 = Array.from({ length: fp.count }, (_, i) => fp.getX(i));
    animated.push({ update: (t) => { for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin(t * 4 + (fx0[i]! + 0.85) * 3 + seat) * 0.12 * (fx0[i]! + 0.85)); fp.needsUpdate = true; } });
  }

  // tiki torches at the fence ends, and the old oil works gone to rust
  for (const s of [-1, 1]) { const t = torch(); t.position.set(s * (RAIL_HALF + 1.9), 0, 2.4); g.add(t); animated.push(t); }
  const rig = derrick(6.5); rig.position.set(-(RAIL_HALF + 3.6), 0, 5.2); g.add(rig);
  const jack = pumpJack(seat * 1.7); jack.position.set(RAIL_HALF + 3.4, 0, 5.4); g.add(jack); animated.push(jack);
  const stack = barrels(); stack.position.set(RAIL_HALF + 0.6, 0, 4.6); g.add(stack);
  void RUST;
  return { group: g, animated };
}
