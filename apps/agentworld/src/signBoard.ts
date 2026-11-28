// The sign standing on a plot in the 3D galaxy (land3d.ts): two posts and a wooden board with the owner's pen strokes
// burnt into it. Built here from checked strokes only (sign.ts); no name on it.
import * as THREE from "three";
import { PAD, type Point } from "./sign.ts";
import { scrawl } from "./signPad.ts";

const WIDE = 22, HIGH = WIDE * (PAD.h / PAD.w), LEG = 5;

export function signBoard(strokes: readonly Point[][]): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = PAD.w; canvas.height = PAD.h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#d9a866"; g.fillRect(0, 0, PAD.w, PAD.h);
  // Grain.
  g.strokeStyle = "rgba(110,66,28,.35)"; g.lineWidth = 3;
  for (let y = 20; y < PAD.h; y += 34) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(200, y - 14, 380, y + 16, PAD.w, y - 4); g.stroke(); }
  scrawl(g, strokes, 11, "#3b1f0c");
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  const wood = (color: string) => new THREE.MeshStandardMaterial({ color, flatShading: true });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    group.add(m);
  };
  const up = LEG + HIGH / 2;
  // The posts reach a little into the ground, so a slope doesn't leave one in the air.
  for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.55, 0.65, up + 3, 8), wood("#6a4428"), side * WIDE * 0.4, up / 2 - 1.5, -0.8);
  add(new THREE.BoxGeometry(WIDE + 1.4, HIGH + 1.4, 1), wood("#7a4a24"), 0, up, -0.6);
  add(new THREE.PlaneGeometry(WIDE, HIGH), new THREE.MeshBasicMaterial({ map, fog: false }), 0, up, 0);
  return group;
}
