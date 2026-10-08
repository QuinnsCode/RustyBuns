// Campers and rangers, built from primitives so there's nothing to download.
// A camper wears their Look; a ranger wears the flat hat and carries a flashlight.

import * as THREE from "three";
import { PANTS, SHIRTS, SKINS, type Look } from "../hunt/game.ts";
import type { Role } from "../hunt/sim.ts";

export interface Character {
  root: THREE.Group;
  /** Turns with the pitch: the head and the flashlight. */
  head: THREE.Group;
  legs: [THREE.Object3D, THREE.Object3D];
  arms: [THREE.Object3D, THREE.Object3D];
  body: THREE.Group;
  light: THREE.SpotLight | null;
  beam: THREE.Mesh | null;
  tag: THREE.Sprite;
  role: Role;
  /** Walk cycle phase. */
  phase: number;
}

const mat = (color: string | number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });

function box(w: number, h: number, d: number, m: THREE.Material, y = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.y = y;
  g.castShadow = true;
  return g;
}

export function makeCharacter(role: Role, look: Look, name: string): Character {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const ranger = role === "ranger";
  const shirt = mat(ranger ? "#b8a275" : SHIRTS[look.shirt]);
  const pants = mat(ranger ? "#4c5b3a" : PANTS[look.pants]);
  const skin = mat(SKINS[look.skin]);
  const boots = mat("#3a2a1c");

  // Legs swing from the hips.
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0.9, 0);
    const leg = box(0.17, 0.82, 0.2, pants, -0.41);
    const boot = box(0.19, 0.12, 0.3, boots, -0.84);
    boot.position.z = 0.04;
    hip.add(leg, boot);
    body.add(hip);
    legs.push(hip);
  }
  const torso = box(0.46, 0.62, 0.26, shirt, 1.22);
  body.add(torso);
  if (ranger) {
    // Badge and a reflective stripe: rangers are easy to spot (on purpose).
    const badge = box(0.08, 0.1, 0.02, mat("#e8c547", { metalness: 0.6, roughness: 0.3 }), 1.36);
    badge.position.set(-0.12, 1.36, 0.14);
    const stripe = box(0.47, 0.06, 0.27, mat("#d8ff3a", { emissive: "#556600" }), 1.05);
    body.add(badge, stripe);
  } else if (look.pack) {
    const pack = box(0.36, 0.48, 0.2, mat(SHIRTS[(look.shirt + 3) % SHIRTS.length]), 1.25);
    pack.position.z = -0.23;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10), mat("#5a6b3a"));
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.53, -0.23);
    body.add(pack, roll);
  }
  const arms: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.31 * side, 1.5, 0);
    shoulder.add(box(0.13, 0.58, 0.15, shirt, -0.27));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
    hand.position.y = -0.6;
    shoulder.add(hand);
    body.add(shoulder);
    arms.push(shoulder);
  }

  const head = new THREE.Group();
  head.position.y = 1.62;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin);
  skull.position.y = 0.1;
  skull.castShadow = true;
  head.add(skull);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), mat("#1d1d1d"));
    eye.position.set(0.055 * side, 0.13, 0.135);
    head.add(eye);
  }
  head.add(...hat(ranger ? "ranger" : look.hat, look));
  body.add(head);

  // The flashlight: a real spotlight plus a faint cone so others see the beam.
  let light: THREE.SpotLight | null = null, beam: THREE.Mesh | null = null;
  if (ranger) {
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8), mat("#222"));
    torch.rotation.x = Math.PI / 2;
    torch.position.set(0.31, 1.0, 0.2);
    body.add(torch);
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
  tag.position.y = 2.25;
  root.add(tag);
  return { root, head, legs: legs as [THREE.Object3D, THREE.Object3D], arms: arms as [THREE.Object3D, THREE.Object3D], body, light, beam, tag, role, phase: 0 };
}

function hat(kind: Look["hat"] | "ranger", look: Look): THREE.Object3D[] {
  const c = mat(kind === "ranger" ? "#8a6a3e" : SHIRTS[(look.shirt + 5) % SHIRTS.length]);
  switch (kind) {
    case "ranger": {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20), c);
      brim.position.y = 0.19;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.16, 4), c);
      crown.position.y = 0.28;
      crown.rotation.y = Math.PI / 4;
      return [brim, crown];
    }
    case "beanie": {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), c);
      b.position.y = 0.13;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat("#f2efe6"));
      pom.position.y = 0.3;
      return [b, pom];
    }
    case "cap": {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), c);
      b.position.y = 0.14;
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.14), c);
      peak.position.set(0, 0.15, 0.17);
      return [b, peak];
    }
    case "bucket": {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.13, 14), c);
      b.position.y = 0.24;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.015, 18), c);
      brim.position.y = 0.18;
      return [b, brim];
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
  const swing = Math.min(1, speed / 3) * 0.7 * Math.sin(ch.phase);
  ch.legs[0].rotation.x = swing;
  ch.legs[1].rotation.x = -swing;
  ch.arms[0].rotation.x = -swing * 0.8;
  ch.arms[1].rotation.x = ch.role === "ranger" ? -0.9 + pitch * 0.5 : swing * 0.8;
  const target = crouch ? 0.45 : 0;
  ch.body.position.y += (-target - ch.body.position.y) * Math.min(1, dt * 10);
  ch.body.rotation.x += ((crouch ? 0.35 : 0) - ch.body.rotation.x) * Math.min(1, dt * 10);
  ch.head.rotation.x = -pitch * 0.8;
  ch.tag.position.y = crouch ? 1.75 : 2.25;
}
