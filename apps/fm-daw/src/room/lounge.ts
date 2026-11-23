// The gear room page's room (/studio.html): a rented warehouse bay made cozy round the gear corner. Worn concrete, an
// old brick back wall, painted block sides, steel trusses under a ribbed roof deck, high windows letting in a cool
// daylight, pallet racking full of road cases and boxes down the left, and a lounge on layered rugs at the right:
// a leather chesterfield, two chairs, a steel coffee table, plants, a floor lamp, under warm factory pendants and a
// string of bulbs along the brick. The furniture is Poly Haven's (CC0, public/lounge/, scripts/lounge-models.ts);
// the shell, the racking, the road cases, rugs, posters and lamps are built here, on the photo surfaces look.ts and
// gear-kit.ts give the studios. Where things stand is lounge-plan.ts (room.ts walks round the same footprints).
// Browser only.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mulberry32 } from "@rustybuns/util";
import { metreUV, surface, useKit, type Quality } from "../studio/look.ts";
import { gearKit } from "../studio/gear-kit.ts";
import { BAY, CASES, FLOOR_LAMP, PENDANTS, PIECES, POSTS, RACKING, ROOF, RUG, SHELF_BOXES, TRUSS, TRUSSES } from "./lounge-plan.ts";
import { LOUNGE_MODELS, type LoungeModel } from "./lounge-models.ts";

export interface LoungeState { quality: Quality; models: { loaded: number; of: number; failed: string[] }; lights: number; shadows: number }
export interface Lounge { group: THREE.Group; ready: Promise<void>; state(): LoungeState }

const W = BAY.x1 - BAY.x0, D = BAY.z1 - BAY.z0, MX = (BAY.x0 + BAY.x1) / 2, MZ = (BAY.z0 + BAY.z1) / 2;
const WARM = 0xffc489, BULB = 0xffb070;

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, shadow);
/** A box whose texture is laid in metres where it stands, so a photo surface keeps its real scale. */
const slab = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => mesh(metreUV(new THREE.BoxGeometry(w, h, d), [x, y, z]), m, x, y, z, false);

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---- the shell ----

function shell(g: THREE.Group) {
  // sealed concrete, a little glossy where it was never scuffed
  const floor = surface("concrete", "#5f5a53");
  const f = mesh(metreUV(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), [MX, 0, MZ]), floor, MX, 0, MZ, false);
  g.add(f);
  // the slab's saw-cut joints every three metres, and the stains a floor collects
  const joint = new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 1 });
  for (let x = BAY.x0 + 3; x < BAY.x1; x += 3) g.add(mesh(new THREE.PlaneGeometry(0.008, D).rotateX(-Math.PI / 2), joint, x, 0.001, MZ, false));
  for (let z = BAY.z0 + 3; z < BAY.z1; z += 3) g.add(mesh(new THREE.PlaneGeometry(W, 0.008).rotateX(-Math.PI / 2), joint, MX, 0.001, z, false));
  const stain = canvas(256, 256, (c) => {
    const grad = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, "rgba(20,16,12,0.55)"); grad.addColorStop(0.6, "rgba(20,16,12,0.25)"); grad.addColorStop(1, "rgba(20,16,12,0)");
    c.fillStyle = grad; c.fillRect(0, 0, 256, 256);
  });
  const rs = mulberry32(77), spill = new THREE.MeshStandardMaterial({ map: stain, transparent: true, depthWrite: false, roughness: 0.6 });
  for (let i = 0; i < 9; i++) {
    const r = 0.4 + rs() * 1.3, o = mesh(new THREE.PlaneGeometry(r, r * (0.6 + rs() * 0.5)).rotateX(-Math.PI / 2), spill, BAY.x0 + 0.5 + rs() * (W - 1), 0.0015, BAY.z0 + 0.5 + rs() * (D - 1), false);
    o.rotation.y = rs() * Math.PI;
    g.add(o);
  }
  // the yellow line the last tenant painted along the racking
  const paint = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 });
  g.add(mesh(new THREE.PlaneGeometry(0.08, RACKING.bays.at(-1)![1] - RACKING.bays[0]![0]).rotateX(-Math.PI / 2), paint, RACKING.x1 + 0.25, 0.002, (RACKING.bays[0]![0] + RACKING.bays.at(-1)![1]) / 2, false));

  // the back wall is the old brick; the sides and front painted block
  const brick = surface("brick", "#8c5a44"), block = surface("plaster", "#6d726f"), front = surface("plaster", "#5d625f");
  g.add(slab(W, ROOF, 0.2, brick, MX, ROOF / 2, BAY.z0 - 0.1));
  g.add(slab(0.2, ROOF, D, block, BAY.x0 - 0.1, ROOF / 2, MZ));
  g.add(slab(0.2, ROOF, D, block, BAY.x1 + 0.1, ROOF / 2, MZ));
  g.add(slab(W, ROOF, 0.2, front, MX, ROOF / 2, BAY.z1 + 0.1));
  // a painted dado band on the block, the way a warehouse keeps its lower walls
  const dado = new THREE.MeshStandardMaterial({ color: 0x2f3a3a, roughness: 0.85 });
  g.add(box(0.01, 1.1, D, dado, BAY.x1 - 0.005, 0.55, MZ, false), box(W, 1.1, 0.01, dado, MX, 0.55, BAY.z1 - 0.005, false));

  // the roof deck: ribbed steel, dark with age
  const deck = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.7, metalness: 0.4, map: canvas(64, 256, (c) => {
    for (let y = 0; y < 256; y++) { const v = 0.5 + 0.5 * Math.sin((y / 256) * Math.PI * 16); c.fillStyle = `rgb(${120 + v * 80},${120 + v * 80},${124 + v * 80})`; c.fillRect(0, y, 64, 1); }
  }) });
  deck.map!.wrapS = deck.map!.wrapT = THREE.RepeatWrapping;
  deck.map!.repeat.set(1, D / 1.6);
  g.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), deck, MX, ROOF, MZ, false));

  // steel: trusses across the bay, purlins along it, and the posts
  const steel = surface("steel", "#3d4247");
  for (const z of TRUSSES) {
    g.add(box(W, 0.12, 0.1, steel, MX, TRUSS, z), box(W, 0.12, 0.1, steel, MX, ROOF - 0.1, z));
    const n = 12, dx = W / n;
    for (let i = 0; i <= n; i++) {
      const x = BAY.x0 + i * dx;
      g.add(box(0.06, ROOF - 0.1 - TRUSS, 0.06, steel, x, (TRUSS + ROOF - 0.1) / 2, z));
      if (i < n) {
        const web = box(0.05, Math.hypot(dx, ROOF - 0.1 - TRUSS), 0.05, steel, x + dx / 2, (TRUSS + ROOF - 0.1) / 2, z);
        web.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(dx, ROOF - 0.1 - TRUSS);
        g.add(web);
      }
    }
  }
  for (const x of [-4.5, -1.5, 1.5, 4.5]) g.add(box(0.08, 0.14, D, steel, x, ROOF - 0.07, MZ));
  for (const [x, z] of POSTS) {
    // an I-section post on a base plate
    g.add(box(0.2, TRUSS, 0.02, steel, x, TRUSS / 2, z), box(0.02, TRUSS, 0.2, steel, x, TRUSS / 2, z - 0.09), box(0.02, TRUSS, 0.2, steel, x, TRUSS / 2, z + 0.09));
    g.add(box(0.34, 0.02, 0.34, steel, x, 0.01, z));
  }
  // a spiral duct along the bay, under the trusses
  const duct = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.35, metalness: 0.9 });
  const d = mesh(new THREE.CylinderGeometry(0.24, 0.24, D - 0.4, 24, 1, true).rotateX(Math.PI / 2), duct, -3.9, TRUSS - 0.32, MZ);
  g.add(d);
  for (let z = BAY.z0 + 0.5; z < BAY.z1 - 0.3; z += 0.9) g.add(mesh(new THREE.TorusGeometry(0.245, 0.012, 6, 24), duct, -3.9, TRUSS - 0.32, z, false));

  // high windows on the right wall: wired glass with daylight behind it
  const sky = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xb9cde2, emissiveIntensity: 1.1, roughness: 0.3 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.5 });
  for (const z of [-1.4, 1.6, 4.6]) {
    g.add(mesh(new THREE.PlaneGeometry(2.2, 0.9).rotateY(-Math.PI / 2), sky, BAY.x1 - 0.01, 3.55, z, false));
    for (const dz of [-1.1, -0.37, 0.37, 1.1]) g.add(box(0.05, 0.95, 0.04, frame, BAY.x1 - 0.03, 3.55, z + dz, false));
    for (const y of [3.1, 4.0]) g.add(box(0.06, 0.05, 2.25, frame, BAY.x1 - 0.03, y, z, false));
  }
  // the roller door and the door beside it in the front wall
  const ribs = surface("steel", "#7e8489");
  const door = new THREE.Group();
  for (let y = 0.05; y < 3.4; y += 0.1) door.add(box(3.4, 0.085, 0.04, ribs, 0, y, 0, false));
  door.add(box(3.6, 0.3, 0.12, steel, 0, 3.55, 0.02), box(0.1, 3.5, 0.1, steel, -1.75, 1.75, 0), box(0.1, 3.5, 0.1, steel, 1.75, 1.75, 0));
  door.position.set(0.6, 0, BAY.z1 - 0.04);
  g.add(door);
  const wood = surface("wood", "#4a3424");
  g.add(box(0.95, 2.1, 0.05, wood, 3.9, 1.05, BAY.z1 - 0.03, false), box(0.06, 0.06, 0.06, surface("metal"), 3.55, 1.0, BAY.z1 - 0.07, false));
  // an exit sign over it
  g.add(box(0.36, 0.16, 0.05, new THREE.MeshStandardMaterial({ color: 0x0f2a12, emissive: 0x3ad15a, emissiveIntensity: 1.2 }), 3.9, 2.35, BAY.z1 - 0.04, false));
}

// ---- the racking and the road cases ----

function racking(g: THREE.Group) {
  const upright = new THREE.MeshStandardMaterial({ color: 0x24517f, roughness: 0.55, metalness: 0.35 });
  const beam = new THREE.MeshStandardMaterial({ color: 0xd9601e, roughness: 0.5, metalness: 0.3 });
  const deck = surface("ply", "#9d8261");
  const top = RACKING.beams.at(-1)! + 0.9, cx = (RACKING.x0 + RACKING.x1) / 2, depth = RACKING.x1 - RACKING.x0;
  const posts = new Set<number>();
  for (const [z0, z1] of RACKING.bays) {
    posts.add(z0); posts.add(z1);
    for (const y of RACKING.beams) {
      for (const x of [RACKING.x0 + 0.05, RACKING.x1 - 0.05]) g.add(box(0.05, 0.12, z1 - z0 - 0.08, beam, x, y - 0.06, (z0 + z1) / 2));
      g.add(box(depth - 0.1, 0.02, z1 - z0 - 0.1, deck, cx, y + 0.01, (z0 + z1) / 2));
    }
  }
  for (const z of posts) {
    for (const x of [RACKING.x0 + 0.05, RACKING.x1 - 0.05]) g.add(box(0.08, top, 0.08, upright, x, top / 2, z));
    for (let y = 0.3; y < top; y += 0.6) {
      const tie = box(0.03, Math.hypot(depth - 0.1, 0.6), 0.03, upright, cx, y + 0.3, z);
      tie.rotation.x = 0; tie.rotation.z = Math.atan2(depth - 0.1, 0.6);
      g.add(tie);
    }
  }
}

/** A road case: black laminate over ply, aluminium angle on every edge, ball corners, two latches and a handle. */
function roadCase([w, h, d]: [number, number, number], rnd: () => number): THREE.Group {
  const g = new THREE.Group(), skin = surface("plastic", rnd() < 0.2 ? "#2b3a4c" : "#1a1a1b"), alu = surface("metal", "#c9ccd0"), ball = surface("chrome", "#d8dadc");
  g.add(box(w, h, d, skin, 0, h / 2, 0));
  const t = 0.022;
  for (const y of [t / 2, h - t / 2]) for (const z of [-d / 2, d / 2]) g.add(box(w, t, t, alu, 0, y, z));
  for (const y of [t / 2, h - t / 2]) for (const x of [-w / 2, w / 2]) g.add(box(t, t, d, alu, x, y, 0));
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) g.add(box(t, h, t, alu, x, h / 2, z));
  const lid = h * (0.68 + rnd() * 0.1);
  g.add(box(w + 0.004, 0.018, d + 0.004, alu, 0, lid, 0));
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), ball, x, y, z, false));
  for (const x of [-w * 0.3, w * 0.3]) g.add(box(0.06, 0.07, 0.018, alu, x, lid, d / 2 + 0.008));
  g.add(box(0.14, 0.035, 0.03, surface("rubber", "#111"), 0, lid - 0.12 > 0.05 ? lid - 0.12 : h / 2, d / 2 + 0.015));
  // a stencilled strip of gaffer on the lid, as every crew marks its cases
  if (rnd() < 0.7) g.add(box(w * 0.4, 0.002, 0.05, new THREE.MeshStandardMaterial({ color: rnd() < 0.5 ? 0xe9e4d6 : 0xd4b13a, roughness: 0.9 }), (rnd() - 0.5) * w * 0.3, h + 0.002, (rnd() - 0.5) * d * 0.4, ));
  return g;
}

// ---- the lounge's own things ----

/** A woven rug: a field in `base`, a border, and stepped diamonds down the middle, as a flatweave has. */
function rugTexture(seed: number, base: string, ink: string, edge: string): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  return canvas(512, 512, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 512, 512);
    c.fillStyle = edge; c.fillRect(0, 0, 512, 40); c.fillRect(0, 472, 512, 40); c.fillRect(0, 0, 40, 512); c.fillRect(472, 0, 40, 512);
    c.fillStyle = ink;
    for (let k = 0; k < 4; k++) {
      const cy = 100 + k * 104;
      for (let s = 5; s > 0; s -= 1) { c.beginPath(); c.moveTo(256, cy - s * 9); c.lineTo(256 + s * 30, cy); c.lineTo(256, cy + s * 9); c.lineTo(256 - s * 30, cy); c.closePath(); c.fillStyle = s % 2 ? ink : s === 2 ? edge : base; c.fill(); }
    }
    c.fillStyle = ink;
    for (let x = 48; x < 464; x += 22) { c.fillRect(x, 52, 10, 10); c.fillRect(x, 450, 10, 10); }
    // the weave: a fine grain and the wear of feet
    const img = c.getImageData(0, 0, 512, 512), px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const x = (i / 4) % 512, y = (i / 4 / 512) | 0, n = (rnd() - 0.5) * 30 + (y % 3 === 0 ? -10 : 0) + (x % 4 === 0 ? -6 : 0);
      // faded toward a lighter middle, where the sun and feet have been
      const fade = 1 - Math.hypot(x - 256, y - 256) / 362;
      for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, px[i + k]! * (1 - fade * 0.12) + fade * 22 + n));
    }
    c.putImageData(img, 0, 0);
  });
}

function rugs(g: THREE.Group) {
  const lay = (w: number, d: number, x: number, z: number, yaw: number, y: number, map: THREE.Texture) => {
    const r = mesh(new THREE.BoxGeometry(w, 0.012, d), new THREE.MeshStandardMaterial({ map, roughness: 1 }), x, y, z, false);
    r.rotation.y = yaw;
    g.add(r);
  };
  lay(RUG.w, RUG.d, RUG.at[0], RUG.at[1], 0.04, 0.006, rugTexture(3, "#6a2a24", "#2a3346", "#b89a72"));
  lay(1.9, 1.3, RUG.at[0] - 0.9, RUG.at[1] + 0.7, -0.35, 0.014, rugTexture(9, "#a8987a", "#4e3528", "#3d4a55"));
  // a worn one under the gear, where players stand
  lay(2.6, 1.9, 0.1, 0.35, 0.02, 0.006, rugTexture(17, "#363c44", "#6e3428", "#9c8358"));
}

function floorLamp(g: THREE.Group, lights: THREE.Light[]) {
  const [x, z] = FLOOR_LAMP, brass = surface("metal", "#b08a4a");
  const lamp = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2, leg = box(0.02, 1.55, 0.02, brass, Math.sin(a) * 0.14, 0.76, Math.cos(a) * 0.14);
    leg.rotation.set(Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18);
    lamp.add(leg);
  }
  const shade = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, emissive: 0xffc68a, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide });
  lamp.add(mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.32, 28, 1, true), shade, 0, 1.62, 0, false));
  const l = new THREE.PointLight(WARM, 9, 6, 2);
  l.position.set(0, 1.6, 0);
  lamp.add(l);
  lights.push(l);
  lamp.position.set(x, 0, z);
  g.add(lamp);
}

/** A string of bulbs along the brick, swagging between hooks; two real lights stand in for the lot. */
function stringLights(g: THREE.Group, lights: THREE.Light[]) {
  const z = BAY.z0 + 0.12, glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: BULB, emissiveIntensity: 5 });
  const pts: THREE.Vector3[] = [], hooks = [-5.6, -3.4, -1.6, 1.6, 3.6, 5.6];
  for (let h = 0; h < hooks.length - 1; h++) {
    const a = hooks[h]!, b = hooks[h + 1]!;
    for (let i = 0; i < 12; i++) { const t = i / 12, x = a + (b - a) * t; pts.push(new THREE.Vector3(x, 3.35 - Math.sin(t * Math.PI) * 0.35, z)); }
  }
  pts.push(new THREE.Vector3(hooks.at(-1)!, 3.35, z));
  const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.005, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  g.add(wire);
  const bulb = new THREE.SphereGeometry(0.03, 10, 8);
  for (let i = 0; i < pts.length; i += 3) g.add(mesh(bulb, glow, pts[i]!.x, pts[i]!.y - 0.04, z + 0.01, false));
  for (const x of [-3.5, 3.5]) {
    const l = new THREE.PointLight(BULB, 4, 5, 2);
    l.position.set(x, 3.1, z + 0.3);
    g.add(l);
    lights.push(l);
  }
}

/** A sign of our own on the brick: the studio's name in warm tube light. */
function sign(g: THREE.Group, lights: THREE.Light[]) {
  const t = canvas(1024, 256, (c) => {
    c.clearRect(0, 0, 1024, 256);
    c.font = "600 150px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "#ff8a3d"; c.shadowBlur = 30; c.strokeStyle = "#ffd2a0"; c.lineWidth = 9;
    c.strokeText("QOLLAB", 512, 128);
    c.shadowBlur = 0; c.strokeStyle = "#fff4e2"; c.lineWidth = 4; c.strokeText("QOLLAB", 512, 128);
  });
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  g.add(mesh(new THREE.PlaneGeometry(2.2, 0.55), m, -3.3, 2.55, BAY.z0 + 0.03, false));
  const l = new THREE.PointLight(0xff9a50, 2.5, 3, 2);
  l.position.set(-3.3, 2.55, BAY.z0 + 0.4);
  g.add(l);
  lights.push(l);
}

/** Gig posters of our own, pasted or framed: made-up acts, our own type. */
function posters(g: THREE.Group, rnd: () => number) {
  const acts = [["THE TAPE LOOPS", "#e2d3b1", "#b23a2e"], ["SPRING REVERB", "#1d2c3a", "#e8b04a"], ["Q SPLIT", "#e9e4d6", "#24314a"], ["NIGHT BUS", "#2a1d2e", "#e46a4a"], ["LOW END CLUB", "#d6c49a", "#2b2d31"]] as const;
  const poster = (i: number) => canvas(256, 360, (c) => {
    const [name, bg, ink] = acts[i % acts.length]!;
    c.fillStyle = bg; c.fillRect(0, 0, 256, 360);
    c.fillStyle = ink;
    for (let k = 0; k < 5; k++) { c.globalAlpha = 0.25 + rnd() * 0.4; c.beginPath(); c.arc(40 + rnd() * 180, 60 + rnd() * 160, 20 + rnd() * 50, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
    c.font = "700 34px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.textAlign = "center";
    c.fillText(name, 128, 270);
    c.font = "500 16px 'IBM Plex Sans', sans-serif"; c.fillText("LIVE · FRI 9PM · DOORS 8", 128, 300);
    c.fillText("BAY 4 · NO COVER", 128, 322);
  });
  const paste = (i: number, x: number, y: number, z: number, yaw: number, framed: boolean) => {
    const p = mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ map: poster(i), roughness: 0.85 }), 0, 0, 0.012, false);
    const o = new THREE.Group();
    o.add(p);
    if (framed) o.add(box(0.56, 0.76, 0.02, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }), 0, 0, 0, false));
    o.position.set(x, y, z);
    o.rotation.set(0, yaw, (rnd() - 0.5) * (framed ? 0.01 : 0.05));
    g.add(o);
  };
  // pasted up on the front block, framed over the couch
  paste(0, -3.4, 1.7, BAY.z1 - 0.01, Math.PI, false);
  paste(1, -2.75, 1.75, BAY.z1 - 0.01, Math.PI, false);
  paste(3, -4.05, 1.68, BAY.z1 - 0.01, Math.PI, false);
  paste(2, BAY.x1 - 0.02, 1.85, 2.15, -Math.PI / 2, true);
  paste(4, BAY.x1 - 0.02, 1.85, 3.05, -Math.PI / 2, true);
}

/** Coiled cables and a gaffer-taped run, the way a room in use collects them. */
function cables(g: THREE.Group) {
  const jacket = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 });
  for (const [x, z, r] of [[2.4, -0.55, 0.16], [-2.0, -0.7, 0.13], [-1.6, 5.1, 0.2], [2.25, -0.5, 0.12]] as const) {
    for (let k = 0; k < 4; k++) {
      const loop = mesh(new THREE.TorusGeometry(r - k * 0.008, 0.007, 6, 32), jacket, x + k * 0.006, 0.008 + k * 0.012, z, false);
      loop.rotation.x = Math.PI / 2 + (k - 2) * 0.04;
      g.add(loop);
    }
  }
  const tape = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95 });
  g.add(box(0.05, 0.003, 3.2, tape, 1.25, 0.0015, 1.5, false));
}

// ---- the Poly Haven furniture ----

function furniture(g: THREE.Group, done: (id: string, ok: boolean) => void): Promise<void> {
  const loader = new GLTFLoader(), base = `${import.meta.env.BASE_URL}lounge/`;
  const cache = new Map<LoungeModel, Promise<THREE.Group | null>>();
  const load = (id: LoungeModel) => {
    let p = cache.get(id);
    if (!p) {
      p = loader.loadAsync(`${base}${id}/${id}.gltf`).then((gl) => {
        const s = gl.scene;
        s.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
        done(id, true);
        return s;
      }, () => { done(id, false); return null; });
      cache.set(id, p);
    }
    return p;
  };
  const placed: (THREE.Object3D | null)[] = [];
  const stand = async (i: number): Promise<THREE.Object3D | null> => {
    const piece = PIECES[i]!, src = await load(piece.model);
    if (!src) return null;
    const o = new THREE.Group(), m = src.clone();
    o.add(m);
    o.rotation.y = piece.yaw;
    o.updateMatrixWorld(true);
    // bottom centre at the spot (the models' own origins vary)
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    let y = -b.min.y;
    if (piece.on !== undefined) {
      const under = placed[piece.on] ?? (await stand(piece.on));
      if (under) y += new THREE.Box3().setFromObject(under).max.y;
    }
    o.position.set(piece.at[0] - c.x, y, piece.at[1] - c.z);
    g.add(o);
    placed[i] = o;
    return o;
  };
  const pieces = PIECES.map((_, i) => (placed[i] ? Promise.resolve(placed[i]) : stand(i)));
  // cardboard boxes stacked on the racking, the same scan turned this way and that
  const boxes = load("cardboard_box_01").then((src) => {
    if (!src) return;
    for (const [x, z, y, yaw] of SHELF_BOXES) {
      const o = src.clone();
      o.rotation.y = yaw;
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
      o.position.set(x - c.x, y + 0.02 - b.min.y, z - c.z);
      g.add(o);
    }
  });
  // the pendants hang from the trusses, each with its own warm lamp under the shade
  const cord = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const lamps = load("hanging_industrial_lamp").then((src) => {
    if (!src) return;
    for (const [x, z] of PENDANTS) {
      const o = src.clone();
      const b = new THREE.Box3().setFromObject(o), top = TRUSS + 0.25;
      o.position.set(x, top - b.max.y, z);
      g.add(o, mesh(new THREE.CylinderGeometry(0.004, 0.004, ROOF - top), cord, x, (ROOF + top) / 2, z, false));
    }
  });
  const filled = Promise.all(pieces).then((all) => {
    all.forEach((o, i) => {
      const m = PIECES[i]!.model;
      if (o && m === "wooden_bookshelf_worn") stock(g, o, "books");
      if (o && m === "worn_metal_rack") stock(g, o, "spares");
    });
  });
  return Promise.all([filled, boxes, lamps]).then(() => undefined);
}

/** The tops of a shelf unit's shelves (world y), found by dropping rays through it: lowest first. */
function shelfTops(o: THREE.Object3D): { tops: number[]; box: THREE.Box3 } {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3()), ray = new THREE.Raycaster(), hits: number[] = [];
  for (const dx of [-0.25, 0, 0.25]) {
    ray.set(new THREE.Vector3(c.x + dx * (box.max.x - box.min.x), box.max.y + 0.1, c.z), new THREE.Vector3(0, -1, 0));
    for (const h of ray.intersectObject(o, true)) if (h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.9) hits.push(h.point.y);
  }
  const tops: number[] = [];
  for (const y of hits.sort((a, b) => a - b)) if (!tops.length || y - tops.at(-1)! > 0.08) tops.push(y);
  return { tops, box };
}

const SPINES = ["#6e2b22", "#2c3e50", "#8a6d3b", "#3f5a3a", "#b9a27a", "#1f1f22", "#7b4a5a", "#c2b49a", "#45606e", "#a0432f", "#d6c9a8", "#2e2a26"];
/** Fill a shelf unit: rows of books and LP sleeves (`books`), or tubs, tape and coiled cable (`spares`). One instanced mesh. */
function stock(g: THREE.Group, o: THREE.Object3D, what: "books" | "spares") {
  const { tops, box } = shelfTops(o), rnd = mulberry32(what === "books" ? 11 : 23);
  const items: { w: number; h: number; d: number; x: number; y: number; z: number; lean: number; color: string }[] = [];
  const x0 = box.min.x + 0.07, x1 = box.max.x - 0.07, back = box.min.z + 0.06, depth = box.max.z - box.min.z - 0.14;
  tops.forEach((y, i) => {
    const room = (tops[i + 1] ?? box.max.y + 0.4) - y - 0.03;
    if (room < 0.12 || y > box.max.y - 0.02) return;
    let x = x0 + rnd() * 0.05;
    while (x < x1 - 0.03) {
      if (what === "books") {
        if (rnd() < 0.12) { x += 0.06 + rnd() * 0.12; continue; }
        if (rnd() < 0.18 && room > 0.33) { // a run of records in their sleeves
          const n = 8 + Math.floor(rnd() * 14);
          for (let k = 0; k < n && x < x1 - 0.01; k++, x += 0.007) items.push({ w: 0.006, h: 0.31, d: 0.31, x, y, z: back + Math.min(depth, 0.31) / 2, lean: 0, color: SPINES[Math.floor(rnd() * SPINES.length)]! });
          x += 0.02;
          continue;
        }
        const w = 0.018 + rnd() * 0.035, h = Math.min(room, 0.17 + rnd() * 0.14), d = Math.min(depth, 0.13 + rnd() * 0.09);
        items.push({ w, h, d, x: x + w / 2, y, z: back + d / 2 + (depth - d) * 0.7, lean: 0, color: SPINES[Math.floor(rnd() * SPINES.length)]! });
        x += w + 0.002;
      } else {
        const w = 0.18 + rnd() * 0.16, h = Math.min(room, 0.12 + rnd() * 0.12), d = Math.min(depth, 0.25 + rnd() * 0.12);
        if (rnd() < 0.3) { x += 0.1; continue; }
        items.push({ w, h, d, x: x + w / 2, y, z: back + d / 2, lean: (rnd() - 0.5) * 0.2, color: ["#2b4f7a", "#c9c3b4", "#1d1d1f", "#b7462e", "#556b3e"][Math.floor(rnd() * 5)]! });
        x += w + 0.04;
      }
    }
    // a lean at the end of a row of books
    if (what === "books" && items.length) { const last = items.at(-1)!; if (last.w > 0.01) last.lean = 0.12; }
  });
  const mat = new THREE.MeshStandardMaterial({ roughness: what === "books" ? 0.8 : 0.5 }), geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(geo, mat, items.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  items.forEach((b, i) => {
    q.setFromEuler(new THREE.Euler(0, b.lean ? (rnd() - 0.5) * 0.1 : (rnd() - 0.5) * 0.04, -b.lean));
    m4.compose(new THREE.Vector3(b.x, b.y + 0.001, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.set(b.color).multiplyScalar(0.85 + rnd() * 0.3));
  });
  inst.castShadow = inst.receiveShadow = true;
  g.add(inst);
}

// ---- the light ----

function light(g: THREE.Group, renderer: THREE.WebGLRenderer, scene: THREE.Scene, high: boolean, lights: THREE.Light[]): number {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  pm.dispose();
  scene.background = new THREE.Color(0x0c0d0f);
  scene.fog = new THREE.Fog(0x15130f, 9, 22);
  g.add(new THREE.HemisphereLight(0xf2e6d6, 0x3a2e24, 0.22));
  // daylight through the high windows: cool, soft, from the right
  const sun = new THREE.DirectionalLight(0xcfdcf0, 0.4);
  sun.position.set(BAY.x1 + 3, ROOF + 2, 1.5);
  sun.target.position.set(-1, 0, 1.5);
  g.add(sun, sun.target);
  lights.push(sun);
  // under each pendant's shade, a warm pool on the floor; the first few throw shadows on high
  const glass = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: BULB, emissiveIntensity: 6 });
  let shadows = 0;
  PENDANTS.forEach(([x, z], i) => {
    const l = new THREE.SpotLight(WARM, 55, 0, 1.05, 0.75, 2);
    const y = TRUSS + 0.25 - 1.36 + 0.08;
    l.position.set(x, y, z);
    l.target.position.set(x, 0, z);
    if (high && i < 3) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.02;
      l.shadow.radius = 4;
      l.shadow.camera.near = 0.2;
      shadows++;
    }
    g.add(l, l.target, mesh(new THREE.SphereGeometry(0.045, 12, 10), glass, x, y + 0.02, z, false));
    // the bounce off the floor and the shade: a soft fill that keeps the pool from reading as a stage spot
    const fill = new THREE.PointLight(WARM, 3, 4.5, 2);
    fill.position.set(x, y - 0.2, z);
    g.add(fill);
    lights.push(l, fill);
  });
  if (high) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -7; c.right = 7; c.top = 6; c.bottom = -6; c.near = 0.5; c.far = 20;
    sun.shadow.bias = -0.0005;
    shadows++;
  }
  return shadows;
}

/** Dress `scene` as the warehouse lounge, and set the renderer up the way the studios are (tone mapped, soft shadows on high). */
export function lounge(renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality: Quality): Lounge {
  const high = quality === "high";
  useKit(gearKit(quality));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const g = new THREE.Group(), lights: THREE.Light[] = [], rnd = mulberry32(4242);
  g.name = "lounge";
  shell(g);
  racking(g);
  for (const c of CASES) {
    const o = roadCase(c.size, rnd);
    o.position.set(c.at[0], (c.y ?? 0) + (c.y ? 0.02 : 0), c.at[1]);
    o.rotation.y = c.yaw;
    g.add(o);
  }
  rugs(g);
  floorLamp(g, lights);
  stringLights(g, lights);
  sign(g, lights);
  posters(g, rnd);
  cables(g);
  const shadows = light(g, renderer, scene, high, lights);
  if (!high) g.traverse((o) => { o.castShadow = false; });
  scene.add(g);

  const of = Object.keys(LOUNGE_MODELS).length, failed: string[] = [];
  let loaded = 0;
  const ready = furniture(g, (id, ok) => { if (ok) loaded++; else failed.push(id); });
  return {
    group: g,
    ready,
    state: () => ({ quality, models: { loaded, of, failed }, lights: lights.length, shadows }),
  };
}
