// Campers and rangers, built from primitives so there's nothing to download.
// A camper wears their Look; a ranger wears the flat hat and carries a flashlight.
// Rounded parts on real joints (hips, knees, shoulders, elbows), so walking and crouching bend
// like a person. Geometry and materials are shared between characters, so a full park stays cheap.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PANTS, SHIRTS, SKINS, type Look } from "../hunt/game.ts";
import type { Role } from "../hunt/sim.ts";

export interface Character {
  root: THREE.Group;
  /** Turns with the pitch: the head and the flashlight. */
  head: THREE.Group;
  /** Hips, then knees: index 0 is the left side. */
  legs: [THREE.Object3D, THREE.Object3D];
  knees: [THREE.Object3D, THREE.Object3D];
  /** Shoulders, then elbows. */
  arms: [THREE.Object3D, THREE.Object3D];
  elbows: [THREE.Object3D, THREE.Object3D];
  body: THREE.Group;
  /** Everything above the hips: leans forward when crouching. */
  upper: THREE.Group;
  light: THREE.SpotLight | null;
  beam: THREE.Mesh | null;
  tag: THREE.Sprite;
  role: Role;
  /** Walk cycle phase. */
  phase: number;
  /** 0 standing, 1 crouched, eased. */
  crouchT: number;
}

const HAIR = ["#2a1b12", "#4f3220", "#7b4f28", "#b98a4a", "#171717", "#8f3a1c"];
const RANGER_SHIRT = "#b8a275";
const RANGER_PANTS = "#4c5b3a";
const HIP_Y = 0.9;
const THIGH = 0.43;
const SHIN = 0.41;

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<string, THREE.Material>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g as T;
}
function mat(color: string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(opts);
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...opts })));
  return m as THREE.MeshStandardMaterial;
}
function shade(color: string, f: number): string {
  return `#${new THREE.Color(color).multiplyScalar(f).getHexString()}`;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  return o;
}
const capsule = (r: number, len: number) => geo(`cap${r}/${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 12));
const sphere = (r: number, w = 12, h = 8) => geo(`sph${r}/${w}/${h}`, () => new THREE.SphereGeometry(r, w, h));
const rbox = (w: number, h: number, d: number, r: number) => geo(`rb${w}/${h}/${d}/${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
const cyl = (rt: number, rb: number, h: number, seg = 16, open = false) => geo(`cyl${rt}/${rb}/${h}/${seg}/${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));

export function makeCharacter(role: Role, look: Look, name: string): Character {
  const ranger = role === "ranger";
  const shirtC = ranger ? RANGER_SHIRT : SHIRTS[look.shirt];
  const pantsC = ranger ? RANGER_PANTS : PANTS[look.pants];
  const skinC = SKINS[look.skin];
  const shirt = mat(shirtC);
  const shirtDark = mat(shade(shirtC, 0.62));
  const pants = mat(pantsC);
  const skin = mat(skinC, { roughness: 0.7 });
  const bootC = ranger ? "#2c2018" : "#5a3b24";

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Legs: hip → thigh → knee → shin → boot. Feet land at y = 0.
  const legs: THREE.Group[] = [], knees: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.1 * side, HIP_Y, 0);
    hip.add(mesh(capsule(0.085, THIGH - 0.12), pants, 0, -THIGH / 2, 0, true));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    knee.add(mesh(capsule(0.072, SHIN - 0.1), pants, 0, -SHIN / 2 + 0.02, 0, true));
    // a turned-up cuff above the boot
    knee.add(mesh(cyl(0.083, 0.083, 0.05), mat(shade(pantsC, 0.75)), 0, -SHIN + 0.13, 0));
    const boot = new THREE.Group();
    boot.position.y = -SHIN;
    boot.add(mesh(rbox(0.16, 0.13, 0.27, 0.045), mat(bootC), 0, 0.005, 0.035, true));
    boot.add(mesh(rbox(0.17, 0.035, 0.285, 0.012), mat("#1d1611"), 0, -0.05, 0.035));
    knee.add(boot);
    hip.add(knee);
    body.add(hip);
    legs.push(hip);
    knees.push(knee);
  }

  // Everything above the hips hangs off one pivot, so a crouch can lean it forward.
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  body.add(upper);
  const U = (y: number) => y - HIP_Y;

  upper.add(mesh(rbox(0.36, 0.2, 0.22, 0.07), pants, 0, U(0.95), 0, true));
  const torso = mesh(capsule(0.19, 0.3), shirt, 0, U(1.28), 0, true);
  torso.scale.set(1.08, 1, 0.68);
  upper.add(torso);
  // jacket hem, collar and zip
  const hem = mesh(cyl(0.2, 0.2, 0.06, 20), shirtDark, 0, U(1.06), 0);
  hem.scale.set(1.08, 1, 0.7);
  const collar = mesh(geo("collar", () => new THREE.TorusGeometry(0.095, 0.035, 8, 18)), shirtDark, 0, U(1.6), 0);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1.05, 0.85, 1);
  upper.add(hem, collar);
  if (!ranger) upper.add(mesh(geo("zip", () => new THREE.BoxGeometry(0.018, 0.5, 0.012)), mat(shade(shirtC, 0.45)), 0, U(1.3), 0.13));
  upper.add(mesh(cyl(0.055, 0.06, 0.1, 10), skin, 0, U(1.64), 0));

  if (ranger) {
    // Badge, breast pockets, belt and a reflective stripe: rangers are easy to spot (on purpose).
    const pocket = rbox(0.1, 0.1, 0.03, 0.01);
    for (const side of [-1, 1]) upper.add(mesh(pocket, mat(shade(RANGER_SHIRT, 0.85)), 0.085 * side, U(1.36), 0.12));
    const badge = mesh(cyl(0.035, 0.035, 0.012, 6), mat("#e8c547", { metalness: 0.7, roughness: 0.3 }), -0.085, U(1.44), 0.135);
    badge.rotation.x = Math.PI / 2;
    const stripe = mesh(cyl(0.2, 0.2, 0.05, 20), mat("#d8ff3a", { emissive: "#556600" }), 0, U(1.14), 0);
    stripe.scale.set(1.09, 1, 0.71);
    const belt = mesh(cyl(0.19, 0.19, 0.05, 20), mat("#3b2a1a"), 0, U(1.0), 0);
    belt.scale.set(1.0, 1, 0.62);
    const buckle = mesh(geo("buckle", () => new THREE.BoxGeometry(0.06, 0.045, 0.02)), mat("#c9a646", { metalness: 0.7, roughness: 0.35 }), 0, U(1.0), 0.125);
    upper.add(badge, stripe, belt, buckle);
  } else if (look.pack) {
    const packC = SHIRTS[(look.shirt + 3) % SHIRTS.length];
    const pack = mat(packC);
    const packDark = mat(shade(packC, 0.6));
    upper.add(mesh(rbox(0.32, 0.44, 0.17, 0.06), pack, 0, U(1.3), -0.21, true));
    upper.add(mesh(rbox(0.22, 0.15, 0.07, 0.03), packDark, 0, U(1.19), -0.31));
    upper.add(mesh(rbox(0.33, 0.07, 0.19, 0.03), packDark, 0, U(1.52), -0.21));
    // straps over the shoulders and down the chest
    const strap = mat(shade(packC, 0.45));
    for (const side of [-1, 1]) {
      upper.add(mesh(geo("strapF", () => new THREE.BoxGeometry(0.034, 0.26, 0.016)), strap, 0.125 * side, U(1.42), 0.122));
      upper.add(mesh(geo("strapT", () => new THREE.BoxGeometry(0.034, 0.018, 0.3)), strap, 0.125 * side, U(1.565), -0.03));
    }
    // a sleeping roll under the pack, tied on
    const roll = mesh(cyl(0.075, 0.075, 0.4, 14), mat("#5a6b3a"), 0, U(1.02), -0.22, true);
    roll.rotation.z = Math.PI / 2;
    upper.add(roll);
    for (const side of [-1, 1]) {
      const tie = mesh(geo("tie", () => new THREE.TorusGeometry(0.078, 0.01, 6, 16)), strap, 0.12 * side, U(1.02), -0.22);
      tie.rotation.y = Math.PI / 2;
      upper.add(tie);
    }
  }

  // Arms: shoulder → upper arm → elbow → forearm → cuff → hand.
  const arms: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.255 * side, U(1.5), 0);
    shoulder.add(mesh(sphere(0.075), shirt, 0, 0, 0));
    shoulder.add(mesh(capsule(0.068, 0.18), shirt, 0, -0.14, 0, true));
    if (ranger) {
      const patch = mesh(cyl(0.04, 0.04, 0.01, 12), mat("#5b6b3a"), 0.07 * side, -0.07, 0);
      patch.rotation.z = Math.PI / 2;
      shoulder.add(patch);
    }
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    elbow.add(mesh(capsule(0.06, 0.17), shirt, 0, -0.13, 0, true));
    elbow.add(mesh(cyl(0.066, 0.066, 0.04, 12), shirtDark, 0, -0.255, 0));
    const hand = mesh(sphere(0.062), skin, 0, -0.31, 0.005);
    hand.scale.set(0.85, 1.1, 0.95);
    elbow.add(hand);
    shoulder.add(elbow);
    upper.add(shoulder);
    arms.push(shoulder);
    elbows.push(elbow);
  }

  // Head: hair under the hat, a face that reads from across a meadow.
  const head = new THREE.Group();
  head.position.y = U(1.68);
  const skull = mesh(sphere(0.165, 20, 14), skin, 0, 0.14, 0, true);
  skull.scale.set(0.96, 1.04, 0.98);
  head.add(skull);
  head.add(...face(look, skin));
  const hairC = HAIR[(look.skin * 3 + look.shirt) % HAIR.length];
  head.add(...hair(ranger ? "ranger" : look.hat, mat(hairC)));
  const hatParts = hat(ranger ? "ranger" : look.hat, look);
  if (hatParts.length) head.add(...hatParts);
  upper.add(head);

  // The flashlight: held in the right hand, plus a real spotlight and a faint cone from the head so
  // it follows the ranger's gaze.
  let light: THREE.SpotLight | null = null, beam: THREE.Mesh | null = null;
  if (ranger) {
    const torch = new THREE.Group();
    torch.position.set(0, -0.34, 0.02);
    torch.add(mesh(cyl(0.03, 0.03, 0.2, 10), mat("#2a2a2a", { metalness: 0.5, roughness: 0.4 }), 0, -0.04, 0));
    torch.add(mesh(cyl(0.045, 0.032, 0.07, 12), mat("#3a3a3a", { metalness: 0.5, roughness: 0.4 }), 0, -0.17, 0));
    torch.add(mesh(cyl(0.04, 0.04, 0.01, 12), mat("#fff8e0", { emissive: "#fff2c4", emissiveIntensity: 1.5 }), 0, -0.21, 0));
    elbows[1].add(torch);
    light = new THREE.SpotLight("#fff4d6", 0, 46, (26 * Math.PI) / 180, 0.45, 1.2);
    light.position.set(0.3, 1.45, 0.25);
    light.target.position.set(0.3, 1.2, 10);
    head.add(light, light.target);
    const beamGeo = new THREE.ConeGeometry(Math.tan((26 * Math.PI) / 180) * 22, 22, 24, 1, true);
    beamGeo.translate(0, -11, 0);
    beamGeo.rotateX(-Math.PI / 2);
    beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#fff2c4", transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(0.3, -0.15, 0.25);
    beam.visible = false;
    head.add(beam);
  }

  const tag = nameTag(name, ranger ? "#e8c547" : "#ffffff");
  tag.position.y = 2.32;
  root.add(tag);
  const ch: Character = {
    root, head, body, upper, light, beam, tag, role, phase: 0, crouchT: 0,
    legs: legs as [THREE.Group, THREE.Group], knees: knees as [THREE.Group, THREE.Group],
    arms: arms as [THREE.Group, THREE.Group], elbows: elbows as [THREE.Group, THREE.Group],
  };
  bake(root);
  pose(ch, 0, false, 0, 0);
  return ch;
}

const baked = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

/**
 * Merges each joint's plain parts into one vertex-coloured mesh: ~50 meshes per character become
 * ~12 draw calls. Shiny, glowing or see-through parts (badge, stripe, flashlight) stay as they are.
 */
function bake(root: THREE.Object3D) {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => { if (!(o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite) groups.push(o); });
  for (const g of groups) {
    const parts = g.children.filter((o): o is THREE.Mesh => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      return !!(o as THREE.Mesh).isMesh && !!m?.isMeshStandardMaterial && !m.transparent && m.side === THREE.FrontSide
        && m.metalness === 0 && m.emissive.getHex() === 0;
    });
    if (parts.length < 2) continue;
    const geos = parts.map((p) => {
      p.updateMatrix();
      const geo = p.geometry.clone().applyMatrix4(p.matrix);
      const c = (p.material as THREE.MeshStandardMaterial).color;
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return geo;
    });
    const merged = mergeGeometries(geos.some((g) => !g.index) ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, baked);
    m.castShadow = parts.some((p) => p.castShadow);
    for (const p of parts) g.remove(p);
    g.add(m);
  }
}

function face(look: Look, skin: THREE.Material): THREE.Object3D[] {
  const white = mat("#f7f4ee", { roughness: 0.4 });
  const dark = mat("#1b1712", { roughness: 0.3 });
  const brow = mat(shade(HAIR[(look.skin * 3 + look.shirt) % HAIR.length], 0.8));
  const out: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const eye = mesh(sphere(0.03, 10, 8), white, 0.058 * side, 0.165, 0.138);
    eye.scale.set(1, 1.15, 0.55);
    const pupil = mesh(sphere(0.017, 8, 6), dark, 0.058 * side, 0.163, 0.152);
    const b = mesh(geo("brow", () => new THREE.BoxGeometry(0.055, 0.013, 0.014)), brow, 0.06 * side, 0.2, 0.142);
    b.rotation.z = -0.12 * side;
    const ear = mesh(sphere(0.035, 8, 6), skin, 0.16 * side, 0.13, 0);
    ear.scale.set(0.5, 1, 0.75);
    out.push(eye, pupil, b, ear);
  }
  out.push(mesh(sphere(0.026, 8, 6), mat(shade(SKINS[look.skin], 0.9), { roughness: 0.7 }), 0, 0.12, 0.16));
  const mouth = mesh(geo("smile", () => new THREE.TorusGeometry(0.034, 0.008, 6, 12, Math.PI)), mat("#6e2f26"), 0, 0.085, 0.146);
  mouth.rotation.z = Math.PI;
  out.push(mouth);
  return out;
}

/** Hair shows at the back and sides; with no hat, on top too, with a fringe. */
function hair(kind: Look["hat"] | "ranger", m: THREE.Material): THREE.Object3D[] {
  if (kind === "none") {
    const top = mesh(geo("hairTop", () => new THREE.SphereGeometry(0.173, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52)), m, 0, 0.15, -0.01);
    top.rotation.x = -0.32;
    top.scale.set(0.98, 1.06, 1);
    const fringe = mesh(rbox(0.2, 0.05, 0.06, 0.02), m, 0, 0.265, 0.11);
    fringe.rotation.x = 0.5;
    return [top, fringe];
  }
  const back = mesh(geo("hairBack", () => new THREE.SphereGeometry(0.171, 16, 10, Math.PI * 1.13, Math.PI * 0.74, Math.PI * 0.2, Math.PI * 0.4)), m, 0, 0.13, -0.005);
  return [back];
}

function hat(kind: Look["hat"] | "ranger", look: Look): THREE.Object3D[] {
  const hc = kind === "ranger" ? "#8a6a3e" : SHIRTS[(look.shirt + 5) % SHIRTS.length];
  const c = mat(hc);
  const dark = mat(shade(hc, 0.7));
  switch (kind) {
    case "ranger": {
      const brim = mesh(cyl(0.31, 0.31, 0.018, 28), c, 0, 0.255, 0, true);
      const band = mesh(cyl(0.158, 0.165, 0.04, 20), mat("#3b2a1a"), 0, 0.285, 0);
      const crown = mesh(cyl(0.085, 0.16, 0.17, 4), c, 0, 0.385, 0);
      crown.rotation.y = Math.PI / 4;
      return [brim, band, crown];
    }
    case "beanie": {
      const dome = mesh(geo("beanie", () => new THREE.SphereGeometry(0.178, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), c, 0, 0.215, 0, true);
      dome.scale.set(1, 1.05, 1);
      const cuff = mesh(cyl(0.176, 0.178, 0.06, 20), dark, 0, 0.255, 0);
      const pom = mesh(sphere(0.055, 10, 8), mat("#f2efe6", { roughness: 1 }), 0, 0.43, 0);
      return [dome, cuff, pom];
    }
    case "cap": {
      const dome = mesh(geo("capDome", () => new THREE.SphereGeometry(0.172, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), c, 0, 0.225, 0, true);
      const bill = mesh(geo("bill", () => new THREE.CylinderGeometry(0.15, 0.15, 0.014, 20, 1, false, -Math.PI / 2, Math.PI)), dark, 0, 0.235, 0.08);
      bill.scale.set(1, 1, 1.25);
      bill.rotation.x = 0.12;
      const button = mesh(sphere(0.018, 8, 6), dark, 0, 0.395, 0);
      return [dome, bill, button];
    }
    case "bucket": {
      const crown = mesh(cyl(0.145, 0.172, 0.13, 20), c, 0, 0.31, 0, true);
      const top = mesh(cyl(0.145, 0.145, 0.01, 20), dark, 0, 0.375, 0);
      const brim = mesh(cyl(0.18, 0.27, 0.07, 24, true), mat(hc, { side: THREE.DoubleSide }), 0, 0.235, 0);
      return [crown, top, brim];
    }
    default: return [];
  }
}

export function nameTag(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 30px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillStyle = "rgba(20, 16, 10, 0.6)";
  g.beginPath(); g.roundRect(128 - w / 2, 10, w, 44, 12); g.fill();
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

/** Pose for one frame: walk cycle from speed, crouch, head pitch. */
export function pose(ch: Character, speed: number, crouch: boolean, pitch: number, dt: number) {
  ch.phase += dt * speed * 2.6;
  const a = Math.min(1, speed / 3);
  const run = Math.min(1, Math.max(0, (speed - 3) / 3));
  const s = Math.sin(ch.phase), c = Math.cos(ch.phase);
  ch.crouchT += ((crouch ? 1 : 0) - ch.crouchT) * Math.min(1, dt * 10);
  const k = ch.crouchT, w = 1 - k;

  // Legs: hips swing, each knee folds as its leg comes forward. Crouched: hips forward, knees back,
  // feet stay planted under the hips.
  const amp = a * (0.55 + 0.2 * run);
  const sit = 1.0;
  const hip = [amp * s, -amp * s];
  const knee = [a * (0.12 + (1.0 + 0.4 * run) * Math.max(0, -c)), a * (0.12 + (1.0 + 0.4 * run) * Math.max(0, c))];
  for (let i = 0; i < 2; i++) {
    ch.legs[i].rotation.x = hip[i] * w - sit * k;
    ch.knees[i].rotation.x = knee[i] * w + 2 * sit * k;
  }
  const drop = (THIGH + SHIN) * (1 - Math.cos(sit)) * k;
  const bob = 0.035 * a * Math.abs(c) * w;
  ch.body.position.y = -drop - bob;
  ch.upper.rotation.x = 0.06 * run + 0.42 * k;

  // Arms swing against the legs, elbows a little bent; the ranger holds the light out ahead.
  const armAmp = amp * (0.75 + 0.4 * run);
  ch.arms[0].rotation.x = -armAmp * s - 0.15 * k;
  ch.elbows[0].rotation.x = -(0.2 + 0.5 * a + 0.5 * run) - 0.5 * k;
  if (ch.role === "ranger") {
    ch.arms[1].rotation.x = -0.65 + pitch * 0.6;
    ch.elbows[1].rotation.x = -0.75;
  } else {
    ch.arms[1].rotation.x = armAmp * s - 0.15 * k;
    ch.elbows[1].rotation.x = -(0.2 + 0.5 * a + 0.5 * run) - 0.5 * k;
  }
  ch.arms[0].rotation.z = -0.08;
  ch.arms[1].rotation.z = 0.08;
  ch.head.rotation.x = -pitch * 0.8 - 0.3 * k;
  ch.tag.position.y = 2.32 - 0.5 * k;
}
