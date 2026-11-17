// An avatar (@rustybuns/util/avatar, the one codeSplitter's city and the Mythic crowd wear) as a little three.js
// figure: legs, body, arms and a round head with its face drawn by drawFace. It stands, walks (legs swing), sits
// (thighs forward at seat height) and plays (forearms out over the instrument, bobbing). View only.
import * as THREE from "three";
import { drawFace, type Avatar } from "@rustybuns/util/avatar";

export interface Figure { root: THREE.Group; pose(p: { sitting: boolean; walking: number; playing: boolean; t: number }): void; dispose(): void }

const box = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.SphereGeometry(0.5, 20, 14);
const dome = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);

function faceTexture(a: Avatar): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) { g.fillStyle = a.skin; g.fillRect(0, 0, 128, 128); drawFace(g, a, 64, 64, 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A figure facing -z (as the camera does at yaw 0), its feet at the origin, about 1.7 m tall. */
export function figure(a: Avatar): Figure {
  const wide = a.build === "round" ? 1.25 : a.build === "slim" ? 0.85 : 1;
  const legLen = a.build === "tall" ? 0.95 : a.build === "short" ? 0.68 : 0.82;
  const mats: THREE.Material[] = [];
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }); mats.push(m); return m; };
  const skin = mat(a.skin), top = mat(a.topColor), bottom = mat(a.bottomColor), hair = mat(a.hairColor), shoe = mat("#1d1f23");
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.scale.set(sx, sy, sz); o.position.set(x, y, z);
    return o;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = legLen;
  root.add(hips);
  // a leg pivots at the hip: the thigh, then the shin from a knee that bends when you sit
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.x = s * 0.1 * wide;
    const thigh = mesh(box, bottom, 0.14 * wide, legLen / 2, 0.16, 0, -legLen / 4);
    const knee = new THREE.Group();
    knee.position.y = -legLen / 2;
    knee.add(mesh(box, bottom, 0.13 * wide, legLen / 2, 0.15, 0, -legLen / 4), mesh(box, shoe, 0.15 * wide, 0.08, 0.26, 0, -legLen / 2 + 0.04, -0.05));
    hip.add(thigh, knee);
    hips.add(hip);
    return { hip, knee };
  });
  const torsoH = 0.58;
  hips.add(mesh(box, top, 0.38 * wide, torsoH, 0.24 * wide, 0, torsoH / 2));
  if (a.top === "suit" || a.top === "labcoat") hips.add(mesh(box, mat(a.top === "suit" ? "#f4f5f5" : "#e8e8e8"), 0.12, torsoH * 0.6, 0.01, 0, torsoH * 0.6, -0.125 * wide));
  // an arm pivots at the shoulder; the forearm at the elbow reaches forward to play
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * (0.24 * wide), torsoH - 0.05, 0);
    shoulder.add(mesh(box, top, 0.11, 0.3, 0.12, 0, -0.15));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(mesh(box, skin, 0.09, 0.28, 0.1, 0, -0.14), mesh(ball, skin, 0.1, 0.1, 0.1, 0, -0.3));
    shoulder.add(elbow);
    hips.add(shoulder);
    return { shoulder, elbow };
  });
  const head = new THREE.Group();
  head.position.y = torsoH + 0.2;
  hips.add(head);
  const r = 0.17;
  const tex = faceTexture(a);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  mats.push(faceMat);
  // the face looks the way the figure does (-z): the sphere's texture centre turned to the front
  const headBall = mesh(ball, skin, r * 2, r * 2.1, r * 2);
  const face = mesh(new THREE.CircleGeometry(0.5, 24), faceMat, r * 1.5, r * 1.5, 1, 0, 0, -r * 0.98);
  face.rotation.y = Math.PI;
  head.add(headBall, face);
  if (a.hair !== "none") {
    head.add(mesh(dome, hair, r * 2.15, r * (a.hair === "afro" || a.hair === "curly" ? 2.8 : 1.6), r * 2.15, 0, r * 0.2, 0.01));
    if (["long", "locs", "braids", "ponytail", "bob"].includes(a.hair)) head.add(mesh(box, hair, r * 2, a.hair === "bob" ? 0.2 : 0.42, r * 0.8, 0, -0.08, r * 0.7));
    if (["mohawk", "spiky", "pompadour", "flat-top"].includes(a.hair)) head.add(mesh(box, hair, r * 0.5, 0.14, r * 1.8, 0, r * 1.1, 0));
    if (["bun", "space-buns", "topknot"].includes(a.hair)) head.add(mesh(ball, hair, 0.13, 0.13, 0.13, 0, r * 1.2, 0.04));
  }
  if (a.hat !== "none") {
    const hat = mat(a.hat === "hardhat" ? "#f4d03a" : a.hat === "halo" || a.hat === "crown" ? "#e8c34a" : a.topColor, a.hat === "halo" ? { emissive: "#e8c34a", emissiveIntensity: 0.6 } : {});
    if (a.hat === "tophat" || a.hat === "wizard" || a.hat === "party" || a.hat === "cone")
      head.add(mesh(new THREE.ConeGeometry(0.5, 1, 18, 1, a.hat === "tophat"), hat, r * 1.6, a.hat === "tophat" ? 0.22 : 0.32, r * 1.6, 0, r + 0.12));
    else if (a.hat === "halo") { const h = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.015, 8, 24), hat); h.rotation.x = Math.PI / 2; h.position.y = r + 0.1; head.add(h); }
    else if (a.hat === "headphones") head.add(mesh(box, hat, r * 2.3, 0.05, 0.05, 0, r * 0.9), mesh(ball, hat, 0.08, 0.12, 0.12, -r, 0), mesh(ball, hat, 0.08, 0.12, 0.12, r, 0));
    else head.add(mesh(dome, hat, r * 2.3, r * 1.4, r * 2.3, 0, r * 0.35));
  }
  if (a.glasses !== "none") head.add(mesh(box, mat(a.glasses === "shades" || a.glasses === "vr" ? "#16191c" : "#5a5e66"), r * 1.5, 0.05, 0.02, 0, 0.02, -r * 1.02));
  root.traverse((o) => { o.castShadow = true; });

  return {
    root,
    pose({ sitting, walking, playing, t }) {
      const swing = sitting ? 0 : Math.sin(t * 8) * 0.55 * walking;
      hips.position.y = sitting ? 0.5 : legLen;
      hips.position.z = sitting ? 0.1 : 0;
      legs.forEach(({ hip, knee }, i) => {
        hip.rotation.x = sitting ? Math.PI / 2 : (i ? swing : -swing);
        knee.rotation.x = sitting ? -Math.PI / 2 : Math.max(0, (i ? -swing : swing)) * 0.8;
      });
      const bob = playing ? Math.sin(t * 14) * 0.15 : 0;
      arms.forEach(({ shoulder, elbow }, i) => {
        shoulder.rotation.x = sitting ? 0.55 + (i ? bob : -bob) : (i ? -swing : swing) * 0.8;
        elbow.rotation.x = sitting ? 0.9 : 0.15;
      });
      head.rotation.x = playing ? -0.15 + bob * 0.3 : 0;
    },
    dispose() { tex.dispose(); for (const m of mats) m.dispose(); },
  };
}
