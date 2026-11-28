// The Design desk: the architect's sloped table in every studio, "Design" over it. Walked up to, it opens the event
// space, the sound design or the speaker stack (seat-bar.ts draws that choice).
import * as THREE from "three";
import { DESK_D, DESK_W, type DeskPlace } from "./design-place.ts";

/** What the desk opens, each a symbol (Lucide, ISC) and a word or two. */
export const DESIGNS = [
  { id: "event", say: "Event space", href: "/rooms.html#party", icon: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>' },
  { id: "sound", say: "Sound design", href: "/rooms.html", icon: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>' },
  { id: "stack", say: "Speaker stack", href: "/speakers.html", icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>' },
] as const;

/** The table, its drawing and the sign over it. */
export function designDesk(at: DeskPlace): THREE.Group {
  const g = new THREE.Group();
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.yaw;
  const wood = new THREE.MeshStandardMaterial({ color: "#a9825a", roughness: 0.7 }), steel = new THREE.MeshStandardMaterial({ color: "#2c2f34", roughness: 0.5, metalness: 0.5 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, to: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; to.add(m); return m;
  };
  for (const x of [-DESK_W / 2 + 0.08, DESK_W / 2 - 0.08]) {
    add(new THREE.BoxGeometry(0.05, 0.86, 0.05), steel, x, 0.43, -0.12);
    add(new THREE.BoxGeometry(0.07, 0.04, DESK_D * 0.8), steel, x, 0.02, -0.02);
  }
  add(new THREE.BoxGeometry(DESK_W - 0.2, 0.03, 0.03), steel, 0, 0.3, -0.12);
  // the board, tipped toward whoever stands at it (+z), with a plan pinned on it and a lip to stop the pencils
  const top = new THREE.Group();
  top.position.set(0, 0.94, 0); top.rotation.x = 0.42;
  g.add(top);
  add(new THREE.BoxGeometry(DESK_W, 0.035, DESK_D), wood, 0, 0, 0, top);
  add(new THREE.BoxGeometry(DESK_W, 0.03, 0.025), wood, 0, 0.025, DESK_D / 2 - 0.012, top);
  const plan = add(new THREE.PlaneGeometry(DESK_W - 0.2, DESK_D - 0.18), new THREE.MeshStandardMaterial({ map: drawing(), roughness: 0.9 }), 0, 0.019, -0.01, top);
  plan.rotation.x = -Math.PI / 2;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: word("Design"), transparent: true, depthWrite: false }));
  sign.scale.set(0.8, 0.22, 1);
  sign.position.set(0, 1.62, 0);
  g.add(sign);
  return g;
}

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const el = document.createElement("canvas");
  el.width = w; el.height = h;
  const c = el.getContext("2d");
  if (c) draw(c);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** A stage plan in blue line: a grid, the stage, two stacks and their throw. */
const drawing = () => canvas(512, 320, (c) => {
  c.fillStyle = "#e9eef2"; c.fillRect(0, 0, 512, 320);
  c.strokeStyle = "#c5d2dd"; c.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 320); c.stroke(); }
  for (let y = 0; y <= 320; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  c.strokeStyle = "#2f5d86"; c.lineWidth = 4;
  c.strokeRect(144, 40, 224, 64); c.strokeRect(80, 56, 40, 56); c.strokeRect(392, 56, 40, 56);
  for (const x of [100, 412]) for (const r of [70, 130, 190]) { c.beginPath(); c.arc(x, 112, r, Math.PI * 0.3, Math.PI * 0.7); c.stroke(); }
});
const word = (text: string) => canvas(512, 140, (c) => {
  c.fillStyle = "rgba(21, 23, 27, 0.86)"; c.beginPath(); c.roundRect(8, 8, 496, 124, 26); c.fill();
  c.fillStyle = "#f4f1ea"; c.font = '80px "Russo One", "Arial Black", sans-serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, 256, 74);
});
