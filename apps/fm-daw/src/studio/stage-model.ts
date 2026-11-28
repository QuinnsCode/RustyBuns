// The Stage Builder's ready-made stage (#6053), one piece: the deck, four posts and the roof on them, a bar of lights
// along the front edge and the booth's fascia. The builder's 3D view and the jam room both draw this one, so what you
// place is what you walk into. The decks on it are the room's "dj" spot, drawn with the seats.
import * as THREE from "three";
import { metreUV, surface } from "./look.ts";
import { deckHeight, type StagePiece } from "./room.ts";

/** The stage where it stands: its front toward its own +z, turned by its yaw. `open`: its roof see-through, for the
 *  builder looking down into it. */
export function stageModel(st: StagePiece, open = false): THREE.Group {
  const g = new THREE.Group(), h = deckHeight(st), roof = h + Math.max(3.2, st.w * 0.4);
  g.position.set(st.at[0], 0, st.at[1]); g.rotation.y = st.yaw;
  const steel = surface("steel", "#6d7178"), deck = surface("ply", "#2a2420"), skirt = surface("fabric", "#101014"), canopy = open ? new THREE.MeshStandardMaterial({ color: "#8d93a6", transparent: true, opacity: 0.22, depthWrite: false }) : surface("fabric", "#1b1d24");
  const box = (w: number, tall: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(metreUV(new THREE.BoxGeometry(w, tall, d)), m);
    o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o);
  };
  box(st.w, 0.12, st.d, deck, 0, h - 0.06, 0);
  box(st.w - 0.04, h - 0.12, st.d - 0.04, skirt, 0, (h - 0.12) / 2, 0);
  const x = st.w / 2 - 0.15, z = st.d / 2 - 0.15;
  for (const kx of [-1, 1]) for (const kz of [-1, 1]) box(0.2, roof - h, 0.2, steel, kx * x, (roof + h) / 2, kz * z);
  // the roof, a canopy on a truss frame
  box(st.w + 0.3, 0.12, st.d + 0.3, canopy, 0, roof + 0.2, 0);
  for (const kz of [-1, 1]) box(st.w, 0.25, 0.2, steel, 0, roof, kz * z);
  for (const kx of [-1, 1]) box(0.2, 0.25, st.d, steel, kx * x, roof, 0);
  // the lights under the front truss
  const lamps = Math.max(3, Math.round(st.w / 1.6)), glow = new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb454", emissiveIntensity: 1.4 });
  for (let i = 0; i < lamps; i++) {
    const lx = -x + 0.4 + (i * (2 * x - 0.8)) / (lamps - 1);
    box(0.22, 0.2, 0.2, steel, lx, roof - 0.22, z);
    box(0.14, 0.03, 0.12, glow, lx, roof - 0.34, z);
  }
  // the booth's fascia, across the front of the deck
  box(Math.min(3.2, st.w * 0.6), 0.1, 0.08, glow, 0, h - 0.06, st.d / 2 + 0.03);
  return g;
}
