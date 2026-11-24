// A camper van, the kind a crew or a few friends drive out to a desert party in: a forward-control box van about 4.9 m
// long, 1.9 m wide and 2 m tall, two-tone (a colour below the belt line, cream above), a flat front with a wide
// windscreen, round headlamps, a split chrome bumper, a sliding door on the right, three windows a side, a roof rack,
// and four wheels with white hubcaps. With `awning`, a striped canvas rolled out from the left side on two poles and
// pegged down, the shade people sit under. Generic on purpose: no maker's badge or shape. Wheels on the ground at
// y = 0, centred on x and z, the nose toward +z, metres. One mesh per material slot, as the other gear is built.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { type Palette, type Piece, box, part } from "./shapes.ts";
import { piece } from "./monosynth.ts";

export const VAN_SIZE = { w: 1.9, d: 4.9, h: 2.05 } as const;
const PAINTS = ["#2f6f73", "#b2552e", "#d2a33a", "#5b7a3a", "#7a2f2f", "#3a5a8a"];

export function van(seed: number, { awning = false }: { awning?: boolean } = {}): THREE.Group {
  const rnd = mulberry32(seed), pieces: Piece[] = [];
  const W = VAN_SIZE.w, L = VAN_SIZE.d, sill = 0.38, belt = 1.12, roof = 1.95, front = L / 2, back = -L / 2;
  // ---- the body: the paint below the belt line, the cream above, every edge rounded
  pieces.push(box("paint", [W, belt - sill, L], [0, (sill + belt) / 2, 0], { bevel: 0.07 }));
  pieces.push(box("cream", [W - 0.02, roof - belt, L - 0.08], [0, (belt + roof) / 2, -0.03], { bevel: 0.12 }));
  // a bright strip along the belt line, and the sliding door's seams on the right (-x, as the driver sits on the left)
  for (const x of [-1, 1]) pieces.push(box("trim", [0.012, 0.03, L - 0.2], [x * (W / 2 + 0.002), belt, 0]));
  for (const z of [0.35, 1.55]) pieces.push(box("seam", [0.006, belt - sill + (roof - belt) * 0.85, 0.012], [-(W / 2 + 0.004), (sill + roof) / 2 - 0.08, z]));
  // ---- glass: the windscreen leaning back, three windows each side, one in the back door
  pieces.push(box("glass", [W - 0.22, 0.62, 0.02], [0, belt + 0.38, front - 0.035], { rot: [-0.12, 0, 0] }));
  for (const x of [-1, 1]) for (const [z, w] of [[1.75, 0.6], [0.75, 0.95], [-0.55, 0.95], [-1.75, 0.8]] as const)
    pieces.push(box("glass", [0.02, 0.5, w], [x * (W / 2 - 0.005), belt + 0.36, z]));
  pieces.push(box("glass", [W - 0.5, 0.5, 0.02], [0, belt + 0.36, back + 0.03]));
  // ---- the front: a panel between the lamps, round headlamps, indicators, the split bumper
  pieces.push(box("trim", [W - 0.5, 0.18, 0.02], [0, 0.78, front + 0.005], { bevel: 0.01 }));
  for (const x of [-1, 1]) {
    pieces.push(piece("lamp", new THREE.CylinderGeometry(0.085, 0.085, 0.03, 20).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(x * (W / 2 - 0.24), 0.8, front + 0.01)));
    pieces.push(piece("trim", new THREE.TorusGeometry(0.09, 0.012, 6, 20), new THREE.Matrix4().makeTranslation(x * (W / 2 - 0.24), 0.8, front + 0.015)));
    pieces.push(box("amber", [0.1, 0.05, 0.02], [x * (W / 2 - 0.1), 0.62, front + 0.01]));
    pieces.push(box("red", [0.08, 0.2, 0.02], [x * (W / 2 - 0.1), 0.7, back - 0.005]));
  }
  for (const z of [front + 0.06, back - 0.06]) for (const x of [-1, 1])
    pieces.push(box("chrome", [W / 2 - 0.05, 0.1, 0.07], [x * (W / 4 + 0.02), 0.46, z], { bevel: 0.02 }));
  // ---- under: a dark sill and the wheels in their arches
  pieces.push(box("under", [W - 0.15, 0.2, L - 0.5], [0, sill - 0.06, 0]));
  for (const z of [1.55, -1.55]) for (const x of [-1, 1]) {
    pieces.push(piece("tyre", new THREE.CylinderGeometry(0.33, 0.33, 0.21, 24).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(x * (W / 2 - 0.13), 0.33, z)));
    pieces.push(piece("hub", new THREE.CylinderGeometry(0.17, 0.18, 0.02, 20).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(x * (W / 2 - 0.02), 0.33, z)));
    pieces.push(box("under", [0.06, 0.4, 0.86], [x * (W / 2 - 0.02), sill + 0.06, z]));
  }
  // ---- the roof rack: two rails on four feet and slats across, a rolled mat and a crate up there
  for (const x of [-1, 1]) {
    pieces.push(box("rack", [0.03, 0.03, L * 0.6], [x * (W / 2 - 0.15), roof + 0.09, -0.4]));
    for (const z of [-1.7, 0.9]) pieces.push(box("rack", [0.03, 0.09, 0.03], [x * (W / 2 - 0.15), roof + 0.04, z]));
  }
  for (let i = 0; i < 6; i++) pieces.push(box("rack", [W - 0.3, 0.015, 0.03], [0, roof + 0.1, -1.7 + i * 0.52]));
  pieces.push(piece("mat", new THREE.CylinderGeometry(0.1, 0.1, 1.2, 14).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, roof + 0.21, 0.4)));
  pieces.push(box("crate", [0.5, 0.3, 0.4], [0.2, roof + 0.26, -1.1], { bevel: 0.01 }));
  // ---- the awning: rolled out from the left top edge, sloping down to two poles, its guys pegged to the ground
  if (awning) {
    const out = 2.1, len = 2.8, hi = roof - 0.05, lo = 1.75, x0 = W / 2 + 0.02;
    // the cloth in seven bands along the van, every other one the stripe colour (both faces drawn)
    const slope = Math.atan2(hi - lo, out), span = Math.hypot(out, hi - lo);
    for (let i = 0; i < 7; i++) {
      const band = new THREE.PlaneGeometry(span, len / 7).rotateX(-Math.PI / 2).rotateZ(-slope);
      pieces.push(piece(i % 2 ? "stripe" : "canvas", band, new THREE.Matrix4().makeTranslation(x0 + out / 2, (hi + lo) / 2, -0.2 - len / 2 + (i + 0.5) * (len / 7))));
    }
    // the valance: a scalloped-looking flap hanging from the outer edge, what you see of an awning from across the floor
    pieces.push(piece("stripe", new THREE.PlaneGeometry(len, 0.16).rotateY(Math.PI / 2), new THREE.Matrix4().makeTranslation(x0 + out, lo - 0.08, -0.2)));
    pieces.push(piece("rack", new THREE.CylinderGeometry(0.05, 0.05, len + 0.1, 12).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(x0, hi, -0.2)));
    for (const z of [-0.2 - len / 2 + 0.05, -0.2 + len / 2 - 0.05]) {
      pieces.push(piece("rack", new THREE.CylinderGeometry(0.015, 0.015, lo, 8), new THREE.Matrix4().makeTranslation(x0 + out, lo / 2, z)));
      // a guy rope from the pole's top out to a peg
      const a = new THREE.Vector3(x0 + out, lo, z), b = new THREE.Vector3(x0 + out + 0.9, 0.02, z + (z < -0.2 ? -0.5 : 0.5));
      const rope = new THREE.CylinderGeometry(0.004, 0.004, a.distanceTo(b), 4).translate(0, a.distanceTo(b) / 2, 0);
      rope.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      pieces.push(piece("rope", rope, new THREE.Matrix4().makeTranslation(a.x, a.y, a.z)));
    }
  }
  const paint = PAINTS[Math.floor(rnd() * PAINTS.length)]!, stripe = PAINTS[Math.floor(rnd() * PAINTS.length)]!;
  const palette: Palette = {
    paint: [paint, 0.45, 0.15], cream: ["#e9e1cc", 0.45, 0.1], trim: ["#c9ccd0", 0.3, 0.85], seam: ["#1a1a1a", 0.8, 0],
    glass: ["#0d1418", 0.08, 0.4], lamp: ["#f2eee0", 0.15, 0.2], amber: ["#d98a1a", 0.3, 0], red: ["#8a1a14", 0.3, 0],
    chrome: ["#d6d8dc", 0.15, 1], under: ["#1b1b1c", 0.9, 0.1], tyre: ["#161616", 0.95, 0], hub: ["#ece7da", 0.35, 0.3],
    rack: ["#2a2b2d", 0.5, 0.6], mat: ["#4c6b8a", 0.8, 0], crate: ["#8a6a44", 0.8, 0],
    canvas: ["#e6dcc4", 0.9, 0], stripe: [stripe, 0.9, 0], rope: ["#c8b896", 0.9, 0],
  };
  const g = part("van", pieces, palette);
  g.traverse((o) => { if (o instanceof THREE.Mesh && /canvas|stripe/.test(o.name) && o.material instanceof THREE.MeshStandardMaterial) o.material.side = THREE.DoubleSide; });
  g.userData.size = [VAN_SIZE.w, VAN_SIZE.h, VAN_SIZE.d];
  return g;
}
