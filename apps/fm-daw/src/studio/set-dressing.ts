// The set dressing props.ts hands on: an office's clutter (a desk with its screen, papers and mugs, the edge of a
// cubicle, books stacked on the floor, cables across it, what's left on a desk, a filing cabinet) and a TV sound
// stage's (a riser the band stands on, the lighting grid, bleachers, a camera on its pedestal, a floor wedge, a
// painted cyc, a flat with the city at night through it). Mobile first: the small parts of a prop share one
// instanced draw (`many`), cables are one merged tube, so a crowded corner costs a handful of draws, not hundreds.
// Same frame as props.ts: the front faces -z before the yaw turns it, w across, d deep, h tall.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Prop } from "./room.ts";

/** A small part for `many`: [w, h, d, x, y, z, colour, turn about y]. */
export type Item = [number, number, number, number, number, number, string, number?];
/** What props.ts builds a prop with: its group, materials by name, its seeded randomness and the shape helpers. */
export interface Kit {
  g: THREE.Group;
  m: (name: string, color: string) => THREE.Material;
  rnd: () => number;
  pick: <T>(xs: readonly T[]) => T;
  box: (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => THREE.Mesh;
  cyl: (r: number, h: number, x: number, y: number, z: number, material: THREE.Material, seg?: number) => THREE.Mesh;
  glow: <T extends THREE.Object3D>(o: T, k: number) => T;
  many: (name: string, items: Item[], k?: number, shape?: "box" | "cyl" | "ball") => void;
}

const PAPER = ["#f4f1ea", "#ece8dc", "#f8f6f0", "#e8e0c8", "#f0e6a0"];
const MUGS = ["#f2efe8", "#2f4a6b", "#b8562e", "#1f2428", "#3e5a3a", "#d8b040", "#8a2a2a"];
const COVERS = ["#7a2e2a", "#2f4a6b", "#c9b27a", "#3e5a3a", "#8a6a3a", "#d8d2c4", "#4a3a5c", "#b8562e", "#1f2428"];

/** Small lit parts in one draw, each its own colour at full strength (a lens, a lit window, an aisle light): unlit, so
 * the look's glow pass, which lights a material in one colour, leaves them be. */
function lit(g: THREE.Group, items: Item[], shape: "box" | "cyl" = "box") {
  if (!items.length) return;
  const geo = shape === "cyl" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 14) : new THREE.BoxGeometry(1, 1, 1);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#ffffff" }), items.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  items.forEach(([w, h, d, x, y, z, col, turn], i) => {
    o.position.set(x, y, z); o.rotation.set(0, turn ?? 0, 0); o.scale.set(w, h, d); o.updateMatrix();
    im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(col));
  });
  im.userData.lit = true;
  g.add(im);
}

/** A turn of up to `k` radians either way. */
const jig = (rnd: () => number, k: number) => (rnd() - 0.5) * 2 * k;

/** Paper on a surface at height `y`: a few stacks of sheets, each a little askew, sometimes a folder under them. */
function papers(k: Kit, items: Item[], x: number, z: number, y: number, n: number) {
  let top = y;
  if (k.rnd() < 0.4) { items.push([0.24, 0.004, 0.31, x, top + 0.002, z, "#c8a870", jig(k.rnd, 0.2)]); top += 0.004; }
  for (let i = 0; i < n; i++, top += 0.0016) items.push([0.21, 0.0016, 0.297, x + jig(k.rnd, 0.015), top + 0.0008, z + jig(k.rnd, 0.015), k.pick(PAPER), jig(k.rnd, 0.25)]);
}
/** A mug at (x, z) on a surface at `y`: the cup (into `cups`, cylinders) and its handle (into `bits`, boxes). */
function mug(k: Kit, cups: Item[], bits: Item[], x: number, z: number, y: number) {
  const c = k.pick(MUGS), a = k.rnd() * Math.PI * 2;
  cups.push([0.082, 0.095, 0.082, x, y + 0.0475, z, c]);
  bits.push([0.012, 0.06, 0.04, x + Math.cos(a) * 0.05, y + 0.05, z - Math.sin(a) * 0.05, c, a]);
  bits.push([0.07, 0.003, 0.07, x, y + 0.093, z, "#2a1a10"]);   // coffee, nearly to the brim
}
/** A pile of books lying flat at (x, z) from height `y`, each turned a little: n of them. */
function pile(k: Kit, items: Item[], x: number, z: number, y: number, n: number) {
  let top = y;
  for (let i = 0; i < n; i++) {
    const bw = 0.15 + k.rnd() * 0.1, bd = 0.21 + k.rnd() * 0.08, bh = 0.02 + k.rnd() * 0.035;
    items.push([bw, bh, bd, x + jig(k.rnd, 0.02), top + bh / 2, z + jig(k.rnd, 0.02), k.pick(COVERS), jig(k.rnd, 0.35)]);
    top += bh;
  }
  return top;
}
/** Tubes along each run of points, merged into one mesh. */
function tubes(runs: THREE.Vector3[][], r: number, material: THREE.Material): THREE.Mesh | null {
  const geos = runs.filter((p) => p.length > 1).map((p) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), p.length * 6, r, 5));
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  for (const x of geos) x.dispose();
  return merged ? new THREE.Mesh(merged, material) : null;
}
/** A cable lying on the floor from a to b, wandering a little, with a loose coil of slack somewhere along it. */
function floorRun(k: Kit, a: [number, number], b: [number, number], y = 0.008, wander = 0.12): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [], n = 7, coil = 2 + Math.floor(k.rnd() * 3);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, off = i === 0 || i === n ? 0 : jig(k.rnd, wander);
    // across the run, so the cable snakes rather than stretches
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    pts.push(new THREE.Vector3(x + nx * off, y, z + nz * off));
    if (i === coil) for (let j = 1; j <= 8; j++) {
      const q = (j / 8) * Math.PI * 2, rr = 0.13;
      pts.push(new THREE.Vector3(x + nx * off + Math.sin(q) * rr, y + 0.006 * (j % 2), z + nz * off + (1 - Math.cos(q)) * rr));
    }
  }
  return pts;
}

/** An office chair: five-star base, the gas lift, a seat and a back, turned `turn` and standing at (x, z). */
function chair(k: Kit, x: number, z: number, turn: number, color: string) {
  const c = new THREE.Group(), black = k.m("plastic", "#1c1c1e"), cloth = k.m("fabric", color);
  c.position.set(x, 0, z); c.rotation.y = turn;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.04), black);
    leg.position.set(Math.cos(a) * 0.15, 0.06, -Math.sin(a) * 0.15); leg.rotation.y = a; c.add(leg);
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), black);
    wheel.position.set(Math.cos(a) * 0.29, 0.025, -Math.sin(a) * 0.29); c.add(wheel);
  }
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.36, 10), k.m("chrome", "#9a9ca0"));
  lift.position.y = 0.25; c.add(lift);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.46), cloth);
  seat.position.y = 0.47; c.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.06), cloth);
  back.position.set(0, 0.8, 0.24); back.rotation.x = -0.12; c.add(back);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.03), black);
  spine.position.set(0, 0.55, 0.25); c.add(spine);
  k.g.add(c);
}

/** A gradient painted top to bottom, as a texture three.js can use anywhere (no canvas: tests build props too). */
function gradient(stops: [number, string][]): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * 4), c = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let j = 0;
    while (j < stops.length - 2 && stops[j + 1]![0] < t) j++;
    const [t0, c0] = stops[j]!, [t1, c1] = stops[j + 1]!;
    c.copy(a.set(c0)).lerp(b.set(c1), Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1))));
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, 1, n);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
/** A painted backdrop that holds its own colour under the stage lights: the gradient as both paint and glow. */
const backdrop = (tex: THREE.Texture, glow: number) => new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: glow, roughness: 0.95 });

/** Build a kind props.ts doesn't, into the kit's group. */
export function dressing(p: Prop, k: Kit) {
  const { g, m, rnd, pick, box, cyl, glow, many } = k, { w, d, h, color } = p;
  switch (p.kind) {
    case "officeDesk": {
      // a work desk: a laminate top, a drawer pedestal on the right, legs and a modesty panel; the screen on the back
      // half, the keyboard and mouse at the front (-z, where you sit), paper, mugs, a pen cup, books, sticky notes
      const top = m("wood", color), steel = m("metal", "#3a3c40"), t = 0.03, ped = Math.min(0.42, w * 0.3);
      box(w, t, d, 0, h - t / 2, 0, top);
      box(ped, h - t - 0.02, d - 0.06, w / 2 - ped / 2 - 0.02, (h - t) / 2 + 0.01, 0.01, m("metal", "#6a6c70"));
      const bits: Item[] = [], cups: Item[] = [], sheets: Item[] = [], keys: Item[] = [];
      for (let i = 0; i < 3; i++) {
        const fh = (h - t - 0.06) / 3;
        bits.push([ped - 0.03, fh - 0.015, 0.01, w / 2 - ped / 2 - 0.02, 0.04 + fh * (i + 0.5), -d / 2 + 0.035, "#7a7c80"]);
        bits.push([0.1, 0.012, 0.02, w / 2 - ped / 2 - 0.02, 0.04 + fh * (i + 0.8), -d / 2 + 0.025, "#c8c8cc"]);
      }
      for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) box(0.04, h - t, 0.04, -w / 2 + 0.04, (h - t) / 2, z, steel);
      box(w - ped - 0.1, 0.4, 0.015, -ped / 2, h - t - 0.22, d / 2 - 0.04, steel);
      // the screen: a foot, a neck and the panel, lit, its back dark; sticky notes round the bezel
      const sx = jig(rnd, w * 0.12), sz = d * 0.18, sw = Math.min(0.62, w * 0.42), sh = sw * 0.58;
      box(0.22, 0.012, 0.17, sx, h + 0.006, sz + 0.04, steel);
      box(0.04, 0.16, 0.03, sx, h + 0.09, sz + 0.06, steel);
      box(sw, sh, 0.035, sx, h + 0.16 + sh / 2, sz, m("plastic", "#151618"));
      g.add(glow(box(sw - 0.03, sh - 0.03, 0.004, sx, h + 0.16 + sh / 2, sz - 0.019, m("screen", pick(["#9ec4e8", "#d8e4f0", "#a8d8b0", "#e8d8b0"]))), 0.45));
      for (let i = 0, n = 1 + Math.floor(rnd() * 4); i < n; i++) bits.push([0.065, 0.065, 0.002, sx + (rnd() < 0.5 ? -1 : 1) * (sw / 2 - 0.02), h + 0.17 + rnd() * sh, sz - 0.019, pick(["#f4e060", "#f4a0b8", "#a0e0f0"]), jig(rnd, 0.1)]);
      // the keyboard's keys as one draw, the mouse beside it
      const kx = sx + jig(rnd, 0.05), kz = -d * 0.22;
      bits.push([0.44, 0.018, 0.14, kx, h + 0.009, kz, "#202124"]);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) keys.push([0.024, 0.008, 0.022, kx - 0.19 + c * 0.027, h + 0.021, kz - 0.05 + r * 0.025, r === 4 && c > 4 && c < 10 ? "#2a2b2e" : "#3a3b3e"]);
      bits.push([0.06, 0.03, 0.1, kx + 0.32, h + 0.015, kz + 0.01, "#202124", jig(rnd, 0.3)]);
      // paper, mugs, a pen cup, a pile of books, all where they'd be left
      papers(k, sheets, -w / 2 + 0.2 + rnd() * 0.1, -d * 0.05, h, 4 + Math.floor(rnd() * 10));
      if (w > 1.1) papers(k, sheets, w / 2 - 0.25, d * 0.15, h, 2 + Math.floor(rnd() * 6));
      mug(k, cups, bits, kx + 0.34 + rnd() * 0.08, -d * 0.05 + jig(rnd, 0.06), h);
      if (rnd() < 0.5) mug(k, cups, bits, -w / 2 + 0.12, d * 0.3, h);
      cups.push([0.075, 0.11, 0.075, w / 2 - 0.12, h + 0.055, d * 0.33, "#2a2a2c"]);
      for (let i = 0; i < 4; i++) cups.push([0.008, 0.15, 0.008, w / 2 - 0.12 + jig(rnd, 0.02), h + 0.1, d * 0.33 + jig(rnd, 0.02), pick(["#1a3a8a", "#c82a2a", "#1a1a1a", "#e0b02a"])]);
      if (rnd() < 0.7) pile(k, bits, -w / 2 + 0.18, d * 0.28, h, 2 + Math.floor(rnd() * 4));
      many("plastic", bits); many("plastic", keys); many("plastic", cups, 0, "cyl"); many("fabric", sheets);
      // the chair, pushed back and left at an angle
      chair(k, kx + jig(rnd, 0.15), -d / 2 - 0.32 - rnd() * 0.15, Math.PI + jig(rnd, 0.6), pick(["#2a3440", "#3a2a2a", "#2a2a2c"]));
      break;
    }
    case "cubicle": {
      // a cubicle's edge: a fabric panel on a steel frame, aluminium caps, papers and a calendar pinned up on its front
      const cloth = m("fabric", color), trim = m("metal", "#a8aaae");
      box(w, h - 0.04, d, 0, (h - 0.04) / 2 + 0.02, 0, cloth);
      box(w + 0.01, 0.025, d + 0.012, 0, h, 0, trim);
      for (const x of [-w / 2, w / 2]) box(0.03, h, d + 0.014, x, h / 2, 0, trim);
      box(w, 0.06, d + 0.01, 0, 0.03, 0, m("metal", "#3a3c40"));
      const pinned: Item[] = [];
      for (let i = 0, n = Math.max(2, Math.round(w * 3)); i < n; i++) {
        const big = rnd() < 0.3, pw = big ? 0.3 : 0.21, ph = big ? 0.42 : 0.297;
        pinned.push([pw, ph, 0.002, -w / 2 + 0.15 + rnd() * (w - 0.3), h * 0.45 + rnd() * h * 0.35, -d / 2 - 0.003 - i * 0.0004, pick(PAPER)]);
        pinned.push([0.012, 0.012, 0.006, pinned.at(-1)![3], pinned.at(-1)![4] + ph / 2 - 0.02, -d / 2 - 0.006, pick(["#d03020", "#2050c0", "#e0c020"])]);
      }
      many("fabric", pinned);
      break;
    }
    case "books": {
      // books stacked on the floor: a pile or two, more than anyone will read
      const items: Item[] = [], n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) pile(k, items, -w / 2 + (i + 0.5) * (w / n), jig(rnd, d * 0.2), 0, Math.max(3, Math.round(h / 0.03 * (0.6 + rnd() * 0.4))));
      many("fabric", items);
      break;
    }
    case "cables": {
      // cables across the floor from -x to +x, each wandering and coiled once: a few in black, one in a colour
      const n = 3 + Math.floor(rnd() * 3), runs: THREE.Vector3[][] = [], odd: THREE.Vector3[][] = [];
      for (let i = 0; i < n; i++) {
        const z0 = jig(rnd, d / 2), z1 = jig(rnd, d / 2);
        (i === 0 ? odd : runs).push(floorRun(k, [-w / 2, z0], [w / 2, z1], 0.008 + i * 0.002, d * 0.25));
      }
      for (const [run, col] of [[runs, "#141416"], [odd, color]] as const) { const o = tubes(run, 0.007, m("rubber", col)); if (o) g.add(o); }
      break;
    }
    case "clutter": {
      // what's left on a surface: papers, a mug or two, a notebook, a bottle of water, a pile of books
      const sheets: Item[] = [], cups: Item[] = [], bits: Item[] = [];
      const spot = () => [jig(rnd, w / 2 - 0.12), jig(rnd, d / 2 - 0.1)] as const;
      for (let i = 0, n = 1 + Math.floor(rnd() * 2); i < n; i++) { const [x, z] = spot(); papers(k, sheets, x, z, 0, 2 + Math.floor(rnd() * 8)); }
      for (let i = 0, n = 1 + Math.floor(rnd() * 2); i < n; i++) { const [x, z] = spot(); mug(k, cups, bits, x, z, 0); }
      if (rnd() < 0.6) { const [x, z] = spot(); bits.push([0.15, 0.015, 0.21, x, 0.0075, z, pick(COVERS), jig(rnd, 0.5)]); }
      if (rnd() < 0.5) { const [x, z] = spot(); cups.push([0.065, 0.22, 0.065, x, 0.11, z, "#a8c8d8"]); cups.push([0.03, 0.02, 0.03, x, 0.23, z, "#2050a0"]); }
      if (rnd() < 0.4) { const [x, z] = spot(); pile(k, bits, x, z, 0, 2 + Math.floor(rnd() * 3)); }
      many("fabric", sheets); many("plastic", bits); many("plastic", cups, 0, "cyl");
      break;
    }
    case "cabinet": {
      // a steel filing cabinet: a drawer every 32 cm, each with a handle and a label, binders and a box on top
      const steel = m("metal", color), n = Math.max(2, Math.round(h / 0.32)), fh = (h - 0.04) / n, bits: Item[] = [];
      box(w, h, d, 0, h / 2, 0, steel);
      for (let i = 0; i < n; i++) {
        const y = 0.02 + fh * (i + 0.5);
        bits.push([w - 0.03, fh - 0.012, 0.012, 0, y, -d / 2 - 0.006, color]);
        bits.push([0.14, 0.02, 0.025, 0, y + fh * 0.18, -d / 2 - 0.018, "#c8c8cc"]);
        bits.push([0.08, 0.035, 0.004, 0, y + fh * 0.32, -d / 2 - 0.014, "#f4f1ea"]);
      }
      for (let x = -w / 2 + 0.04; x < w * 0.15; x += 0.055) bits.push([0.05, 0.3, 0.26, x, h + 0.15, jig(rnd, 0.02), pick(["#2f4a6b", "#7a2e2a", "#1f2428", "#3e5a3a"]), jig(rnd, 0.06)]);
      if (rnd() < 0.7) bits.push([w * 0.4, 0.16, d * 0.6, w * 0.27, h + 0.08, 0, "#a88a5a", jig(rnd, 0.3)]);
      many("plastic", bits);
      break;
    }
    case "riser": {
      // a band riser: a deck standing h high (from y), black skirt pleated down its faces, a lit strip along its
      // front edge, spike tape where the band's gear goes, and two steps up at the right end of the front
      const deck = m("wood", "#2a2826"), frame = m("metal", "#18181a");
      box(w, 0.025, d, 0, h - 0.0125, 0, deck);
      box(w - 0.04, h - 0.025, d - 0.04, 0, (h - 0.025) / 2, 0, frame);
      const pleats: Item[] = [], tape: Item[] = [];
      for (let x = -w / 2 + 0.04; x < w / 2; x += 0.08) pleats.push([0.06, h - 0.04, 0.02, x, (h - 0.04) / 2, -d / 2 - 0.004 + (Math.round(x / 0.08) % 2) * 0.008, color]);
      for (const sx of [-1, 1]) for (let z = -d / 2 + 0.04; z < d / 2; z += 0.08) pleats.push([0.02, h - 0.04, 0.06, sx * (w / 2 + 0.004 - (Math.round(z / 0.08) % 2) * 0.008), (h - 0.04) / 2, z, color]);
      g.add(glow(box(w - 0.04, 0.018, 0.012, 0, h - 0.035, -d / 2 - 0.012, m("screen", "#bcd8ff")), 0.9));
      for (let i = 0, n = 6 + Math.floor(rnd() * 6); i < n; i++) {
        const x = jig(rnd, w / 2 - 0.3), z = jig(rnd, d / 2 - 0.3), c = pick(["#f0e8d0", "#e8c030", "#40c0e0", "#e05080"]);
        tape.push([0.1, 0.002, 0.025, x, h + 0.001, z, c]); tape.push([0.025, 0.002, 0.1, x - 0.0375, h + 0.001, z + 0.0375, c]);
      }
      many("fabric", pleats); many("plastic", tape);
      for (let i = 1; i <= 2; i++) box(0.9, h * i / 3, 0.3, w / 2 - 0.6, h * i / 6, -d / 2 - 0.15 - (2 - i) * 0.3, deck);
      break;
    }
    case "grid": {
      // the lighting grid: pipes across the stage on a frame, fixtures hung along them, yokes down and lenses lit,
      // a few colours the way a late-night set is lit; a safety cable on each; the whole of it hangs at y
      const pipe: Item[] = [], cans: Item[] = [], lens: Item[] = [], yokes: Item[] = [];
      const rows = Math.max(2, Math.round(d / 1.5)), gap = d / rows, palette = ["#ffd8a0", "#ffd8a0", "#a8c8ff", "#ff6ab0", "#8a60ff", "#ffffff"];
      for (let r = 0; r <= rows; r++) pipe.push([w, 0.05, 0.05, 0, 0, -d / 2 + r * gap, "#2a2a2c"]);
      for (const x of [-w / 2, -w / 6, w / 6, w / 2]) pipe.push([0.05, 0.05, d, x, 0.03, 0, "#2a2a2c"]);
      for (let r = 0; r <= rows; r++) for (let x = -w / 2 + 0.6; x < w / 2 - 0.3; x += 0.9 + rnd() * 0.6) {
        const z = -d / 2 + r * gap, c = pick(palette), long = rnd() < 0.5;
        yokes.push([0.26, 0.03, 0.03, x, -0.08, z, "#1a1a1c"]);
        for (const s of [-1, 1]) yokes.push([0.02, 0.22, 0.03, x + s * 0.13, -0.19, z, "#1a1a1c"]);
        cans.push([0.2, long ? 0.42 : 0.3, 0.2, x, -0.3, z, "#202022"]);
        lens.push([0.17, 0.012, 0.17, x, long ? -0.515 : -0.455, z, c]);
      }
      many("metal", pipe); many("metal", yokes); many("metal", cans, 0, "cyl"); lit(g, lens, "cyl");
      break;
    }
    case "bleachers": {
      // tiers of seats rising toward the back (+z), the audience's: a step each row, a row of seats on it, an aisle
      // down the middle lit on every riser, and a rail along both ends
      const rows = Math.max(2, Math.round(d / 0.8)), rise = h / rows, run = d / rows, tier = m("concrete", color);
      for (let i = 0; i < rows; i++) box(w, rise * (i + 1), run, 0, rise * (i + 1) / 2, -d / 2 + run * (i + 0.5), tier);
      const seats: Item[] = [], backs: Item[] = [], lights: Item[] = [], seatC = pick(["#6a1e22", "#1e3a6a", "#2a2a30"]);
      for (let i = 0; i < rows; i++) {
        const y = rise * (i + 1), z = -d / 2 + run * (i + 0.5);
        for (let x = -w / 2 + 0.35; x < w / 2 - 0.3; x += 0.55) {
          if (Math.abs(x) < 0.5) continue;   // the aisle
          seats.push([0.46, 0.07, 0.4, x, y + 0.42, z - 0.05, seatC]);
          seats.push([0.04, 0.4, 0.04, x, y + 0.2, z - 0.05, "#3a3c40"]);
          backs.push([0.46, 0.4, 0.05, x, y + 0.66, z + run / 2 - 0.12, seatC, 0]);
        }
        lights.push([0.12, 0.03, 0.01, 0, rise * i + rise * 0.6, -d / 2 + run * i - 0.006, "#a0c8ff"]);
      }
      many("fabric", seats); many("fabric", backs); lit(g, lights);
      const rail = m("metal", "#8a8c90"), len = Math.hypot(d, h), ang = Math.atan2(h, d);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05, -0.45, 0.45]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, len), rail);
        r.position.set(x, h / 2 + 0.9, 0); r.rotation.x = -ang; g.add(r);
      }
      break;
    }
    case "camera": {
      // a studio camera on a pedestal: a wheeled base, the column and its steering ring, the head with the body, a
      // long lens and a prompter hood on the front, the viewfinder lit at the back, pan bars, and the red tally light
      const dark = m("metal", "#202024"), grey = m("metal", color), lensY = h;
      cyl(0.36, 0.12, 0, 0.1, 0, dark, 24);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; box(0.1, 0.1, 0.16, Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36, dark).rotation.y = -a; }
      cyl(0.09, lensY - 0.4, 0, (lensY - 0.4) / 2 + 0.16, 0, grey, 16);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 32), m("chrome", "#a0a2a6"));
      ring.rotation.x = Math.PI / 2; ring.position.y = lensY - 0.55; g.add(ring);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3, s = box(0.3, 0.015, 0.015, Math.cos(a) * 0.15, lensY - 0.55, Math.sin(a) * 0.15, grey); s.rotation.y = -a; }
      box(0.22, 0.12, 0.22, 0, lensY - 0.22, 0, dark);
      box(0.26, 0.3, 0.48, 0, lensY, 0.05, grey);
      const lensM = m("plastic", "#141416"), barrel = cyl(0.085, 0.42, 0, lensY - 0.02, -0.38, lensM, 18);
      barrel.rotation.x = Math.PI / 2;
      // the prompter: a hood out front, its glass at 45 degrees, the screen under it lit
      box(0.42, 0.36, 0.04, 0, lensY - 0.02, -0.62, dark);
      box(0.42, 0.02, 0.36, 0, lensY + 0.17, -0.78, dark);
      for (const s of [-1, 1]) box(0.02, 0.36, 0.36, s * 0.21, lensY - 0.02, -0.78, dark);
      const pane = box(0.4, 0.5, 0.008, 0, lensY - 0.02, -0.78, m("glass", "#9fc6d8"));
      pane.rotation.x = -Math.PI / 4;
      g.add(glow(box(0.36, 0.008, 0.3, 0, lensY - 0.2, -0.78, m("screen", "#e8f0ff")), 0.4));
      box(0.42, 0.02, 0.36, 0, lensY - 0.21, -0.78, dark);
      // the viewfinder at the back, turned toward the operator
      box(0.24, 0.18, 0.14, 0, lensY + 0.25, 0.22, dark);
      g.add(glow(box(0.2, 0.14, 0.004, 0, lensY + 0.25, 0.292, m("screen", "#9ec4e8")), 0.5));
      g.add(glow(box(0.05, 0.025, 0.03, 0, lensY + 0.36, -0.1, m("screen", "#ff2a20")), 1.5));
      for (const s of [-1, 1]) { const bar = box(0.025, 0.025, 0.55, s * 0.16, lensY - 0.1, 0.45, grey); bar.rotation.x = 0.35; bar.rotation.y = s * 0.35; }
      // its cable trails off behind it, across the floor
      const cable = tubes([floorRun(k, [0, 0.3], [jig(rnd, 0.8), 2.2 + rnd()], 0.01, 0.25)], 0.011, m("rubber", "#141416"));
      if (cable) g.add(cable);
      break;
    }
    case "wedge": {
      // a floor monitor: a low cabinet whose face slopes up at whoever stands behind it (-z), grille cloth over it,
      // a handle let into the top and a cable out of the back
      const side = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(d / 2, h), new THREE.Vector2(-d / 2, h * 0.35)]);
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(side, { depth: w, bevelEnabled: false }), m("plastic", color));
      body.rotation.y = -Math.PI / 2; body.position.x = w / 2;
      g.add(body);
      const slope = Math.atan2(h * 0.65, d), len = Math.hypot(h * 0.65, d), face = Math.PI / 2 - slope;
      const grille = box(w * 0.9, len * 0.86, 0.012, 0, h * 0.675 + Math.sin(face) * 0.007, -Math.cos(face) * 0.007, m("grille", "#1a1a1c"));
      grille.rotation.x = face;
      box(w * 0.3, 0.012, 0.05, 0, h + 0.002, d * 0.3, m("metal", "#0a0a0c"));
      const lead = tubes([[new THREE.Vector3(0, 0.12, d / 2), new THREE.Vector3(0.05, 0.03, d / 2 + 0.15), new THREE.Vector3(-0.1, 0.008, d / 2 + 0.5), new THREE.Vector3(0.2, 0.008, d / 2 + 1)]], 0.008, m("rubber", "#141416"));
      if (lead) g.add(lead);
      break;
    }
    case "hostDesk": {
      // the host's desk on a late-night set: a broad wood top, a solid front panel toward the cameras (-z) with a
      // lit strip under its lip, and on top a mug, a stack of question cards, a pen and a desk mic; the chair behind
      const wood = m("wood", color), panel = m("wood", "#3a2418");
      box(w, 0.05, d, 0, h - 0.025, 0, wood);
      box(w - 0.06, h - 0.05, 0.05, 0, (h - 0.05) / 2, -d / 2 + 0.06, panel);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) box(0.05, h - 0.05, d - 0.06, x, (h - 0.05) / 2, 0.03, panel);
      g.add(glow(box(w - 0.1, 0.015, 0.01, 0, h - 0.07, -d / 2 + 0.03, m("screen", "#ffc890")), 1));
      const inlay: Item[] = [];
      for (let x = -w / 2 + 0.2; x < w / 2 - 0.15; x += 0.22) inlay.push([0.012, h - 0.3, 0.008, x, (h - 0.05) / 2, -d / 2 + 0.03, "#5a3a24"]);
      many("wood", inlay);
      const cups: Item[] = [], bits: Item[] = [];
      mug(k, cups, bits, w * 0.28, -d * 0.1, h);
      for (let i = 0; i < 12; i++) bits.push([0.1, 0.0015, 0.15, -w * 0.15 + jig(rnd, 0.004), h + 0.001 + i * 0.0015, -d * 0.05, "#e8e4d8", jig(rnd, 0.06)]);
      bits.push([0.008, 0.008, 0.14, -w * 0.02, h + 0.004, -d * 0.02, "#1a1a1a", 0.4]);
      many("plastic", cups, 0, "cyl"); many("plastic", bits);
      const metal = m("metal", "#1c1c1e");
      cyl(0.05, 0.015, -w * 0.32, h + 0.008, -d * 0.1, metal);
      const neck = cyl(0.006, 0.3, -w * 0.32, h + 0.15, -d * 0.18, metal, 8);
      neck.rotation.x = -0.5;
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.05, 6, 10), m("metal", "#2a2a2c"));
      head.position.set(-w * 0.32, h + 0.28, -d * 0.26); head.rotation.x = Math.PI / 2 - 0.5; g.add(head);
      chair(k, 0, d / 2 + 0.3, jig(rnd, 0.2), "#1c1a1a");
      break;
    }
    case "cyc": {
      // a cyclorama: the wall coved into the floor with no corner, painted and lit from the grid in a late-night
      // wash, deep blue up top down to warm magenta at the floor
      const tex = gradient([[0, "#ff5a8a"], [0.18, "#c03a9a"], [0.55, "#3a2a8a"], [1, "#0e1240"]]);
      const mat = backdrop(tex, 0.55), r = Math.min(0.8, h * 0.2);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h - r), mat);
      wall.position.set(0, r + (h - r) / 2, d / 2);
      wall.rotation.y = Math.PI;
      g.add(wall);
      // the cove: a quarter round from the wall down onto the floor, painted the floor's end of the gradient
      const cove = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16, 1, true, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#ff5a8a", emissive: "#ff5a8a", emissiveIntensity: 0.55, roughness: 0.95, side: THREE.DoubleSide }));
      cove.rotation.z = -Math.PI / 2;
      cove.position.set(0, r, d / 2 - r);
      g.add(cove);
      break;
    }
    case "flat": {
      // a set flat: a big window frame in the stage's own wood, and through it the city at night, painted: a sky
      // going to dusk at the bottom, towers in silhouette, their windows lit here and there, a red light on top
      const sky = backdrop(gradient([[0, "#0a0e24"], [0.6, "#1a2050"], [0.9, "#5a3a6a"], [1, "#b8687a"]]), 0.6);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sky);
      back.position.set(0, h / 2, d / 2);
      back.rotation.y = Math.PI;
      g.add(back);
      const towers: Item[] = [], windows: Item[] = [], tops: Item[] = [];
      for (let x = -w / 2 + 0.1; x < w / 2 - 0.1;) {
        const tw = 0.25 + rnd() * 0.5, th = h * (0.25 + rnd() * 0.5), far = rnd() < 0.5, z = d / 2 - (far ? 0.02 : 0.05);
        towers.push([tw, th, 0.01, x + tw / 2, th / 2, z, far ? "#141832" : "#0a0c18"]);
        for (let wy = 0.1; wy < th - 0.06; wy += 0.07) for (let wx = -tw / 2 + 0.04; wx < tw / 2 - 0.03; wx += 0.055) {
          if (rnd() < 0.3) windows.push([0.026, 0.034, 0.004, x + tw / 2 + wx, wy, z - 0.008, pick(["#ffd890", "#ffe8b0", "#a8d0ff", "#ffc070"])]);
        }
        if (rnd() < 0.3) tops.push([0.025, 0.025, 0.004, x + tw / 2, th + 0.02, z - 0.008, "#ff3020"]);
        x += tw + rnd() * 0.08 - 0.04;
      }
      many("plastic", towers); lit(g, windows); lit(g, tops);
      // the frame: a deep surround and mullions in the stage's wood, a sill along the bottom
      const frame = m("wood", color), t = 0.12;
      for (const y of [t / 2, h - t / 2]) box(w, t, d, 0, y, 0, frame);
      for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) box(t, h, d, x, h / 2, 0, frame);
      for (let i = 1; i < 4; i++) box(0.05, h - 2 * t, 0.06, -w / 2 + (w * i) / 4, h / 2, -d / 2 + 0.05, frame);
      box(w - 2 * t, 0.05, 0.06, 0, h * 0.62, -d / 2 + 0.05, frame);
      box(w + 0.1, 0.06, d + 0.12, 0, 0.03, -0.06, frame);
      break;
    }
  }
}
