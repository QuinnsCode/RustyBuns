// Heads: what sits on your neck. The plain ball, or a white block with a logo on all
// four sides, drawn in ink lines like the files. A head is a row here:
//   { id, name, mark }  a monogram drawn on the block (no file needed)
//   { id, name, src }   an image, e.g. "heads/<id>.svg" in public/heads/; any square-ish logo works
// Adding one is a row and, for src, a file.

import * as THREE from "three";
import { ballHead } from "./figure.ts";

export interface HeadDef {
  id: string;
  name: string;
  src?: string;
  mark?: { text: string; ink: string };
}

export const HEADS: HeadDef[] = [
  { id: "ball", name: "Plain" },
  { id: "rustybuns", name: "Rusty Buns", mark: { text: "rb", ink: "#1f1f1f" } },
  { id: "codesplitter", name: "codeSplitter", mark: { text: "cs", ink: "#e8590c" } },
];

export const headById = (id: string) => HEADS.find((h) => h.id === id) ?? HEADS[0]!;

const SIZE = 256;

/** The head's face as a square canvas: the logo, or the monogram, on white. Draws images once they load. */
export function headCanvas(def: HeadDef, onLoad?: () => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, SIZE, SIZE);
  if (def.mark) {
    g.fillStyle = def.mark.ink;
    g.font = "700 120px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(def.mark.text, SIZE / 2, SIZE / 2 + 6, SIZE * 0.8);
  } else if (def.src) {
    const img = new Image();
    img.onload = () => {
      // Fit inside a margin, keeping its shape.
      const pad = SIZE * 0.14, room = SIZE - 2 * pad, k = Math.min(room / img.width, room / img.height);
      const w = img.width * k, h = img.height * k;
      g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      onLoad?.();
    };
    img.src = def.src;
  } else {
    // The plain ball, as a tile: a black dot.
    g.fillStyle = "#1f1f1f";
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** A head to put on a figure (see setHead in figure.ts). `mat` is the body's, for the plain ball. */
export function buildHead(def: HeadDef, mat: THREE.Material, size = 1): THREE.Object3D {
  if (!def.mark && !def.src) return ballHead(mat, size);
  const tex = new THREE.CanvasTexture(headCanvas(def, () => (tex.needsUpdate = true)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshLambertMaterial({ map: tex }), plain = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const s = 0.44 * size, geo = new THREE.BoxGeometry(s, s, s);
  // Box faces: +x, -x, +y, -y, +z, -z. The logo on the four sides, plain on top and bottom.
  const m = new THREE.Mesh(geo, [face, face, plain, plain, face, face]);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1f1f1f })));
  m.position.y = s * 0.12;
  m.castShadow = true;
  return m;
}
