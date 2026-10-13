// Heads: what sits on your neck. The plain ball, or a white block with a logo on all
// four sides, drawn in ink lines like the files. A head is a row here:
//   { id, name, mark }  a monogram drawn on the block (no file needed)
//   { id, name, src }   an image, e.g. "heads/<id>.svg" in public/heads/; any square-ish logo works
//   { id, name, toy }   a toy head from characters.ts, open from the start (wins: 0) or locked until enough levels are won (src/sim/heads.ts)
// Adding one is a row and, for src, a file.

import * as THREE from "three";
import { STARTERS, UNLOCKABLE } from "../sim/heads.ts";
import { headModel, headThumbs } from "./characters.ts";
import { ballHead } from "./figure.ts";

export interface HeadDef {
  id: string;
  name: string;
  src?: string;
  mark?: { text: string; ink: string };
  /** A toy head's id in characters.ts, and the levels you must have won to wear it. */
  toy?: string;
  wins?: number;
  /** What a toy head nods to. */
  nod?: string;
}

export const HEADS: HeadDef[] = [
  { id: "ball", name: "Plain" },
  { id: "rustybuns", name: "Rusty Buns", mark: { text: "rb", ink: "#1f1f1f" } },
  { id: "codesplitter", name: "codeSplitter", mark: { text: "cs", ink: "#e8590c" } },
  ...STARTERS.map((h) => ({ id: h.id, name: h.name, toy: h.id, wins: 0, nod: h.nod })),
  ...UNLOCKABLE.map((h, i) => ({ id: h.id, name: h.name, toy: h.id, wins: i + 1, nod: h.nod })),
];

/** Whether someone who has won this many levels can wear it. */
export const isOpen = (def: HeadDef, won: number) => (def.wins ?? 0) <= won;

let thumbs: Map<string, string> | null = null;

export const headById = (id: string) => HEADS.find((h) => h.id === id) ?? HEADS[0]!;

const SIZE = 256;

/** The head's face as a square canvas: the logo, or the monogram, on white. Draws images once they load. */
export function headCanvas(def: HeadDef, onLoad?: () => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, SIZE, SIZE);
  if (def.toy) {
    // A toy head's picture, drawn once for all of them.
    thumbs ??= headThumbs([...STARTERS, ...UNLOCKABLE].map((h) => h.id), SIZE / 2);
    const img = new Image();
    img.onload = () => (g.drawImage(img, 0, 0, SIZE, SIZE), onLoad?.());
    img.src = thumbs.get(def.toy) ?? "";
  } else if (def.mark) {
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
  if (def.toy) {
    // Toy heads stand on y = 0 and are about 0.9 m wide: shrink to the ball's size and sit where it sits.
    const m = headModel(def.toy)!;
    m.scale.setScalar(0.5 * size);
    m.position.y = -0.2 * size;
    return m;
  }
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
