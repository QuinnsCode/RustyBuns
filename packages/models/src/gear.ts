// Load In's gear, grown in code: speakers, a sub, a wedge, stands, guitar amps, a rolling amp rack, cases, a cable
// ramp, a generator, a distro box, a mixer, a mic stand, a guitar, a DI box, a hung line array box, a front fill, a sand cart, a jerry can, the desert rigs' horn boxes (a synergy horn, a tapped horn, a triple-21 sub, a tri-amp top and bass), and a DJ booth's media player deck, direct-drive turntable and four-channel mixer, and a club media player and a four-channel analog club mixer with twin filters; and, outside the catalog, a studio's stompbox (`stompbox`). Generic boxes named for what they are, at
// the real sizes of #4849's table (width x height x depth = x, y, z, in metres), feet on the floor at y = 0,
// centred on x and z, the front facing +z. Each app brings its own materials (`GearLook`, one per slot).
//
// Every model marks where things attach, as empty Object3Ds the app finds by name:
//   jack:<id>   a socket on its real panel, its +z pointing out of the panel (a plug comes in along -z)
//   grab        where a hand holds it to carry it
//   pole        the top of a stand or a sub's pole socket, +z up: a top's `pole-cup` sits on it
//   pole-cup    the socket under a top, +z down
//   link-a/b    a cable ramp's ends, +z out along the run, so ramps link end to end
//   hinge-top/bottom  a hung line array box's front pins, +z along the pin (+x): a hang chains box to box at these
//
// What moves is a child group `part:<name>` (`gearParts`), its origin the pivot, a mesh per slot of its own. Its
// built rotation carries any slope it sits on, so an app turns it by `rotation.y` only, or moves it by its position:
//   turntable   platter (spins about +y), tonearm (swings about +y; userData.arm: rest, outer, inner groove angles)
//   deck-media  jog (spins about +y), ring (the jog's light ring), screen (a quad with 0..1 UVs for a canvas, up is away from you)
//   mixer-dj    meter-1..4 (the lit bar at full height along +y, front to back on the face: scale.y 0..1), fader-1..4 (caps at mid travel,
//               slide along z: +z toward you is down; userData.faderTravel), cross (slides along x; userData.crossTravel)
//   deck-cd     platter and ring (the jog's top and its ribbed side, each spins about +y), screen (as deck-media's, tilted up
//               toward you), cue and play (the round keys, their rims lit), tempo (the cap, slides along z; userData.tempoTravel)
//   mixer-club-4  as mixer-dj, and filter-1, filter-2 (the big frequency knobs, turn about +y)
//
// Geometry is built once per id (and stand height) and shared by every copy; each call makes new meshes only.
import * as THREE from "three";
import { clamp } from "@rustybuns/util";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { mergeGeometries, mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Piece, R, along, box, loft } from "./shapes.ts";

export type GearId = keyof typeof GEAR_SIZES;

/** Width x height x depth in metres, from #4849's table. */
export const GEAR_SIZES = {
  "top-12-powered": [0.37, 0.6, 0.36],
  "top-15-passive": [0.45, 0.72, 0.42],
  "sub-18": [0.55, 0.7, 0.75],
  "wedge-12": [0.6, 0.35, 0.42],
  "amp-head": [0.7, 0.27, 0.25],
  "cab-4x12": [0.76, 0.76, 0.36],
  "amp-rack-4u": [0.6, 0.4, 0.65],
  "mixer-small": [0.4, 0.1, 0.35],
  "generator-7kva": [0.7, 0.6, 0.55],
  "distro-box": [0.4, 0.3, 0.25],
  "cable-ramp-2ch": [0.9, 0.08, 0.5],
  "road-case-m": [0.6, 0.5, 0.5],
  "trunk-case": [0.95, 0.6, 0.55],
  "stand-tripod": [0.9, 1.2, 0.9],
  "mic-stand": [0.6, 1.6, 0.6],
  "sand-cart": [0.8, 0.45, 1.2],
  "sand-dolly": [1.1, 0.15, 1.0],
  "jerry-can-20l": [0.35, 0.47, 0.17],
  "line-array-box": [1.0, 0.32, 0.55],
  "line-array-10": [0.74, 0.3, 0.5],
  "fill-8-powered": [0.28, 0.42, 0.25],
  "bar-cooler": [0.9, 0.9, 0.6],
  guitar: [0.33, 1.0, 0.05],
  "di-box": [0.1, 0.05, 0.13],
  "mic-condenser": [0.05, 0.19, 0.05],
  "wedge-12-passive": [0.6, 0.35, 0.42],
  "deck-media": [0.329, 0.118, 0.453],
  turntable: [0.453, 0.169, 0.353],
  "mixer-dj": [0.333, 0.108, 0.414],
  // the Desert Gathering booth (#5651): the club media player and the four-channel analog club mixer with twin filters
  "deck-cd": [0.32, 0.105, 0.405],
  "mixer-club-4": [0.32, 0.088, 0.358],
  // the festival (#5029 step 9): the dance stack, the sculpted array, a stage rack and the site generator
  "stack-mid-high": [0.75, 0.5, 0.7],
  "stack-mid-bass": [0.75, 0.75, 0.85],
  "horn-sub-21": [1.1, 0.8, 1.0],
  "sculpted-3way": [0.42, 0.85, 0.52],
  "arc-sub-18": [1.2, 0.5, 0.75],
  "amp-rack-12u": [0.6, 1.05, 0.75],
  "generator-100kva": [1.3, 2.0, 3.6],
  // Desert Gathering's other rigs (packages/gear systems.ts): sizes from the makers' sheets, or typical of the class
  "synergy-horn": [0.711, 0.711, 0.648],
  "tapped-horn-18": [0.734, 1.016, 0.572],
  "triple-21-sub": [1.479, 0.696, 1.218],
  "tri-amp-top": [0.76, 0.76, 0.9],
  "tri-amp-bass": [0.76, 0.76, 0.9],
} as const satisfies Record<string, THREE.Vector3Tuple>;

export const GEAR_IDS = Object.keys(GEAR_SIZES) as GearId[];

/** What a hang flies from, part of the venue rather than gear the crew carries in (so not in the catalog): the line
 * array's flying frame and the chain motor over it, w x h x d in metres as built (`rigging`). */
export const RIG_SIZES = {
  "flying-frame": [0.8, 0.284, 0.8],
  "chain-motor": [0.262, 0.748, 0.298],
} as const satisfies Record<string, THREE.Vector3Tuple>;
export type RigId = keyof typeof RIG_SIZES;
export const RIG_IDS = Object.keys(RIG_SIZES) as RigId[];
/** The frame's link pins along z: over `line-array-10`'s front pins and its rear link. */
const FRAME_PINS = { front: 0.205, rear: -0.235 };
/** The frame's pick-up holes along its spine (z), and the one its shackle is in. */
const FRAME_HOLES = [-0.39, -0.31, -0.23, -0.15, -0.07, 0.01, 0.09, 0.17, 0.25];
const FRAME_PICKUP = -0.07;
/** How far below the hook part's origin (the chain's end) its bite is. */
const MOTOR_BITE = 0.143;

const SLOTS = ["paint", "grille", "metal", "rubber", "panel", "lid", "tolex", "body", "chrome", "knob", "light", "shell", "badge", "ink", "mesh", "coat", "cheek"] as const;
export type GearSlot = (typeof SLOTS)[number];
/** A material per slot: paint (cabinets), grille, metal (frames, poles), rubber (feet, wheels, ramp), panel (jack
 * plates), lid (the ramp's yellow lid), tolex (guitar amps), body (the guitar), chrome, knob, light (LEDs), shell (the
 * sculpted array's moulded composite), badge (the dance stack's maker plate), ink (the white print on a control face); and a hung line array box's own:
 * mesh (its black grille, backed nearly solid), coat (its shell's even pebble coat), cheek (its paler side panels). */
export type GearLook = Record<GearSlot, THREE.Material>;

export function gearLook(): GearLook {
  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    paint: std(0x1d1e20, 0.85), grille: std(0x2c2e31, 0.55, 0.6), metal: std(0x8a8d92, 0.4, 0.8), rubber: std(0x121212, 0.95),
    panel: std(0x3a3c40, 0.6, 0.3), lid: std(0xf2c230, 0.6), tolex: std(0x161514, 0.9), body: std(0x8f1f1f, 0.3, 0.1),
    chrome: std(0xd8dade, 0.15, 1), knob: std(0x0c0c0c, 0.5), light: new THREE.MeshBasicMaterial({ color: 0x45e06a }),
    shell: std(0x1f6f78, 0.32, 0.1), badge: std(0x7a3fc6, 0.45), ink: std(0xe4e2dc, 0.7),
    mesh: std(0x141518, 0.6, 0.4), coat: std(0x1d1e20, 0.9), cheek: std(0x55574f, 0.92),
  };
}

type Mark = { name: string; at: THREE.Vector3Tuple; out: THREE.Vector3Tuple };
/** A moving part: its pivot `at`, turned by `rot` (radians about x), its pieces in its own frame; `ownUv` keeps the
 * pieces' UVs (a screen's 0..1) instead of laying metre UVs on. */
type Part = { name: string; at: THREE.Vector3Tuple; rot?: number; pieces: Piece[]; ownUv?: boolean };
/** What a model with moving parts says about them, on its group's userData: the tonearm's turns about its bearing
 * (radians: at the rest, the outer groove, the inner groove) and the mixer's fader and crossfader throws (and a deck tempo fader's), metres. */
export type GearData = { arm?: { rest: number; outer: number; inner: number }; faderTravel?: number; crossTravel?: number; tempoTravel?: number; bite?: number };
type Build = { pieces: Piece[]; marks: Mark[]; parts?: Part[]; data?: GearData };

// ---- pieces ---------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A rod from a to b (a pole, a leg, a frame tube). */
function rod(slot: GearSlot, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, r: number, seg = 6): Piece {
  const va = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(va), len = d.length();
  const m = new THREE.Matrix4().compose(va.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
  return loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg, m });
}

/** A short cylinder along an axis: a wheel, a knob, a cone ring, a socket. */
function disc(slot: GearSlot, r: number, len: number, axis: "x" | "y" | "z", at: THREE.Vector3Tuple, seg = 8): Piece {
  const m = axis === "y" ? new THREE.Matrix4().makeTranslation(...at) : along(axis, at);
  return loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg, m });
}

/** The convex hull of a side profile (z, y pairs) pushed `wide` across x, centred at x = cx; `chamfer` bevels the
 * edges round each side face. */
function prism(slot: GearSlot, profile: [number, number][], wide: number, cx = 0, chamfer = 0): Piece {
  const [mz, my] = [0, 1].map((k) => profile.reduce((s, p) => s + p[k], 0) / profile.length);
  const shrink = (z: number, y: number, k: number): [number, number] => { const l = Math.hypot(z - mz, y - my) || 1; return [z - ((z - mz) / l) * k, y - ((y - my) / l) * k]; };
  const pts = profile.flatMap(([z, y]) => [-1, 1].flatMap((s) => {
    const [iz, iy] = shrink(z, y, chamfer);
    return [new THREE.Vector3(cx + (s * wide) / 2, iy, iz), new THREE.Vector3(cx + s * (wide / 2 - chamfer), y, z)];
  }));
  let geo: THREE.BufferGeometry = new ConvexGeometry(pts);
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  return { geo, slot };
}

/** A carry handle: a bar on two posts, standing out of a face along `out`. */
function handle(slot: GearSlot, at: THREE.Vector3Tuple, out: "x" | "-x" | "y" | "z" | "-z", span = 0.12, rise = 0.03): Piece[] {
  const [x, y, z] = at, s = span / 2;
  const n: THREE.Vector3Tuple = out === "x" ? [rise, 0, 0] : out === "-x" ? [-rise, 0, 0] : out === "y" ? [0, rise, 0] : out === "z" ? [0, 0, rise] : [0, 0, -rise];
  // along the face: across x for y/z faces, across z for x faces
  const t: THREE.Vector3Tuple = out === "x" || out === "-x" ? [0, 0, s] : [s, 0, 0];
  const p = (k: number, lift: number): THREE.Vector3Tuple => [x + t[0] * k + n[0] * lift, y + t[1] * k + n[1] * lift, z + t[2] * k + n[2] * lift];
  return [rod(slot, p(-1, 0), p(-1, 1), 0.008, 4), rod(slot, p(1, 0), p(1, 1), 0.008, 4), rod(slot, p(-1, 1), p(1, 1), 0.01, 6)];
}

/** A rounded cabinet: the convex hull of round corners, `wf` wide at the front and `wb` at the back (a trapezoid in
 * plan, as a moulded PA box tapers), its upright edges rounded `r` and its top and bottom edges `e`. Smooth across
 * the rounds and flat on the faces. Built from y0 up, its depth centred on z0; `m` turns it afterwards; `detail` 1 for
 * small parts (a cap, a handle). */
function rounded(slot: GearSlot, { wf, wb = wf, h, d, r, e = r, y0 = 0, z0 = 0, m, detail = 2 }: { wf: number; wb?: number; h: number; d: number; r: number; e?: number; y0?: number; z0?: number; m?: THREE.Matrix4; detail?: 1 | 2 }): Piece {
  const pts: THREE.Vector3[] = [], layers = detail === 2 ? 4 : 1, round = detail === 2 ? 12 : 6;
  const corners = [[wf / 2, d / 2], [-wf / 2, d / 2], [wb / 2, -d / 2], [-wb / 2, -d / 2]].map(([x, z]) => [x - Math.sign(x) * r, z0 + z - Math.sign(z) * r]);
  for (let k = 0; k <= layers; k++) {
    const t = (k / layers) * (Math.PI / 2), inset = e * (1 - Math.cos(t)), rr = Math.max(r - inset, 0.0004);
    for (const y of [y0 + e * (1 - Math.sin(t)), y0 + h - e * (1 - Math.sin(t))])
      for (const [cx, cz] of corners) for (let j = 0; j < round; j++) {
        const a = (j / round) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr));
      }
  }
  let geo: THREE.BufferGeometry = new ConvexGeometry(pts);
  if (m) geo.applyMatrix4(m);
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  geo = toCreasedNormals(geo.index ? geo.toNonIndexed() : geo, 0.6);
  return { geo, slot };
}

/** A surface of revolution round the z axis, seen from the front: a cone's dish, its rubber surround, a horn's
 * flare. `rings` run from back to front ([z, rx, ry]); `p` > 2 squares the rings off (a horn's mouth). Every face is
 * turned to look forward (+z), so the inside of a dish is what shows. */
function lathe(slot: GearSlot, rings: [number, number, number][], { p = 2, seg = 20, m }: { p?: number; seg?: number; m?: THREE.Matrix4 } = {}): Piece {
  const ring = (z: number, rx: number, ry: number) => Array.from({ length: seg }, (_, j) => {
    const a = (2 * Math.PI * j) / seg, c = Math.cos(a), s = Math.sin(a);
    return new THREE.Vector3(Math.sign(c) * Math.abs(c) ** (2 / p) * rx, Math.sign(s) * Math.abs(s) ** (2 / p) * ry, z);
  });
  const rows = rings.map(([z, rx, ry]) => ring(z, rx, ry)), pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    pos.push(...(n.z >= 0 ? [a, b, c] : [a, c, b]).flatMap((v) => v.toArray()));
  };
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg, [a, b] = [rows[i], rows[i + 1]];
    tri(a[j], a[k], b[k]); tri(a[j], b[k], b[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (m) geo.applyMatrix4(m);
  // smooth round the turn (a cone's dish, a knob's skirt), creased where a ring folds sharply (a horn's lip)
  return { geo: toCreasedNormals(geo, 0.6), slot };
}

/** A loudspeaker as it shows through a grille: the cone's dish, its rolled rubber surround, the dust cap and the
 * basket's rim, `r` the cone's radius, its rim at z = 0 and its throat `deep` behind. `m` places it; `seg` fewer
 * for one only a shadow behind a solid grille. */
function cone(r: number, deep: number, m: THREE.Matrix4, seg = 24): Piece[] {
  const roll = Math.min(deep, 0.01);
  return [
      // the dish is coated paper with a satin sheen (it catches the light through the holes); the surround is rubber
    lathe("knob", [[-deep, r * 0.22, r * 0.22], [-deep * 0.55, r * 0.6, r * 0.6], [-deep * 0.12, r * 0.92, r * 0.92], [0, r, r]], { m, seg }),
    lathe("rubber", [[0, r, r], [roll * 0.25, r * 1.04, r * 1.04], [roll * 0.2, r * 1.09, r * 1.09], [0, r * 1.12, r * 1.12]], { m, seg }),
    lathe("knob", [[-deep * 0.95, r * 0.22, r * 0.22], [-deep * 0.72, r * 0.16, r * 0.16], [-deep * 0.62, 0.001, 0.001]], { m, seg: Math.round(seg * 0.67) }),
    lathe("knob", [[0, r * 1.12, r * 1.12], [roll * 0.1, r * 1.13, r * 1.13], [roll * 0.1, r * 1.2, r * 1.2], [-roll * 0.2, r * 1.2, r * 1.2]], { m, seg }),
  ];
}

/** A constant-directivity horn's mouth: a squared-off flare from a small throat, `w` by `h` at the mouth. */
function horn(w: number, h: number, deep: number, m: THREE.Matrix4, seg = 24): Piece[] {
  return [
    lathe("knob", [[-deep, 0.014, 0.014], [-deep * 0.6, w * 0.16, h * 0.2], [-deep * 0.2, w * 0.38, h * 0.42], [0, w / 2, h / 2]], { p: 4, seg, m }),
    lathe("knob", [[0, w / 2, h / 2], [Math.min(deep, 0.01) * 0.15, w / 2 + 0.008, h / 2 + 0.008], [0, w / 2 + 0.014, h / 2 + 0.014]], { p: 4, seg, m }),
  ];
}

/** A well sunk into a face: centred on the face at `at`, `w` by `h` at the face (`w` along the face's u: across x on a
 * face looking front, back, up or down, along z on a side), its corners rounded `r`. Its rim rolls in `lip` at 45
 * degrees, then its walls run `deep` into the box, drawing in `draft` on each side as a moulding's walls do; `walls`
 * and `floor` are their slots (the cabinet's own unless given). `d` makes it a D instead (a hand-hold's half-moon): flat
 * along its bottom edge and domed up (+1, along v) or flat along its top and domed down (-1). */
type Well = { at: THREE.Vector3Tuple; w: number; h: number; r: number; deep: number; lip?: number; draft?: number; walls?: GearSlot; floor?: GearSlot | null; d?: 1 | -1 };

/** A D's outline, counter-clockwise in (u, v), `w` by `h` round (cu, cv): a half ellipse on a flat edge, its two
 * corners rounded `r`, the flat at the bottom for `up` +1 and at the top for -1; the same count of points whatever its size. */
function dShape(cu: number, cv: number, w: number, h: number, r: number, up: 1 | -1, per = 12): THREE.Vector2[] {
  const a = w / 2, base = cv - (up * h) / 2, rr = Math.max(Math.min(r, h / 3, a / 3), 1e-4), t0 = Math.asin(rr / h), pts: THREE.Vector2[] = [];
  // the dome from the right end of the flat over to the left, stopping `r` short of the flat, then the flat's two
  // ends pulled in, so each corner is a short round, not a point
  for (let j = 0; j <= per; j++) { const t = t0 + ((Math.PI - 2 * t0) * j) / per; pts.push(new THREE.Vector2(cu + a * Math.cos(t), base + up * h * Math.sin(t))); }
  const end = a * Math.cos(t0) - rr * 0.7;
  pts.push(new THREE.Vector2(cu - end, base), new THREE.Vector2(cu + end, base));
  // mirrored in v, that ran clockwise
  return up > 0 ? pts : pts.reverse();
}

/** A face's own frame: u and v across it, n out of it (u = x on a front, back, top or bottom face). */
function faceFrame(out: THREE.Vector3Tuple) {
  const n = new THREE.Vector3(...out).normalize();
  const u = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(UP, n).normalize();
  return { n, u, v: new THREE.Vector3().crossVectors(n, u) };
}

/** A rounded rectangle's outline, counter-clockwise in (u, v), the same count of points whatever its size. */
function roundRect(cu: number, cv: number, w: number, h: number, r: number, per = 5): THREE.Vector2[] {
  const rr = Math.max(Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4), 1e-4), pts: THREE.Vector2[] = [];
  for (const [k, sx, sy] of [[0, 1, 1], [1, -1, 1], [2, -1, -1], [3, 1, -1]] as const)
    for (let j = 0; j <= per; j++) {
      const a = ((k + j / per) * Math.PI) / 2;
      pts.push(new THREE.Vector2(cu + sx * (w / 2 - rr) + Math.cos(a) * rr, cv + sy * (h / 2 - rr) + Math.sin(a) * rr));
    }
  return pts;
}

/** The convex hull of points in a plane, counter-clockwise, points closer than 0.1 mm or in a straight run dropped. */
function hull2(points: THREE.Vector2[]): THREE.Vector2[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y), turn = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: THREE.Vector2[]) => list.reduce<THREE.Vector2[]>((h, p) => {
    while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop();
    if (!h.length || h[h.length - 1].distanceTo(p) > 1e-4) h.push(p);
    return h;
  }, []);
  const lower = half(ps), upper = half([...ps].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Wells sunk into a piece's flat face looking along `out` (a convex cabinet's front, back, side, top or bottom): the
 * face is cut round each well's mouth, and the well's walls and floor go in behind it, so a pocket handle, an amp's
 * recess or the dark cavity behind a grille is a real hollow you see into, not a part stuck on the face. */
function sink(piece: Piece, out: THREE.Vector3Tuple, wells: Well[]): Piece[] {
  const p = piece.geo.getAttribute("position");
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), want = new THREE.Vector3(...out).normalize();
  // the face is the one looking most nearly along `out` (a tapered box's sides lean by its taper)
  const best = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    f.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if (f.dot(want) > best.dot(want)) best.copy(f);
  }
  const { n, u, v } = faceFrame(best.toArray());
  let top = -Infinity;
  for (let i = 0; i < p.count; i++) top = Math.max(top, a.fromBufferAttribute(p, i).dot(n));
  const keep: number[] = [], rim: THREE.Vector2[] = [];
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    f.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if (f.dot(n) > 0.9999 && Math.abs(a.dot(n) - top) < 1e-5) { for (const q of [a, b, c]) rim.push(new THREE.Vector2(q.dot(u), q.dot(v))); continue; }
    for (let k = 0; k < 3; k++) keep.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
  }
  if (!rim.length) throw new Error("sink: no flat face looks that way");
  const outline = hull2(rim);
  const at3 = (q: THREE.Vector2, depth: number) => u.clone().multiplyScalar(q.x).addScaledVector(v, q.y).addScaledVector(n, top - depth);
  const facing = (pos: number[], tris: THREE.Vector3[][], want?: THREE.Vector3) => {
    for (const [x, y, z] of tris) {
      const fn = new THREE.Vector3().subVectors(y, x).cross(z.clone().sub(x));
      const flip = want ? fn.dot(want) < 0 : false;
      pos.push(...(flip ? [x, z, y] : [x, y, z]).flatMap((q) => q.toArray()));
    }
  };
  const centres = wells.map((w) => [w.at[0] * u.x + w.at[1] * u.y + w.at[2] * u.z, w.at[0] * v.x + w.at[1] * v.y + w.at[2] * v.z] as const);
  const outline2 = (w: Well, [cu, cv]: readonly [number, number], k: number) => w.d ? dShape(cu, cv, w.w - 2 * k, w.h - 2 * k, Math.max(w.r - k, 0.002), w.d) : roundRect(cu, cv, w.w - 2 * k, w.h - 2 * k, k ? Math.max(w.r - k, 0.002) : w.r);
  const mouths = wells.map((w, i) => outline2(w, centres[i], 0));
  // a mouth has to lie on the flat (past it, the cut would tear the rounds)
  const inside = (q: THREE.Vector2) => outline.every((o, i) => { const e = outline[(i + 1) % outline.length]; return (e.x - o.x) * (q.y - o.y) - (e.y - o.y) * (q.x - o.x) >= -1e-7; });
  if (!mouths.every((m) => m.every(inside))) throw new Error("sink: a well's mouth runs off the flat of its face");
  // (triangulateShape turns its arrays round in place, so it gets copies, and its indices run over those)
  const face: number[] = [], shape = [outline, ...mouths].map((ring) => [...ring]);
  const tris = THREE.ShapeUtils.triangulateShape(shape[0], shape.slice(1)), all = shape.flat();
  facing(face, tris.map((t) => t.map((k) => at3(all[k], 0))), n);
  // the shell's normals made again, so the rounds still blend into the cut face
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([...keep, ...face], 3));
  const pieces: Piece[] = [{ geo: toCreasedNormals(geo, 0.6), slot: piece.slot }];
  wells.forEach((w, i) => {
    const [cu, cv] = centres[i];
    const lip = Math.min(w.lip ?? 0.004, w.w / 4, w.h / 4), dr = Math.min(w.draft ?? 0, w.w / 4 - lip, w.h / 4 - lip);
    const ring = (k: number) => outline2(w, centres[i], k);
    // (a well with no lip goes straight down: no flat band at the mouth)
    const rings: [THREE.Vector2[], number][] = lip > 0 ? [[mouths[i], 0], [ring(lip), lip], [ring(lip + dr), w.deep]] : [[mouths[i], 0], [ring(dr), w.deep]];
    const walls: number[] = [], centre = (d: number) => at3(new THREE.Vector2(cu, cv), d);
    for (let r = 0; r + 1 < rings.length; r++) {
      const [ra, da] = rings[r], [rb, db] = rings[r + 1];
      for (let j = 0; j < ra.length; j++) {
        const k = (j + 1) % ra.length, [p0, p1, q0, q1] = [at3(ra[j], da), at3(ra[k], da), at3(rb[j], db), at3(rb[k], db)];
        // a wall looks in, at the well's own axis
        const want = centre((da + db) / 2).sub(p0.clone().add(q1).multiplyScalar(0.5)).projectOnPlane(n).addScaledVector(n, 0.2);
        facing(walls, [[p0, p1, q1], [p0, q1, q0]], want);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(walls, 3));
    pieces.push({ geo: toCreasedNormals(wg, 0.9), slot: w.walls ?? piece.slot });
    if (w.floor === null) return;
    const last = [...rings[rings.length - 1][0]], floor: number[] = [];
    facing(floor, THREE.ShapeUtils.triangulateShape(last, []).map((t) => t.map((k) => at3(last[k], w.deep))), n);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(floor, 3));
    fg.setAttribute("normal", new THREE.Float32BufferAttribute(floor.map((_, i) => n.getComponent(i % 3)), 3));
    pieces.push({ geo: fg, slot: w.floor ?? w.walls ?? piece.slot });
  });
  return pieces;
}

/** Cuts wells into one cabinet face after face (`[out, wells]` each), and puts the cut cabinet and its hollows into the build. */
function sunk(b: Build, piece: Piece, cuts: [THREE.Vector3Tuple, Well[]][]) {
  const [cab, ...hollows] = cuts.reduce<Piece[]>(([p, ...rest], [out, wells]) => { const [face, ...more] = sink(p, out, wells); return [face, ...rest, ...more]; }, [piece]);
  b.pieces.push(cab, ...hollows);
}

/** A pan-head screw on a face looking along `out` (`slot` "knob" for the black ones that hold a grille on). */
function screw(at: THREE.Vector3Tuple, out: "z" | "-z" | "x" | "-x" | "y", r = 0.0045, slot: GearSlot = "chrome", seg = 8): Piece[] {
  return [disc(slot, r, 0.002, out.endsWith("x") ? "x" : out === "y" ? "y" : "z", at, seg)];
}

/** The black screws that hold a grille on: down each long side of a sheet `w` by `h` whose face is the plane
 * z = 0 of `m`, `rows` of them a side. */
function grilleScrews(b: Build, w: number, h: number, m: THREE.Matrix4, rows = 3) {
  for (const x of [-1, 1]) for (let i = 0; i < rows; i++) b.pieces.push(...onto(m, screw([x * (w / 2 - 0.011), (i / (rows - 1) - 0.5) * (h - 0.03), 0.001], "z", 0.004, "knob", 6)));
}

/** UVs in metres across each triangle's own plane, so a photo texture tiles at its real size on every face. */
function metreUv(geo: THREE.BufferGeometry) {
  const p = geo.getAttribute("position"), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), s = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if (Math.abs(n.y) > 0.9) t.copy(X); else t.crossVectors(UP, n).normalize();
    s.crossVectors(n, t);
    [a, b, c].forEach((v, k) => { uv[(i + k) * 2] = v.dot(t); uv[(i + k) * 2 + 1] = v.dot(s); });
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

type Face = "front" | "back" | "top" | "left" | "right";
const NORMAL: Record<Face, THREE.Vector3Tuple> = { front: [0, 0, 1], back: [0, 0, -1], top: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

/** Sockets in a row on a face, each a ring round an insert, with a mark. `at` is the face point of the first, `step` to the next. */
function jacks(b: Build, names: string[], face: Face, at: THREE.Vector3Tuple, step: THREE.Vector3Tuple, r = 0.012, seg = 14) {
  const out = NORMAL[face], axis = face === "top" ? "y" : face === "front" || face === "back" ? "z" : "x";
  names.forEach((name, i) => {
    const p: THREE.Vector3Tuple = [at[0] + step[0] * i, at[1] + step[1] * i, at[2] + step[2] * i];
    const c: THREE.Vector3Tuple = [p[0] + out[0] * 0.004, p[1] + out[1] * 0.004, p[2] + out[2] * 0.004];
    // a socket: a metal ring round a black insert
    b.pieces.push(disc("metal", r, 0.008, axis, c, seg), disc("knob", r * 0.74, 0.009, axis, c, seg));
    b.marks.push({ name: `jack:${name}`, at: [p[0] + out[0] * 0.008, p[1] + out[1] * 0.008, p[2] + out[2] * 0.008], out });
  });
}

const mark = (b: Build, name: string, at: THREE.Vector3Tuple, out: THREE.Vector3Tuple = [0, 1, 0]) => b.marks.push({ name, at, out });
const numbered = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem}-${i + 1}`);

// ---- the gear -------------------------------------------------------------------------------------------------

/** Feet, corner caps and the like: a small rounded block `s` across, centred at `at`. */
const block = (slot: GearSlot, s: THREE.Vector3Tuple, at: THREE.Vector3Tuple, r: number) =>
  rounded(slot, { wf: s[0], h: s[1], d: s[2], r, e: r, y0: at[1] - s[1] / 2, m: new THREE.Matrix4().makeTranslation(at[0], 0, at[2]), detail: 1 });

/** A grille standing up at the front, `w` by `h` on the face, `t` thick from z0 forward, centred at (0, yc), made as a
 * steel grille is: a flat perforated face (the `grille` slot, holes and all), and its edge bent back round the
 * cabinet as a solid lip (`panel`), so no holes run round the rounded edge. The back is open onto the drivers. */
function grilleSlab(w: number, h: number, t: number, yc: number, z0: number, r: number, m = new THREE.Matrix4()): Piece[] {
  const slab = rounded("grille", { wf: w, h: t, d: h, r, e: Math.min(0.006, t * 0.45), y0: z0 }).geo;
  const place = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, yc, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const p = slab.getAttribute("position"), n = slab.getAttribute("normal"), face: number[] = [], lip: number[] = [], fn: number[] = [], ln: number[] = [];
  const a = new THREE.Vector3(), bv = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    // a triangle's own facing (not its corners' normals, smoothed into the bend): the flat front, +y here and out of
    // the cabinet once turned, is the perforated sheet, shaded flat
    a.fromBufferAttribute(p, i); bv.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const ny = bv.sub(a).cross(c.sub(a)).normalize().y;
    if (ny < -0.999) continue;
    const front = ny > 0.999, [pos, nor] = front ? [face, fn] : [lip, ln];
    for (let k = 0; k < 3; k++) { pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); nor.push(...(front ? [0, 1, 0] : [n.getX(i + k), n.getY(i + k), n.getZ(i + k)])); }
  }
  const make = (slot: GearSlot, pos: number[], nor: number[]): Piece => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return { geo: geo.applyMatrix4(place), slot };
  };
  return [make("grille", face, fn), make("panel", lip, ln)];
}

/** A back panel: a painted steel plate with a screw in each corner. */
function plate(b: Build, w: number, h: number, at: THREE.Vector3Tuple) {
  b.pieces.push(box("panel", [w, h, 0.008], at, { bevel: 0.002 }));
  for (const x of [-1, 1]) for (const y of [-1, 1]) b.pieces.push(...screw([at[0] + x * (w / 2 - 0.012), at[1] + y * (h / 2 - 0.012), at[2] - 0.004], "-z"));
}

/** A knob with a skirt and a pointer, standing out of a face along `out` (+1 front, -1 back). */
function knob(b: Build, at: THREE.Vector3Tuple, out: 1 | -1, r = 0.011) {
  const z = (k: number): THREE.Vector3Tuple => [at[0], at[1], at[2] + out * k];
  b.pieces.push(disc("knob", r * 1.3, 0.003, "z", z(0.0015), 16), lathe("knob", [[0, r, r], [r * 0.9, r * 0.85, r * 0.85], [r * 0.95, 0.001, 0.001]].map(([k, rx, ry]) => [out * k, rx, ry] as [number, number, number]), { seg: 14, m: new THREE.Matrix4().makeTranslation(...z(0.003)) }));
  b.pieces.push(box("chrome", [0.0016, r * 0.7, 0.001], [at[0], at[1] + r * 0.4, at[2] + out * (0.0035 + r * 0.9)]));
}

/** Print on a back panel (a face looking along -z), reading left to right for someone standing behind it: `print`'s
 * up-facing strokes turned to face -z, centred at `at`. */
function backPrint(b: Build, text: string, at: THREE.Vector3Tuple, size = 0.008) {
  const m = new THREE.Matrix4().makeTranslation(...at).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  b.pieces.push(...onto(m, print(text, 0, 0, 0, size)));
}

/** Print on a side face (looking along x, `side` +1 or -1), reading left to right for someone facing it. */
function sidePrint(b: Build, text: string, at: THREE.Vector3Tuple, side: number, size = 0.012) {
  const m = new THREE.Matrix4().makeTranslation(...at).multiply(new THREE.Matrix4().makeRotationY(side > 0 ? -Math.PI / 2 : Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  b.pieces.push(...onto(m, print(text, 0, 0, 0, size)));
}

/** The small plain plate a speaker's grille carries in a corner (no maker's mark), standing just proud of the sheet;
 * `m` places it, its face looking along +z. */
function grillePlate(b: Build, m: THREE.Matrix4) {
  b.pieces.push(...onto(m, [box("metal", [0.05, 0.014, 0.003], [0, 0, 0.0015], { bevel: 0.001 })]));
}

/** A speaker box, built as a moulded PA top is: a cabinet that tapers to the back, a perforated steel grille across
 * the front with the woofer and the horn behind it, a handle set into the top and each side, rubber feet and a pole
 * cup underneath, threaded fly points, and a back panel (a powered box's amp plate has a heat sink and knobs). */
function speaker([w, h, d]: readonly number[], backJacks: string[], powered: boolean): Build {
  const b: Build = { pieces: [], marks: [] }, body = h - 0.025, y0 = 0.012, g = 0.01;
  // a moulded shell: every edge rounded over 3 to 4.5 cm, as an injection-moulded box is
  const wb = w * 0.76, r = Math.min(0.045, w * 0.11), e = Math.min(0.035, h * 0.1), fh = body - y0;
  const shell = rounded("paint", { wf: w, wb, h: fh, d, r, e, y0 });
  // The grille fills the flat of the front, inside the rounded shell, seated in a dark cavity: the baffle 7 cm back,
  // the woofer's cone and the horn's flare reaching forward to just behind the sheet.
  // Under it, a band of the shell carries two bass port slots (a tall enough box only).
  const mw = w - 2 * r - 0.008, fl = fh - 2 * e - 0.008, pb = fl > 0.3 ? Math.min(0.06, fl * 0.12) : 0, mh = fl - pb;
  const gw = mw + 0.004, gh = mh + 0.004, yc = y0 + fh / 2 + pb / 2, cave = Math.min(0.08, d * 0.2);
  const ph0 = pb - 0.02, ports: Well[] = pb ? [-1, 1].map((x) => ({ at: [x * mw * 0.22, yc - mh / 2 - pb / 2 - 0.002, d / 2], w: mw * 0.36, h: ph0, r: ph0 / 2 - 0.001, deep: 0.09, lip: 0.004, walls: "knob", floor: "knob" })) : [];
  const lean = Math.atan2((w - wb) / 2, d - 2 * r), side = (s: number): THREE.Vector3Tuple => [s * Math.cos(lean), 0, -Math.sin(lean)];
  // handles: a pocket in each side the fingers curl into, a pocket with a bridge across it on top, and the back's
  // amp plate (or a passive box's jack cup) sunk in a moulded recess, inside the flat of the back
  const rec = 0.02, lo = y0 + e + 0.008, hi = body - e - 0.008;
  const rw0 = Math.min(w * 0.62, wb - 2 * r - 0.016 - 0.03) + 0.03, rh0 = Math.min(powered ? h * 0.4 : h * 0.18, hi - lo - 0.03) + 0.03;
  const pw = rw0 - 0.03, ph = rh0 - 0.03, py = clamp(powered ? h * 0.32 : h * 0.3, lo + rh0 / 2, hi - rh0 / 2);
  // a scoop moulded deep into each side, high up where the box balances: a hand goes in to the knuckles
  const sh = Math.min(0.1, fh * 0.18), sy = clamp(y0 + fh * 0.7, lo + sh / 2 + 0.01, hi - sh / 2 - 0.01);
  const grip = (s: number): [THREE.Vector3Tuple, Well[]] => [side(s), [{ at: [s * w * 0.43, sy, -0.01], w: Math.min(d * 0.45, d - 2 * r - 0.05), h: sh, r: Math.min(0.03, sh / 2 - 0.004), deep: 0.065, lip: 0.012, draft: 0.008 }]];
  sunk(b, shell, [
    [[0, 0, 1], [{ at: [0, yc, d / 2], w: mw, h: mh, r: 0.012, deep: cave, lip: 0.003, walls: "knob" }, ...ports]],
    grip(-1), grip(1),
    [[0, 1, 0], [{ at: [0, body, -d * 0.04], w: w * 0.42, h: d * 0.2, r: 0.02, deep: 0.035, lip: 0.006, draft: 0.003 }]],
    [[0, 0, -1], [{ at: [0, py, -d / 2], w: rw0, h: rh0, r: 0.014, deep: rec, lip: 0.005, draft: 0.002 }]],
  ]);
  b.pieces.push(rounded("paint", { wf: w * 0.4, h: 0.016, d: d * 0.07, r: 0.006, e: 0.006, y0: body - 0.018, z0: -d * 0.04 }));
  b.pieces.push(...grilleSlab(gw, gh, g, yc, d / 2 - g - 0.003, 0.012));
  const at = (y: number, x = 0) => new THREE.Matrix4().makeTranslation(x, y, d / 2 - g - 0.006);
  const rw = Math.min(gw, gh * 0.62) * 0.43, deep = cave - g - 0.012;
  b.pieces.push(...cone(rw, deep, at(yc - gh * 0.16)));
  b.pieces.push(...horn(gw * 0.62, gh * 0.2, deep, at(yc + gh * 0.3)));
  grillePlate(b, new THREE.Matrix4().makeTranslation(gw / 2 - 0.045, yc - gh / 2 + 0.03, d / 2 - 0.003));
  grilleScrews(b, gw, gh, new THREE.Matrix4().makeTranslation(0, yc, d / 2 - 0.003));
  for (const x of [-1, 1]) for (const [z, half] of [[d / 2 - 0.07, w / 2], [-d / 2 + 0.07, wb / 2]]) b.pieces.push(block("rubber", [0.055, y0 + 0.003, 0.045], [x * (half - 0.07), (y0 + 0.003) / 2, z], 0.008));
  // the pole cup: a steel ring round a dark socket
  b.pieces.push(disc("metal", 0.024, 0.004, "y", [0, y0 - 0.002, 0], 16), disc("knob", 0.018, 0.003, "y", [0, y0 - 0.0035, 0], 16));
  // the fly points: a threaded insert in a steel washer
  for (const z of [-d * 0.3, d * 0.22]) for (const x of [-1, 1]) b.pieces.push(disc("metal", 0.012, 0.002, "y", [x * w * 0.24, body + 0.0005, z], 8), disc("knob", 0.006, 0.003, "y", [x * w * 0.24, body + 0.0005, z], 6));
  // the plate lies on the recess's floor; `bz` is its face
  const bz = -d / 2 + rec - 0.008;
  plate(b, pw, ph, [0, py, bz + 0.004]);
  if (powered) {
    // the amp's heat sink across the top of the plate, its knobs and the power LED below
    const fins = 9;
    for (let i = 0; i < fins; i++) b.pieces.push(box("metal", [0.003, ph * 0.34, 0.008], [-pw * 0.36 + (i * pw * 0.72) / (fins - 1), py + ph * 0.24, bz - 0.004]));
    for (const x of [-0.6, -0.1]) knob(b, [x * pw * 0.5, py - ph * 0.02, bz], -1, 0.009);
    b.pieces.push(disc("light", 0.0035, 0.004, "z", [pw * 0.32, py - ph * 0.02, bz - 0.002], 8));
  }
  const gap = (pw * 0.72) / Math.max(1, backJacks.length - 1);
  jacks(b, backJacks, "back", [-pw * 0.36, py - (powered ? ph * 0.3 : 0), bz], [gap, 0, 0]);
  // the warning, printed along the foot of the plate
  backPrint(b, "RISK OF SHOCK DO NOT OPEN", [0, py - ph / 2 + 0.011, bz - 0.0005], Math.min(0.007, pw / 50));
  mark(b, "grab", [0, body + 0.025, 0]);
  mark(b, "pole-cup", [0, 0.012, 0], [0, -1, 0]);
  return b;
}

/** An 18-inch sub: a rounded-over box in a textured coat, a full steel grille with the cone and the port slot behind
 * it, a cap on every corner, a dish handle in each side, a pole socket on top and the speaker jacks on the back. */
function sub(): Build {
  const [w, h, d] = GEAR_SIZES["sub-18"], b: Build = { pieces: [], marks: [] }, y0 = 0.014, g = 0.014, front = d / 2 - g, fh = h - y0 - 0.004;
  const yc = y0 + fh / 2, cy = yc + 0.06;
  // Behind the grille the baffle is cut: the woofer in a dark well 7 cm deep, and the port, a slot right across the
  // bottom whose rounded-over mouth runs 25 cm back into the box.
  // and a pocket handle sunk in each side
  const grip = (x: number): [THREE.Vector3Tuple, Well[]] => [[x, 0, 0], [{ at: [x * w / 2, h * 0.6, 0], w: 0.16, h: 0.07, r: 0.03, deep: 0.05, lip: 0.008, draft: 0.004 }]];
  sunk(b, rounded("paint", { wf: w - 0.01, h: fh, d: d - g, r: 0.01, y0, z0: -g / 2 }), [[[0, 0, 1], [
    { at: [0, cy, front], w: 0.5, h: 0.5, r: 0.05, deep: 0.075, lip: 0.004, walls: "knob" },
    { at: [0, y0 + 0.07, front], w: w - 0.12, h: 0.05, r: 0.012, deep: 0.25, lip: 0.01, walls: "knob" },
  ]], grip(-1), grip(1)]);
  b.pieces.push(...grilleSlab(w - 0.016, fh - 0.01, g + 0.002, yc, front - 0.001, 0.01));
  b.pieces.push(...cone(0.2, 0.06, new THREE.Matrix4().makeTranslation(0, cy, front - 0.004)));
  grillePlate(b, new THREE.Matrix4().makeTranslation(w / 2 - 0.07, h - 0.06, d / 2 + 0.001));
  grilleScrews(b, w - 0.016, fh - 0.01, new THREE.Matrix4().makeTranslation(0, yc, d / 2 + 0.001), 4);
  // Rigging: a steel plate on each side, towards the front, with three pin holes, bolted through the box, its safe
  // load printed under it; and four bolts round the pole socket's flange.
  for (const x of [-1, 1]) {
    const px = x * (w / 2 - 0.004), pz = d * 0.3, py = h * 0.6, ph = 0.26;
    b.pieces.push(box("panel", [0.005, ph, 0.06], [px, py, pz], { bevel: 0.0015 }));
    for (const k of [-1, 0, 1]) b.pieces.push(disc("knob", 0.009, 0.006, "x", [px, py + k * 0.055, pz], 10));
    for (const y of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(...screw([px + x * 0.003, py + y * (ph / 2 - 0.014), pz + z * 0.018], x > 0 ? "x" : "-x", 0.005));
    sidePrint(b, "SWL 250 KG", [px + x * 0.0015, py - ph / 2 - 0.02, pz], x);
  }
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.pieces.push(...screw([x * 0.03, h + 0.001, z * 0.03], "y", 0.0035));
  // a cap on each corner: the bottom four are its feet
  const c = 0.056;
  for (const x of [-1, 1]) for (const y of [c / 2, h - c / 2]) for (const z of [-1, 1]) b.pieces.push(block("rubber", [c, c, c], [x * (w / 2 - c / 2 + 0.001), y, z * (d / 2 - c / 2 + 0.001)], 0.014));
  b.pieces.push(box("panel", [0.085, 0.003, 0.085], [0, h - 0.0005, 0], { bevel: 0.001 }), disc("metal", 0.026, 0.005, "y", [0, h - 0.0005, 0], 16), disc("knob", 0.019, 0.002, "y", [0, h + 0.002, 0], 16));
  plate(b, w * 0.4, h * 0.16, [0, h * 0.25, -d / 2 - 0.004]);
  jacks(b, ["speaker-in", "speaker-out"], "back", [-w * 0.08, h * 0.25, -d / 2 - 0.008], [w * 0.16, 0, 0]);
  backPrint(b, "8 OHM 1000W", [0, h * 0.25 - h * 0.08 + 0.012, -d / 2 - 0.0085]);
  backPrint(b, "IN", [-w * 0.08, h * 0.25 + 0.026, -d / 2 - 0.0085], 0.007);
  backPrint(b, "LINK", [w * 0.08, h * 0.25 + 0.026, -d / 2 - 0.0085], 0.007);
  mark(b, "grab", [w / 2 + 0.012, h * 0.6, 0], [1, 0, 0]);
  mark(b, "pole", [0, h - 0.005, 0], [0, 1, 0]);
  return b;
}

/** A floor monitor: a wedge whose long sloped face (the grille) looks up at the player, the woofer and the horn side
 * by side behind it, caps on its corners, a handle set into the back and the jack plate beside it. */
function wedge(id: "wedge-12" | "wedge-12-passive" = "wedge-12"): Build {
  const [w, h, d] = GEAR_SIZES[id], b: Build = { pieces: [], marks: [] };
  const lo = 0.08, backTop = -d / 2 + 0.07;
  // the slope's own frame: x across, y up the slope from the front edge, z out of it
  const dz = backTop - d / 2, dy = h - lo, len = Math.hypot(dz, dy);
  const up = new THREE.Vector3(0, dy, dz).divideScalar(len), out = new THREE.Vector3(0, -dz, dy).divideScalar(len);
  const mid: THREE.Vector3Tuple = [0, (lo + h) / 2, (d / 2 + backTop) / 2], slope = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), up, out).setPosition(...mid);
  // the drivers sit in a dark well under the grille, and the handle is a pocket in the back
  sunk(b, prism("paint", [[-d / 2, 0.012], [d / 2, 0.012], [d / 2, lo], [backTop, h], [-d / 2, h]], w - 0.004, 0, 0.008), [
    [out.toArray(), [{ at: mid, w: w - 0.06, h: len - 0.04, r: 0.012, deep: 0.045, lip: 0.003, walls: "knob" }]],
    [[0, 0, -1], [{ at: [0, h * 0.62, -d / 2], w: 0.14, h: 0.05, r: 0.022, deep: 0.04, lip: 0.006, draft: 0.004 }]],
  ]);
  b.pieces.push(...grilleSlab(w - 0.05, len - 0.03, 0.011, 0, 0, 0.012, slope));
  const on = (x: number, y: number) => slope.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, -0.003));
  b.pieces.push(...cone(0.14, 0.035, on(-0.11, 0)), ...horn(0.16, 0.12, 0.035, on(0.17, 0.02)));
  grillePlate(b, slope.clone().multiply(new THREE.Matrix4().makeTranslation((w - 0.05) / 2 - 0.045, -(len - 0.03) / 2 + 0.025, 0.011)));
  grilleScrews(b, w - 0.05, len - 0.03, slope.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.011)));
  const c = 0.05;
  for (const x of [-1, 1]) {
    for (const [y, z] of [[c / 2, -d / 2 + c / 2], [h - c / 2, -d / 2 + c / 2], [c / 2, d / 2 - c / 2]]) b.pieces.push(block("rubber", [c, c, c], [x * (w / 2 - c / 2 + 0.001), y, z + Math.sign(z) * 0.001], 0.012));
  }
  plate(b, w * 0.3, h * 0.2, [w * 0.28, h * 0.25, -d / 2 - 0.004]);
  // powered: mains and a signal in and thru; passive: two speaker jacks, in and the link on
  jacks(b, id === "wedge-12" ? ["power-in", "xlr-in", "xlr-out"] : ["speaker-in", "speaker-out"], "back", [w * 0.2, h * 0.25, -d / 2 - 0.008], [w * 0.08, 0, 0]);
  backPrint(b, id === "wedge-12" ? "DO NOT OPEN" : "8 OHM", [w * 0.28, h * 0.25 - h * 0.1 + 0.01, -d / 2 - 0.0085], 0.0065);
  mark(b, "grab", [0, h * 0.62, -d / 2 - 0.02], [0, 0, -1]);
  return b;
}

function ampHead(): Build {
  const [w, h] = GEAR_SIZES["amp-head"], d = GEAR_SIZES["amp-head"][2] - 0.03, b: Build = { pieces: [], marks: [] }, body = h - 0.03;
  b.pieces.push(box("tolex", [w, body - 0.012, d], [0, 0.012 + (body - 0.012) / 2, 0], { bevel: 0.012 }));
  b.pieces.push(box("panel", [w - 0.05, body * 0.42, 0.008], [0, body * 0.32, d / 2]));
  for (let i = 0; i < 8; i++) b.pieces.push(disc("knob", 0.011, 0.018, "z", [-w * 0.3 + i * w * 0.07, body * 0.32, d / 2 + 0.009], 6));
  b.pieces.push(disc("light", 0.006, 0.01, "z", [w * 0.36, body * 0.32, d / 2 + 0.004], 4));
  b.pieces.push(...handle("rubber", [0, body, 0], "y", 0.22, 0.03));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.012, 0.012, "y", [x * (w / 2 - 0.05), 0.006, z * (d / 2 - 0.04)], 6));
  jacks(b, ["inst-in"], "front", [-w * 0.4, body * 0.32, d / 2 + 0.004], [0, 0, 0], 0.01);
  b.pieces.push(box("panel", [w * 0.4, body * 0.5, 0.008], [0, body * 0.42, -d / 2 - 0.002]));
  jacks(b, ["speaker-out-1", "speaker-out-2", "power-in"], "back", [-w * 0.12, body * 0.42, -d / 2 - 0.006], [w * 0.12, 0, 0]);
  mark(b, "grab", [0, h, 0]);
  return b;
}

function cab4x12(): Build {
  const [w, h, d] = GEAR_SIZES["cab-4x12"], b: Build = { pieces: [], marks: [] };
  b.pieces.push(box("tolex", [w, h - 0.015, d], [0, 0.015 + (h - 0.015) / 2, 0], { bevel: 0.02 }));
  b.pieces.push(box("grille", [w - 0.07, h - 0.08, 0.01], [0, h / 2, d / 2 - 0.003], { bevel: 0.003 }));
  for (const x of [-1, 1]) b.pieces.push(...handle("rubber", [x * w / 2, h * 0.62, 0], x > 0 ? "x" : "-x", 0.16, 0.012));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.015, 0.015, "y", [x * (w / 2 - 0.05), 0.0075, z * (d / 2 - 0.05)], 6));
  b.pieces.push(box("panel", [0.12, 0.08, 0.008], [0, h * 0.3, -d / 2 - 0.002]));
  jacks(b, ["speaker-in"], "back", [0, h * 0.3, -d / 2 - 0.006], [0, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * 0.62, 0], [1, 0, 0]);
  return b;
}

/** A rolling rack: a case on casters with its front lid off, two power amps in the rails. */
function ampRack(): Build {
  const [w, h, d] = GEAR_SIZES["amp-rack-4u"], b: Build = { pieces: [], marks: [] }, wheel = 0.035, floor = wheel * 2 + 0.005;
  const ch = h - floor;
  b.pieces.push(box("paint", [w, ch, d - 0.02], [0, floor + ch / 2, -0.01], { bevel: 0.012 }));
  for (let i = 0; i < 2; i++) {
    const y = floor + ch * (0.27 + i * 0.47);
    b.pieces.push(box("panel", [w - 0.04, ch * 0.42, 0.012], [0, y, d / 2 - 0.016]));
    for (const x of [-1, 1]) b.pieces.push(...handle("chrome", [x * (w / 2 - 0.045), y, d / 2 - 0.01], "z", ch * 0.25, 0.008));
    b.pieces.push(disc("light", 0.005, 0.006, "z", [-w * 0.3, y, d / 2 - 0.008], 4));
    for (const x of [0.1, 0.2]) b.pieces.push(disc("knob", 0.014, 0.012, "z", [x, y, d / 2 - 0.004], 6));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wheel, 0.025, "x", [x * (w / 2 - 0.06), wheel, z * (d / 2 - 0.06)], 8));
    b.pieces.push(box("metal", [0.04, 0.012, 0.05], [x * (w / 2 - 0.06), floor - 0.004, z * (d / 2 - 0.06)]));
  }
  for (const x of [-1, 1]) b.pieces.push(...handle("metal", [x * w / 2, floor + ch * 0.6, 0], x > 0 ? "x" : "-x", 0.16, 0.012));
  b.pieces.push(box("panel", [w * 0.8, ch * 0.5, 0.008], [0, floor + ch * 0.5, -d / 2 - 0.012]));
  const back = -d / 2 - 0.016;
  jacks(b, numbered("xlr-in", 4), "back", [-0.21, floor + ch * 0.62, back], [0.06, 0, 0]);
  jacks(b, numbered("speaker-out", 4), "back", [0.03, floor + ch * 0.62, back], [0.06, 0, 0]);
  jacks(b, ["power-in"], "back", [0.18, floor + ch * 0.38, back], [0, 0, 0], 0.016);
  mark(b, "grab", [w / 2 + 0.012, floor + ch * 0.6, 0], [1, 0, 0]);
  return b;
}

/** A 12-channel mixer (8 mic, 4 line): a low wedge, a column of knobs and a fader per channel, jacks along the back. */
function mixer(): Build {
  const [w, h, d] = GEAR_SIZES["mixer-small"], b: Build = { pieces: [], marks: [] }, front = 0.04, back = h - 0.003;
  b.pieces.push(prism("paint", [[d / 2, 0.006], [d / 2, front], [-d / 2 + 0.05, back], [-d / 2, back], [-d / 2, 0.006]], w));
  const slope = Math.atan2(back - front, d - 0.05), yAt = (z: number) => front + (d / 2 - z) * Math.tan(slope);
  for (let i = 0; i < 12; i++) {
    const x = -w * 0.42 + i * w * 0.062;
    for (const z of [-0.08, -0.03, 0.02]) b.pieces.push(disc("knob", 0.006, 0.012, "y", [x, yAt(z) + 0.004, z], 4));
    b.pieces.push(box("knob", [0.01, 0.012, 0.018], [x, yAt(0.11) + 0.005, 0.11], { rot: [slope, 0, 0] }));
  }
  b.pieces.push(box("knob", [0.014, 0.014, 0.02], [w * 0.4, yAt(0.11) + 0.006, 0.11], { rot: [slope, 0, 0] }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.01, 0.006, "y", [x * (w / 2 - 0.03), 0.003, z * (d / 2 - 0.03)], 6));
  const rear = -d / 2 - 0.002, y = back * 0.55;
  jacks(b, numbered("xlr-in", 8), "back", [-w * 0.42, y, rear], [w * 0.062, 0, 0], 0.009);
  jacks(b, numbered("line-in", 4), "back", [w * 0.08, y, rear], [w * 0.062, 0, 0], 0.007);
  // the mains, line outs and power sit above the inputs
  jacks(b, [...numbered("xlr-out", 4), "line-out-1", "line-out-2", "power-in"], "back", [-w * 0.3, back * 0.85, rear], [w * 0.08, 0, 0], 0.007);
  mark(b, "grab", [0, back, -d / 2 + 0.03]);
  return b;
}

/** A wheeled generator: a tube frame round an engine and a tank, wheels at one end, a fold-out handle at the other. */
function generator(): Build {
  const [w, h, d] = GEAR_SIZES["generator-7kva"], b: Build = { pieces: [], marks: [] }, r = 0.014, wr = 0.1;
  const x0 = -w / 2 + wr, x1 = w / 2 - 0.08, zf = d / 2 - 0.055, y0 = 0.05, y1 = h - r;
  const corners: [number, number][] = [[x0, -zf], [x1, -zf], [x1, zf], [x0, zf]];
  corners.forEach(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % 4];
    b.pieces.push(rod("metal", [x, y0, z], [x, y1, z], r), rod("metal", [x, y1, z], [nx, y1, nz], r), rod("metal", [x, y0, z], [nx, y0, nz], r));
  });
  b.pieces.push(box("paint", [w * 0.55, h * 0.4, d * 0.6], [0, y0 + h * 0.2, 0], { bevel: 0.02 }));
  b.pieces.push(box("lid", [w * 0.5, h * 0.22, d * 0.62], [0, y1 - h * 0.13, 0], { bevel: 0.03 }));
  b.pieces.push(disc("knob", 0.03, 0.02, "y", [w * 0.12, y1 - 0.01, 0], 8));
  for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wr, 0.06, "z", [x0, wr, z * (d / 2 - 0.03)], 10));
    b.pieces.push(disc("metal", wr * 0.45, 0.065, "z", [x0, wr, z * (d / 2 - 0.03)], 8));
    b.pieces.push(rod("rubber", [x1, y0, z * (zf - 0.03)], [x1, 0, z * (zf - 0.03)], 0.015, 4));
    b.pieces.push(rod("metal", [x1, y1 * 0.85, z * zf], [w / 2 - 0.01, y1 * 0.95, z * zf], r));
  }
  b.pieces.push(rod("rubber", [w / 2 - 0.01, y1 * 0.95, -zf], [w / 2 - 0.01, y1 * 0.95, zf], 0.018));
  b.pieces.push(box("panel", [w * 0.4, h * 0.25, d / 2 - zf], [-0.04, h * 0.48, (zf + d / 2) / 2 - 0.006]));
  jacks(b, numbered("power-out", 4), "front", [-w * 0.18, h * 0.43, d / 2 - 0.006], [w * 0.09, 0, 0], 0.014);
  b.pieces.push(disc("light", 0.006, 0.008, "z", [w * 0.08, h * 0.55, d / 2 - 0.006], 4));
  mark(b, "grab", [w / 2 - 0.01, y1 * 0.95, 0], [1, 0, 0]);
  return b;
}

function distro(): Build {
  const [w, h, d] = GEAR_SIZES["distro-box"], b: Build = { pieces: [], marks: [] }, body = h - 0.03;
  b.pieces.push(box("lid", [w, body, d], [0, body / 2, 0], { bevel: 0.015 }));
  b.pieces.push(...handle("rubber", [0, body, 0], "y", 0.16, 0.03));
  b.pieces.push(box("panel", [w - 0.06, body * 0.55, 0.008], [0, body * 0.5, d / 2]));
  jacks(b, numbered("power-out", 6), "front", [-w * 0.32, body * 0.5, d / 2 + 0.004], [w * 0.128, 0, 0], 0.016);
  jacks(b, ["power-in"], "left", [-w / 2, body * 0.5, 0], [0, 0, 0], 0.02);
  mark(b, "grab", [0, h, 0]);
  return b;
}

/** Two cable channels under a yellow lid, between rubber ramps; a tab at one end and a slot at the other link them. */
function cableRamp(): Build {
  const [w, h, d] = GEAR_SIZES["cable-ramp-2ch"], b: Build = { pieces: [], marks: [] }, body = w - 0.04, top = h - 0.006;
  b.pieces.push(prism("rubber", [[-d / 2, 0], [d / 2, 0], [0.11, top], [-0.11, top]], body, -0.02));
  b.pieces.push(box("lid", [body - 0.02, 0.006, 0.2], [-0.02, h - 0.003, 0]));
  for (const z of [-0.05, 0.05]) b.pieces.push(box("knob", [0.004, top * 0.6, 0.07], [-0.02 - body / 2 - 0.001, top * 0.4, z]), box("knob", [0.004, top * 0.6, 0.07], [-0.02 + body / 2 + 0.001, top * 0.4, z]));
  // the tab on the +x end; its slot on the -x end is the dark notch above
  for (const z of [-0.17, 0.17]) b.pieces.push(box("rubber", [0.04, 0.02, 0.06], [w / 2 - 0.02, 0.01, z]));
  mark(b, "link-a", [-w / 2, 0.01, 0], [-1, 0, 0]);
  mark(b, "link-b", [w / 2, 0.01, 0], [1, 0, 0]);
  mark(b, "grab", [-0.02, h, 0]);
  return b;
}

/** A beach cart: a slatted tray on one axle of fat balloon tyres, a leg at the front, a T-handle at the back (-z). */
function sandCart(): Build {
  const [w, h] = GEAR_SIZES["sand-cart"], b: Build = { pieces: [], marks: [] }, tyre = 0.19, bed = 0.16, z0 = -0.45, z1 = 0.55;
  b.pieces.push(box("paint", [w - 0.24, bed, z1 - z0], [0, h - bed / 2, (z0 + z1) / 2], { bevel: 0.01 }));
  for (const x of [-1, 1]) {
    b.pieces.push(disc("rubber", tyre, 0.12, "x", [x * (w / 2 - 0.06), tyre, 0.05], 12));
    b.pieces.push(disc("metal", tyre * 0.4, 0.125, "x", [x * (w / 2 - 0.06), tyre, 0.05], 8));
  }
  b.pieces.push(rod("metal", [-(w / 2 - 0.06), tyre, 0.05], [w / 2 - 0.06, tyre, 0.05], 0.015));
  b.pieces.push(rod("metal", [0, h - bed, z1 - 0.05], [0, 0, z1 - 0.05], 0.015));
  b.pieces.push(rod("metal", [0, h - bed / 2, z0], [0, h - 0.02, -0.59], 0.015));
  b.pieces.push(rod("rubber", [-0.18, h - 0.02, -0.59], [0.18, h - 0.02, -0.59], 0.018));
  mark(b, "grab", [0, h - 0.02, -0.6], [0, 0, -1]);
  return b;
}

/** A dance stack's dolly: a plywood deck on four fat balloon tyres tucked under it, a strap ring at each corner. */
function sandDolly(): Build {
  const [w, h, d] = GEAR_SIZES["sand-dolly"], b: Build = { pieces: [], marks: [] }, deck = 0.03, tyre = (h - deck) / 2;
  b.pieces.push(box("paint", [w, deck, d], [0, h - deck / 2, 0], { bevel: 0.005 }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", tyre, 0.1, "x", [x * (w / 2 - 0.12), tyre, z * (d / 2 - 0.14)], 12));
    b.pieces.push(rod("metal", [x * (w / 2 - 0.01), h - deck, z * (d / 2 - 0.01)], [x * (w / 2 - 0.01), h, z * (d / 2 - 0.01)], 0.012));
  }
  mark(b, "grab", [0, h, -d / 2], [0, 0, -1]);
  return b;
}

/** A 20 litre jerry can: a tall flat can with a three-bar handle on top and a spout at one corner. */
function fuelCan(): Build {
  const [w, h, d] = GEAR_SIZES["jerry-can-20l"], b: Build = { pieces: [], marks: [] }, body = h - 0.05;
  b.pieces.push(box("body", [w, body, d], [0, body / 2, 0], { bevel: 0.015 }));
  b.pieces.push(...handle("metal", [-0.02, body, 0], "y", 0.16, 0.04));
  b.pieces.push(disc("metal", 0.02, 0.03, "y", [w / 2 - 0.04, body + 0.015, 0], 8));
  mark(b, "grab", [-0.02, body + 0.04, 0]);
  return b;
}

/** A road case: on four casters, or (`wheels` false) a trunk that sits on its own skids and takes two to lift. */
function roadCase(id: "road-case-m" | "trunk-case" = "road-case-m", wheels = true): Build {
  const [w, h, d] = GEAR_SIZES[id], b: Build = { pieces: [], marks: [] }, wheel = 0.035, floor = wheels ? wheel * 2 + 0.005 : 0.02;
  const ch = h - floor, cy = floor + ch / 2;
  b.pieces.push(box("paint", [w - 0.01, ch, d - 0.01], [0, cy, 0], { bevel: 0.006 }));
  b.pieces.push(box("metal", [w, 0.016, d], [0, floor + ch * 0.68, 0]));
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(box("chrome", [0.045, 0.045, 0.045], [x * (w / 2 - 0.02), cy + y * (ch / 2 - 0.02), z * (d / 2 - 0.02)], { bevel: 0.01 }));
  for (const x of [-0.18, 0.18]) for (const z of [-1, 1]) b.pieces.push(box("chrome", [0.05, 0.04, 0.012], [x, floor + ch * 0.68, z * (d / 2)]));
  for (const x of [-1, 1]) b.pieces.push(...handle("rubber", [x * (w / 2 - 0.005), floor + ch * 0.4, 0], x > 0 ? "x" : "-x", 0.14, 0.01));
  if (!wheels) for (const z of [-1, 1]) b.pieces.push(box("rubber", [w - 0.06, floor, 0.04], [0, floor / 2, z * (d / 2 - 0.06)]));
  else for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.pieces.push(disc("rubber", wheel, 0.025, "x", [x * (w / 2 - 0.07), wheel, z * (d / 2 - 0.07)], 8));
    b.pieces.push(box("metal", [0.04, 0.012, 0.05], [x * (w / 2 - 0.07), floor - 0.004, z * (d / 2 - 0.07)]));
  }
  mark(b, "grab", [w / 2 + 0.005, floor + ch * 0.4, 0], [1, 0, 0]);
  return b;
}

/** Three legs out of a hub at `hubY`, spread so the feet reach `r` from the pole: one along +z, two behind. */
function tripod(b: Build, r: number, hubY: number, legR: number) {
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3, x = Math.sin(a) * r, z = Math.cos(a) * r;
    b.pieces.push(rod("metal", [0, hubY, 0], [x, 0.012, z], legR));
    b.pieces.push(disc("rubber", legR * 1.6, 0.012, "y", [x, 0.006, z], 6));
    b.pieces.push(rod("metal", [x * 0.45, hubY * 0.45, z * 0.45], [0, hubY * 0.75, 0], legR * 0.6, 4));
  }
}

/** A speaker stand, opened out, its pole at `height` (1.2 to 2.0 m). */
function stand(height: number): Build {
  const b: Build = { pieces: [], marks: [] };
  tripod(b, 0.53, 0.45, 0.012);
  b.pieces.push(rod("metal", [0, 0.25, 0], [0, height * 0.55, 0], 0.019, 8), rod("chrome", [0, height * 0.5, 0], [0, height, 0], 0.017, 8));
  b.pieces.push(disc("knob", 0.025, 0.04, "y", [0, height * 0.55, 0], 6));
  b.pieces.push(rod("knob", [0, height * 0.55, 0], [0.05, height * 0.55, 0], 0.006, 4));
  mark(b, "pole", [0, height, 0], [0, 1, 0]);
  mark(b, "grab", [0, height * 0.45, 0], [1, 0, 0]);
  return b;
}

function micStand(): Build {
  const b: Build = { pieces: [], marks: [] }, mast = 1.05;
  tripod(b, 0.35, 0.18, 0.008);
  b.pieces.push(rod("metal", [0, 0.1, 0], [0, mast, 0], 0.011, 6));
  b.pieces.push(disc("knob", 0.016, 0.03, "y", [0, mast, 0], 6));
  // the boom: a counterweight behind, the clip up front
  const back: THREE.Vector3Tuple = [0.13, mast - 0.12, 0], tip: THREE.Vector3Tuple = [-0.24, 1.58, 0];
  b.pieces.push(rod("metal", back, tip, 0.008, 6), disc("metal", 0.018, 0.04, "x", back, 6));
  b.pieces.push(rod("knob", tip, [tip[0] - 0.012, tip[1] + 0.012, 0], 0.012, 6));
  mark(b, "mic", [tip[0] - 0.012, tip[1] + 0.014, 0], [-0.7, 0.7, 0]);
  mark(b, "grab", [0, mast * 0.7, 0], [1, 0, 0]);
  return b;
}

/** A condenser vocal mic standing on its tail: a body tube, a ring, a ball of mesh on top, the XLR in its tail. */
function micCondenser(): Build {
  const [w, h] = GEAR_SIZES["mic-condenser"], b: Build = { pieces: [], marks: [] }, r = w / 2;
  b.pieces.push(disc("metal", r * 0.62, h * 0.55, "y", [0, h * 0.275, 0], 16), disc("chrome", r * 0.72, 0.008, "y", [0, h * 0.56, 0], 16));
  b.pieces.push(disc("grille", r, h * 0.36, "y", [0, h * 0.78, 0], 18), disc("chrome", r * 1.0, 0.006, "y", [0, h * 0.6, 0], 18));
  b.pieces.push(disc("light", 0.002, 0.003, "z", [0, h * 0.45, r * 0.62], 6));
  // the XLR in the tail, a plug comes up into it from below
  b.marks.push({ name: "jack:xlr-out", at: [0, -0.008, 0], out: [0, -1, 0] });
  mark(b, "grab", [0, h * 0.35, 0], [1, 0, 0]);
  return b;
}

/** An electric guitar standing on its end: a double-bout body, a neck and a headstock. The front faces +z. */
function guitar(): Build {
  const [w, h, d] = GEAR_SIZES.guitar, b: Build = { pieces: [], marks: [] }, lower = w / 2, mid = d / 2;
  b.pieces.push(disc("body", lower, d * 0.8, "z", [0, lower * Math.cos(Math.PI / 12), 0], 12), disc("body", 0.125, d * 0.8, "z", [0.01, 0.38, 0], 10));
  b.pieces.push(box("paint", [0.05, 0.47, 0.022], [0, 0.66, 0.004]), box("paint", [0.085, 0.12, 0.016], [0, h - 0.06, 0]));
  for (let i = 0; i < 6; i++) b.pieces.push(disc("chrome", 0.005, 0.02, "x", [(i < 3 ? -1 : 1) * 0.05, h - 0.1 + (i % 3) * 0.032, 0], 4));
  for (const y of [0.23, 0.34]) b.pieces.push(box("knob", [0.075, 0.022, 0.006], [0, y, d * 0.4 + 0.002]));
  b.pieces.push(box("chrome", [0.08, 0.018, 0.008], [0, 0.15, d * 0.4 + 0.002]));
  for (const [x, y] of [[0.09, 0.12], [0.12, 0.18]]) b.pieces.push(disc("knob", 0.011, 0.012, "z", [x, y, d * 0.4 + 0.005], 6));
  jacks(b, ["line-out"], "front", [0.11, 0.07, mid * 0.8], [0, 0, 0], 0.009);
  mark(b, "grab", [0, 0.68, 0.02], [0, 0, 1]);
  return b;
}

/** A DI box: a steel brick, the instrument in and its thru on the back, the XLR on the front, a ground-lift switch on top. */
function diBox(): Build {
  const [w, h, d] = GEAR_SIZES["di-box"], b: Build = { pieces: [], marks: [] }, body = h - 0.004;
  b.pieces.push(box("paint", [w, body, d - 0.012], [0, body / 2, 0], { bevel: 0.004 }));
  b.pieces.push(box("chrome", [0.012, 0.004, 0.02], [w * 0.25, body + 0.002, -d * 0.2]));
  jacks(b, ["inst-in", "line-out"], "back", [-w * 0.22, body * 0.5, -d / 2 + 0.006], [w * 0.44, 0, 0], 0.008);
  jacks(b, ["xlr-out"], "front", [0, body * 0.5, d / 2 - 0.006], [0, 0, 0], 0.011);
  mark(b, "grab", [0, body, 0]);
  return b;
}

/** A stompbox `w` x `h` x `d`: a die-cast box with its edges rounded, rubber feet, a footswitch toward you (chrome on a
 * nut), a status LED behind it, the instrument jack in on its right end and the out on its left. Its lid's back half is
 * left clear for the knobs an app puts on (the app's circuit says how many). */
function stomp([w, h, d]: THREE.Vector3Tuple): Build {
  const b: Build = { pieces: [], marks: [] }, feet = 0.003, body = h - feet - 0.012;
  b.pieces.push(box("paint", [w, body, d], [0, feet + body / 2, 0], { bevel: Math.min(0.006, w * 0.08) }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.007, feet, "y", [x * (w / 2 - 0.012), feet / 2, z * (d / 2 - 0.014)], 6));
  const top = feet + body, sw = d / 2 - Math.min(0.045, d * 0.25);
  b.pieces.push(disc("chrome", 0.009, 0.004, "y", [0, top + 0.002, sw], 12), disc("chrome", 0.0055, 0.008, "y", [0, top + 0.008, sw], 10));
  b.pieces.push(disc("light", 0.0028, 0.003, "y", [0, top + 0.0015, sw - 0.03], 6));
  jacks(b, ["in"], "right", [w / 2, feet + body * 0.55, -d * 0.2], [0, 0, 0], 0.009);
  jacks(b, ["out"], "left", [-w / 2, feet + body * 0.55, -d * 0.2], [0, 0, 0], 0.009);
  mark(b, "switch", [0, top + 0.012, sw]);
  mark(b, "grab", [0, top, 0]);
  return b;
}

/** A guitar pedal's box as it comes from the bench: about a 125B enclosure, w x h x d in metres. */
export const STOMP_SIZE: THREE.Vector3Tuple = [0.066, 0.04, 0.122];

/** A stompbox at `size` (w x h x d, metres; `STOMP_SIZE` unless asked), built as `gear` builds gear, its paint the
 * pedal's colour: marks `jack:in` (right end), `jack:out` (left end), `switch` (the footswitch's top) and `grab`.
 * Not Load In's catalog: a studio's pedals, loopers and splitters wear it. */
export function stompbox(size: THREE.Vector3Tuple = STOMP_SIZE, { look = gearLook() }: { look?: GearLook } = {}): THREE.Group {
  const s: THREE.Vector3Tuple = [size[0], size[1], size[2]];
  return assemble("stompbox", built(`stompbox@${s.map((v) => v.toFixed(3)).join("x")}`, () => stomp(s)), look, { stomp: true, size: s });
}

/** The venue's back-bar cooler: a cabinet with two glass doors lit from inside, its plug at the back. */
function barCooler(): Build {
  const [w, h, d] = GEAR_SIZES["bar-cooler"], b: Build = { pieces: [], marks: [] };
  b.pieces.push(box("paint", [w, h - 0.02, d], [0, 0.01 + (h - 0.02) / 2, 0], { bevel: 0.01 }));
  for (const x of [-1, 1]) {
    b.pieces.push(box("light", [w / 2 - 0.06, h - 0.2, 0.01], [x * w / 4, h / 2 + 0.03, d / 2 + 0.002]));
    b.pieces.push(box("metal", [0.02, 0.3, 0.02], [x * 0.04, h * 0.55, d / 2 + 0.015]));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.02, 0.01, "y", [x * (w / 2 - 0.05), 0.005, z * (d / 2 - 0.05)], 6));
  jacks(b, ["power-in"], "back", [w * 0.3, 0.15, -d / 2 - 0.004], [0, 0, 0], 0.02);
  mark(b, "grab", [0, h, 0]);
  return b;
}

/**
 * A hung line array box: a wedge seen from the side (the cabinet's top and bottom draw in toward the back, so the box
 * below can splay down), its front split into three grille panels (a 10" woofer behind each outer one, the tall
 * waveguide behind the middle), a pair of D-shaped hand-holds moulded into each side, and black steel rigging on both
 * sides: a front bracket carrying the hinge pins the hang turns on and a pull handle, and a rear link bar drilled
 * with the splay holes, a pin in one. The amp plate sits in a recess in the back.
 */
function lineArray(id: "line-array-10" | "line-array-box"): Build {
  const [w, h, d] = GEAR_SIZES[id], b: Build = { pieces: [], marks: [] }, inner = w - 0.05, taper = h * 0.15, ch = 0.008;
  const front = d / 2 - 0.012, back = -d / 2 + 0.01;
  const body = prism("coat", [[front, 0], [front, h], [back, h - taper], [back, taper]], inner, 0, ch);
  // where the hang pins on (unchanged, so the flying frame still fits), and the rigging's steel round them
  const pinY = [0.014, h - 0.014], plateZ = d / 2 - 0.045, linkZ = back + 0.04, bh = h - 2 * taper, yc = h / 2;
  // the front: one dark cavity behind three grille panels, each its own thin flat slab with a tight edge, a 5 mm seam between each
  const span = inner - 2 * ch - 0.024, seam = 0.005, cw = inner * 0.2, sw = (span - cw - 2 * seam) / 2, gh = h - 2 * ch - 0.026, cave = 0.09, g = 0.008;
  const xs = [-(cw / 2 + seam + sw / 2), 0, cw / 2 + seam + sw / 2], ws = [sw, cw, sw];
  // the side cheeks: a paler pebble-coat panel from behind the front bracket to the rear link bar, two D hand-holds in
  // it, a half-moon over a bar of panel and a half-moon under it
  const tc = 0.0035, z0 = linkZ + 0.032, z1 = plateZ - 0.046, run = (z: number) => taper * (front - z) / (front - back), rim = 0.012;
  const hz = (z0 + z1) / 2, hw = Math.min(0.19, (z1 - z0) * 0.5), hh = Math.min(0.085, h * 0.26), bar = 0.03, lip = 0.005;
  const ds = (s: number, k: number, deep: number, wells: Partial<Well>): Well[] => [1, -1].map((up) => ({
    at: [s * (inner / 2 + k), yc + (up * (hh + bar)) / 2, hz], w: hw - 2 * (k ? 0 : lip), h: hh - 2 * (k ? 0 : lip), r: 0.012, deep, d: up as 1 | -1, ...wells,
  }));
  // the back: the amp plate in a recess
  const rec = 0.016, pw = inner * 0.42, ph = bh * 0.62, px = -inner * 0.18, py = h / 2;
  sunk(b, body, [
    [[0, 0, 1], [{ at: [0, yc, front], w: span + 0.004, h: gh + 0.004, r: 0.006, deep: cave, lip: 0.002, walls: "rubber", floor: "rubber" }]],
    // through the shell under each cheek's pockets, the pocket's walls running on in
    [[-1, 0, 0], ds(-1, 0, 0.05, { lip: 0, draft: 0.004, walls: "knob", floor: "knob" })],
    [[1, 0, 0], ds(1, 0, 0.05, { lip: 0, draft: 0.004, walls: "knob", floor: "knob" })],
    [[0, 0, -1], [{ at: [px, py, back], w: pw + 0.03, h: ph + 0.03, r: 0.01, deep: rec, lip: 0.004, draft: 0.002 }]],
  ]);
  for (const s of [-1, 1]) {
    const cheek = prism("cheek", [[z1, run(z1) + rim], [z1, h - run(z1) - rim], [z0, h - run(z0) - rim], [z0, run(z0) + rim]], tc, s * (inner / 2 + tc / 2), 0.0015);
    sunk(b, cheek, [[[s, 0, 0], ds(s, tc, tc, { lip, walls: "cheek", floor: null })]]);
  }
  // the panels: black perforated steel backed nearly solid, each a flat slab standing half a centimetre proud of the
  // shell, its edge turned on a 3 mm round, the drivers well behind them only a shadow
  const gz = front - g, gt = 0.013, sit = 0.03, deep = cave - sit - 0.006;
  xs.forEach((x, i) => {
    const [sheet, edge] = grilleSlab(ws[i], gh, gt, yc, gz, 0.003, new THREE.Matrix4().makeTranslation(x, 0, 0));
    b.pieces.push({ ...sheet, slot: "mesh" }, { ...edge, slot: "knob" });
    const at = new THREE.Matrix4().makeTranslation(x, yc, gz - sit);
    if (i === 1) b.pieces.push(...horn(cw * 0.7, gh * 0.86, deep, at, 10));
    else b.pieces.push(...cone(Math.min(sw, gh) * 0.42, deep, at, 10));
  });
  grillePlate(b, new THREE.Matrix4().makeTranslation(xs[2] + sw / 2 - 0.045, yc - gh / 2 + 0.025, gz + gt));
  // the rigging, black steel: a pin through each hole the hang uses, each pin on a wire lanyard to an eye beside it
  const pin = (x: number, y: number, z: number, s: number, t: number) => {
    const head: THREE.Vector3Tuple = [x + s * 0.019, y, z], eye: THREE.Vector3Tuple = [x + s * 0.014, y + t * 0.055, z - 0.026];
    b.pieces.push(disc("chrome", 0.0075, 0.032, "x", [x, y, z], 8), disc("knob", 0.012, 0.007, "x", head, 8), disc("chrome", 0.0045, 0.005, "x", eye, 6));
    const sag: THREE.Vector3Tuple = [x + s * 0.02, (y + eye[1]) / 2 - 0.012, (z + eye[2]) / 2 + 0.004];
    b.pieces.push(rod("metal", head, sag, 0.0012, 3), rod("metal", sag, eye, 0.0012, 3));
  };
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.012), rx = s * (w / 2 - 0.0115);
    // the front corner rail: a heavy U channel the full height, wrapped round onto the front beside the frame, its two
    // flanges standing out past the web; the pins top and bottom, a moulded handle housing between them: a deep
    // back plate, two square arms and a fat vertical grip, the hand's gap behind it
    b.pieces.push(box("panel", [0.03, h - 0.002, 0.094], [s * (w / 2 - 0.015), h / 2, plateZ - 0.004], { bevel: 0.005 }));
    b.pieces.push(box("panel", [w / 2 - inner / 2 + 0.006, h - 0.002, 0.012], [s * (w / 2 + inner / 2 - 0.006) / 2, h / 2, front + 0.004], { bevel: 0.003 }));
    for (const k of [-1, 1]) b.pieces.push(box("panel", [0.012, h - 0.004, 0.011], [s * (w / 2 + 0.004), h / 2, plateZ + k * 0.04], { bevel: 0.003 }));
    pinY.forEach((y, i) => pin(x, y, plateZ, s, i ? -1 : 1));
    const gx = s * (w / 2 - 0.004), gy = Math.min(0.062, h * 0.2), hd = 0.064;
    b.pieces.push(box("panel", [0.014, 2 * gy + 0.05, hd + 0.008], [gx, h / 2, plateZ], { bevel: 0.004 }));
    for (const k of [-1, 1]) b.pieces.push(box("knob", [0.03, 0.024, hd], [gx + s * 0.015, h / 2 + k * (gy + 0.002), plateZ], { bevel: 0.006 }));
    b.pieces.push(box("knob", [0.017, 2 * gy + 0.026, hd - 0.012], [gx + s * 0.024, h / 2, plateZ], { bevel: 0.006 }));
    // the rear link bar: drilled down its length in two staggered rows of splay holes, the pin in the one this box hangs at
    b.pieces.push(box("panel", [0.021, bh - 0.004, 0.06], [rx, h / 2, linkZ], { bevel: 0.004 }));
    for (let i = 0; i < 6; i++) for (const k of [-1, 1]) {
      const y = h / 2 + (i / 5 - 0.5) * bh * 0.82 + (k > 0 ? bh * 0.04 : 0);
      if (k > 0 && i === 5) continue;
      b.pieces.push(disc("knob", 0.004, 0.0225, "x", [rx, y, linkZ + k * 0.017], 6));
    }
    pin(rx, h / 2 + bh * 0.2, linkZ, s, -1);
  }
  const bz = back + rec - 0.008;
  plate(b, pw, ph, [px, py, bz + 0.004]);
  for (let i = 0; i < 7; i++) b.pieces.push(box("metal", [0.003, ph * 0.36, 0.008], [px - pw * 0.34 + (i * pw * 0.68) / 6, py + ph * 0.22, bz - 0.004]));
  b.pieces.push(disc("light", 0.0035, 0.004, "z", [px + pw * 0.34, py - ph * 0.12, bz - 0.002], 8));
  jacks(b, ["power-in", "xlr-in", "xlr-out"], "back", [px - pw * 0.32, py - ph * 0.22, bz], [pw * 0.22, 0, 0]);
  backPrint(b, "RISK OF SHOCK DO NOT OPEN", [px, py - ph / 2 + 0.01, bz - 0.0005], Math.min(0.006, pw / 50));
  mark(b, "hinge-top", [0, pinY[1], plateZ], [1, 0, 0]);
  mark(b, "hinge-bottom", [0, pinY[0], plateZ], [1, 0, 0]);
  mark(b, "grab", [0, h, 0]);
  return b;
}

// ---- the DJ booth ---------------------------------------------------------------------------------------------

/** Pieces built flat (y up) moved onto a sloped face: `m` places them. */
const onto = (m: THREE.Matrix4, pieces: Piece[]) => pieces.map((p) => (p.geo.applyMatrix4(m), p));

/** A plain stroke letter for printing on a face: its width (the letter is 1 tall) and its strokes, [x1, y1, x2, y2] in
 * 0..1 of that width and height. Blocky, as small print on gear reads at arm's length. */
const STROKES: Record<string, [number, number[][]]> = (() => {
  const C = [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0, 1, 0]], O = [...C, [1, 0, 1, 1]], P = [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [0, 0.5, 1, 0.5]];
  const S = [[1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [1, 0.5, 1, 0], [1, 0, 0, 0]], minus = [[0.1, 0.5, 0.9, 0.5]];
  const g: Record<string, number[][]> = {
    A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.24, 0.45, 0.76, 0.45]], B: [[0, 0, 0, 1], [0, 1, 0.85, 1], [0, 0.5, 1, 0.5], [0, 0, 1, 0], [0.85, 1, 0.85, 0.5], [1, 0.5, 1, 0]],
    C, D: [[0, 0, 0, 1], [0, 1, 0.6, 1], [0.6, 1, 1, 0.65], [1, 0.65, 1, 0.35], [1, 0.35, 0.6, 0], [0.6, 0, 0, 0]], E: [...C, [0, 0.5, 0.75, 0.5]],
    F: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.75, 0.5]], G: [...C, [1, 0, 1, 0.45], [1, 0.45, 0.55, 0.45]], H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
    I: [[0, 0, 0, 1]], K: [[0, 0, 0, 1], [0, 0.45, 1, 1], [0.35, 0.65, 1, 0]], L: [[0, 0, 0, 1], [0, 0, 1, 0]], M: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 0.5, 0.45], [0.5, 0.45, 1, 1]],
    N: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 1, 0]], O, P, R: [...P, [0.4, 0.5, 1, 0]], S, T: [[0, 1, 1, 1], [0.5, 1, 0.5, 0]], U: [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 1]],
    V: [[0, 1, 0.5, 0], [0.5, 0, 1, 1]], Q: [...O, [0.6, 0.3, 1, 0]], Y: [[0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]], W: [[0, 1, 0.2, 0], [0.2, 0, 0.5, 0.6], [0.5, 0.6, 0.8, 0], [0.8, 0, 1, 1]], X: [[0, 0, 1, 1], [0, 1, 1, 0]],
    "0": O, "1": [[0.6, 0, 0.6, 1], [0.6, 1, 0, 0.7]], "2": [[0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5], [0, 0.5, 0, 0], [0, 0, 1, 0]],
    "3": [[0, 1, 1, 1], [1, 1, 1, 0], [0, 0, 1, 0], [0.3, 0.5, 1, 0.5]], "4": [[0, 1, 0, 0.45], [0, 0.45, 1, 0.45], [0.8, 1, 0.8, 0]], "5": S,
    "6": [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.5], [1, 0.5, 0, 0.5]], "8": [...O, [0, 0.5, 1, 0.5]], "-": minus, "+": [...minus, [0.5, 0.2, 0.5, 0.8]],
  };
  return Object.fromEntries(Object.entries(g).map(([k, s]): [string, [number, number[][]]] => [k, [k === "I" ? 0 : k === "1" ? 0.3 : k === "-" || k === "+" ? 0.5 : 0.62, s]]));
})();

/** Text printed flat on a face that looks up (+y): `size` tall, centred on (x, z) at height y, reading left to right
 * along +x with its top away from you (-z), as a control face reads from where its user stands. Each stroke is one
 * flat strip in the `ink` slot, two triangles. */
function print(text: string, x: number, y: number, z: number, size: number): Piece[] {
  const t = size * 0.15, gap = size * 0.34, letters = [...text].map((c): [number, number[][]] => {
    if (c === " ") return [0.62, []];
    const g = STROKES[c];
    if (!g) throw new Error(`print: no stroke letter for "${c}" in "${text}"`);
    return g;
  });
  const wide = letters.reduce((s, [w]) => s + w * size, 0) + gap * Math.max(0, letters.length - 1), pos: number[] = [];
  let left = x - wide / 2;
  for (const [w, strokes] of letters) {
    for (const [x1, y1, x2, y2] of strokes) {
      const a = new THREE.Vector2(left + x1! * w * size, z - (y1! - 0.5) * size), b = new THREE.Vector2(left + x2! * w * size, z - (y2! - 0.5) * size);
      const along = b.clone().sub(a).normalize().multiplyScalar(t / 2), side = new THREE.Vector2(-along.y, along.x);
      a.sub(along); b.add(along);
      const [p, q, r, s] = [a.clone().add(side), b.clone().add(side), b.clone().sub(side), a.clone().sub(side)];
      // wound so the strip faces up
      const up = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0;
      for (const v of up ? [p, q, r, p, r, s] : [p, r, q, p, s, r]) pos.push(v.x, y, v.y);
    }
    left += w * size + gap;
  }
  if (!pos.length) return [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return [{ geo, slot: "ink" }];
}

/** Round domed dots round a vertical drum of radius `r` (a platter's strobe rim): `count` evenly round each row at
 * the heights `rows`, all rows lined up, each a low dome `size` across, a hexagon fan with its normals bent round so it
 * catches light as a round bump does. */
function dots(slot: GearSlot, r: number, rows: number[], count: number, size: number): Piece {
  const pos: number[] = [], nor: number[] = [], k = size / 2, rise = size * 0.3;
  for (const y of rows) for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2, out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), across = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const centre = out.clone().multiplyScalar(r + rise).setY(y);
    const rim = Array.from({ length: 6 }, (_, j) => {
      const t = (j / 6) * Math.PI * 2, u = Math.cos(t), v = Math.sin(t);
      return { p: out.clone().multiplyScalar(r).addScaledVector(across, u * k).setY(y + v * k), n: out.clone().multiplyScalar(0.55).addScaledVector(across, u).add(new THREE.Vector3(0, v, 0)).normalize() };
    });
    for (let j = 0; j < 6; j++) {
      const p = rim[j]!, q = rim[(j + 1) % 6]!;
      // centre, then the rim the way round that faces out
      for (const [v, n] of [[centre, out], [p.p, p.n], [q.p, q.n]] as const) pos.push(...v.toArray()), nor.push(...n.toArray());
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return { geo, slot };
}

/** A direct-drive turntable: a heavy brushed plinth on damped feet, the platter (strobe dots round its rim, a slip mat
 * and a record on it) to the left, an S-shaped tonearm on its gimbal at the right rear with the counterweight behind
 * and the headshell in front, the pitch fader at the right front, start/stop and 33/45 at the left front. */
function turntable(): Build {
  const [w, , d] = GEAR_SIZES.turntable, b: Build = { pieces: [], marks: [], parts: [] }, foot = 0.03, top = 0.108;
  b.pieces.push(rounded("rubber", { wf: w - 0.004, h: 0.012, d: d - 0.004, r: 0.012, e: 0.004, y0: foot - 0.002, detail: 1 }));
  b.pieces.push(rounded("metal", { wf: w, h: top - foot - 0.01, d, r: 0.01, e: 0.004, y0: foot + 0.008, detail: 1 }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const at: THREE.Vector3Tuple = [x * (w / 2 - 0.045), 0, z * (d / 2 - 0.045)];
    b.pieces.push(loft("rubber", [R(0, 0.034), R(0.012, 0.036), R(0.022, 0.03), R(foot, 0.028)], { seg: 14, m: new THREE.Matrix4().makeTranslation(...at) }));
  }
  const cx = -0.055, cz = 0, platR = 0.166;
  // the platter's well and the strobe light that lights its dots
  b.pieces.push(disc("knob", platR + 0.004, 0.002, "y", [cx, top + 0.001, cz], 40));
  b.pieces.push(disc("knob", 0.013, 0.02, "y", [cx - 0.135, top + 0.01, cz + 0.135], 10), disc("light", 0.009, 0.003, "z", [cx - 0.128, top + 0.012, cz + 0.142], 8));
  // start/stop (a long flat key), 33 and 45, the power knob in the corner
  b.pieces.push(box("knob", [0.052, 0.006, 0.03], [-w / 2 + 0.05, top + 0.003, d / 2 - 0.03], { bevel: 0.002 }));
  for (const i of [0, 1]) b.pieces.push(box("knob", [0.02, 0.005, 0.014], [-w / 2 + 0.1 + i * 0.026, top + 0.0025, d / 2 - 0.025], { bevel: 0.0015 }));
  b.pieces.push(disc("chrome", 0.012, 0.012, "y", [-w / 2 + 0.03, top + 0.006, d / 2 - 0.07], 12));
  // the pitch fader: a slot, a scale and a cap, and the pop-up target light at the platter's edge
  const px = w / 2 - 0.035;
  b.pieces.push(box("knob", [0.006, 0.002, 0.11], [px, top + 0.001, d / 2 - 0.09]));
  for (let i = 0; i < 9; i++) b.pieces.push(box("chrome", [0.008, 0.0012, 0.0012], [px - 0.012, top + 0.0006, d / 2 - 0.035 - i * 0.0137]));
  b.pieces.push(box("knob", [0.024, 0.012, 0.016], [px, top + 0.006, d / 2 - 0.09], { bevel: 0.003 }));
  b.pieces.push(disc("chrome", 0.006, 0.02, "y", [px - 0.02, top + 0.01, d / 2 - 0.02], 8), disc("light", 0.004, 0.004, "y", [px - 0.02, top + 0.021, d / 2 - 0.02], 6));

  // the platter part: its rim with four even rows of round strobe dots, the slip mat, a record and its label, the spindle
  const pl: Piece[] = [];
  pl.push(disc("metal", platR, 0.02, "y", [0, 0.012, 0], 48));
  pl.push(dots("chrome", platR, [0.0052, 0.009, 0.0128, 0.0166], 72, 0.0026));
  pl.push(disc("rubber", 0.152, 0.003, "y", [0, 0.0235, 0], 40));
  pl.push(disc("knob", 0.1524, 0.0018, "y", [0, 0.026, 0], 48));
  pl.push(disc("lid", 0.05, 0.0004, "y", [0, 0.0271, 0], 28), box("paint", [0.03, 0.0005, 0.008], [0.018, 0.0274, 0]));
  pl.push(disc("chrome", 0.0036, 0.014, "y", [0, 0.032, 0], 8));
  b.parts!.push({ name: "platter", at: [cx, top, cz], pieces: pl });

  // the tonearm: its base and gimbal in the plinth, the arm a part that swings about the bearing
  const ax = 0.16, az = -0.07, armY = 0.045, L = 0.235;
  b.pieces.push(disc("metal", 0.034, 0.012, "y", [ax, top + 0.006, az], 24), disc("knob", 0.03, 0.004, "y", [ax, top + 0.014, az], 24));
  // the arm rest and its clip, off the record to the right, where the arm lies at rest
  b.pieces.push(rod("chrome", [ax, top, az + 0.17], [ax, top + armY - 0.005, az + 0.17], 0.004, 6), box("knob", [0.012, 0.006, 0.012], [ax, top + armY - 0.004, az + 0.17]));
  // anti-skate and height dials beside the base
  b.pieces.push(disc("chrome", 0.011, 0.012, "y", [ax + 0.042, top + 0.006, az - 0.02], 12), disc("knob", 0.016, 0.008, "y", [ax - 0.02, top + 0.004, az - 0.05], 12));
  const arm: Piece[] = [];
  arm.push(disc("chrome", 0.016, 0.03, "y", [0, armY - 0.016, 0], 12), disc("metal", 0.011, 0.024, "x", [0, armY, 0], 10));
  // the S: a tube from the bearing, bowing right then left, to the headshell's collar
  const S: THREE.Vector3Tuple[] = [[0, armY, -0.012], [0, armY, 0.04], [0.008, armY, 0.09], [0.004, armY, 0.13], [-0.014, armY, 0.175], [-0.022, armY - 0.002, 0.2]];
  for (let i = 0; i + 1 < S.length; i++) arm.push(rod("chrome", S[i]!, S[i + 1]!, 0.004, 8));
  // the headshell: a collar, a tapered shell turned in, a finger lift, and the cartridge with its stylus at (0, ., L)
  arm.push(disc("chrome", 0.0055, 0.012, "z", [-0.022, armY - 0.002, 0.205], 8));
  arm.push(box("metal", [0.018, 0.003, 0.034], [-0.013, armY - 0.003, 0.224], { rot: [0, -0.35, 0], bevel: 0.001 }));
  arm.push(rod("chrome", [-0.003, armY - 0.002, 0.222], [0.014, armY + 0.002, 0.226], 0.0012, 4));
  arm.push(box("knob", [0.014, 0.014, 0.022], [-0.004, armY - 0.011, L - 0.006], { rot: [0, -0.35, 0], bevel: 0.0015 }), box("light", [0.004, 0.003, 0.004], [0, armY - 0.019, L], {}));
  // behind the bearing: the stub and the counterweight
  arm.push(rod("chrome", [0, armY, -0.012], [0, armY, -0.08], 0.0045, 8));
  arm.push(loft("metal", [R(-0.035, 0.019), R(-0.03, 0.021), R(0.0, 0.021), R(0.005, 0.017)], { seg: 20, m: along("z", [0, armY, -0.072]) }));
  b.parts!.push({ name: "tonearm", at: [ax, top, az], pieces: arm });
  // Where the stylus lands, as the arm's turn about the bearing: at angle a it sits at (ax + L sin a, az + L cos a).
  const groove = (r: number) => {
    let lo = -1.2, hi = 0;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, dist = Math.hypot(ax + L * Math.sin(m) - cx, az + L * Math.cos(m) - cz); if (dist > r) hi = m; else lo = m; }
    return (lo + hi) / 2;
  };
  b.data = { arm: { rest: 0, outer: groove(0.146), inner: groove(0.06) } };

  const back = -d / 2;
  b.pieces.push(box("panel", [0.13, 0.04, 0.004], [w / 2 - 0.1, 0.07, back - 0.001]));
  jacks(b, ["rca-out", "ground-out", "power-in"], "back", [w / 2 - 0.145, 0.07, back - 0.003], [0.04, 0, 0], 0.008);
  mark(b, "grab", [-w / 2 - 0.01, 0.07, 0], [-1, 0, 0]);
  return b;
}

/** A club media player deck: a sloped black top on a grey chassis, the colour screen near the back in a bezel with
 * browse keys round it, the big jog wheel in the middle with its light ring, play and cue at the bottom left, the
 * tempo fader up the right side. */
function deckMedia(): Build {
  const [w, h, d] = GEAR_SIZES["deck-media"], b: Build = { pieces: [], marks: [], parts: [] }, hf = 0.075;
  const slope = Math.atan2(h - hf, d), yAt = (z: number) => hf + (d / 2 - z) * Math.tan(slope);
  // the chassis, and the face plate on it in a darker finish
  b.pieces.push(prism("panel", [[d / 2, 0.008], [d / 2, hf - 0.004], [-d / 2, h - 0.004], [-d / 2, 0.008]], w, 0, 0.004));
  b.pieces.push(prism("paint", [[d / 2 + 0.0015, hf - 0.012], [d / 2 + 0.0015, hf + 0.0005], [-d / 2 + 0.008, h + 0.0005], [-d / 2 + 0.008, h - 0.006]], w - 0.006, 0, 0.002));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.014, 0.008, "y", [x * (w / 2 - 0.03), 0.004, z * (d / 2 - 0.04)], 10));
  /** A frame on the top face at (x, z): flat pieces built there with y up land on the slope. */
  const at = (x: number, z: number) => new THREE.Matrix4().makeTranslation(x, yAt(z), z).multiply(new THREE.Matrix4().makeRotationX(slope));
  const top = (x: number, z: number, pieces: Piece[]) => b.pieces.push(...onto(at(x, z), pieces));
  // the jog: a recessed collar in the face; the platter and its ring are parts
  const jz = 0.045;
  top(0, jz, [disc("metal", 0.122, 0.003, "y", [0, 0.001, 0], 48), disc("knob", 0.11, 0.004, "y", [0, 0.0015, 0], 48)]);
  const jog: Piece[] = [disc("metal", 0.1, 0.012, "y", [0, 0.01, 0], 48), disc("knob", 0.084, 0.003, "y", [0, 0.0172, 0], 40), disc("panel", 0.034, 0.002, "y", [0, 0.0192, 0], 24)];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; jog.push(box("chrome", [0.0024, 0.0012, 0.008], [Math.sin(a) * 0.092, 0.0162, Math.cos(a) * 0.092], { rot: [0, a, 0] })); }
  jog.push(box("light", [0.003, 0.0006, 0.022], [0, 0.0204, 0.012]));
  b.parts!.push({ name: "jog", at: [0, yAt(jz), jz], rot: slope, pieces: jog });
  b.parts!.push({ name: "ring", at: [0, yAt(jz), jz], rot: slope, pieces: [loft("light", [R(0.002, 0.107), R(0.009, 0.107), R(0.009, 0.1015), R(0.002, 0.1015)], { seg: 48, closed: true, caps: false })] });
  // the screen in its bezel, browse knob and keys round it
  const sz = -0.142, sw = 0.15, sh = 0.086;
  top(0, sz, [box("knob", [sw + 0.016, 0.004, sh + 0.016], [0, 0.001, 0], { bevel: 0.0015 })]);
  const quad = new THREE.PlaneGeometry(sw, sh).rotateX(-Math.PI / 2).translate(0, 0.0034, 0).toNonIndexed();
  b.parts!.push({ name: "screen", at: [0, yAt(sz), sz], rot: slope, ownUv: true, pieces: [{ geo: quad, slot: "light" }] });
  top(w / 2 - 0.035, sz + 0.02, [disc("knob", 0.013, 0.014, "y", [0, 0.007, 0], 16), disc("chrome", 0.0135, 0.002, "y", [0, 0.0005, 0], 16)]);
  for (let i = 0; i < 4; i++) top(-w / 2 + 0.03, sz - 0.03 + i * 0.022, [box("knob", [0.022, 0.004, 0.012], [0, 0.002, 0], { bevel: 0.001 })]);
  for (let i = 0; i < 5; i++) top(-0.06 + i * 0.03, sz + sh / 2 + 0.024, [box("knob", [0.022, 0.004, 0.01], [0, 0.002, 0], { bevel: 0.001 })]);
  // play and cue at the bottom left, big round keys with lit rims; hot cues across the top of the jog
  for (const [i, zz] of [[0, d / 2 - 0.03], [1, d / 2 - 0.075]] as const) top(-w / 2 + 0.035, zz, [disc("light", 0.0185, 0.003, "y", [0, 0.0015, 0], 20), disc("knob", 0.016, 0.006, "y", [0, 0.004, 0], 20), ...(i === 0 ? [box("chrome", [0.006, 0.0008, 0.006], [0, 0.0072, 0])] : [])]);
  for (let i = 0; i < 4; i++) top(-0.07 + i * 0.047, jz - 0.135, [box("knob", [0.034, 0.004, 0.014], [0, 0.002, 0], { bevel: 0.0012 }), box("light", [0.028, 0.0008, 0.002], [0, 0.0042, 0.006])]);
  // the tempo fader up the right side: a slot, its scale, the cap
  const tz = 0.07;
  top(w / 2 - 0.032, tz, [box("knob", [0.006, 0.002, 0.13], [0, 0.0008, 0])]);
  for (let i = 0; i < 11; i++) top(w / 2 - 0.018, tz - 0.06 + i * 0.012, [box("chrome", [0.007, 0.0008, 0.0012], [0, 0.0004, 0])]);
  top(w / 2 - 0.032, tz, [box("knob", [0.026, 0.012, 0.016], [0, 0.006, 0], { bevel: 0.003 }), box("chrome", [0.02, 0.0008, 0.002], [0, 0.0122, 0])]);
  // the badge on the front lip: ours, a plain bar
  b.pieces.push(box("chrome", [0.07, 0.008, 0.002], [0, hf - 0.03, d / 2 + 0.001], { bevel: 0.001 }));
  // the slot for a stick and a disc on the front
  b.pieces.push(box("knob", [0.13, 0.006, 0.003], [0.04, hf - 0.05, d / 2 + 0.0005]));
  const back = -d / 2;
  b.pieces.push(box("panel", [0.18, 0.05, 0.004], [0, 0.06, back - 0.001]));
  jacks(b, ["rca-out", "digital-out", "power-in"], "back", [-0.06, 0.06, back - 0.003], [0.06, 0, 0], 0.009);
  mark(b, "grab", [0, yAt(-d / 2 + 0.02), -d / 2 + 0.02]);
  return b;
}

/** A four-channel DJ mixer: a steel body between two moulded side cheeks, a bevelled aluminium top plate screwed down
 * over it with the control field printed in white (channel numbers, the knobs' names, a scale by each meter and
 * fader); per channel a trim, three EQ knobs and a colour filter, a lit level meter and a long channel fader, the
 * crossfader across the front, the master and headphone knobs down the left and the effects down the right; the inputs
 * (phono and line per channel), the outs and the ground post behind. */
function mixerDj(): Build {
  const [w, h, d] = GEAR_SIZES["mixer-dj"], b: Build = { pieces: [], marks: [], parts: [] }, foot = 0.008, top = h - 0.008, cheek = 0.007;
  // the body, the top plate over it (its bevel shows bright round the field), the dark printed field on the plate
  b.pieces.push(box("panel", [w - 2 * cheek, top - foot - 0.004, d], [0, foot + (top - foot - 0.004) / 2, 0], { bevel: 0.003 }));
  b.pieces.push(box("metal", [w - 2 * cheek, 0.005, d - 0.004], [0, top - 0.0015, 0], { bevel: 0.0022 }));
  b.pieces.push(box("paint", [w - 2 * cheek - 0.012, 0.0012, d - 0.018], [0, top + 0.0012, 0], { bevel: 0.0004 }));
  const face = top + 0.0018, CH = [-0.0825, -0.0275, 0.0275, 0.0825], fz = 0.11, travel = 0.06, mz = 0.03, mLen = 0.06, ink = face + 0.0003;
  // the side cheeks: moulded ends a little proud of the plate, the front corner rounded off, two screws in each
  for (const s of [-1, 1]) {
    b.pieces.push(prism("paint", [[d / 2, foot + 0.001], [d / 2, top - 0.014], [d / 2 - 0.016, top + 0.0035], [-d / 2 + 0.008, top + 0.0035], [-d / 2, top - 0.006], [-d / 2, foot + 0.001]], cheek, s * (w / 2 - cheek / 2), 0.0015));
    for (const z of [-d / 4, d / 4]) b.pieces.push(...screw([s * (w / 2 + 0.0008), (foot + top) / 2, z], "x", 0.0028));
  }
  // the plate's screws, in the bright border round the field
  for (const x of [-1, 1]) for (const z of [-0.18, 0, 0.18]) b.pieces.push(...screw([x * (w / 2 - cheek - 0.003), top + 0.0012, z], "y", 0.0017));
  for (const x of [-0.06, 0.06]) b.pieces.push(...screw([x, top + 0.0012, -d / 2 + 0.0045], "y", 0.0017));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.012, foot, "y", [x * (w / 2 - 0.03), foot / 2, z * (d / 2 - 0.035)], 6));
  const say = (text: string, x: number, z: number, size = 0.0026) => b.pieces.push(...print(text, x, ink, z, size));
  /** A knob, its white pointer line printed on its cap, and its name printed where the DJ sees it past the knob: to
   * its left in a channel's column, in front of it elsewhere. */
  const knob = (x: number, z: number, r: number, name: string, slot: GearSlot = "knob", side: "left" | "front" = "front") => {
    b.pieces.push(loft(slot, [R(0, r * 1.15), R(0.003, r * 1.15), R(0.014, r * 0.92)], { seg: 8, m: new THREE.Matrix4().makeTranslation(x, face, z) }));
    b.pieces.push(...print("I", x, face + 0.0141, z - r * 0.45, r * 0.8));
    if (side === "left") say(name, x - 0.0195, z, 0.0024); else say(name, x, z + r * 1.15 + 0.003);
  };
  CH.forEach((x, i) => {
    knob(x, -0.165, 0.0085, "TRIM", "knob", "left");
    for (const [z, name] of [[-0.13, "HI"], [-0.098, "MID"], [-0.066, "LOW"]] as const) knob(x, z, 0.0095, name, "knob", "left");
    knob(x, -0.028, 0.011, "FILTER", "metal");
    // the meter: a dark strip, the lit bar a part over it, filling from the front end back; its scale beside it
    b.pieces.push(box("knob", [0.008, 0.0008, mLen + 0.004], [x + 0.016, face + 0.0004, mz - mLen / 2]));
    for (const [k, dB] of ["-24", "", "-6", "0", "+6"].entries()) {
      const zz = mz - (k / 4) * mLen;
      b.pieces.push(...print("-", x + 0.0225, ink, zz, 0.005));
      if (dB) say(dB, x + 0.0295, zz, 0.0021);
    }
    // the cue key, the channel's number big under it
    b.pieces.push(box("chrome", [0.03, 0.0006, 0.006], [x, face + 0.0003, mz + 0.012]));
    say(String(i + 1), x, mz + 0.027, 0.0075);
    // the channel fader's slot and scale, and its cap as a part at mid travel
    b.pieces.push(box("knob", [0.004, 0.0012, travel + 0.012], [x, face + 0.0006, fz]));
    for (let k = 0; k < 11; k++) b.pieces.push(...print("-", x - 0.011, ink, fz - travel / 2 + k * (travel / 10), k % 5 ? 0.005 : 0.009));
    b.parts!.push({ name: `fader-${i + 1}`, at: [x, face, fz], pieces: [box("knob", [0.014, 0.014, 0.02], [0, 0.007, 0], { bevel: 0.003 }), ...print("-", 0, 0.0141, 0, 0.022)] });
  });
  // the crossfader across the front, its ends named
  const cz = d / 2 - 0.035, ct = 0.045;
  b.pieces.push(box("knob", [ct + 0.014, 0.0012, 0.004], [0, face + 0.0006, cz]));
  for (const s of [-1, 1]) say(s < 0 ? "A" : "B", s * (ct / 2 + 0.014), cz, 0.004);
  b.parts!.push({ name: "cross", at: [0, face, cz], pieces: [box("knob", [0.02, 0.014, 0.014], [0, 0.007, 0], { bevel: 0.003 }), ...print("I", 0, 0.0141, 0, 0.012)] });
  // master and headphones down the left, effects down the right, with their lit keys
  ["MASTER", "BOOTH", "MIX", "LEVEL"].forEach((name, k) => knob(-w / 2 + 0.025, -0.16 + k * 0.05, 0.009, name));
  ["FX", "TIME", "DEPTH"].forEach((name, k) => knob(w / 2 - 0.025, -0.16 + k * 0.05, 0.009, name));
  for (let k = 0; k < 3; k++) b.pieces.push(box("light", [0.014, 0.0012, 0.008], [w / 2 - 0.025, face + 0.0006, 0.0 + k * 0.03]));
  say("ON", w / 2 - 0.025, -0.012, 0.0024);
  b.pieces.push(box("chrome", [0.06, 0.001, 0.008], [0, face + 0.0005, -d / 2 + 0.012]));
  // the front: the headphone sockets, the crossfader curve and reverse knobs, a strip of our own badge
  const fr = d / 2 + 0.001;
  b.pieces.push(disc("metal", 0.009, 0.004, "z", [-w / 2 + 0.04, 0.05, fr], 12), disc("knob", 0.0045, 0.005, "z", [-w / 2 + 0.04, 0.05, fr], 10));
  b.pieces.push(disc("metal", 0.006, 0.004, "z", [-w / 2 + 0.065, 0.05, fr], 10), disc("knob", 0.003, 0.005, "z", [-w / 2 + 0.065, 0.05, fr], 8));
  for (const x of [w / 2 - 0.07, w / 2 - 0.04]) b.pieces.push(disc("knob", 0.007, 0.01, "z", [x, 0.05, fr + 0.004], 10), box("chrome", [0.001, 0.005, 0.001], [x, 0.054, fr + 0.0095]));
  b.pieces.push(box("chrome", [0.07, 0.007, 0.002], [0, 0.05, fr], { bevel: 0.001 }), box("knob", [w - 0.03, 0.003, 0.002], [0, 0.085, fr]));
  const back = -d / 2;
  jacks(b, numbered("phono-in", 4), "back", [-0.15, 0.078, back - 0.002], [0.026, 0, 0], 0.0065, 10);
  jacks(b, numbered("rca-in", 4), "back", [-0.15, 0.045, back - 0.002], [0.026, 0, 0], 0.0065, 10);
  jacks(b, numbered("xlr-out", 4), "back", [0.03, 0.06, back - 0.002], [0.03, 0, 0], 0.011);
  // the ground post: one knurled nut, both lugs go under it
  b.pieces.push(disc("chrome", 0.006, 0.014, "z", [-0.03, 0.078, back - 0.006], 10));
  jacks(b, ["ground-in-1", "ground-in-2"], "back", [-0.03, 0.078, back - 0.012], [0, 0, 0], 0.004, 8);
  jacks(b, ["power-in"], "back", [-0.03, 0.035, back - 0.002], [0, 0, 0], 0.012);
  b.data = { faderTravel: travel, crossTravel: ct };
  mark(b, "grab", [0, h, 0]);
  return b;
}

/** The club media player (`deck-cd`): a dark top plate inside a steel chassis whose top rises gently to the back, the
 * display band across the back with the screen tilted up toward the DJ and its small keys either side, the row of
 * keys under it (loop, the hot cues with their lamps, reverse), the big jog wheel in the middle (its top platter and
 * its ribbed side ring each spin; the lit ring display sits still in its middle), the vinyl/CD mode key with its lamp
 * and the search keys down the left, round CUE and PLAY at the lower left with lit rims, the tall tempo fader up the
 * right with its range and master tempo keys over it; the disc slot and eject in the front, the outs behind. */
function deckCd(): Build {
  const [w, h, d] = GEAR_SIZES["deck-cd"], b: Build = { pieces: [], marks: [], parts: [] }, hf = 0.07, hb = 0.086, foot = 0.008;
  const slope = Math.atan2(hb - hf, d), yAt = (z: number) => hf + (d / 2 - z) * Math.tan(slope);
  // the chassis, and the dark top plate set into it (a band of the chassis shows down each side)
  b.pieces.push(prism("panel", [[d / 2, foot], [d / 2, hf - 0.003], [-d / 2, hb - 0.003], [-d / 2, foot]], w, 0, 0.004));
  b.pieces.push(prism("paint", [[d / 2 + 0.0012, hf - 0.008], [d / 2 + 0.0012, hf + 0.0005], [-d / 2 + 0.004, hb + 0.0005], [-d / 2 + 0.004, hb - 0.006]], w - 0.014, 0, 0.0018));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.014, foot, "y", [x * (w / 2 - 0.03), foot / 2, z * (d / 2 - 0.04)], 10));
  const at = (x: number, z: number) => new THREE.Matrix4().makeTranslation(x, yAt(z), z).multiply(new THREE.Matrix4().makeRotationX(slope));
  const top = (x: number, z: number, pieces: Piece[]) => b.pieces.push(...onto(at(x, z), pieces));
  const say = (text: string, x: number, z: number, size = 0.0032) => top(x, z, print(text, 0, 0.0003, 0, size));
  const key = (x: number, z: number, sw = 0.018, sd = 0.011, lamp = false) =>
    top(x, z, [box("knob", [sw, 0.004, sd], [0, 0.002, 0], { bevel: 0.0012 }), ...(lamp ? [box("light", [sw * 0.7, 0.0008, 0.0018], [0, 0.0042, -sd * 0.28])] : [])]);
  // the jog: a bright trim ring round a dark well; the side ring and the platter spin, the display in its middle stays
  const jz = 0.045, jog: THREE.Vector3Tuple = [0, yAt(jz), jz];
  top(0, jz, [disc("knob", 0.112, 0.003, "y", [0, 0.0005, 0], 48), loft("metal", [R(0, 0.1155), R(0.003, 0.1155), R(0.003, 0.1115), R(0, 0.1115)], { seg: 48, closed: true, caps: false })]);
  const ring: Piece[] = [loft("rubber", [R(0.002, 0.1035), R(0.0165, 0.1035), R(0.0165, 0.0955), R(0.002, 0.0955)], { seg: 48, closed: true, caps: false })];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; ring.push(box("rubber", [0.0026, 0.011, 0.0016], [Math.sin(a) * 0.1042, 0.0095, Math.cos(a) * 0.1042], { rot: [0, a, 0] })); }
  b.parts!.push({ name: "ring", at: jog, rot: slope, pieces: ring });
  b.parts!.push({ name: "platter", at: jog, rot: slope, pieces: [
    disc("metal", 0.0955, 0.004, "y", [0, 0.0145, 0], 48), disc("knob", 0.084, 0.001, "y", [0, 0.017, 0], 40),
    box("ink", [0.003, 0.0006, 0.024], [0, 0.0177, 0.062]),
  ] });
  top(0, jz, [
    disc("knob", 0.036, 0.0045, "y", [0, 0.0195, 0], 32), loft("light", [R(0.0218, 0.031), R(0.0224, 0.031), R(0.0224, 0.0255), R(0.0218, 0.0255)], { seg: 32, closed: true, caps: false }),
    disc("panel", 0.021, 0.0006, "y", [0, 0.022, 0], 24), box("light", [0.002, 0.0006, 0.007], [0, 0.0224, -0.0285]),
  ]);
  // the display band across the back: its face tilts up toward the DJ, the screen in a bezel, keys either side
  const z1 = -0.092, zb = -d / 2, y1 = yAt(z1) + 0.003, tilt = Math.atan2(h - y1, z1 - zb);
  const plane = (z: number) => y1 + (z1 - z) * Math.tan(tilt);
  b.pieces.push(prism("paint", [[z1, yAt(z1) - 0.01], [z1, y1], [zb, h], [zb, hb - 0.01]], w - 0.014, 0, 0.0025));
  const band = (x: number, z: number, pieces: Piece[]) => b.pieces.push(...onto(new THREE.Matrix4().makeTranslation(x, plane(z), z).multiply(new THREE.Matrix4().makeRotationX(tilt)), pieces));
  const sz = -0.142, sw = 0.115, sh = 0.066;
  band(0, sz, [box("knob", [sw + 0.014, 0.003, sh + 0.012], [0, 0.0005, 0], { bevel: 0.001 })]);
  const quad = new THREE.PlaneGeometry(sw, sh).rotateX(-Math.PI / 2).translate(0, 0.0022, 0).toNonIndexed();
  b.parts!.push({ name: "screen", at: [0, plane(sz), sz], rot: tilt, ownUv: true, pieces: [{ geo: quad, slot: "light" }] });
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) band(s * 0.118, sz - 0.022 + i * 0.022, [box("knob", [0.02, 0.004, 0.01], [0, 0.002, 0], { bevel: 0.0012 })]);
  band(-0.118, sz + 0.034, print("TIME", 0, 0.0003, 0, 0.003));
  band(0.118, sz + 0.034, print("TEXT", 0, 0.0003, 0, 0.003));
  // the row under the band: loop in and out at the ends, the four hot cues with their lamps between
  for (let i = 0; i < 4; i++) key(-0.07 + i * 0.047, -0.08, 0.032, 0.011, true);
  for (const s of [-1, 1]) key(s * 0.122, -0.08, 0.022, 0.011);
  say("IN", -0.122, -0.068, 0.0028); say("OUT", 0.122, -0.068, 0.0028);
  // down the left: the vinyl/CD mode key and its lamp, then track and search back and forward
  top(-0.136, -0.042, [disc("knob", 0.008, 0.005, "y", [0, 0.0025, 0], 16), disc("light", 0.0022, 0.0012, "y", [0.014, 0.0006, 0], 8)]);
  say("VINYL", -0.136, -0.028, 0.0028);
  for (let i = 0; i < 4; i++) key(-0.14, -0.005 + i * 0.024);
  say("SEARCH", -0.14, 0.088, 0.0026);
  // CUE and PLAY: big round keys with lit rims, each a part the room can light
  for (const [name, z] of [["cue", 0.13], ["play", 0.175]] as const) {
    b.parts!.push({ name, at: [-0.1295, yAt(z), z], rot: slope, pieces: [disc("light", 0.0188, 0.003, "y", [0, 0.0015, 0], 24), disc("knob", 0.0165, 0.007, "y", [0, 0.0045, 0], 24)] });
    say(name.toUpperCase(), -0.096, z + 0.012, 0.0034);
  }
  // the tempo fader up the right: its slot, a scale with the zero mark long, the cap a part; range and master tempo over it
  const tx = 0.135, tz = 0.075, tempo = 0.1;
  top(tx, tz, [box("knob", [0.005, 0.0016, tempo + 0.014], [0, 0.0006, 0])]);
  for (let k = 0; k <= 10; k++) top(tx + 0.0135, tz - tempo / 2 + k * (tempo / 10), [box("ink", [k === 5 ? 0.008 : 0.005, 0.0006, 0.0011], [0, 0.0003, 0])]);
  say("-", tx, tz - tempo / 2 - 0.012, 0.005); say("+", tx, tz + tempo / 2 + 0.011, 0.005);
  say("TEMPO", tx, tz + tempo / 2 + 0.021, 0.003);
  b.parts!.push({ name: "tempo", at: [tx, yAt(tz), tz], rot: slope, pieces: [box("knob", [0.022, 0.011, 0.014], [0, 0.0055, 0], { bevel: 0.003 }), box("ink", [0.018, 0.0006, 0.0018], [0, 0.0113, 0])] });
  key(tx, -0.045, 0.018, 0.01, true); key(tx, -0.018, 0.018, 0.01);
  // the front: the disc slot, eject, a plain badge of our own
  const fr = d / 2 + 0.0008;
  b.pieces.push(box("knob", [0.14, 0.005, 0.003], [0.035, 0.04, fr]), box("metal", [0.146, 0.009, 0.0015], [0.035, 0.04, fr - 0.0004]));
  b.pieces.push(box("knob", [0.018, 0.008, 0.004], [-0.06, 0.04, fr + 0.001], { bevel: 0.0012 }), box("chrome", [0.05, 0.006, 0.0015], [-0.115, 0.04, fr], { bevel: 0.0006 }));
  const back = -d / 2;
  b.pieces.push(box("panel", [0.18, 0.045, 0.004], [0, 0.045, back - 0.001]));
  jacks(b, ["rca-out", "digital-out", "power-in"], "back", [-0.06, 0.045, back - 0.003], [0.06, 0, 0], 0.009);
  b.data = { tempoTravel: tempo };
  mark(b, "grab", [0, h, -d / 2 + 0.03]);
  return b;
}

/** The four-channel analog club mixer with twin filters (`mixer-club-4`): a dark steel case, the face plate screwed
 * down over it and printed in white; per channel a gain, four EQ knobs with coloured caps, two aux sends, the filter
 * assign and cue keys with their lamps, an LED meter and a long fader; the mic and return strip down the left, master,
 * booth, the master meters and the phones down the right; along the front the two filters (a big frequency knob, a
 * resonance knob and three type keys each) either side of the crossfader. The headphone sockets in the front edge,
 * the inputs, outs and ground post behind. */
function mixerClub4(): Build {
  const [w, h, d] = GEAR_SIZES["mixer-club-4"], b: Build = { pieces: [], marks: [], parts: [] }, foot = 0.008, face = h - 0.017;
  b.pieces.push(box("panel", [w, face - 0.002 - foot, d], [0, foot + (face - 0.002 - foot) / 2, 0], { bevel: 0.004 }));
  b.pieces.push(box("paint", [w - 0.006, 0.0022, d - 0.006], [0, face - 0.0011, 0], { bevel: 0.0008 }));
  for (const x of [-1, 1]) for (const z of [-0.17, 0, 0.17]) b.pieces.push(...screw([x * (w / 2 - 0.0065), face + 0.0004, z], "y", 0.0018, "chrome", 6));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.012, foot, "y", [x * (w / 2 - 0.03), foot / 2, z * (d / 2 - 0.035)], 8));
  const ink = face + 0.0003, say = (text: string, x: number, z: number, size = 0.0026) => b.pieces.push(...print(text, x, ink, z, size));
  /** A knob: a black ribbed body, its cap in `cap`'s colour, the white pointer printed across the cap. */
  const knob = (x: number, z: number, r: number, cap: GearSlot): Piece[] => [
    loft("knob", [R(0, r * 1.12), R(0.011, r * 0.92), R(0.011, 0)], { seg: 8, caps: false, m: new THREE.Matrix4().makeTranslation(x, face, z) }),
    disc(cap, r * 0.78, 0.0016, "y", [x, face + 0.0115, z], 6), ...print("I", x, face + 0.0124, z - r * 0.38, r * 0.7),
  ];
  const keyAt = (x: number, z: number, lamp: GearSlot | null, sw = 0.013, sd = 0.007) => {
    b.pieces.push(box("knob", [sw, 0.004, sd], [x, face + 0.002, z]));
    if (lamp) b.pieces.push(box(lamp, [sw * 0.6, 0.0008, 0.0016], [x, face + 0.0042, z - sd * 0.25]));
  };
  /** An LED meter: a dark strip from the front end `z0` back `len`, its scale printed beside it. */
  const meter = (x: number, z0: number, len: number) => {
    b.pieces.push(box("knob", [0.005, 0.0008, len + 0.004], [x, face + 0.0004, z0 - len / 2]));
    for (let k = 0; k <= 6; k++) b.pieces.push(...print("-", x - 0.0055, ink, z0 - (k / 6) * len, 0.004));
  };
  const CH = [-0.07875, -0.02625, 0.02625, 0.07875], EQ: [string, GearSlot][] = [["HI", "shell"], ["MID", "lid"], ["MID", "body"], ["LO", "badge"]];
  const fz = 0.07, travel = 0.06, mz = -0.032, mLen = 0.092;
  CH.forEach((x, i) => {
    const kx = x - 0.005;
    b.pieces.push(...knob(kx, -0.16, 0.0065, "metal"));
    EQ.forEach(([name, cap], k) => { b.pieces.push(...knob(kx, -0.134 + k * 0.022, 0.0072, cap)); if (i === 0) say(name, -0.1325 + 0.021, -0.134 + k * 0.022, 0.0024); });
    for (const k of [0, 1]) b.pieces.push(...knob(kx, -0.044 + k * 0.02, 0.0062, "chrome"));
    keyAt(kx, -0.008, "lid"); keyAt(kx, 0.01, "light");
    // the channel's meter, and its lit bar a part over it: origin at the front end, the bar up its +y (back along the face)
    meter(x + 0.019, mz, mLen);
    b.parts!.push({ name: `meter-${i + 1}`, at: [x + 0.019, face + 0.0012, mz], rot: -Math.PI / 2, pieces: [box("light", [0.003, mLen, 0.0006], [0, mLen / 2, 0.0003])] });
    // the fader: its slot, a scale, its number under it, the cap a part at mid travel
    b.pieces.push(box("knob", [0.0035, 0.0012, travel + 0.012], [x, face + 0.0006, fz]));
    for (let k = 0; k <= 10; k++) b.pieces.push(...print("-", x - 0.011, ink, fz - travel / 2 + k * (travel / 10), k % 5 ? 0.004 : 0.008));
    say(String(i + 1), x + 0.012, fz + travel / 2 + 0.002, 0.006);
    b.parts!.push({ name: `fader-${i + 1}`, at: [x, face, fz], pieces: [box("knob", [0.012, 0.012, 0.018], [0, 0.006, 0], { bevel: 0.0025 }), box("ink", [0.0105, 0.0006, 0.0014], [0, 0.0121, 0])] });
  });
  say("GAIN", -0.1325 + 0.021, -0.16, 0.0024); say("AUX", -0.1325 + 0.021, -0.034, 0.0024);
  say("CUE", -0.1325 + 0.021, 0.01, 0.0024);
  // the mic and return strip down the left
  [-0.16, -0.134, -0.112, -0.07].forEach((z, k) => b.pieces.push(...knob(-0.1325, z, 0.0065, k === 3 ? "metal" : k === 1 ? "shell" : k === 2 ? "badge" : "metal")));
  keyAt(-0.1325, -0.045, "light");
  say("MIC", -0.1325, -0.171, 0.003); say("RTN", -0.1325, -0.082, 0.003);
  // master, booth, the master meters and the phones down the right
  b.pieces.push(...knob(0.1325, -0.158, 0.0085, "body"), ...knob(0.1325, -0.124, 0.0072, "chrome"));
  say("MASTER", 0.1325, -0.171, 0.0026); say("BOOTH", 0.1325, -0.137, 0.0026);
  for (const dx of [-0.006, 0.006]) { meter(0.1325 + dx, -0.03, 0.07); b.pieces.push(box("light", [0.003, 0.0006, 0.042], [0.1325 + dx, face + 0.0014, -0.03 - 0.021])); }
  b.pieces.push(...knob(0.1325, 0.0, 0.0068, "metal"), ...knob(0.1325, 0.026, 0.0068, "metal"));
  say("PHONES", 0.1325, 0.04, 0.0024);
  // the twin filters along the front either side of the crossfader: frequency (a part that turns), resonance, three types
  for (const [n, s] of [[1, -1], [2, 1]] as const) {
    const fx = s * 0.115;
    b.parts!.push({ name: `filter-${n}`, at: [fx, face, 0.138], pieces: knob(0, 0, 0.0115, "chrome").map((p) => (p.geo.translate(0, -face, 0), p)) });
    b.pieces.push(...knob(s * 0.078, 0.132, 0.0068, "metal"));
    for (let k = 0; k < 3; k++) keyAt(s * 0.115 + (k - 1) * 0.018, 0.163, "light", 0.012, 0.006);
    say("FREQ", fx, 0.122, 0.0024); say("RES", s * 0.078, 0.12, 0.0024); say(String(n), s * 0.145, 0.138, 0.005);
  }
  const cz = 0.155, ct = 0.045;
  b.pieces.push(box("knob", [ct + 0.012, 0.0012, 0.0035], [0, face + 0.0006, cz]));
  for (const s of [-1, 1]) say(s < 0 ? "A" : "B", s * (ct / 2 + 0.012), cz, 0.004);
  b.parts!.push({ name: "cross", at: [0, face, cz], pieces: [box("knob", [0.018, 0.012, 0.012], [0, 0.006, 0], { bevel: 0.0025 }), box("ink", [0.0014, 0.0006, 0.0105], [0, 0.0121, 0])] });
  // the front edge: two headphone sockets at the right
  const fr = d / 2 + 0.001;
  b.pieces.push(disc("metal", 0.0085, 0.004, "z", [w / 2 - 0.04, 0.04, fr], 12), disc("knob", 0.0045, 0.005, "z", [w / 2 - 0.04, 0.04, fr], 10));
  b.pieces.push(disc("metal", 0.0055, 0.004, "z", [w / 2 - 0.065, 0.04, fr], 10), disc("knob", 0.0028, 0.005, "z", [w / 2 - 0.065, 0.04, fr], 8));
  const back = -d / 2;
  jacks(b, numbered("phono-in", 4), "back", [-0.15, 0.055, back - 0.002], [0.026, 0, 0], 0.0065, 8);
  jacks(b, numbered("rca-in", 4), "back", [-0.15, 0.03, back - 0.002], [0.026, 0, 0], 0.0065, 8);
  jacks(b, numbered("xlr-out", 4), "back", [0.03, 0.042, back - 0.002], [0.03, 0, 0], 0.011);
  b.pieces.push(disc("chrome", 0.006, 0.014, "z", [-0.03, 0.055, back - 0.006], 10));
  jacks(b, ["ground-in-1", "ground-in-2"], "back", [-0.03, 0.055, back - 0.012], [0, 0, 0], 0.004, 8);
  jacks(b, ["power-in"], "back", [-0.03, 0.026, back - 0.002], [0, 0, 0], 0.012);
  b.data = { faderTravel: travel, crossTravel: ct };
  mark(b, "grab", [0, h, 0]);
  return b;
}

// ---- the festival's systems (#5029 step 9) ----------------------------------------------------------------------

/** A horn's mouth flaring back from the front face: `w` by `h`, `deep` into the box, squarer as `p` grows. */
function mouth(b: Build, w: number, h: number, deep: number, at: THREE.Vector3Tuple, p = 6, slot: GearSlot = "panel") {
  const m = new THREE.Matrix4().makeTranslation(...at);
  b.pieces.push(lathe(slot, [[-deep, w * 0.1, h * 0.1], [-deep * 0.6, w * 0.24, h * 0.26], [-deep * 0.25, w * 0.4, h * 0.41], [0, w / 2, h / 2]], { p, seg: 24, m }));
  b.pieces.push(disc("knob", Math.min(w, h) * 0.1, 0.01, "z", [at[0], at[1], at[2] - deep], 12));
}

/**
 * A horn-loaded box of the dance stack: a black cabinet whose front is a well (its walls run the full depth) filled by
 * its horn mouths, the maker's purple plate on the top rail, bar handles on the sides and the speaker jacks on the back.
 */
function hornCab(id: GearId, mouths: [x: number, y: number, w: number, h: number, p?: number][], deep: number, { badge = true, skin = "paint" as GearSlot } = {}): Build {
  const [w, h, d] = GEAR_SIZES[id], b: Build = { pieces: [], marks: [] }, t = 0.04, front = d / 2;
  well(b, skin, GEAR_SIZES[id], deep, t);
  b.pieces.push(box("knob", [w - 2 * t, h - 2 * t, 0.01], [0, h / 2, front - deep]));
  for (const [x, y, mw, mh, p] of mouths) mouth(b, mw, mh, deep * 0.92, [x, y, front - 0.004], p, skin === "paint" ? "panel" : skin);
  if (badge) b.pieces.push(box("badge", [0.15, 0.026, 0.004], [w / 2 - t - 0.1, h - t / 2, front + 0.001]));
  for (const s of [-1, 1]) b.pieces.push(...handle("metal", [s * w / 2, h * 0.6, -d * 0.1], s > 0 ? "x" : "-x", 0.18, 0.012));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(block("rubber", [0.05, 0.012, 0.05], [x * (w / 2 - 0.05), 0.006, z * (d / 2 - 0.05)], 0.004));
  plate(b, w * 0.3, h * 0.2, [0, h * 0.45, -d / 2 - 0.004]);
  jacks(b, ["speaker-in", "speaker-out"], "back", [-w * 0.06, h * 0.45, -d / 2 - 0.008], [w * 0.12, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * 0.6, 0], [1, 0, 0]);
  return b;
}
const midHigh = () => hornCab("stack-mid-high", [[-0.09, 0.25, 0.47, 0.41], [0.245, 0.25, 0.17, 0.2]], 0.32);
const midBass = () => hornCab("stack-mid-bass", [[0, 0.375, 0.66, 0.66]], 0.42);
const hornSub = () => hornCab("horn-sub-21", [[0, 0.46, 1.01, 0.5]], 0.55);

// ---- the other rigs on the sand (Qollab Studio's Desert Gathering, packages/gear systems.ts) -------------------------

/** A horn box's shell, `w` by `h` by `d`, open at the front: a back panel and four walls the full depth, one piece
 * each, so no seam runs round the box (its front is the well `deep` into it that the horn mouths fill). */
function well(b: Build, skin: GearSlot, [w, h, d]: readonly number[], deep: number, t: number) {
  const back = Math.max(t, d - deep);
  b.pieces.push(box(skin, [w - 2 * t, h - 2 * t, back], [0, h / 2, -d / 2 + back / 2]));
  for (const s of [-1, 1]) b.pieces.push(box(skin, [t, h, d], [s * (w / 2 - t / 2), h / 2, 0], { bevel: 0.008 }));
  for (const y of [t / 2, h - t / 2]) b.pieces.push(box(skin, [w - 2 * t + 0.002, t, d], [0, y, 0], { bevel: 0.006 }));
}

/** The back of a passive box: a plate with the speaker jacks, rubber feet, a bar handle each side and the grab. */
function backAndFeet(b: Build, [w, h, d]: readonly number[], handleY = 0.6) {
  for (const s of [-1, 1]) b.pieces.push(...handle("knob", [s * w / 2, h * handleY, -d * 0.1], s > 0 ? "x" : "-x", 0.16, 0.01));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(block("rubber", [0.05, 0.012, 0.05], [x * (w / 2 - 0.05), 0.006, z * (d / 2 - 0.05)], 0.004));
  plate(b, w * 0.3, Math.min(0.2, h * 0.2), [0, h * 0.45, -d / 2 - 0.004]);
  jacks(b, ["speaker-in", "speaker-out"], "back", [-w * 0.06, h * 0.45, -d / 2 - 0.008], [w * 0.12, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * handleY, 0], [1, 0, 0]);
}

/**
 * The synergy horn: one square box, 71 cm a side, whose whole front is a single pyramid horn in a textured black coat.
 * The tweeter's compression driver sits at the throat; the four mids fire into the horn's walls through small ports
 * part way up it, and the two 12" woofers through slots near its mouth, so all three ways leave from one point (the
 * box that sums as one source, 50 x 50 degrees). Flying points at the corners.
 */
function synergyHorn(): Build {
  const size = GEAR_SIZES["synergy-horn"], [w, h, d] = size, b: Build = { pieces: [], marks: [] }, t = 0.022, deep = d * 0.78, front = d / 2;
  well(b, "coat", size, deep, t);
  const W = w - 2 * t, H = h - 2 * t;
  b.pieces.push(lathe("coat", [[-deep * 0.97, W * 0.035, H * 0.035], [-deep * 0.6, W * 0.2, H * 0.2], [-deep * 0.3, W * 0.35, H * 0.35], [0, W / 2, H / 2]], { p: 7, seg: 32, m: new THREE.Matrix4().makeTranslation(0, h / 2, front - 0.004) }));
  b.pieces.push(disc("knob", 0.022, 0.012, "z", [0, h / 2, front - deep * 0.95], 12));
  // the mids' ports: one in each wall, part way up the horn (walls at a fifth of the width there)
  const mz = front - 0.004 - deep * 0.6, mr = W * 0.2 - 0.002;
  for (const [x, y, axis] of [[mr, 0, "x"], [-mr, 0, "x"], [0, mr, "y"], [0, -mr, "y"]] as const) b.pieces.push(disc("knob", 0.03, 0.02, axis, [x, h / 2 + y, mz], 12));
  // the woofers' slots near the mouth, top and bottom walls
  const wz = front - 0.004 - deep * 0.22, wr = W * 0.39;
  for (const y of [wr, -wr]) b.pieces.push(box("knob", [W * 0.4, 0.024, 0.07], [0, h / 2 + y, wz]));
  for (const x of [-1, 1]) for (const y of [0.04, h - 0.04]) b.pieces.push(box("knob", [0.006, 0.05, 0.12], [x * (w / 2 + 0.003), y, -d / 2 + 0.1]));
  backAndFeet(b, size, 0.5);
  return b;
}

/**
 * A tapped horn with one 18": a tall black box, its mouth a wide well across the top of the front, the folded horn's
 * last slanted panel showing inside it; the rest of the front is flat. Loud for its size down to about 30 Hz.
 */
function tappedHorn(): Build {
  const size = GEAR_SIZES["tapped-horn-18"], [w, h, d] = size, b: Build = { pieces: [], marks: [] }, t = 0.02, mh = 0.34, deep = d * 0.8, front = d / 2;
  well(b, "coat", size, deep, t);
  b.pieces.push(box("coat", [w - 2 * t, h - mh - t, 0.02], [0, (h - mh + t) / 2, front - 0.01]));
  b.pieces.push(box("coat", [w - 2 * t, h - mh - t, deep], [0, (h - mh + t) / 2, front - deep / 2 - 0.01]));
  // the fold's last panel, slanting up from the mouth's floor to the back
  const slant = Math.atan2(mh - t * 2, deep);
  b.pieces.push(box("panel", [w - 2 * t, 0.012, Math.hypot(deep, mh - 2 * t) * 0.98], [0, h - mh / 2, front - deep / 2], { rot: [slant, 0, 0] }));
  backAndFeet(b, size, 0.55);
  return b;
}

/**
 * The sculpted family's triple 21: a wide, low hybrid-horn bass bin (three 21" drivers loading a bandpass horn), a
 * black coat with the family's teal moulding across its top and bottom lips, and one long, rounded mouth across the
 * front. 214 kg: it goes on with a forklift or six people.
 */
function triple21(): Build {
  const size = GEAR_SIZES["triple-21-sub"], [w, h, d] = size, b: Build = { pieces: [], marks: [] }, t = 0.07, deep = 0.5;
  well(b, "coat", size, deep, t);
  mouth(b, w - 2 * t - 0.02, h - 2 * t - 0.02, deep * 0.94, [0, h / 2, d / 2 - 0.004], 4, "coat");
  for (const k of [-1, 0, 1]) b.pieces.push(disc("knob", 0.05, 0.02, "z", [k * 0.4, h / 2, d / 2 - deep * 0.9], 12));
  for (const y of [0.012, h - 0.012]) b.pieces.push(box("shell", [w + 0.004, 0.024, 0.06], [0, y, d / 2 - 0.028], { bevel: 0.008 }));
  for (const s of [-1, 1]) b.pieces.push(...handle("knob", [s * w / 2, h * 0.75, d * 0.2], s > 0 ? "x" : "-x", 0.16, 0.01));
  backAndFeet(b, size, 0.5);
  return b;
}

/**
 * The tri-amp horn top: a deep birch box in black, two 10" mid drivers each loaded by its own short round horn with a
 * bullet phase plug in its throat, side by side over the low half of the front; a 1" waveguide over them. Narrow and
 * long-throwing, the old touring way (sheets for this class: high-Q, about 35 x 25 degrees).
 */
function triAmpTop(): Build {
  const b = hornCab("tri-amp-top", [[-0.18, 0.27, 0.34, 0.34, 2], [0.18, 0.27, 0.34, 0.34, 2], [0, 0.6, 0.46, 0.2, 8]], 0.5, { badge: false, skin: "coat" });
  const front = GEAR_SIZES["tri-amp-top"][2] / 2;
  for (const x of [-0.18, 0.18]) b.pieces.push(lathe("knob", [[-0.44, 0.05, 0.05], [-0.36, 0.04, 0.04], [-0.28, 0.02, 0.02], [-0.24, 0.004, 0.004]], { p: 2, seg: 16, m: new THREE.Matrix4().makeTranslation(x, 0.27, front) }));
  return b;
}
/** Its bass: two 15" horn-loaded side by side, square mouths, the same black birch. */
const triAmpBass = () => hornCab("tri-amp-bass", [[-0.185, 0.38, 0.35, 0.66, 6], [0.185, 0.38, 0.35, 0.66, 6]], 0.55, { badge: false, skin: "coat" });

/**
 * The sculpted three-way: one moulded teal shell, round in plan and swelling at the waist like a pebble on end, with
 * three round horn mouths stacked down its face (low-mid, mid, high, largest at the bottom), a pole cup under it and
 * the speaker jacks on a plate at the back.
 */
function sculpted(): Build {
  const b: Build = { pieces: [], marks: [] };
  b.pieces.push(loft("shell", [R(0.012, 0.09, 0.12, { cz: -0.02 }), R(0.1, 0.17, 0.21), R(0.28, 0.206, 0.25, { cz: 0.01 }), R(0.5, 0.2, 0.24),
    R(0.68, 0.165, 0.2, { cz: -0.01 }), R(0.8, 0.11, 0.15, { cz: -0.02 }), R(0.848, 0.04, 0.06, { cz: -0.03 })], { seg: 22, smooth: true }));
  for (const [y, r, z] of [[0.27, 0.15, 0.255], [0.52, 0.112, 0.238], [0.71, 0.07, 0.19]] as const) {
    const m = new THREE.Matrix4().makeTranslation(0, y, z);
    b.pieces.push(lathe("panel", [[-0.01, r * 0.18, r * 0.18], [0.006, r * 0.55, r * 0.55], [0.018, r, r]], { seg: 24, m }));
    b.pieces.push(lathe("metal", [[0.018, r, r], [0.022, r + 0.008, r + 0.008], [0.016, r + 0.014, r + 0.014]], { seg: 24, m }));
    b.pieces.push(disc("knob", r * 0.16, 0.012, "z", [0, y, z - 0.004], 10));
  }
  b.pieces.push(disc("metal", 0.026, 0.008, "y", [0, 0.004, 0], 16), disc("knob", 0.018, 0.003, "y", [0, 0.0015, 0], 16));
  plate(b, 0.13, 0.08, [0, 0.42, -0.243]);
  jacks(b, ["speaker-in", "speaker-out"], "back", [-0.03, 0.42, -0.253], [0.06, 0, 0]);
  mark(b, "grab", [0, 0.86, 0]);
  mark(b, "pole-cup", [0, 0.004, 0], [0, -1, 0]);
  return b;
}

/** A low-profile arc sub: a squat cabinet tapering to the back, a full grille, a teal cap like the tops it carries, and
 * a pole socket on top for them. */
function arcSub(): Build {
  const [w, h, d] = GEAR_SIZES["arc-sub-18"], b: Build = { pieces: [], marks: [] }, y0 = 0.014, g = 0.014, fh = h - y0 - 0.03;
  b.pieces.push(rounded("paint", { wf: w - 0.01, wb: w * 0.86, h: fh, d: d - g, r: 0.03, e: 0.012, y0, z0: -g / 2 }));
  b.pieces.push(...grilleSlab(w - 0.04, fh - 0.02, g + 0.002, y0 + fh / 2, d / 2 - g - 0.001, 0.02));
  b.pieces.push(...cone(0.19, 0.009, new THREE.Matrix4().makeTranslation(0, y0 + fh / 2, d / 2 - g + 0.011)));
  b.pieces.push(rounded("shell", { wf: w - 0.03, wb: w * 0.84, h: 0.03, d: d - 0.04, r: 0.03, e: 0.01, y0: y0 + fh, z0: -0.01 }));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(block("rubber", [0.06, y0 + 0.002, 0.06], [x * (w / 2 - 0.08), (y0 + 0.002) / 2, z * (d / 2 - 0.08)], 0.006));
  b.pieces.push(disc("metal", 0.026, 0.005, "y", [0, h - 0.002, 0], 16));
  plate(b, w * 0.3, h * 0.25, [0, h * 0.45, -d / 2 - 0.004]);
  jacks(b, ["speaker-in", "speaker-out"], "back", [-w * 0.06, h * 0.45, -d / 2 - 0.008], [w * 0.12, 0, 0]);
  mark(b, "grab", [w / 2 + 0.012, h * 0.6, 0], [1, 0, 0]);
  mark(b, "pole", [0, h - 0.005, 0], [0, 1, 0]);
  return b;
}

/** A stage's 12U rack: a tall case on casters, three amps in the rails, the inputs and two rows of speaker outs behind. */
function ampRack12(): Build {
  const [w, h, d] = GEAR_SIZES["amp-rack-12u"], b: Build = { pieces: [], marks: [] }, wheel = 0.045, floor = wheel * 2 + 0.005, ch = h - floor;
  b.pieces.push(box("paint", [w, ch, d - 0.02], [0, floor + ch / 2, -0.01], { bevel: 0.014 }));
  for (let i = 0; i < 3; i++) {
    const y = floor + ch * (0.18 + i * 0.32);
    b.pieces.push(box("panel", [w - 0.04, ch * 0.24, 0.012], [0, y, d / 2 - 0.016]));
    for (const x of [-1, 1]) b.pieces.push(...handle("chrome", [x * (w / 2 - 0.045), y, d / 2 - 0.01], "z", ch * 0.14, 0.008));
    for (let k = 0; k < 4; k++) b.pieces.push(disc("light", 0.004, 0.006, "z", [-w * 0.3 + k * 0.03, y + 0.02, d / 2 - 0.008], 4));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", wheel, 0.03, "x", [x * (w / 2 - 0.07), wheel, z * (d / 2 - 0.07)], 8));
  for (const x of [-1, 1]) b.pieces.push(...handle("metal", [x * w / 2, floor + ch * 0.7, 0], x > 0 ? "x" : "-x", 0.18, 0.012));
  b.pieces.push(box("panel", [w * 0.84, ch * 0.6, 0.008], [0, floor + ch * 0.5, -d / 2 - 0.012]));
  const back = -d / 2 - 0.016;
  jacks(b, numbered("xlr-in", 4), "back", [-0.21, floor + ch * 0.74, back], [0.06, 0, 0]);
  jacks(b, numbered("speaker-out", 8).slice(0, 4), "back", [-0.21, floor + ch * 0.56, back], [0.06, 0, 0], 0.014);
  jacks(b, numbered("speaker-out", 8).slice(4), "back", [-0.21, floor + ch * 0.44, back], [0.06, 0, 0], 0.014);
  jacks(b, ["power-in"], "back", [0.16, floor + ch * 0.3, back], [0, 0, 0], 0.02);
  mark(b, "grab", [w / 2 + 0.012, floor + ch * 0.7, 0], [1, 0, 0]);
  return b;
}

/** The site's 100 kVA set: a silenced canopy on a two-axle trailer, louvres at both ends, an exhaust stack on the roof,
 * the drawbar and jockey wheel at the front, and the three-phase outlets on the back panel. */
function siteGenerator(): Build {
  const [w, h, d] = GEAR_SIZES["generator-100kva"], b: Build = { pieces: [], marks: [] }, deck = 0.5, canopy = h - deck - 0.12, cd = d - 0.6;
  const cz = -d / 2 + cd / 2;
  b.pieces.push(box("metal", [w * 0.7, 0.12, cd - 0.1], [0, deck - 0.06, cz]));
  for (const z of [cz - 0.5, cz + 0.5]) for (const s of [-1, 1]) b.pieces.push(disc("rubber", 0.33, 0.2, "x", [s * (w / 2 - 0.08), 0.33, z], 12));
  b.pieces.push(box("lid", [w, canopy, cd], [0, deck + canopy / 2, cz], { bevel: 0.03 }));
  for (const z of [cz - cd / 2 - 0.002, cz + cd / 2 + 0.002]) for (let k = 0; k < 7; k++) b.pieces.push(box("knob", [w * 0.7, 0.03, 0.006], [0, deck + canopy * 0.25 + k * 0.1, z]));
  for (const s of [-1, 1]) for (const z of [cz - cd / 4, cz + cd / 4]) b.pieces.push(box("panel", [0.006, canopy * 0.8, cd * 0.4], [s * (w / 2 + 0.002), deck + canopy / 2, z]));
  b.pieces.push(disc("metal", 0.06, 0.12, "y", [0, deck + canopy + 0.06, cz - cd * 0.3], 10));
  b.pieces.push(rod("metal", [0, deck - 0.05, cz + cd / 2], [0, 0.45, d / 2 - 0.05], 0.04));
  b.pieces.push(disc("rubber", 0.08, 0.06, "x", [0, 0.08, d / 2 - 0.12], 10), rod("metal", [0, 0.08, d / 2 - 0.12], [0, 0.45, d / 2 - 0.12], 0.025));
  b.pieces.push(box("panel", [w * 0.5, 0.3, 0.01], [0, deck + 0.5, cz - cd / 2 - 0.008]));
  jacks(b, numbered("power-out", 3), "back", [-0.15, deck + 0.5, cz - cd / 2 - 0.014], [0.15, 0, 0], 0.03);
  mark(b, "grab", [0, 0.45, d / 2 - 0.05], [0, 0, 1]);
  return b;
}

// ---- rigging: what a hang flies from ---------------------------------------------------------------------------

/** A torus arc `r` round and `tube` thick, from angle 0 to `arc` round its own z axis (in its xy plane), placed by
 * `m`: a shackle's bow, a hook, a ring. */
function bow(slot: GearSlot, r: number, tube: number, arc: number, m: THREE.Matrix4, seg = 12): Piece {
  const t = new THREE.TorusGeometry(r, tube, 6, seg, arc).applyMatrix4(m);
  for (const k of Object.keys(t.attributes)) if (k !== "position") t.deleteAttribute(k);
  const geo = t.toNonIndexed();
  geo.computeVertexNormals();
  return { geo, slot };
}

const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/**
 * A line array's flying frame (the bumper on the motor's hook): two powder-coated side rails and three cross members
 * the width of the box, link plates down to the top box's front and rear pins, and a spine along the middle drilled
 * with a row of pick-up holes, a shackle in the one the hang balances on. y = 0 is the top of the box it carries: the
 * link plates reach 3 cm down to the box's pins, so it pins straight to `line-array-10`.
 */
function flyingFrame(): Build {
  const [w, , d] = RIG_SIZES["flying-frame"], b: Build = { pieces: [], marks: [] }, z1 = 0.35, z0 = z1 - d, zc = (z0 + z1) / 2;
  const rx = w / 2 - 0.025, plateX = w / 2 - 0.024, pinY = -0.014;
  for (const s of [-1, 1]) {
    b.pieces.push(box("paint", [0.05, 0.08, d], [s * rx, 0.07, zc], { bevel: 0.004 }));
    // the link plates, at the box's front pins (lineArray's plateZ) and its rear link (linkZ)
    for (const pz of [FRAME_PINS.front, FRAME_PINS.rear]) {
      b.pieces.push(box("paint", [0.012, 0.11, 0.07], [s * plateX, 0.025, pz], { bevel: 0.003 }));
      b.pieces.push(disc("chrome", 0.009, 0.03, "x", [s * (plateX + 0.006), pinY, pz], 6), disc("chrome", 0.012, 0.004, "x", [s * (plateX + 0.02), pinY, pz], 8));
    }
  }
  for (const z of [z1 - 0.03, -0.05, z0 + 0.03]) b.pieces.push(box("paint", [w - 0.1, 0.05, 0.05], [0, 0.07, z], { bevel: 0.004 }));
  // the spine and its pick-up holes, every 8 cm
  b.pieces.push(box("paint", [0.03, 0.08, d - 0.06], [0, 0.15, zc], { bevel: 0.003 }));
  for (const z of FRAME_HOLES) b.pieces.push(disc("rubber", 0.009, 0.032, "x", [0, 0.15, z], 8));
  // the shackle: a pin through the hole, two legs and the bow on top
  const zp = FRAME_PICKUP, legX = 0.035, bowY = 0.21;
  b.pieces.push(disc("chrome", 0.008, 0.09, "x", [0, 0.15, zp], 6), disc("chrome", 0.013, 0.012, "x", [legX + 0.016, 0.15, zp], 6));
  for (const s of [-1, 1]) b.pieces.push(rod("metal", [s * legX, 0.15, zp], [s * legX, bowY, zp], 0.009, 6));
  b.pieces.push(bow("metal", legX, 0.009, Math.PI, at(0, bowY, zp), 8));
  mark(b, "pickup", [0, bowY + legX - 0.009, zp]);
  mark(b, "hinge-bottom", [0, pinY, FRAME_PINS.front], [1, 0, 0]);
  return b;
}

/**
 * A one-tonne chain hoist, hung body-up: its top hook in a sling round the steel, a finned housing, the power and
 * control sockets on a plate at the front, the chain out of a guide underneath beside the bag that takes the slack,
 * and the load hook (`part:hook`) on the end of the chain. The app runs the chain: it lowers the hook by its y (its
 * bite is `userData.bite` below the part's origin) and draws the chain from `chain` down to it.
 */
function chainMotor(): Build {
  const b: Build = { pieces: [], marks: [], data: { bite: MOTOR_BITE } }, rx = 0.12, rz = 0.135, y0 = 0.3, y1 = 0.6, cx = -0.04;
  b.pieces.push(loft("paint", [R(y0, rx, rz), R(y1, rx, rz)], { seg: 16, p: 2.6 }));
  for (let y = 0.35; y < 0.56; y += 0.045) b.pieces.push(loft("metal", [R(y, rx + 0.007, rz + 0.007), R(y + 0.012, rx + 0.007, rz + 0.007)], { seg: 16, p: 2.6 }));
  b.pieces.push(loft("metal", [R(y1, rx - 0.004, rz - 0.004), R(y1 + 0.025, rx - 0.02, rz - 0.02), R(y1 + 0.04, 0.06, 0.07)], { seg: 16, p: 2.4 }));
  b.pieces.push(loft("metal", [R(y0 - 0.03, 0.07, 0.08), R(y0, rx - 0.004, rz - 0.004)], { seg: 16, p: 2.4 }));
  // the top hook: a swivel and a ring, the sling sits in it
  b.pieces.push(disc("metal", 0.03, 0.025, "y", [0, 0.655, 0], 10), rod("metal", [0, 0.665, 0], [0, 0.69, 0], 0.012, 6));
  b.pieces.push(bow("chrome", 0.03, 0.01, Math.PI * 1.75, at(0, 0.71, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationZ(1.9)), 14));
  mark(b, "hang", [0, 0.74, 0]);
  // the chain guide and the chain bag beside it on two straps
  b.pieces.push(disc("metal", 0.024, 0.04, "y", [cx, y0 - 0.04, 0], 10));
  b.pieces.push(loft("tolex", [R(0.0, 0.045, 0.055, { cx: 0.07 }), R(0.04, 0.065, 0.075, { cx: 0.07 }), R(0.2, 0.07, 0.08, { cx: 0.07 }), R(0.24, 0.055, 0.065, { cx: 0.07 })], { seg: 10 }));
  for (const z of [-0.05, 0.05]) b.pieces.push(rod("rubber", [0.07, 0.235, z], [0.07, y0 - 0.02, z], 0.006, 4));
  mark(b, "chain", [cx, y0 - 0.06, 0], [0, -1, 0]);
  // the plate at the front: power in and the controller's line
  b.pieces.push(box("panel", [0.12, 0.1, 0.02], [0, 0.45, rz + 0.005], { bevel: 0.004 }));
  jacks(b, ["power-in", "control-in"], "front", [-0.03, 0.45, rz + 0.015], [0.06, 0, 0], 0.014);
  // the load hook: a link to the chain, a swivel block, the hook with its latch, painted to be seen
  const hook: Piece[] = [rod("metal", [0, 0, 0], [0, -0.04, 0], 0.01, 6), box("metal", [0.04, 0.05, 0.035], [0, -0.065, 0], { bevel: 0.004 })];
  hook.push(bow("lid", 0.032, 0.011, Math.PI * 1.6, at(0, -0.122, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationZ(1.75)), 14));
  hook.push(rod("chrome", [0, -0.09, 0.012], [0, -0.115, 0.04], 0.004, 4));
  b.parts = [{ name: "hook", at: [cx, y0 - 0.06, 0], pieces: hook }];
  return b;
}

const BUILDERS: Record<GearId, (height: number) => Build> = {
  "top-12-powered": () => speaker(GEAR_SIZES["top-12-powered"], ["power-in", "xlr-in", "xlr-out"], true),
  "top-15-passive": () => speaker(GEAR_SIZES["top-15-passive"], ["speaker-in", "speaker-out"], false),
  "sub-18": sub,
  "wedge-12": () => wedge(),
  "amp-head": ampHead,
  "cab-4x12": cab4x12,
  "amp-rack-4u": ampRack,
  "mixer-small": mixer,
  "generator-7kva": generator,
  "distro-box": distro,
  "cable-ramp-2ch": cableRamp,
  "road-case-m": () => roadCase(),
  "trunk-case": () => roadCase("trunk-case", false),
  "stand-tripod": stand,
  "mic-stand": micStand,
  "sand-cart": sandCart,
  "sand-dolly": sandDolly,
  "jerry-can-20l": fuelCan,
  "bar-cooler": barCooler,
  "line-array-box": () => lineArray("line-array-box"),
  "line-array-10": () => lineArray("line-array-10"),
  "fill-8-powered": () => speaker(GEAR_SIZES["fill-8-powered"], ["power-in", "xlr-in", "xlr-out"], true),
  guitar,
  "di-box": diBox,
  "mic-condenser": micCondenser,
  "wedge-12-passive": () => wedge("wedge-12-passive"),
  "deck-media": deckMedia,
  turntable,
  "mixer-dj": mixerDj,
  "deck-cd": deckCd,
  "mixer-club-4": mixerClub4,
  "stack-mid-high": midHigh,
  "stack-mid-bass": midBass,
  "horn-sub-21": hornSub,
  "sculpted-3way": sculpted,
  "arc-sub-18": arcSub,
  "amp-rack-12u": ampRack12,
  "generator-100kva": siteGenerator,
  "synergy-horn": synergyHorn,
  "tapped-horn-18": tappedHorn,
  "triple-21-sub": triple21,
  "tri-amp-top": triAmpTop,
  "tri-amp-bass": triAmpBass,
};

type Slots = [GearSlot, THREE.BufferGeometry][];
type Built = { slots: Slots; marks: Mark[]; parts: { name: string; at: THREE.Vector3Tuple; rot: number; slots: Slots }[]; data: GearData };

/** Pieces merged into a geometry per slot (metre UVs laid on unless they keep their own). */
const merged = (pieces: Piece[], ownUv = false): Slots => SLOTS.filter((s) => pieces.some((p) => p.slot === s))
  .map((s): [GearSlot, THREE.BufferGeometry] => [s, mergeVertices(mergeGeometries(pieces.filter((p) => p.slot === s).map((p) => (ownUv ? p.geo : metreUv(p.geo))))!)]);
const cache = new Map<string, Built>();

function built(key: string, make: () => Build): Built {
  let hit = cache.get(key);
  if (!hit) {
    const { pieces, marks, parts = [], data = {} } = make();
    hit = { slots: merged(pieces), marks, parts: parts.map((p) => ({ name: p.name, at: p.at, rot: p.rot ?? 0, slots: merged(p.pieces, p.ownUv) })), data };
    cache.set(key, hit);
  }
  return hit;
}

export type GearOptions = {
  look?: GearLook;
  /** A speaker stand's pole height, 1.2 to 2.0 m. */
  height?: number;
};

const Z = new THREE.Vector3(0, 0, 1);

/** One piece of gear: a group named for its id, a mesh per material slot, and its jacks, grab and mounts. */
export function gear(id: GearId, { look = gearLook(), height = 1.2 }: GearOptions = {}): THREE.Group {
  const h = clamp(height, 1.2, 2.0);
  return assemble(id, built(id === "stand-tripod" ? `${id}@${h}` : id, () => BUILDERS[id](h)), look,
    { gear: id, size: id === "stand-tripod" ? [0.9, h, 0.9] : [...GEAR_SIZES[id]] });
}

/** A piece of the rig a hang flies from (`RIG_SIZES`), built as `gear` builds gear: its marks are `pickup` (the
 * frame's shackle bow, where the motor's hook bites, +z up), `hinge-bottom` (the frame's front pins, over the top box's
 * `hinge-top`), `hang` (the motor's top hook, +z up), `chain` (where the chain leaves the motor, +z down) and the
 * motor's `jack:power-in` and `jack:control-in`; the motor's load hook is `part:hook`. */
export function rigging(id: RigId, { look = gearLook() }: { look?: GearLook } = {}): THREE.Group {
  return assemble(id, built(id, id === "flying-frame" ? flyingFrame : chainMotor), look, { rig: id, size: [...RIG_SIZES[id]] });
}

function assemble(id: string, { slots, marks, parts, data }: Built, look: GearLook, about: object): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  g.userData = { ...about, ...structuredClone(data) };
  const meshes = (into: THREE.Object3D, from: Slots, stem: string) => {
    for (const [slot, geo] of from) {
      const mesh = new THREE.Mesh(geo, look[slot]);
      mesh.name = `${stem}-${slot}`;
      mesh.castShadow = mesh.receiveShadow = true;
      into.add(mesh);
    }
  };
  meshes(g, slots, id);
  for (const p of parts) {
    const part = new THREE.Group();
    part.name = `part:${p.name}`;
    part.position.set(...p.at);
    part.rotation.x = p.rot;
    meshes(part, p.slots, `${id}-${p.name}`);
    g.add(part);
  }
  for (const { name, at, out } of marks) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(...at);
    o.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...out).normalize());
    g.add(o);
  }
  return g;
}

/** A model's moving parts, by name (`platter`, `tonearm`, `jog`, `meter-2`, ...): each a group at its pivot. */
export function gearParts(g: THREE.Object3D): Map<string, THREE.Object3D> {
  return new Map(g.children.filter((c) => c.name.startsWith("part:")).map((c) => [c.name.slice(5), c]));
}

/** A model's jacks, by id (`power-in`, `xlr-in-3`, ...). */
export function gearJacks(g: THREE.Object3D): Map<string, THREE.Object3D> {
  return new Map(g.children.filter((c) => c.name.startsWith("jack:")).map((c) => [c.name.slice(5), c]));
}
