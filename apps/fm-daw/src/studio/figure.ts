// An eqosys avatar (@rustybuns/util/avatar) as a three.js figure: the same parts the code city and the Mythic crowd
// wear, in blocks. It stands, walks, sits, and plays (its arms move while it holds a note). Its feet are at y 0.
import * as THREE from "three";
import { drawFace, type Avatar } from "@rustybuns/util/avatar";

export interface Figure {
  group: THREE.Group;
  /** Pose it for this frame: walking `speed` m/s, sitting, playing, and `t` seconds since the page opened. */
  pose(o: { speed: number; seated: boolean; playing: boolean; t: number }): void;
  dispose(): void;
}

const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });

function faceTexture(a: Avatar): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) { g.fillStyle = a.skin; g.fillRect(0, 0, 128, 128); drawFace(g, a, 64, 66, 2.4); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTag(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 48;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "rgba(21,23,27,0.75)"; g.beginPath(); g.roundRect(0, 4, 256, 40, 12); g.fill();
    g.fillStyle = "#f4f1ea"; g.font = "600 26px 'Barlow Condensed', sans-serif"; g.textAlign = "center"; g.fillText(name.slice(0, 18), 128, 33);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.8, 0.15, 1);
  return s;
}

/** `name` null: no tag over its head (you, seen over your own shoulder, don't need yours). */
export function figure(a: Avatar, name: string | null): Figure {
  const tall = a.build === "tall" ? 1.08 : a.build === "short" ? 0.9 : 1, wide = a.build === "round" ? 1.25 : a.build === "slim" ? 0.85 : 1;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const skin = mat(a.skin), top = mat(a.topColor), bottom = mat(a.bottomColor), hair = mat(a.hairColor);
  // legs hang from the hips, so sitting swings them forward
  const hipY = 0.82 * tall;
  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.1 * wide, hipY, 0);
    const leg = box(0.13 * wide, hipY, 0.15, bottom);
    leg.position.y = -hipY / 2;
    pivot.add(leg);
    body.add(pivot);
    return pivot;
  });
  const torsoH = 0.56 * tall;
  const torso = box(0.38 * wide, torsoH, 0.22 * wide, a.top === "suit" || a.top === "labcoat" ? mat(a.top === "labcoat" ? "#f4f5f5" : a.topColor) : top);
  torso.position.y = hipY + torsoH / 2;
  body.add(torso);
  const shoulderY = hipY + torsoH - 0.05;
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * (0.19 * wide + 0.06), shoulderY, 0);
    const arm = box(0.1, 0.52 * tall, 0.11, top);
    arm.position.y = -0.26 * tall;
    const hand = box(0.09, 0.09, 0.09, skin);
    hand.position.y = -0.52 * tall;
    pivot.add(arm, hand);
    body.add(pivot);
    return pivot;
  });
  const headR = 0.16;
  const faceMap = faceTexture(a);
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), [skin]);
  head.position.y = shoulderY + 0.07 + headR;
  // the face is a disc on the front of the head (the -z side: a figure faces -z, as the camera does)
  const face = new THREE.Mesh(new THREE.CircleGeometry(headR * 0.86, 24), new THREE.MeshStandardMaterial({ map: faceMap, roughness: 0.8 }));
  face.position.set(0, 0, -headR * 0.93);
  face.rotation.y = Math.PI;
  head.add(face);
  if (a.hair !== "none") {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.06, 20, 12, 0, Math.PI * 2, 0, a.hair === "buzz" ? 1.1 : 1.5), hair);
    cap.rotation.x = 0.35;
    head.add(cap);
    if (a.hair === "long" || a.hair === "ponytail" || a.hair === "braids" || a.hair === "locs") {
      const back = box(headR * 1.6, headR * 2.2, 0.06, hair);
      back.position.set(0, -headR * 0.7, headR * 0.85);
      head.add(back);
    }
    if (a.hair === "afro" || a.hair === "curly") cap.scale.setScalar(1.35);
    if (a.hair === "mohawk" || a.hair === "spiky") { const fin = box(0.05, 0.12, headR * 2, hair); fin.position.y = headR * 1.05; head.add(fin); }
  }
  if (a.hat !== "none") {
    const hatMat = mat(a.hat === "hardhat" ? "#f4d03a" : a.hat === "halo" || a.hat === "crown" ? "#e8c24a" : a.topColor);
    let hat: THREE.Object3D;
    if (a.hat === "tophat") hat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 16), hatMat);
    else if (a.hat === "wizard" || a.hat === "party" || a.hat === "cone") hat = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 16), hatMat);
    else if (a.hat === "halo") { hat = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 8, 24), hatMat); hat.rotation.x = Math.PI / 2; hat.position.y = 0.06; }
    else if (a.hat === "headphones") hat = new THREE.Mesh(new THREE.TorusGeometry(headR * 1.08, 0.02, 8, 24, Math.PI), mat("#16191c"));
    else hat = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.1, 16, 8, 0, Math.PI * 2, 0, 1.3), hatMat);
    hat.position.y += headR * (a.hat === "headphones" ? 0 : 0.95);
    head.add(hat);
  }
  if (a.glasses !== "none") {
    const g = box(headR * 1.5, 0.045, 0.02, mat(a.glasses === "shades" || a.glasses === "vr" ? "#16191c" : "#8a8f94"));
    g.position.set(0, headR * 0.12, -headR * 0.98);
    head.add(g);
  }
  body.add(head);
  const tag = name === null ? null : nameTag(name || "Someone");
  if (tag) { tag.position.y = head.position.y + headR + 0.25; group.add(tag); }

  return {
    group,
    pose({ speed, seated, playing, t }) {
      const swing = seated ? 0 : Math.sin(t * 8) * Math.min(1, speed / 1.5) * 0.6;
      body.position.y = seated ? -(hipY - 0.48) : 0;
      for (const [i, l] of legs.entries()) l.rotation.x = seated ? Math.PI / 2 - 0.15 : (i ? swing : -swing);
      for (const [i, arm] of arms.entries()) {
        // playing: hands out over the instrument, tapping; walking: swinging; sitting: resting on the knees
        arm.rotation.x = playing ? 1.1 + Math.sin(t * 14 + i * 1.7) * 0.18 : seated ? 0.5 : i ? -swing : swing;
      }
      body.rotation.x = seated ? 0.05 : 0;
    },
    dispose() {
      group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of [o.material].flat()) m.dispose(); } });
      faceMap.dispose();
      tag?.material.map?.dispose(); tag?.material.dispose();
    },
  };
}
