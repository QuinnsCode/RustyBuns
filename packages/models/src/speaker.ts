// A speaker cabinet grown from its build plan, the way a board from its tscircuit file: the walls are the cut list
// (sides full height and depth, top and bottom between them, baffle and back between all four), the baffle has a
// round hole for each driver and the vent, the back a slot for a pipe's mouth, and the braces and a pipe's fold
// divider sit inside where the plan puts them. `explode` pulls every piece out along its own normal, as a build sheet
// draws it. The plan's shape is `Plan` in @rustybuns/gear (enclosure.ts); this file only needs the sizes, so it
// takes the fields it reads and nothing from that package.
//
// Metres, the cabinet standing on y = 0, its baffle facing +z. A part's mesh is named for it (`side-left`, `front`,
// `brace-1`, `driver-0`, `port-0`), so a page can pick one and say which wall it is.
import * as THREE from "three";

export interface CabinetDriver {
  driver: { dia: number; cutout: number; id: string };
  /** From the baffle's bottom-left corner, outside, m. */
  at: [number, number];
  top?: boolean;
}

export interface CabinetSpec {
  id: string;
  size: [number, number, number];
  wall: number;
  drivers: CabinetDriver[];
  alignment: { kind: "sealed" } | { kind: "vented"; ports: { dia: number; length: number; count: number } } | { kind: "pipe"; length: number; mouth: number; lining: number };
  braces: number;
  opening?: [number, number];
}

export type CabinetSlot = "wood" | "edge" | "cone" | "dome" | "frame" | "rubber" | "port" | "lining";

export interface CabinetOptions {
  /** The sheet's colour (the plan's material). */
  color?: number;
  /** 0 assembled, 1 every piece pulled out by a quarter of the box. */
  explode?: number;
  /** Bring your own materials; the rest are plain standard ones. */
  look?: Partial<Record<CabinetSlot, THREE.Material>>;
  /** Curve segments for the round parts. */
  seg?: number;
}

const std = (color: number, roughness: number, metalness = 0, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side });

function looks(o: CabinetOptions): Record<CabinetSlot, THREE.Material> {
  const wood = o.color ?? 0xb08a62;
  return {
    wood: std(wood, 0.78), edge: std(new THREE.Color(wood).multiplyScalar(0.82).getHex(), 0.85),
    cone: std(0x2a2b2e, 0.6), dome: std(0x1a1a1c, 0.45), frame: std(0x3b3d42, 0.4, 0.7), rubber: std(0x151516, 0.9),
    port: std(0x111112, 0.7, 0, THREE.DoubleSide), lining: std(0xd8d2c4, 1),
    ...o.look,
  };
}

/** A flat sheet `w` x `h` with round and square holes, `t` thick, extruded along +z from z = 0, centred on x/y. */
function sheet(w: number, h: number, t: number, holes: { x: number; y: number; r?: number; w?: number; h?: number }[], seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.closePath();
  for (const o of holes) {
    const p = new THREE.Path();
    if (o.r) p.absarc(o.x, o.y, o.r, 0, Math.PI * 2, true);
    else { const hw = (o.w ?? 0) / 2, hh = (o.h ?? 0) / 2; p.moveTo(o.x - hw, o.y - hh); p.lineTo(o.x - hw, o.y + hh); p.lineTo(o.x + hw, o.y + hh); p.lineTo(o.x + hw, o.y - hh); p.closePath(); }
    s.holes.push(p);
  }
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: Math.max(8, seg) });
}

/** A driver as it sits in its hole: the frame's flange on the baffle, the surround, a cone turned on a lathe and its cap. */
function driverModel(d: CabinetDriver, m: Record<CabinetSlot, THREE.Material>, seg: number): THREE.Group {
  const g = new THREE.Group(), r = d.driver.dia / 2, rc = d.driver.cutout / 2;
  const flange = new THREE.Mesh(new THREE.RingGeometry(rc * 0.92, r, seg * 2), m.frame);
  flange.position.z = 0.002;
  g.add(flange);
  if (d.top) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(rc * 0.55, seg * 2, seg, 0, Math.PI * 2, 0, Math.PI / 2), m.dome);
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(1, 0.55, 1);
    g.add(dome);
    const face = new THREE.Mesh(new THREE.CircleGeometry(rc * 0.92, seg * 2), m.frame);
    face.position.z = 0.0015;
    g.add(face);
    return g;
  }
  const surround = new THREE.Mesh(new THREE.TorusGeometry(rc * 0.86, rc * 0.07, seg / 2, seg * 2), m.rubber);
  surround.position.z = -0.002;
  g.add(surround);
  // The cone's profile from the surround in to the voice coil, falling back into the box.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(rc * (0.8 - 0.55 * t), -rc * 0.45 * t ** 0.8)); }
  const cone = new THREE.Mesh(new THREE.LatheGeometry(pts, seg * 2), m.cone);
  cone.rotation.x = -Math.PI / 2;
  g.add(cone);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(rc * 0.25, seg * 2, seg, 0, Math.PI * 2, 0, Math.PI / 2), m.dome);
  cap.rotation.x = Math.PI / 2;
  cap.scale.set(1, 0.4, 1);
  cap.position.z = -rc * 0.42;
  g.add(cap);
  return g;
}

/** The cabinet: a group named for the plan, a mesh or group per part. */
export function cabinet(p: CabinetSpec, o: CabinetOptions = {}): THREE.Group {
  const m = looks(o), seg = o.seg ?? 16, ex = (o.explode ?? 0) * 0.25 * Math.max(...p.size);
  const [w, h, d] = p.size, t = p.wall;
  const root = new THREE.Group();
  root.name = p.id;
  const add = (name: string, obj: THREE.Object3D, at: THREE.Vector3Tuple, out: THREE.Vector3Tuple) => {
    obj.name = name;
    obj.position.set(at[0] + out[0] * ex, at[1] + out[1] * ex, at[2] + out[2] * ex);
    root.add(obj);
    return obj;
  };
  const panel = (sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), [m.edge, m.edge, m.edge, m.edge, m.wood, m.wood]);
    return mesh;
  };
  // Sides full height and depth; top and bottom between them.
  add("side-left", panel(t, h, d), [-w / 2 + t / 2, h / 2, 0], [-1, 0, 0]);
  add("side-right", panel(t, h, d), [w / 2 - t / 2, h / 2, 0], [1, 0, 0]);
  add("top", panel(w - 2 * t, t, d), [0, h - t / 2, 0], [0, 1, 0]);
  add("bottom", panel(w - 2 * t, t, d), [0, t / 2, 0], [0, -1, 0]);
  // The baffle and back between all four, with their holes; x/y on the sheet are from the inner rectangle's middle.
  const iw = w - 2 * t, ih = h - 2 * t, toSheet = ([x, y]: [number, number]) => ({ x: x - w / 2, y: y - h / 2 });
  const a = p.alignment;
  const frontHoles = p.drivers.map((dm) => ({ ...toSheet(dm.at), r: dm.driver.cutout / 2 }));
  if (a.kind === "vented" && p.opening)
    for (let i = 0; i < a.ports.count; i++) frontHoles.push({ ...toSheet([p.opening[0] + (i - (a.ports.count - 1) / 2) * a.ports.dia * 1.6, p.opening[1]]), r: a.ports.dia / 2 + 0.003 });
  const front = new THREE.Mesh(sheet(iw, ih, t, frontHoles, seg), m.wood);
  add("front", front, [0, h / 2, d / 2 - t], [0, 0, 1]);
  const backHoles = a.kind === "pipe" && p.opening ? [{ ...toSheet(p.opening), w: iw * 0.9, h: a.mouth / (iw * 0.9) }] : [];
  const back = new THREE.Mesh(sheet(iw, ih, t, backHoles, seg), m.wood);
  add("back", back, [0, h / 2, -d / 2], [0, 0, -1]);
  // Braces: strips across inside, side to side, spaced along the long span.
  for (let i = 0; i < p.braces; i++) {
    const y = t + ((i + 1) * ih) / (p.braces + 1);
    add(`brace-${i + 1}`, panel(iw, 0.05, t), [0, y, 0], [0, 0, 0]);
  }
  if (a.kind === "pipe") {
    // The fold: a divider from the top down, leaving the gap at the bottom where the pipe turns.
    const dl = ih - 0.12;
    add("fold", panel(iw, dl, t), [0, h - t - dl / 2, 0], [0, 0, 0]);
    // Lining on the front channel's back wall (the divider's face), as thick as the plan asks.
    const lin = new THREE.Mesh(new THREE.BoxGeometry(iw * 0.96, dl * 0.5, 0.01 + 0.02 * a.lining), m.lining);
    add("lining", lin, [0, h - t - dl * 0.25, t / 2 + 0.006 + 0.01 * a.lining], [0, 0, 0]);
  }
  if (a.kind === "vented" && p.opening) {
    for (let i = 0; i < a.ports.count; i++) {
      const g = new THREE.Group(), r = a.ports.dia / 2;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.002, r + 0.002, a.ports.length, seg * 2, 1, true), m.port);
      tube.rotation.x = Math.PI / 2;
      tube.position.z = -a.ports.length / 2;
      const flare = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.004, seg / 2, seg * 2), m.port);
      g.add(tube, flare);
      const x = p.opening[0] + (i - (a.ports.count - 1) / 2) * a.ports.dia * 1.6 - w / 2;
      add(`port-${i}`, g, [x, p.opening[1], d / 2], [0, 0, 1.4]);
    }
  }
  p.drivers.forEach((dm, i) => add(`driver-${i}`, driverModel(dm, m, seg), [dm.at[0] - w / 2, dm.at[1], d / 2], [0, 0, 2]));
  return root;
}

/** The parts of a cabinet by name, as `cabinet` named them. */
export const cabinetParts = (g: THREE.Group): string[] => g.children.map((c) => c.name);
