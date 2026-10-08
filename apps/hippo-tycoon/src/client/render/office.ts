import * as THREE from "three";
import { RAIL_HALF, SEAT_NAMES } from "../../sim/rules.ts";
import { LOOKS } from "./looks.ts";
import { BRASS, COPPER, GLOW, IRON, SOOT, derrick, gasLamp, gear, pumpJack, type Animated } from "./industry.ts";
import { brick } from "./textures.ts";

function plaque(text: string, sub: string): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 768; c.height = 160;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, "#e2b84a"); grd.addColorStop(0.5, "#b98a22"); grd.addColorStop(1, "#8a6212");
  g.fillStyle = grd; g.fillRect(0, 0, 768, 160);
  g.strokeStyle = "#4a3208"; g.lineWidth = 6; g.strokeRect(10, 10, 748, 140);
  g.strokeStyle = "rgba(255,240,180,.6)"; g.lineWidth = 2; g.strokeRect(18, 18, 732, 124);
  g.fillStyle = "#2a1c05"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "700 62px Georgia, 'Times New Roman', serif"; g.fillText(text.toUpperCase(), 384, 62);
  g.font = "italic 30px Georgia, serif"; g.fillText(sub, 384, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export interface Office { group: THREE.Group; smokeAt: THREE.Vector3; animated: Animated[] }

/** One tycoon's counting-house. Local +z points away from the pan. */
export function buildOffice(seat: number): Office {
  const L = LOOKS[seat]!, g = new THREE.Group(), animated: Animated[] = [];
  const bricks = new THREE.MeshStandardMaterial({ map: brick(3, 1), bumpMap: brick(3, 1), bumpScale: 2.2, roughness: 0.92 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x6b655d, roughness: 0.9 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.2 });
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const W = RAIL_HALF * 2 + 3;
  // the low front wall the hippo shuffles behind, and the stone coping on it
  put(new THREE.BoxGeometry(W, 1.15, 0.7), bricks, 0, 0.575, 2.1);
  put(new THREE.BoxGeometry(W + 0.3, 0.14, 0.95), stone, 0, 1.22, 2.1);
  put(new THREE.BoxGeometry(RAIL_HALF * 2 + 2, 0.12, 0.34), BRASS, 0, 0.06, 1.25);                          // the brass lip
  // the counting-house itself
  const bw = W + 1.2, bh = 4.4, bd = 3.6, bz = 9.4;
  put(new THREE.BoxGeometry(bw, bh, bd), bricks, 0, bh / 2, bz);
  const roof = new THREE.Shape(); roof.moveTo(-bd / 2 - 0.3, 0); roof.lineTo(0, 1.5); roof.lineTo(bd / 2 + 0.3, 0); roof.closePath();
  const roofMesh = put(new THREE.ExtrudeGeometry(roof, { depth: bw + 0.5, bevelEnabled: false }), slate, -(bw + 0.5) / 2, bh, bz);
  roofMesh.rotation.y = Math.PI / 2; roofMesh.position.set(-(bw + 0.5) / 2, bh, bz);
  roofMesh.rotation.set(0, Math.PI / 2, 0);
  // glowing arched windows on the face toward the pan
  for (const x of [-4.2, -1.4, 1.4, 4.2]) {
    const win = put(new THREE.PlaneGeometry(1.1, 1.9), GLOW.clone(), x, 2.4, bz - bd / 2 - 0.02); win.rotation.y = Math.PI; win.castShadow = false;
    (win.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.3;
    put(new THREE.BoxGeometry(1.4, 0.16, 0.2), stone, x, 3.5, bz - bd / 2 - 0.05);
    put(new THREE.BoxGeometry(0.06, 1.9, 0.08), IRON, x, 2.4, bz - bd / 2 - 0.06);
  }
  // brass nameplate on the wall facing the pan, and again on the back for the outside view
  const tex = plaque(SEAT_NAMES[seat]!, "Oil & Co. · Est. 1851");
  for (const back of [false, true]) {
    const p = put(new THREE.PlaneGeometry(5.2, 1.08), new THREE.MeshStandardMaterial({ map: tex ?? undefined, metalness: 0.8, roughness: 0.35, color: 0xffffff }), 0, 1.85, back ? 2.46 : 1.74);
    p.rotation.y = back ? 0 : Math.PI; p.castShadow = false;
  }
  // stone pillars each side, with a gaslamp on the outer ones
  for (const s of [-1, 1]) {
    put(new THREE.BoxGeometry(0.9, 2.6, 0.9), bricks, s * (RAIL_HALF + 1.55), 1.3, 2.0);
    put(new THREE.BoxGeometry(1.1, 0.2, 1.1), stone, s * (RAIL_HALF + 1.55), 2.7, 2.0);
    const lamp = gasLamp(); lamp.position.set(s * (RAIL_HALF + 1.55), 2.8, 2.0); g.add(lamp); animated.push(lamp);
  }
  // cogs on the face, derrick and pump-jack in the yard
  const big = gear(1.1, 18, BRASS); big.position.set(-6.6, 3.4, bz - bd / 2 - 0.3); big.rotation.y = Math.PI; g.add(big);
  const small = gear(0.62, 11, COPPER); small.position.set(-5.2, 2.6, bz - bd / 2 - 0.3); small.rotation.y = Math.PI; g.add(small);
  animated.push({ update: (t) => { big.rotation.z = t * 0.35 + seat; small.rotation.z = -t * 0.35 * (18 / 11) + seat + 0.2; } });
  const rig = derrick(6.5); rig.position.set(-(RAIL_HALF + 3.6), 0, 5.2); g.add(rig);
  const jack = pumpJack(seat * 1.7); jack.position.set(RAIL_HALF + 3.4, 0, 5.4); g.add(jack); animated.push(jack);
  // a chimney stack with the company colour on its band, steaming
  const chim = put(new THREE.BoxGeometry(1.1, 5.2, 1.1), bricks, RAIL_HALF + 1.2, bh + 1.0, bz + 0.6);
  chim.scale.set(1, 1, 1);
  put(new THREE.BoxGeometry(1.3, 0.3, 1.3), stone, RAIL_HALF + 1.2, bh + 3.7, bz + 0.6);
  const band = put(new THREE.BoxGeometry(1.16, 0.34, 1.16), new THREE.MeshStandardMaterial({ color: L.accent, roughness: 0.5 }), RAIL_HALF + 1.2, bh + 2.4, bz + 0.6);
  band.castShadow = false;
  void SOOT;
  return { group: g, smokeAt: new THREE.Vector3(RAIL_HALF + 1.2, bh + 3.9, bz + 0.6), animated };
}
