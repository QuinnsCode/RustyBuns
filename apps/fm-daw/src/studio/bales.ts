// Straw bales to sit on out of doors (Desert Gathering's chill corners): two-string bales, 90 by 46 by 36 cm, the straw
// running along each one, the cut stubble at its ends, two bands of sisal twine round it. A couch seat outside is a
// row of bales on their edge with a row laid flat behind, two high, to lean on. Drawn from a seed, so everyone in the
// room sees the same straw.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { metreUV } from "./look.ts";

/** One bale's size, metres: long, high (on its edge), deep. */
export const BALE = { l: 0.9, h: 0.46, d: 0.36 } as const;

let straw: THREE.MeshStandardMaterial | null = null;
/** Golden straw: short stalks crossing mostly one way, darker gaps between them, a few green and grey ones. */
function strawMaterial(): THREE.MeshStandardMaterial {
  if (straw) return straw;
  const n = 512, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!, r = mulberry32(77);
  g.fillStyle = "#7a5f2e"; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 9000; i++) {
    const x = r() * n, y = r() * n, len = 10 + r() * 40, a = (r() - 0.5) * 0.7, tone = r();
    g.strokeStyle = tone < 0.04 ? "#7d8a52" : tone < 0.1 ? "#8f8778" : `hsl(${40 + r() * 8}, ${45 + r() * 25}%, ${48 + r() * 26}%)`;
    g.lineWidth = 0.8 + r() * 1.6; g.globalAlpha = 0.65 + r() * 0.35;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(1 / 0.45, 1 / 0.45); map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.copy(map.repeat);
  straw = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 3, roughness: 1 });
  return straw;
}

/** One bale, its long side along x, standing on the floor: on its edge (46 cm high) or laid `flat` (36 cm high). */
export function bale(seed: number, flat = false): THREE.Group {
  const r = mulberry32(seed), g = new THREE.Group(), h = flat ? BALE.d : BALE.h, d = flat ? BALE.h : BALE.d;
  // not quite square: a bale bulges a little and its corners are soft
  const geo = new THREE.BoxGeometry(BALE.l, h, d, 6, 3, 3), p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), bulge = 1 + 0.04 * (1 - (2 * x / BALE.l) ** 2);
    p.setXYZ(i, x + (r() - 0.5) * 0.01, y * bulge + (r() - 0.5) * 0.008, z * bulge + (r() - 0.5) * 0.008);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(metreUV(geo), strawMaterial());
  body.position.y = h / 2; body.castShadow = body.receiveShadow = true;
  g.add(body);
  const twine = new THREE.MeshStandardMaterial({ color: "#8a7650", roughness: 0.9 });
  for (const x of [-BALE.l * 0.25, BALE.l * 0.25]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.008, h * 1.045 + 0.004, d * 1.045 + 0.004), twine);
    band.position.set(x + (r() - 0.5) * 0.03, h / 2, 0); g.add(band);
  }
  g.rotation.y = (r() - 0.5) * 0.06;
  return g;
}

/** A seat of bales `w` wide and `d` deep: a row on their edge to sit on (their top at `seatH`), and behind it a row
 *  laid flat, two high, to lean on. Front toward -z (where you sit), as the couch it stands in for. */
export function baleSeat(w: number, d: number, seed: number): THREE.Group {
  const g = new THREE.Group(), n = Math.max(1, Math.round(w / BALE.l)), x0 = -((n - 1) * BALE.l) / 2;
  for (let i = 0; i < n; i++) {
    const seat = bale(seed + i);
    seat.position.set(x0 + i * BALE.l, 0, -d / 2 + BALE.d / 2); g.add(seat);
    for (let k = 0; k < 2; k++) {
      const back = bale(seed + 10 + i * 2 + k, true);
      back.position.set(x0 + i * BALE.l + (k ? 0.04 : 0), k * BALE.d, d / 2 - BALE.h / 2); g.add(back);
    }
  }
  return g;
}
