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
import type { ConnectorType, Gender } from "@rustybuns/util/connectors";
import { PANELS } from "./panels.ts";
import { type Piece, type Ring, R, along, box, loft } from "./shapes.ts";
import { socketPieces } from "./sockets.ts";

export type GearId = keyof typeof GEAR_SIZES;

/** Width x height x depth in metres, from #4849's table. */
export const GEAR_SIZES = {
  "top-12-powered": [0.356, 0.602, 0.35],
  "top-15-passive": [0.46, 0.699, 0.432],
  "sub-18": [0.52, 0.638, 0.784],
  "wedge-12": [0.515, 0.375, 0.453],
  "amp-head": [0.7, 0.27, 0.25],
  "cab-4x12": [0.77, 0.755, 0.365],
  "amp-rack-4u": [0.6, 0.4, 0.65],
  "mixer-small": [0.4, 0.1, 0.35],
  "generator-7kva": [0.7, 0.6, 0.55],
  "distro-box": [0.337, 0.362, 0.292],
  "cable-ramp-2ch": [0.9, 0.08, 0.5],
  "road-case-m": [0.6, 0.5, 0.5],
  "trunk-case": [0.95, 0.6, 0.55],
  "stand-tripod": [0.9, 1.2, 0.9],
  "mic-stand": [0.6, 1.6, 0.6],
  "sand-cart": [0.8, 0.45, 1.2],
  "sand-dolly": [1.1, 0.15, 1.0],
  "jerry-can-20l": [0.35, 0.47, 0.17],
  "line-array-box": [1.118, 0.33, 0.495],
  "line-array-10": [0.512, 0.271, 0.374],
  "fill-8-powered": [0.28, 0.449, 0.269],
  "bar-cooler": [0.9, 0.9, 0.6],
  guitar: [0.33, 1.0, 0.05],
  "di-box": [0.1, 0.05, 0.13],
  "mic-condenser": [0.05, 0.19, 0.05],
  "wedge-12-passive": [0.574, 0.41, 0.487],
  "deck-media": [0.329, 0.118, 0.453],
  turntable: [0.453, 0.169, 0.353],
  "mixer-dj": [0.333, 0.108, 0.414],
  // the Desert Gathering booth (#5651): the club media player and the four-channel analog club mixer with twin filters
  "deck-cd": [0.32, 0.105, 0.405],
  "mixer-club-4": [0.32, 0.088, 0.358],
  // the festival (#5029 step 9): the dance stack, the sculpted array, a stage rack and the site generator
  "stack-mid-high": [0.522, 0.92, 0.445],
  "stack-mid-bass": [0.59, 0.845, 0.603],
  "horn-sub-21": [1.686, 0.582, 0.867],
  "horn-sub-18": [1.326, 0.496, 0.723],
  "horn-sub-24": [0.702, 0.992, 1.056],
  "infra-sub-18": [1.326, 0.496, 0.723],
  "skeletal-mid-high": [0.484, 0.447, 0.357],
  "skeletal-mid": [0.458, 0.307, 0.357],
  "sculpted-3way": [0.8539, 0.6712, 0.6599],
  "sculpted-3way-lh": [0.8539, 0.6712, 0.6599],
  "arc-sub-18": [0.6568, 0.55, 0.6952],
  "amp-rack-12u": [0.6, 1.05, 0.75],
  "qsc-pld4-5": [0.482, 0.089, 0.406],
  "generator-100kva": [1.3, 2.0, 3.6],
  // Desert Gathering's other rigs (packages/gear systems.ts): sizes from the makers' sheets, or typical of the class
  "synergy-horn": [0.711, 0.711, 0.647],
  "tapped-horn-18": [0.572, 1.016, 0.724],
  "triple-21-sub": [1.479, 0.696, 1.218],
  "tri-amp-top": [0.574, 0.825, 0.773],
  "tri-amp-bass": [0.574, 0.825, 0.773],
} as const satisfies Record<string, THREE.Vector3Tuple>;

export const GEAR_IDS = Object.keys(GEAR_SIZES) as GearId[];

/** What a hang flies from, part of the venue rather than gear the crew carries in (so not in the catalog): the line
 * array's flying frame and the chain motor over it, w x h x d in metres as built (`rigging`). */
export const RIG_SIZES = {
  "flying-frame": [0.572, 0.284, 0.8],
  "chain-motor": [0.262, 0.748, 0.298],
} as const satisfies Record<string, THREE.Vector3Tuple>;
export type RigId = keyof typeof RIG_SIZES;
export const RIG_IDS = Object.keys(RIG_SIZES) as RigId[];
/** The frame's link pins along z: over `line-array-10`'s front pins and its rear pin (the LA108's, 15 mm behind its face and 275 behind that). */
const FRAME_PINS = { front: 0.172, rear: -0.103 };
/** The frame's pick-up holes along its spine (z), and the one its shackle is in. */
const FRAME_HOLES = [-0.39, -0.31, -0.23, -0.15, -0.07, 0.01, 0.09, 0.17, 0.25];
const FRAME_PICKUP = -0.07;
/** How far below the hook part's origin (the chain's end) its bite is. */
const MOTOR_BITE = 0.143;

const SLOTS = ["paint", "grille", "metal", "rubber", "panel", "lid", "tolex", "body", "chrome", "knob", "light", "shell", "badge", "ink", "mesh", "coat", "cheek", "glow", "horn", "grime", "plug", "violet", "satin", "facet", "shade", "cavity", "turbo", "pcblue", "pcgrey"] as const;
export type GearSlot = (typeof SLOTS)[number];
/** A material per slot: paint (cabinets), grille, metal (frames, poles), rubber (feet, wheels, ramp), panel (jack
 * plates), lid (the ramp's yellow lid), tolex (guitar amps), body (the guitar), chrome, knob, light (LEDs), shell (the
 * sculpted array's moulded composite), badge (a plain label plate), ink (the white print on a control face); and a hung line array box's own:
 * mesh (its black grille, backed nearly solid), coat (its shell's even pebble coat), cheek (its paler side panels); glow (a
 * lit key's orange, the Qone mixer's one accent); and the dance stack's own: horn (the pale painted lining of
 * its mid and high horns), grime (that lining gone dark with dust deep in a throat), plug (the bronze phase plug in a mid horn's throat), violet (its cabinets' dark violet paint), satin (the Res2 top's own coat: a smooth near-black navy with a satin sheen), facet (the Res2's mid horn lining, glossier, each flat face a step lighter or darker by where it faces: see `facets`), shade (that paint down a horn cell, darkened per vertex as the light falls off toward the throat: see `fade`) and cavity (that paint deep inside a bass mouth, where the sky's light hardly reaches: the light from the room round it is cut to a sixth, as the box would shade it); and the tri-amp rig's turbo (the Flashlight's TurboBlue, a near-black blue, semi-matt and textured); and the connectors' pcblue and pcgrey (powerCON's blue power-in and grey power-out housings). */
export type GearLook = Record<GearSlot, THREE.Material>;

/** A ramp from black to white along u, read as the `facet` lining's ambient occlusion at the `uv1` that `facets` writes:
 * the sky's image light ignores vertex colours' darkness in its sheen, so a face turned away is darkened here too. */
export const RAMP = (() => {
  const px = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) px.fill(i, i * 4, i * 4 + 3), (px[i * 4 + 3] = 255);
  const t = new THREE.DataTexture(px, 256, 1);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.channel = 1;
  t.needsUpdate = true;
  return t;
})();

export function gearLook(): GearLook {
  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    paint: std(0x1d1e20, 0.85), grille: std(0x2c2e31, 0.55, 0.6), metal: std(0x8a8d92, 0.4, 0.8), rubber: std(0x121212, 0.95),
    panel: std(0x3a3c40, 0.6, 0.3), lid: std(0xf2c230, 0.6), tolex: std(0x161514, 0.9), body: std(0x8f1f1f, 0.3, 0.1),
    chrome: std(0xd8dade, 0.15, 1), knob: std(0x0c0c0c, 0.5), light: new THREE.MeshBasicMaterial({ color: 0x45e06a }),
    shell: std(0x1f6f78, 0.32, 0.1), badge: std(0xd9d6cf, 0.5), ink: std(0xe4e2dc, 0.7),
    mesh: std(0x141518, 0.6, 0.4), coat: std(0x1d1e20, 0.9), cheek: std(0x55574f, 0.92),
    glow: new THREE.MeshStandardMaterial({ color: 0xee6a1f, emissive: 0xee6a1f, emissiveIntensity: 0.7, roughness: 0.5 }),
    horn: std(0x7a7e75, 0.7), grime: std(0x4a4a42, 0.85), plug: std(0x6e5636, 0.5, 0.55), violet: std(0x160a2b, 0.86), satin: std(0x15142a, 0.4), facet: Object.assign(std(0x7a7e75, 0.5), { vertexColors: true, aoMap: RAMP }), shade: Object.assign(std(0x160a2b, 0.86), { vertexColors: true }), turbo: std(0x0e1422, 0.82),
    pcblue: std(0x1f63c4, 0.42), pcgrey: std(0xa3a8ae, 0.5),
    cavity: new THREE.MeshStandardMaterial({ color: 0x050409, roughness: 1, envMapIntensity: 0.02 }),
  };
}

type Mark = { name: string; at: THREE.Vector3Tuple; out: THREE.Vector3Tuple };
/** A moving part: its pivot `at`, turned by `rot` (radians about x), its pieces in its own frame; `ownUv` keeps the
 * pieces' UVs (a screen's 0..1) instead of laying metre UVs on. */
type Part = { name: string; at: THREE.Vector3Tuple; rot?: number; pieces: Piece[]; ownUv?: boolean };
/** What a model with moving parts says about them, on its group's userData: the tonearm's turns about its bearing
 * (radians: at the rest, the outer groove, the inner groove), the mixer's fader and crossfader throws (and a deck tempo fader's), metres, and a
 * sub's cone throw. */
export type GearData = { arm?: { rest: number; outer: number; inner: number }; faderTravel?: number; crossTravel?: number; tempoTravel?: number; bite?: number;
  /** How far a woofer's cone (`part:cone`, the dish and dust cap) pushes out on a hit, metres: move it along its own z. */
  coneThrow?: number };
type Build = { pieces: Piece[]; marks: Mark[]; parts?: Part[]; data?: GearData };

// ---- pieces ---------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A rod from a to b (a pole, a leg, a frame tube). */
function rod(slot: GearSlot, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, r: number, seg = 6): Piece {
  const va = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(va), len = d.length();
  const m = new THREE.Matrix4().compose(va.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
  return loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg, m });
}

/** A quarter of a rod from a to b, the quarter between the outward directions `u` and `v` (each square to the rod):
 * a box's rounded edge, which bulges out of its two faces and stays out of the box. */
function quarterRod(slot: GearSlot, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, r: number, u: THREE.Vector3Tuple, v: THREE.Vector3Tuple, seg = 8): Piece {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
  let U = new THREE.Vector3(...u), V = new THREE.Vector3(...v);
  if (U.clone().cross(V).dot(d) < 0) [U, V] = [V, U]; // wind it so its faces look outward
  const pos: number[] = [], ring = (p: THREE.Vector3, i: number) => p.clone().addScaledVector(U, r * Math.cos((i / seg) * Math.PI / 2)).addScaledVector(V, r * Math.sin((i / seg) * Math.PI / 2)).toArray();
  for (let i = 0; i < seg; i++) {
    const [a0, a1, b0, b1] = [ring(va, i), ring(va, i + 1), ring(vb, i), ring(vb, i + 1)];
    pos.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return { geo: toCreasedNormals(geo, 0.6), slot };
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
  if (!mouths.every((m) => m.every(inside))) throw new Error(`sink: a well's mouth runs off the flat of its face looking along (${out.join(", ")})`);
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

type Face = "front" | "back" | "top" | "bottom" | "left" | "right";
const NORMAL: Record<Face, THREE.Vector3Tuple> = { front: [0, 0, 1], back: [0, 0, -1], top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

/** Sockets in a row on a face, each a ring round an insert, with a mark. `at` is the face point of the first, `step` to the next. */
function jacks(b: Build, names: string[], face: Face, at: THREE.Vector3Tuple, step: THREE.Vector3Tuple, r = 0.012, seg = 14) {
  const out = NORMAL[face], axis = face === "top" || face === "bottom" ? "y" : face === "front" || face === "back" ? "z" : "x";
  names.forEach((name, i) => {
    const p: THREE.Vector3Tuple = [at[0] + step[0] * i, at[1] + step[1] * i, at[2] + step[2] * i];
    const c: THREE.Vector3Tuple = [p[0] + out[0] * 0.004, p[1] + out[1] * 0.004, p[2] + out[2] * 0.004];
    // a socket: a metal ring round a black insert
    b.pieces.push(disc("metal", r, 0.008, axis, c, seg), disc("knob", r * 0.74, 0.009, axis, c, seg));
    b.marks.push({ name: `jack:${name}`, at: [p[0] + out[0] * 0.008, p[1] + out[1] * 0.008, p[2] + out[2] * 0.008], out });
  });
}

/** How far a socket's mark sits out from the panel face: past the tallest socket (an IEC's blades, a male XLR's pins). */
const SOCKET_TIP = 0.008;

/** Half a socket's width and height on its face, metres. */
const socketHalf = new Map<string, [number, number]>();
function halfOf(type: ConnectorType, gender: Gender): [number, number] {
  const key = `${type}/${gender}`;
  let h = socketHalf.get(key);
  if (!h) {
    const bb = new THREE.Box3();
    for (const p of socketPieces(type, gender)) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox!); }
    socketHalf.set(key, (h = [(bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2]));
  }
  return h;
}

/** A box's real connector panel (panels.ts) on `face`: each socket the connector it is on the maker's sheet, laid out
 * as the sheet has them, centred on `centre` and kept inside `area` (the jack plate's free part, w x h metres: the
 * layout closes up to fit, the sockets keep their size), the ones a cable goes into marked `jack:<name>`. A socket the
 * sheet puts on another face (the arc sub's front pair) goes there instead. */
function socketPanel(b: Build, id: GearId, face: Face, centre: THREE.Vector3Tuple, area: [number, number]) {
  const p = PANELS[id]!, own = p.sockets.filter((s) => !s.face), mmv = (v: number) => v / 1000, margin = 0.004;
  const lo = [0, 1].map((k) => Math.min(...own.map((s) => s.at[k]!))), hi = [0, 1].map((k) => Math.max(...own.map((s) => s.at[k]!)));
  const cu = (lo[0]! + hi[0]!) / 2, cv = (lo[1]! + hi[1]!) / 2;
  // the most of the sheet's spacing that can be kept with every socket's edge inside the area
  const fit = Math.min(1, ...own.flatMap((s) => {
    const half = halfOf(s.type, s.gender);
    return [0, 1].map((k) => { const d = Math.abs(mmv(s.at[k]! - (k ? cv : cu))); return d < 1e-6 ? 1 : Math.max(0, area[k]! / 2 - margin - half[k]!) / d; });
  }));
  // closed up that far, no two sockets may touch: a plate too small for its panel is a mistake in the call, not a look
  own.forEach((a, i) => own.slice(i + 1).forEach((c) => {
    const ha = halfOf(a.type, a.gender), hc = halfOf(c.type, c.gender);
    if ([0, 1].every((k) => Math.abs(mmv(a.at[k]! - c.at[k]!)) * fit < ha[k]! + hc[k]! + 0.001)) throw new Error(`${id}: the ${a.role} and ${c.role} sockets overlap on a ${area.map((v) => Math.round(v * 1000)).join(" x ")} mm plate`);
  }));
  for (const s of p.sockets) {
    const on = s.face ?? face, out = new THREE.Vector3(...NORMAL[on]);
    const at = s.face ? new THREE.Vector3(mmv(s.at[0]), mmv(s.at[1]), (GEAR_SIZES[id][2] / 2) * out.z)
      : on === "bottom" ? new THREE.Vector3(centre[0] + mmv(s.at[0] - cu) * fit, centre[1], centre[2] + mmv(s.at[1] - cv) * fit)
      : new THREE.Vector3(centre[0] + mmv(s.at[0] - cu) * fit, centre[1] + mmv(s.at[1] - cv) * fit, centre[2]);
    // the flange sunk most of its 2 mm into the plate, as a panel socket sits
    const m = new THREE.Matrix4().compose(at.clone().addScaledVector(out, -0.0015), new THREE.Quaternion().setFromUnitVectors(Z, out), new THREE.Vector3(1, 1, 1));
    b.pieces.push(...onto(m, socketPieces(s.type, s.gender)));
    if (s.jack) b.marks.push({ name: `jack:${s.jack}`, at: at.clone().addScaledVector(out, SOCKET_TIP).toArray(), out: out.toArray() });
  }
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

/** The small plain plate a speaker's grille carries in a corner (no maker's mark), standing just proud of the sheet;
 * `m` places it, its face looking along +z. */
function grillePlate(b: Build, m: THREE.Matrix4) {
  b.pieces.push(...onto(m, [box("metal", [0.05, 0.014, 0.003], [0, 0, 0.0015], { bevel: 0.001 })]));
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

/** The guitar cab's angled front: it stands upright to `bend` (metres up) and leans back `setback` by the top. */
export const CAB_SLANT = { bend: 0.378, setback: 0.1 } as const;

/**
 * The guitar cab, as the Marshall 1960A angled 4x12 is published (770 wide, 755 tall, 365 deep, 36.5 kg, four 12"
 * behind the cloth) and photographed by its maker (front, three-quarter, back), piece by piece, no maker's name or
 * model plate. The sheet gives only the outside, so the front's bend (half way up) and its 100 mm lean back by the
 * top are read off the three-quarter photo. Metres from the cab's centre line, floor and front.
 * - cabinet: the tolex-covered box in its side profile, upright below the bend, leaning back above it
 * - grille: the black basketweave cloth in two panels (upright, leaning), inside a 35 mm tolex frame at the sides
 *   and 30 at the top and bottom
 * - piping: the white piping round the cloth's edge
 * - corners: the eight black corner protectors, a brass screw in each front one
 * - hardware: a recessed dish handle in each side, two strip handles on the top, the back's screws and its jack
 *   plate high in the middle
 */
function cab1960aPieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["cab-4x12"], P = pieceBuild, cab = P(), grille = P(), piping = P(), corners = P(), hw = P();
  const f = d / 2, zb = -d / 2, { bend: yb, setback: s } = CAB_SLANT, lean = Math.atan2(s, h - yb), fx = mm(35), fy = mm(30);
  // the front's z at height y, and a point `out` proud of it
  const zf = (y: number) => (y <= yb ? f : f - (s * (y - yb)) / (h - yb));
  const front = (x: number, y: number, out: number): THREE.Vector3Tuple => [x, y + (y > yb ? out * Math.sin(lean) : 0), zf(y) + out * (y > yb ? Math.cos(lean) : 1)];

  cab.pieces.push(prism("tolex", [[f, 0], [f, yb], [f - s, h], [zb, h], [zb, 0]], w, 0, 0.01));

  // the cloth: upright from the frame's bottom to the bend, then leaning to the frame's top
  const gw = w - 2 * fx, upH = (h - fy - yb) / Math.cos(lean);
  grille.pieces.push(box("grille", [gw, yb - fy, 0.004], [0, (yb + fy) / 2, f + 0.001]));
  grille.pieces.push(box("grille", [gw, upH, 0.004], front(0, (yb + h - fy) / 2, 0.001), { rot: [-lean, 0, 0] }));
  // the piping round the cloth's edge, and the plain plate low on the left where the real one carries its model name
  const ring: [number, number][] = [[-gw / 2, fy], [gw / 2, fy], [gw / 2, yb], [gw / 2, h - fy], [-gw / 2, h - fy], [-gw / 2, yb]];
  ring.forEach(([x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]!; piping.pieces.push(rod("ink", front(x, y, 0.002), front(x2, y2, 0.002), 0.0025, 6)); });
  piping.pieces.push(box("plug", [mm(60), mm(22), 0.003], front(-gw / 2 + mm(45), fy + mm(26), 0.004), { bevel: 0.001 }));

  // corners: a protector over each of the eight corners, 3 mm proud, the front ones with a brass screw
  const c = mm(50), k = c / 2 - mm(3);
  for (const x of [-1, 1]) for (const [y, z] of [[k, f - k], [h - k, f - s - k], [k, zb + k], [h - k, zb + k]]) {
    corners.pieces.push(box("knob", [c, c, c], [x * (w / 2 - k), y, z], { bevel: mm(6) }));
    if (z > 0) corners.pieces.push(disc("plug", mm(5), 0.002, "z", [x * (w / 2 - mm(14)), y, zf(y) + mm(3) + 0.001], 8));
  }

  // hardware: the side dish handles (a black dish, the bar across it), the top's strip handles, the back's screws and plate
  for (const s2 of [-1, 1]) {
    const x = s2 * (w / 2 + 0.0015), y = h * 0.62, z = mm(-20);
    hw.pieces.push(box("knob", [0.003, mm(190), mm(120)], [x, y, z], { bevel: 0.001 }));
    hw.pieces.push(box("cavity", [0.004, mm(150), mm(85)], [s2 * (w / 2 + 0.002), y, z], { bevel: 0.001 }));
    hw.pieces.push(rod("metal", [s2 * (w / 2 - 0.004), y - mm(60), z], [s2 * (w / 2 - 0.004), y + mm(60), z], 0.009, 8));
  }
  for (const x of [-1, 1]) hw.pieces.push(box("knob", [mm(45), 0.004, mm(140)], [x * mm(300), h + 0.001, (zb + f - s) / 2], { bevel: 0.001 }));
  for (const x of [-1, -0.5, 0, 0.5, 1]) for (const y of [0.04, h - 0.04]) hw.pieces.push(disc("chrome", mm(6), 0.002, "z", [x * (w / 2 - 0.04), y, zb - 0.001], 8));
  for (const x of [-1, 1]) for (const y of [0.25, 0.5, 0.75]) hw.pieces.push(disc("chrome", mm(6), 0.002, "z", [x * (w / 2 - 0.04), y * h, zb - 0.001], 8));
  hw.pieces.push(disc("chrome", mm(6), 0.002, "z", [0, h * 0.4, zb - 0.001], 8));
  hw.pieces.push(box("knob", [mm(120), mm(75), 0.008], [0, h * 0.83, zb - 0.001], { bevel: 0.002 }));
  for (const x of [-1, 1]) for (const y of [-1, 1]) hw.pieces.push(disc("plug", mm(4), 0.002, "z", [x * mm(48), h * 0.83 + y * mm(26), zb - 0.006], 8));
  socketPanel(hw, "cab-4x12", "back", [0, h * 0.83, zb - 0.005], [mm(110), mm(66)]);
  mark(hw, "grab", [w / 2 + 0.012, h * 0.62, mm(-20)], [1, 0, 0]);
  return { cabinet: cab, grille, piping, corners, hardware: hw };
}

/** 1U, as the racks' rails measure it. */
const RU = 0.04445;

/**
 * A QSC PLD4.5's front, 482 x 89 mm (its spec sheet), facing +z at `z`, centred on (x, y): the rack ears with their
 * cast handles, the four output channels' Mute buttons each under its Limit, -10 and -20 LEDs, the soft power and
 * Select buttons, the inputs' Signal and Clip LEDs, the 400 x 240 colour LCD and its HOME, ENTER, EXIT and GAIN keys
 * round the MASTER knob, in the order the user manual's front-panel legend (TD-000368-00-A) numbers them. The legend
 * gives the order, not the millimetres: where each sits across the face is read from that order and is a guess.
 */
function pldFront(b: Build, x: number, y: number, z: number) {
  const w = 0.482, h = 0.088;
  b.pieces.push(box("panel", [w, h, 0.004], [x, y, z - 0.002], { bevel: 0.001 }));
  for (const sx of [-1, 1]) b.pieces.push(...handle("chrome", [x + sx * (w / 2 - 0.022), y, z], "z", h * 0.72, 0.018));
  b.pieces.push(disc("light", 0.006, 0.004, "z", [x - 0.185, y + 0.012, z + 0.001], 10)); // soft power, its ring lit
  for (let i = 0; i < 4; i++) {
    const cx = x - 0.15 + i * 0.03;
    b.pieces.push(box("knob", [0.016, 0.01, 0.004], [cx, y - 0.026, z + 0.002])); // Mute
    for (let k = 0; k < 3; k++) b.pieces.push(disc("light", 0.0022, 0.003, "z", [cx, y - 0.008 + k * 0.011, z + 0.0015], 6)); // Limit, -10, -20
    b.pieces.push(box("knob", [0.012, 0.007, 0.003], [cx + 0.11, y - 0.026, z + 0.0015])); // Select
    for (let k = 0; k < 2; k++) b.pieces.push(disc("light", 0.0022, 0.003, "z", [cx + 0.11, y - 0.004 + k * 0.012, z + 0.0015], 6)); // Signal, Clip
  }
  b.pieces.push(box("pcblue", [0.074, 0.044, 0.002], [x + 0.098, y + 0.002, z + 0.001])); // the LCD
  b.pieces.push(disc("knob", 0.014, 0.012, "z", [x + 0.172, y + 0.004, z + 0.006], 16)); // MASTER
  for (const [dx, dy] of [[-0.024, 0.024], [0.024, 0.024], [-0.024, -0.016], [0.024, -0.016]] as const) b.pieces.push(box("knob", [0.01, 0.006, 0.003], [x + 0.172 + dx * 0.55, y + dy, z + 0.0015])); // HOME, ENTER, EXIT, GAIN
}

/** A rack's blank plate, `u` high, slotted for air, its top edge at `top`. */
function blank(b: Build, units: number, top: number, z: number) {
  const h = units * RU - 0.001;
  b.pieces.push(box("panel", [0.482, h, 0.003], [0, top - h / 2, z - 0.0015]));
  for (let k = 0; k < units * 2; k++) b.pieces.push(box("metal", [0.36, 0.004, 0.002], [0, top - (k + 0.75) * (h / (units * 2)), z]));
}

/** The QSC PLD4.5 itself, out of a rack: its front, a 432 mm chassis 406 deep behind the ears, the back panel. */
function pld(): Build {
  const [w, h, d] = GEAR_SIZES["qsc-pld4-5"], b: Build = { pieces: [], marks: [] }, body = 0.432;
  b.pieces.push(box("paint", [body, h - 0.002, d - 0.006], [0, h / 2, -0.003], { bevel: 0.002 }));
  pldFront(b, 0, h / 2, d / 2);
  socketPanel(b, "qsc-pld4-5", "back", [0, h / 2, -d / 2], [body - 0.01, h - 0.01]);
  mark(b, "grab", [w / 2 - 0.022, h / 2, d / 2 + 0.03], [0, 0, 1]);
  return b;
}

/**
 * A shock rack on casters with its front lid off, `units` of rails, and what it holds from the top (the catalog's
 * `rack`): a PLD4.5 front at each, blanks between; the case's own back panel (panels.ts) is what a cable goes in.
 */
function rackCase(id: "amp-rack-4u" | "amp-rack-12u", units: number, amps: number[], wheel: number, plate: { y: number; area: [number, number] }): Build {
  const [w, h, d] = GEAR_SIZES[id], b: Build = { pieces: [], marks: [] }, floor = wheel * 2 + 0.005, ch = h - floor;
  const open = units * RU, top = floor + ch / 2 + open / 2, face = d / 2 - 0.03;
  // the shell: walls round the rails, lips on the open front, the rails' black inside
  for (const sx of [-1, 1]) b.pieces.push(box("paint", [(w - 0.482) / 2, ch, d - 0.02], [sx * (w / 2 - (w - 0.482) / 4), floor + ch / 2, -0.01], { bevel: 0.01 }));
  for (const sy of [-1, 1]) b.pieces.push(box("paint", [0.482, (ch - open) / 2, d - 0.02], [0, floor + ch / 2 + sy * (open / 2 + (ch - open) / 4), -0.01], { bevel: 0.006 }));
  b.pieces.push(box("metal", [0.482, open, 0.01], [0, floor + ch / 2, -d / 2 + 0.02]));
  for (const sx of [-1, 1]) b.pieces.push(box("chrome", [0.016, open, 0.004], [sx * 0.2335, floor + ch / 2, face - 0.004]));
  let u = 1;
  for (const at of [...amps, units + 1]) {
    if (at > u) blank(b, at - u, top - (u - 1) * RU, face);
    if (at <= units) { pldFront(b, 0, top - (at - 1) * RU - RU, face); u = at + 2; }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.pieces.push(disc("rubber", wheel, 0.028, "x", [sx * (w / 2 - 0.07), wheel, sz * (d / 2 - 0.07)], 10));
    b.pieces.push(box("metal", [0.05, 0.012, 0.06], [sx * (w / 2 - 0.07), floor - 0.004, sz * (d / 2 - 0.07)]));
  }
  for (const sx of [-1, 1]) b.pieces.push(...handle("metal", [sx * w / 2, floor + ch * 0.6, 0], sx > 0 ? "x" : "-x", 0.16, 0.012));
  // the back: the case's own panel, as the crew sees it
  b.pieces.push(box("panel", [plate.area[0], plate.area[1], 0.006], [0, plate.y, -d / 2 + 0.001]));
  socketPanel(b, id, "back", [0, plate.y, -d / 2 - 0.002], plate.area);
  mark(b, "grab", [w / 2 + 0.012, floor + ch * 0.6, 0], [1, 0, 0]);
  return b;
}

/** A small band's 4U rack: one PLD4.5 at the top (catalog's `rack`), blanks under it. */
const ampRack = (): Build => rackCase("amp-rack-4u", 4, [1], 0.035, { y: 0.25, area: [0.47, 0.07] });

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

/**
 * The spider box (Lex Products' hanging spider box, its datasheet): a molded rubber body with a handle on top and
 * hanging brackets on its back, six 20 A GFCI duplexes (each its own jack) in two rows on the front with a GFCI module's
 * test and reset buttons and LED beside each, the L6-30 twist-lock under them, the breakers behind a clear window on
 * top of the face, and the 50 A California-style inlet on its left side. The sheet gives the parts, not where each sits:
 * the layout is a guess from the box's size.
 */
function distro(): Build {
  const [w, h, d] = GEAR_SIZES["distro-box"], b: Build = { pieces: [], marks: [] }, body = h - 0.04;
  b.pieces.push(box("rubber", [w, body, d], [0, body / 2, 0], { bevel: 0.025 }));
  b.pieces.push(...handle("rubber", [0, body, 0], "y", 0.18, 0.035));
  for (const sx of [-1, 1]) b.pieces.push(box("metal", [0.03, 0.12, 0.012], [sx * w * 0.3, body * 0.72, -d / 2 - 0.006])); // hanging brackets
  b.pieces.push(box("panel", [w - 0.05, body * 0.7, 0.008], [0, body * 0.47, d / 2]));
  b.pieces.push(box("mesh", [w * 0.6, 0.04, 0.004], [0, body * 0.84, d / 2 + 0.004])); // the breakers' window
  const rows = [body * 0.62, body * 0.42], cols = [-w * 0.3, 0, w * 0.3];
  const outs: string[] = [];
  rows.forEach((y, r) => cols.forEach((x, c) => {
    b.pieces.push(box("knob", [0.07, 0.07, 0.006], [x, y, d / 2 + 0.006], { bevel: 0.004 })); // the duplex's plate
    for (const dy of [0.016, -0.016]) b.pieces.push(box("metal", [0.026, 0.018, 0.003], [x - 0.008, y + dy, d / 2 + 0.01]));
    b.pieces.push(disc("light", 0.003, 0.004, "z", [x + 0.024, y + 0.024, d / 2 + 0.01], 6)); // the GFCI's LED
    for (const dy of [0, -0.016]) b.pieces.push(box("knob", [0.012, 0.008, 0.004], [x + 0.024, y + dy, d / 2 + 0.011])); // test, reset
    outs.push(`power-out-${r * 3 + c + 1}`);
  }));
  jacks(b, outs.slice(0, 3), "front", [cols[0]! - 0.008, rows[0]!, d / 2 + 0.012], [w * 0.3, 0, 0], 0.012);
  jacks(b, outs.slice(3), "front", [cols[0]! - 0.008, rows[1]!, d / 2 + 0.012], [w * 0.3, 0, 0], 0.012);
  b.pieces.push(disc("knob", 0.03, 0.012, "z", [0, body * 0.2, d / 2 + 0.006], 16)); // the L6-30's collar
  jacks(b, ["power-out-7"], "front", [0, body * 0.2, d / 2 + 0.013], [0, 0, 0], 0.02);
  b.pieces.push(disc("knob", 0.04, 0.03, "x", [-w / 2 - 0.012, body * 0.5, 0], 16)); // the 50 A inlet's housing
  jacks(b, ["power-in"], "left", [-w / 2 - 0.028, body * 0.5, 0], [0, 0, 0], 0.024);
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

/** The four-channel analog club mixer with twin filters (`mixer-club-4`), laid out as the Qone mixer's face on the DJ
 * decks page (apps/fm-daw `src/dj/mixer-panel.ts`), so the mixer on the table is the one the DJ plays: a slate steel
 * face printed in white over a dark case. Left to right: FILTER 1's column, the four channels, FILTER 2's column, the
 * black master panel. Each channel top to bottom: two aux sends, trim, four EQ knobs, the filter flip (1 OFF 2), the
 * crossfader flip (X OFF Y), a round CUE button, its number, then the LED dots beside a long fader; the crossfader in
 * its sunken bed under the four. Each filter column is its LFO (depth, shape and beats, the DECK key lit orange, the
 * tap knob, resonance), then the filter (its curve's screen, HPF / BPF / LPF, the big sweep, the on button). The
 * black panel: QONE, the stereo LEDs, master, booth, split cue, the phones' mix and level and their socket. Positions
 * are the page's, scaled: a pixel there is 0.645 mm across and 0.673 mm deep here. */
function mixerClub4(): Build {
  const [w, h, d] = GEAR_SIZES["mixer-club-4"], b: Build = { pieces: [], marks: [], parts: [] }, foot = 0.008, face = h - 0.017;
  // the page's mixer (its face 496 x 532 px, its middle at 640, 434 in a 1280 x 720 shot) to this model's frame
  const X = (px: number) => (px - 640) * (w / 496), Z = (py: number) => (py - 434) * (d / 532);
  b.pieces.push(box("paint", [w, face - 0.002 - foot, d], [0, foot + (face - 0.002 - foot) / 2, 0], { bevel: 0.004 }));
  b.pieces.push(box("panel", [w - 0.006, 0.0022, d - 0.006], [0, face - 0.0011, 0], { bevel: 0.0008 }));
  for (const x of [-1, 1]) for (const z of [-0.17, 0, 0.17]) b.pieces.push(...screw([x * (w / 2 - 0.0035), face + 0.0004, z], "y", 0.0016, "chrome", 6));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.pieces.push(disc("rubber", 0.012, foot, "y", [x * (w / 2 - 0.03), foot / 2, z * (d / 2 - 0.035)], 8));
  const ink = face + 0.0003, say = (text: string, x: number, z: number, size = 0.0026, y = ink) => b.pieces.push(...print(text, x, y, z, size));
  /** A flat `w` by `dz` patch lying face up at (x, y, z), turned `a` about +y: print, a lit dot, a tick (two triangles). */
  const flat = (slot: GearSlot, w: number, dz: number, x: number, y: number, z: number, a = 0): Piece => {
    const geo = new THREE.PlaneGeometry(w, dz).rotateX(-Math.PI / 2).rotateY(a).translate(x, y, z).toNonIndexed();
    geo.deleteAttribute("uv");
    return { geo, slot };
  };
  /** A black knurled knob, its white pointer printed across the top; `scale` lays the EQ's dashed scale round it. */
  const knob = (x: number, z: number, r: number, scale = false, y = face): Piece[] => {
    const out: Piece[] = [
      loft("knob", [R(0, r * 1.08), R(r * 1.25, r * 0.88), R(r * 1.25, 0)], { seg: 10, caps: false, m: new THREE.Matrix4().makeTranslation(x, y, z) }),
      flat("ink", r * 0.16, r * 0.75, x, y + r * 1.25 + 0.0003, z - r * 0.42),
    ];
    if (scale) for (let k = 0; k <= 4; k++) {
      const a = -0.75 * Math.PI + (k / 4) * 1.5 * Math.PI;
      out.push(flat("ink", 0.0005, r * 0.3, x + Math.sin(a) * r * 1.5, y + 0.0003, z - Math.cos(a) * r * 1.5, -a));
    }
    return out;
  };
  /** A round rubber button, its rim in `ring` (the orange glow when lit). */
  const button = (x: number, z: number, r: number, ring: GearSlot = "knob") => b.pieces.push(
    disc(ring, r, 0.0016, "y", [x, face + 0.0008, z], 9), disc("rubber", r * 0.8, 0.0045, "y", [x, face + 0.0022, z], 9));
  /** A small square key: black, or lit. */
  const key = (x: number, z: number, sw: number, sd: number, slot: GearSlot = "knob") => b.pieces.push(box(slot, [sw, 0.0035, sd], [x, face + 0.0017, z]));
  /** A flip switch: a short slot, the lever standing in it, and its three words over it. */
  const flip = (x: number, z: number, words: string) => {
    b.pieces.push(box("knob", [0.012, 0.0008, 0.0026], [x, face + 0.0004, z]), box("chrome", [0.0028, 0.005, 0.0028], [x, face + 0.0025, z]));
    say(words, x, z + 0.0045, 0.0022);
  };
  /** A column of LED dots from the front end `z0` back `len`: green, blue from 0 dB near the top, red at the top. */
  const dots = (x: number, z0: number, len: number, n: number) => {
    for (let k = 0; k < n; k++) b.pieces.push(flat(k >= n - 2 ? "body" : k >= n - 4 ? "shell" : "light", 0.0018, 0.0018, x, face + 0.0004, z0 - (k / (n - 1)) * len));
  };
  /** A box outlined in thin white print, as the page frames the filter columns. */
  const frame = (x0: number, z0: number, x1: number, z1: number) => {
    const t = 0.0005;
    b.pieces.push(flat("ink", x1 - x0, t, (x0 + x1) / 2, ink, z0), flat("ink", x1 - x0, t, (x0 + x1) / 2, ink, z1));
    b.pieces.push(flat("ink", t, z1 - z0, x0, ink, (z0 + z1) / 2), flat("ink", t, z1 - z0, x1, ink, (z0 + z1) / 2));
  };

  // the four channels
  const CH = [501, 569, 637, 705].map(X), fz0 = Z(640), fz1 = Z(475), travel = (fz0 - fz1) * 0.82, fz = (fz0 + fz1) / 2;
  CH.forEach((x, i) => {
    for (const s of [-1, 1]) b.pieces.push(...knob(x + s * X(651) - s * X(640), Z(185), 0.0052));
    b.pieces.push(...knob(x, Z(214), 0.0068));
    for (const py of [245, 277, 310, 345]) b.pieces.push(...knob(x, Z(py), 0.0068));
    flip(x, Z(366), "1 OFF 2"); flip(x, Z(391), "X OFF Y");
    button(x, Z(429), 0.0085);
    say(String(i + 1), x, Z(456), 0.008);
    // the LED dots, their lit bar a part over them: origin at the front end, the bar up its +y (back along the face)
    const mx = x - X(653) + X(640);
    dots(mx, fz0, fz0 - fz1, 11);
    b.parts!.push({ name: `meter-${i + 1}`, at: [mx, face + 0.0012, fz0], rot: -Math.PI / 2, pieces: [box("light", [0.0022, fz0 - fz1, 0.0006], [0, (fz0 - fz1) / 2, 0.0003])] });
    // the fader: its slot, a scale, the cap a part at mid travel
    const fx = x + X(646) - X(640);
    b.pieces.push(box("knob", [0.0025, 0.0012, fz0 - fz1 + 0.006], [fx, face + 0.0006, fz]));
    for (let k = 0; k <= 10; k++) say("-", fx + 0.0075, fz0 - k * ((fz0 - fz1) / 10), k % 5 ? 0.003 : 0.005);
    b.parts!.push({ name: `fader-${i + 1}`, at: [fx, face, fz], pieces: [box("knob", [0.014, 0.012, 0.009], [0, 0.006, 0], { bevel: 0.002 }), box("ink", [0.0125, 0.0006, 0.0012], [0, 0.0121, 0])] });
  });
  // the crossfader in its sunken bed under the four, X to the left and Y to the right
  const cz = Z(675), cx = X(603), ct = X(712) - X(524);
  b.pieces.push(box("knob", [X(738) - X(468), 0.0008, Z(692) - Z(658)], [cx, face + 0.0003, cz], { bevel: 0.0008 }));
  b.pieces.push(box("rubber", [ct + 0.012, 0.0012, 0.0025], [cx, face + 0.0009, cz]));
  say("X", X(510), cz, 0.006, face + 0.0012); say("Y", X(726), cz, 0.006, face + 0.0012);
  b.pieces.push(...knob(X(486), cz, 0.004, false, face + 0.0008));
  b.parts!.push({ name: "cross", at: [cx, face, cz], pieces: [box("knob", [0.007, 0.012, 0.014], [0, 0.006, 0], { bevel: 0.002 }), box("ink", [0.0012, 0.0006, 0.0125], [0, 0.0121, 0])] });

  // the two filter columns, each its LFO over the filter
  for (const [n, px] of [[1, 429], [2, 777]] as const) {
    const fx = X(px), half = X(px + 31) - fx;
    frame(fx - half, Z(176), fx + half, Z(372)); frame(fx - half, Z(380), fx + half, Z(692));
    say("LFO", fx, Z(189), 0.0035);
    b.pieces.push(...knob(fx, Z(213), 0.006, true)); say("DEPTH", fx, Z(236), 0.0022);
    key(fx - 0.008, Z(253), 0.0095, 0.0085); key(fx + 0.008, Z(253), 0.0095, 0.0085);
    key(fx, Z(279), 0.026, 0.009, "glow"); say(`DECK ${n === 1 ? "A" : "B"}`, fx, Z(279), 0.0028, face + 0.0036);
    b.pieces.push(...knob(fx, Z(307), 0.0072));
    b.pieces.push(...knob(fx, Z(340), 0.006, true)); say("RES", fx, Z(361), 0.0024);
    // the curve's little screen, its line lit
    b.pieces.push(box("knob", [2 * half - 0.004, 0.0008, Z(416) - Z(386)], [fx, face + 0.0004, Z(401)]));
    b.pieces.push(flat("light", 2 * half - 0.012, 0.0008, fx, face + 0.0009, Z(405)));
    // HPF, BPF, LPF: filter 1 starts on low-pass, filter 2 on high-pass, as the page does
    ["HPF", "BPF", "LPF"].forEach((t, k) => { button(fx, Z(461 + k * 32.5), 0.0085, (n === 1 ? k === 2 : k === 0) ? "glow" : "knob"); say(t, fx, Z(461 + k * 32.5), 0.0022, face + 0.0047); });
    // the big sweep (a part that turns about +y), its scale round it
    b.parts!.push({ name: `filter-${n}`, at: [fx, face, Z(593)], pieces: knob(0, 0, 0.0125).map((p) => (p.geo.translate(0, -face, 0), p)) });
    for (let k = 0; k <= 8; k++) {
      const a = -0.75 * Math.PI + (k / 8) * 1.5 * Math.PI;
      b.pieces.push(flat("ink", 0.0005, 0.004, fx + Math.sin(a) * 0.0195, ink, Z(593) - Math.cos(a) * 0.0195, -a));
    }
    say("FREQ", fx, Z(624), 0.0026);
    button(fx, Z(672), 0.0095); say(String(n), fx, Z(672), 0.004, face + 0.0047);
  }

  // the black master panel down the right
  const ox = X(849), oh = X(882) - X(816);
  b.pieces.push(box("knob", [oh, 0.0012, Z(692) - Z(176)], [ox, face + 0.0006, Z(434)], { bevel: 0.0008 }));
  const top = face + 0.0012, sayT = (t: string, x: number, z: number, s = 0.0024) => say(t, x, z, s, top + 0.0003);
  sayT("QONE", ox, Z(195), 0.006);
  for (const px of [842, 856]) for (let k = 0; k < 11; k++) b.pieces.push(flat(k >= 9 ? "body" : k >= 7 ? "shell" : "light", 0.0018, 0.0018, X(px), top + 0.0004, Z(298) - (k / 10) * (Z(298) - Z(212))));
  sayT("L", X(842), Z(309)); sayT("R", X(856), Z(309));
  b.pieces.push(...knob(ox, Z(334), 0.0075, true, top)); sayT("MASTER", ox, Z(356), 0.0022);
  b.pieces.push(...knob(ox, Z(382), 0.0068, true, top)); sayT("BOOTH", ox, Z(404), 0.0022);
  b.pieces.push(flat("ink", oh - 0.006, 0.0005, ox, top + 0.0003, Z(418)));
  b.pieces.push(disc("knob", 0.0098, 0.0016, "y", [ox, top + 0.0008, Z(440)], 10), disc("rubber", 0.0078, 0.0045, "y", [ox, top + 0.0022, Z(440)], 10));
  b.pieces.push(...knob(ox, Z(470), 0.0045, false, top)); sayT("MIX", ox, Z(487), 0.0022);
  b.pieces.push(...knob(ox, Z(508), 0.0045, false, top)); sayT("LEVEL", ox, Z(525), 0.0022);
  b.pieces.push(disc("chrome", 0.0085, 0.003, "y", [ox, top + 0.0015, Z(551)], 10), disc("knob", 0.0045, 0.0035, "y", [ox, top + 0.0018, Z(551)], 8));
  key(X(832), Z(675), 0.011, 0.011); key(X(862), Z(675), 0.011, 0.011, "glow");

  // the front edge: the two headphone sockets at the right
  const fr = d / 2 + 0.001;
  b.pieces.push(disc("metal", 0.0085, 0.004, "z", [w / 2 - 0.04, 0.04, fr], 12), disc("knob", 0.0045, 0.005, "z", [w / 2 - 0.04, 0.04, fr], 10));
  b.pieces.push(disc("metal", 0.0055, 0.004, "z", [w / 2 - 0.065, 0.04, fr], 10), disc("knob", 0.0028, 0.005, "z", [w / 2 - 0.065, 0.04, fr], 8));
  const back = -d / 2;
  jacks(b, numbered("phono-in", 4), "back", [-0.15, 0.055, back - 0.002], [0.026, 0, 0], 0.0065, 6);
  jacks(b, numbered("rca-in", 4), "back", [-0.15, 0.03, back - 0.002], [0.026, 0, 0], 0.0065, 6);
  jacks(b, numbered("xlr-out", 4), "back", [0.03, 0.042, back - 0.002], [0.03, 0, 0], 0.011, 8);
  b.pieces.push(disc("chrome", 0.006, 0.014, "z", [-0.03, 0.055, back - 0.006], 10));
  jacks(b, ["ground-in-1", "ground-in-2"], "back", [-0.03, 0.055, back - 0.012], [0, 0, 0], 0.004, 8);
  jacks(b, ["power-in"], "back", [-0.03, 0.026, back - 0.002], [0, 0, 0], 0.012, 8);
  b.data = { faderTravel: travel, crossTravel: ct };
  mark(b, "grab", [0, h, 0]);
  return b;
}

// ---- the festival's systems (#5029 step 9) ----------------------------------------------------------------------

/** A mouth flaring back from a rectangle on the face to a smaller one at the back, `outer` and `inner` [x0, x1, y0, y1],
 * the front at z `zf` and the back `deep` behind it: four flat walls, every face turned to look forward (a bass bin's
 * pyramid horn, its throat anywhere in the mouth). */
function frustum(slot: GearSlot, outer: number[], inner: number[], zf: number, deep: number): Piece {
  const [ox0, ox1, oy0, oy1] = outer, [ix0, ix1, iy0, iy1] = inner, zb = zf - deep, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const o = [V(ox0, oy0, zf), V(ox1, oy0, zf), V(ox1, oy1, zf), V(ox0, oy1, zf)], i = [V(ix0, iy0, zb), V(ix1, iy0, zb), V(ix1, iy1, zb), V(ix0, iy1, zb)], pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    pos.push(...(n.z >= 0 ? [a, b, c] : [a, c, b]).flatMap((v) => v.toArray()));
  };
  for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; tri(o[k], o[j], i[j]); tri(o[k], i[j], i[k]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return { geo, slot };
}

/** A flat plate in the front plane: `outline` [x, y] round, `holes` cut through it, `t` thick back from z `f`, its
 * edges (holes too) chamfered `bevel` deep when given, so they catch a thin line of light. */
function frontPlate(slot: GearSlot, outline: number[][], holes: number[][][], f: number, t: number, bevel = 0): Piece {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const geo = new THREE.ExtrudeGeometry(shape, bevel > 0
    ? { depth: t - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1 }
    : { depth: t, bevelEnabled: false });
  geo.translate(0, 0, f - t + bevel);
  return { geo: toCreasedNormals(geo, 0.3), slot };
}

/** A rectangle's corners [x, y], centred on (x, y), `w` by `h`, counter-clockwise. */
const rect = (x: number, y: number, w: number, h: number) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];

/** A slab standing on the floor plan: `pts` [x, z] round, from height `y0` up to `y1` (a trapezoid box's top, sides). */
/** How far a horn bin's brace plate turns from facing the front (radians): the drawings show its round holes as ovals
 * about half as wide as they are tall. */
const BRACE_TURN = (55 * Math.PI) / 180;

/** A brace plate standing at (x, y), its face `front` deep: `w` wide as seen from the front, `h` tall, turned `turn`
 * about its upright axis, holes at `ys` up from its middle: round ones `d` across, or ovals [wide, tall] as seen from
 * the front; 18 mm ply, its edges chamfered `bevel` deep when given. */
function brace(x: number, y: number, front: number, w: number, h: number, ys: number[], d: number | [number, number], turn: number, bevel = 0): Piece {
  const [hw, hh] = typeof d === "number" ? [d, d] : [d[0] / Math.cos(turn), d[1]], n = typeof d === "number" ? 20 : 32;
  const holes = ys.map((hy) => Array.from({ length: n }, (_, j) => { const q = (j / n) * Math.PI * 2; return [Math.cos(q) * hw / 2, hy + Math.sin(q) * hh / 2]; }));
  const pw = w / Math.cos(turn), p = frontPlate("violet", rect(0, 0, pw, h), holes, 0.009, 0.018, bevel);
  // set back so the edge the turn swings forward stays at `front`, behind the box's face
  p.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, front - (pw / 2) * Math.abs(Math.sin(turn))).multiply(new THREE.Matrix4().makeRotationY(turn)));
  return p;
}

/** How far the F215's brace plates turn from facing the front: a little, so the photo's front-right view sees their
 * oval holes still tall and the plate's 18 mm edge down one side. */
const F215_BRACE_TURN = (12 * Math.PI) / 180;

/** A piece in the `shade` paint: its full colour at `lit` and in front of it, falling off along a curve to `floor` of
 * that colour at `dark` and behind (as the `k`th power of the way between), as daylight dies down a horn cell toward its throat. The fall is in the
 * piece's vertex colours, so a piece needs vertices along z (a horn wall's curve, a `sheet`'s rows) to show it. */
function fade(p: Piece, lit: number, dark: number, floor = 0.12, k = 2): Piece {
  const pos = p.geo.getAttribute("position"), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = clamp((pos.getZ(i) - dark) / (lit - dark), 0, 1), v = floor + (1 - floor) * s ** k;
    col.fill(v, i * 3, i * 3 + 3);
  }
  p.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return { geo: p.geo, slot: "shade" };
}

/** A piece in the `facet` lining: each flat face painted a step lighter or darker by how square it faces `key` (the
 * photo's studio light, high on the left and in front), down to `lo` of the colour for a face turned away, and the
 * lot falling to `deep` of that toward `dark` (the throat), as the real horn's folds read as pale and dark facets. */
function facets(p: Piece, key: THREE.Vector3, lit: number, dark: number, lo = 0.72, deep = 0.78): Piece {
  const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo, pos = geo.getAttribute("position"), col = new Float32Array(pos.count * 3), uv1 = new Float32Array(pos.count * 2).fill(0.5);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), L = key.clone().normalize();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.z < 0) n.negate(); // every face here looks out of the mouth
    const face = lo + (1 - lo) * Math.max(0, n.dot(L)) ** 2;
    for (let j = 0; j < 3; j++) {
      const s = clamp((pos.getZ(i + j) - dark) / (lit - dark), 0, 1), v = face * (deep + (1 - deep) * s);
      col.fill(v, (i + j) * 3, (i + j) * 3 + 3);
      uv1[(i + j) * 2] = v;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  return { geo, slot: "facet" };
}

/** A thin box cut into `rows` along z (so `fade` has vertices to grade across), centred at `at`. */
function sheet(size: THREE.Vector3Tuple, at: THREE.Vector3Tuple, rows = 12): Piece {
  let geo: THREE.BufferGeometry = new THREE.BoxGeometry(size[0], size[1], size[2], 1, 1, rows).translate(...at);
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return { geo, slot: "shade" };
}

function slab(slot: GearSlot, pts: number[][], y0: number, y1: number): Piece {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return { geo: toCreasedNormals(geo, 0.3), slot };
}

/** Flat triangles between rings of points (each ring the same length, closed), each face turned to look forward (+z):
 * a horn's walls, creased where the rings' points are, as a moulded horn's facets are. `facing` -1 turns them to look
 * back instead: the outside of a horn with no cabinet round it. */
function ringWalls(slot: GearSlot, rings: THREE.Vector3[][], facing: 1 | -1 = 1): Piece {
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    pos.push(...(n.z * facing >= 0 ? [a, b, c] : [a, c, b]).flatMap((v) => v.toArray()));
  };
  for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < rings[i]!.length; j++) {
    const k = (j + 1) % rings[i]!.length, a = rings[i]!, b = rings[i + 1]!;
    // each quad split on the diagonal the real horn creases on, mirrored left to right: on the right half from the
    // mouth's corner to the throat's tip and from the mouth's top to the throat's corner, the left half the mirror
    if (j % 4 < 2) { tri(a[j]!, a[k]!, b[j]!); tri(a[k]!, b[k]!, b[j]!); } else { tri(a[j]!, a[k]!, b[k]!); tri(a[j]!, b[k]!, b[j]!); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return { geo: toCreasedNormals(geo, 0.2), slot };
}

/** A ring of eight points round (x, y) at depth z, counter-clockwise from the right: the side mids at `ma` out, the
 * corners at (`ca`, `cc`), the top and bottom mids at `mc` (a rectangle when ca = ma and cc = mc, a hexagon round a
 * plug's tips when the mids reach further). */
const ring8 = (x: number, y: number, z: number, ma: number, mc: number, ca = ma, cc = mc) =>
  [[ma, 0], [ca, cc], [0, mc], [-ca, cc], [-ma, 0], [-ca, -cc], [0, -mc], [ca, -cc]].map(([u, v]) => new THREE.Vector3(x + u!, y + v!, z));

/**
 * The top, as the Funktion-One Res2 is drawn on its sheet (Res2-F1-WD=T0106-00, 2022) and built, piece by piece (no
 * maker's name: the band where it is embossed stays plain). Every number is the drawing's, in metres from the box's
 * front, floor and centre line: 522 wide, 920 tall, 445 deep, its sides closing 28 degrees to a 300 back.
 * - cabinet: 18 mm ply, the trapezoid shell, a hand slot in the top, one in each side, the jack plate on the back
 * - panel: the pale moulded face, full width at the top, its sides down to 313 mm, chamfered in to a 179 flat at 459
 * - mid horn: its 422 x 274 mouth centred 175 down, each side wall folding to a point at the
 *   plug's tip, the black octagon round the driver behind it
 * - plug: the axe head, a horizontal blade 336 tip to tip and 96 tall, a ridge along its front, lying across the throat
 * - driver: the 8" cone's black surround and dark cone, r 77, behind the plug
 * - hf horn: the 165 x 98 mouth from 331 to 430 down, straight walls to the compression driver's round throat
 * - band: the violet front between the panel and the bass mouth (the maker's name embossed there on the real box)
 * - bass horn: the mouth from 551 down to the floor, its walls closing on a 283 x 156 throat, the strut slanting up
 *   its middle from the floor at the front to the roof at the back, a bracket and the corner fillets
 */
function res2Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["stack-mid-high"], t = 0.018, f = d / 2, bw = 0.3, mm = (v: number) => v / 1000;
  const top = (fromTop: number) => h - mm(fromTop), P = (): Build => ({ pieces: [], marks: [] });
  const sideX = (z: number) => bw / 2 + ((w - bw) / 2) * ((z + d / 2) / d); // the side's outer face at depth z
  const cab = P(), panel = P(), mid = P(), plugB = P(), drv = P(), hf = P(), band = P(), bass = P();

  // ---- cabinet: top and bottom trapezoids, the two slanting sides, the back
  // the box's outer edges are rounded `er` (its front uprights and the roof's front and sides), as the real box's are
  const er = 0.025, ex = (z: number) => sideX(z) - er / Math.cos(Math.atan2((w - bw) / 2, d)); // a round's centre line
  const plan = [[-sideX(f), f], [sideX(f), f], [sideX(-d / 2), -d / 2], [-sideX(-d / 2), -d / 2]];
  const roof = [[-sideX(f) + er, f - er], [sideX(f) - er, f - er], [sideX(-d / 2) - er, -d / 2], [-sideX(-d / 2) + er, -d / 2]];
  cab.pieces.push(slab("satin", plan, 0, t), slab("satin", roof, h - t, h));
  for (const s of [-1, 1]) {
    const q = [[sideX(f - er), f - er], [sideX(f) - t, f - er], [sideX(-d / 2) - t, -d / 2], [sideX(-d / 2), -d / 2]];
    cab.pieces.push(slab("satin", q.map(([x, z]) => [s * x!, z!]), t, h - er));
    // the side's last `er` at the front, inside the round, so the face's frame stays full width
    // (wider than the wall is thick, so it reaches a little past the wall's inside, behind the front)
    const [x0, x1] = [Math.min(sideX(f) - t, ex(f)), Math.max(sideX(f) - t, ex(f))];
    cab.pieces.push(slab("satin", [[x0, f - er], [x1, f - er], [x1, f], [x0, f]].map(([x, z]) => [s * x!, z!]), t, h - er));
    // the rounds bulge only out of the box's faces, so they never narrow the mouths
    const out = new THREE.Vector3(d, 0, s * (ex(-d / 2) - ex(f))).normalize().multiplyScalar(s).toArray(); // square to the roof's side, outward
    cab.pieces.push(quarterRod("satin", [s * ex(f), t, f - er], [s * ex(f), h - er, f - er], er, [0, 0, 1], [s, 0, 0], 8)); // the front upright
    cab.pieces.push(quarterRod("satin", [s * ex(f), h - er, f - er], [s * ex(-d / 2), h - er, -d / 2], er, [0, 1, 0], out, 8)); // the roof's side
    const ball = new THREE.SphereGeometry(er, 8, 4, s > 0 ? Math.PI / 2 : 0, Math.PI / 2, 0, Math.PI / 2);
    ball.translate(s * ex(f), h - er, f - er);
    ball.deleteAttribute("normal"); ball.deleteAttribute("uv");
    cab.pieces.push({ geo: toCreasedNormals(ball.toNonIndexed(), 0.6), slot: "satin" });
  }
  cab.pieces.push(quarterRod("satin", [-ex(f), h - er, f - er], [ex(f), h - er, f - er], er, [0, 1, 0], [0, 0, 1], 8)); // the roof's front
  cab.pieces.push(slab("satin", [[-(bw / 2 - t), -d / 2 + t], [bw / 2 - t, -d / 2 + t], [bw / 2 - t, -d / 2], [-(bw / 2 - t), -d / 2]], t, h - t));
  // the hand slot in the top, near the back, and one in each side, sunk dark
  cab.pieces.push(box("knob", [0.2, 0.004, 0.034], [0, h + 0.0005, -d / 2 + 0.07], { bevel: 0.0015 }));
  const sa = Math.atan2((w - bw) / 2, d);
  for (const s of [-1, 1]) cab.pieces.push(box("knob", [0.004, 0.032, 0.1], [s * (sideX(0) + 0.0008), top(229), 0], { bevel: 0.0015, rot: [0.5 * s, s * sa, 0] }));
  plate(cab, 0.14, 0.09, [0, top(140), -d / 2 - 0.004]);
  socketPanel(cab, "stack-mid-high", "back", [0, top(140), -d / 2 - 0.008], [0.14, 0.09]);
  mark(cab, "grab", [sideX(0) + 0.012, top(229), 0], [Math.cos(sa), 0, Math.sin(sa)]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) cab.pieces.push(block("rubber", [0.05, 0.012, 0.05], [x * (sideX(z * d * 0.4) - 0.05), 0.006, z * d * 0.4], 0.004));

  // ---- panel: the pale face plate, its two mouths cut through it, screwed round its edge
  const pw = w / 2 - t - 0.002, mcy = top(175), mA = mm(211), mC = mm(137), hcy = top(380.5), hA = mm(82.5), hC = mm(49.5);
  const outline = [[-pw, top(t * 1000 + 2)], [-pw, top(313)], [-mm(89.5), top(459)], [mm(89.5), top(459)], [pw, top(313)], [pw, top(t * 1000 + 2)]];
  panel.pieces.push(frontPlate("horn", outline, [rect(0, mcy, mA * 2, mC * 2), rect(0, hcy, hA * 2, hC * 2)], f - 0.002, 0.012));
  for (const [x, y] of [[-pw + 0.012, top(32)], [-0.09, top(32)], [0.09, top(32)], [pw - 0.012, top(32)], [-pw + 0.012, top(175)], [pw - 0.012, top(175)],
    [-pw + 0.012, top(300)], [pw - 0.012, top(300)], [-0.16, top(390)], [0.16, top(390)], [-0.075, top(447)], [0.075, top(447)]])
    panel.pieces.push(...screw([x!, y!, f - 0.001], "z", 0.0035, "metal", 6));

  // ---- mid horn: a rolled lip at the mouth, then the walls back to the throat round the plug
  const zt = f - 0.24, tipA = mm(168), tz = 0.085, drR = mm(77);
  // the bezel: the panel's moulding rolls in 45 degrees round the mouth before the horn's own walls start
  const lip = ring8(0, mcy, f - 0.002, mA, mC), mouth = ring8(0, mcy, f - 0.02, mA - 0.016, mC - 0.016);
  // the walls fold once: the throat's side points stand forward and out at the plug's tips, so each side wall is one big
  // triangle from the mouth's edge to that point, with a diamond fold above and below it back to the round driver
  const throat = ring8(0, mcy, zt, tipA, mm(98), mm(84), mm(70));
  for (const i of [0, 4]) throat[i]!.z = zt + tz;
  // the walls in the glossier `facet` lining, each face a step lighter or darker, so the folds read as the photo's do
  const key = new THREE.Vector3(-0.5, -0.2, 0.85), lit = (q: Piece) => facets(q, key, f - 0.02, zt);
  mid.pieces.push(ringWalls("horn", [lip, mouth]), lit(ringWalls("horn", [mouth, throat])));
  // behind each side point, the wall running back from it to the driver (the corners above and below it)
  const inner = new THREE.BufferGeometry().setFromPoints([0, 1, 7, 4, 5, 3].map((i) => throat[i]!));
  inner.computeVertexNormals();
  mid.pieces.push(lit({ geo: inner, slot: "horn" }));
  // the black octagon round the driver, flat top and sides, closing the throat
  const oct = (r: number) => Array.from({ length: 8 }, (_, i) => { const q = ((i + 0.5) / 8) * Math.PI * 2, k = r / Math.cos(Math.PI / 8); return [Math.cos(q) * k, mcy + Math.sin(q) * k]; });
  mid.pieces.push(frontPlate("knob", oct(mm(92)), [oct(mm(66))], zt + 0.012, 0.012, 0.003), frontPlate("cavity", oct(mm(94)), [], zt - 0.002, 0.006));

  // ---- the plug: the axe head across the throat, blunt back on the driver, a ridge forward, pointed at both tips
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, mcy + y, zt + z), pt: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    for (const y of [-1, 1]) pt.push(V(s * 0.08, y * 0.03, 0.01), V(s * 0.082, y * 0.048, 0.035), V(s * 0.07, y * 0.044, 0.075));
    pt.push(V(s * 0.072, 0, 0.125), V(s * tipA, 0, tz));
  }
  plugB.pieces.push(facets({ geo: toCreasedNormals(new ConvexGeometry(pt), 0.2), slot: "horn" }, key, zt + 0.125, zt, 0.75, 0.9));

  // ---- driver: the 8" cone behind the plug, its black roll surround and dark paper cone
  drv.pieces.push(lathe("knob", [[0, drR, drR], [0.006, drR * 0.9, drR * 0.9], [0.003, drR * 0.8, drR * 0.8]], { seg: 24, m: new THREE.Matrix4().makeTranslation(0, mcy, zt) }));
  drv.pieces.push(...cone(drR * 0.8, 0.04, new THREE.Matrix4().makeTranslation(0, mcy, zt), 20));

  // ---- hf horn: straight walls from its mouth to the compression driver's round throat
  const hz = f - 0.016, hd = 0.13;
  hf.pieces.push(ringWalls("horn", [ring8(0, hcy, f - 0.002, hA + 0.008, hC + 0.008), ring8(0, hcy, hz, hA, hC), ring8(0, hcy, hz - hd, 0.016, 0.012)]));
  hf.pieces.push(disc("grime", 0.013, 0.004, "z", [0, hcy, hz - hd + 0.002], 14), disc("horn", 0.008, 0.012, "z", [0, hcy, hz - hd + 0.006], 12));

  // ---- band: the violet face between the panel and the bass mouth, round the panel
  band.pieces.push(frontPlate("satin", [[-pw, top(551)], [pw, top(551)], [pw, top(t * 1000)], [-pw, top(t * 1000)]], [outline], f - 0.004, 0.03));

  // ---- bass horn: the mouth to the floor, its walls closing on the throat, the strut, a bracket, the corner fillets
  const by0 = t, by1 = top(551), ty0 = top(811), ty1 = top(655), tA = mm(141.5), bdeep = 0.36;
  // the walls painted violet just at the mouth, going to the near-black of a deep hollow an eighth in, as the light dies
  const mouthB = [-pw, pw, by0, by1], throatB = [-tA, tA, ty0, ty1], k = 0.12, part = mouthB.map((v, i) => v + (throatB[i]! - v) * k);
  bass.pieces.push(frustum("satin", mouthB, part, f - 0.004, bdeep * k), frustum("cavity", part, throatB, f - 0.004 - bdeep * k, bdeep * (1 - k)));
  bass.pieces.push(box("knob", [tA * 2, ty1 - ty0, 0.006], [0, (ty0 + ty1) / 2, f - 0.004 - bdeep - 0.003]));
  bass.pieces.push(rod("satin", [0, by0, f - 0.04], [0, ty1, f - 0.004 - bdeep + 0.02], 0.012, 6));
  bass.pieces.push(box("metal", [0.028, 0.05, 0.006], [0.02, (ty0 + by0) / 2 + 0.03, f - 0.2], { bevel: 0.002 }));
  for (const s of [-1, 1]) bass.pieces.push(prism("satin", [[f - 0.004, by0], [f - 0.004, by0 + 0.05], [f - 0.06, by0]], 0.05, s * (pw - 0.025)));

  return { cabinet: cab, band, "bass-horn": bass, panel, "hf-horn": hf, driver: drv, "mid-horn": mid, plug: plugB };
}


/**
 * The mid-bass, as the Funktion-One F215 MkII is drawn on its sheets (F215_MK2-F1-TD=T0200-01, DD=T0201-01) and built,
 * piece by piece (no maker's name): stood upright as a stack has it, 590 wide, 845 tall and 603 deep in 15 mm birch
 * ply and textured violet paint. Every number is the drawing's, in metres from the box's centre line, floor and front.
 * - cabinet: the open-fronted shell, the shelf splitting it into two horn cells, the back
 * - horn walls: in each cell a curved ply wall sweeping from the front corner on the horn side back to the throat, near
 *   parallel to the box's axis at the back and flaring at the mouth
 * - braces: a 76 mm ply plate standing 342 mm in from the horn side, three 95 x 45 ovals through it, a fin behind it
 * - channels: the 205 mm driver channel beside each brace, dark at its back, a fixing block in its corner
 * - hardware: two kidney handles in the top (122 x 53, 424 apart, 250 from the back), the 15" drivers' access lid
 *   in one side, the M10 fly points, the jack plate on the back
 */
function f215Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["stack-mid-bass"], t = 0.015, f = d / 2, back = 0.03, zb = -d / 2 + back, mm = (v: number) => v / 1000;
  const P = (): Build => ({ pieces: [], marks: [] }), cab = P(), walls = P(), braces = P(), chans = P(), hw = P();
  const mid = h / 2, bx = -w / 2 + mm(342), bw = mm(76), cx0 = bx + bw / 2;
  well(cab, "violet", [w, h, d], d - back, t);
  // the light dies down each cell toward its throat: the shelf, the horn walls, the fins and a liner on the box's
  // floor and roof go from the paint's full colour at the mouth to near black at the back (`fade`)
  const mouth = f - 0.04, hx0 = -w / 2 + t, hx1 = bx - bw / 2, deepZ = (f - 0.003 + zb) / 2, deepL = f - 0.003 - zb;
  cab.pieces.push(fade(sheet([w - 2 * t, t, d - back], [0, mid, back / 2]), mouth, zb, 0.05, 4));
  for (const y of [t + 0.001, h - t - 0.001]) cab.pieces.push(fade(sheet([hx1 - hx0, 0.002, deepL], [(hx0 + hx1) / 2, y, deepZ]), mouth, zb, 0.05, 4));
  for (const [y0, y1] of [[t, mid - t / 2], [mid + t / 2, h - t]]) {
    const ch = y1 - y0, cy = (y0 + y1) / 2;
    // the horn wall: a curve x(s) = throat + (mouth - throat) s^2 from the back (s = 0) to the front (s = 1)
    const xf = -w / 2 + t, xt = bx - bw / 2 - mm(50), z0 = zb + 0.005, z1 = f - 0.002, n = 10;
    const curve = Array.from({ length: n + 1 }, (_, i) => { const s = i / n; return [xt + (xf - xt) * s * s, z0 + (z1 - z0) * s]; });
    walls.pieces.push(fade(slab("violet", [...curve, ...[...curve].reverse().map(([x, z]) => [x! - t, z!])], y0, y1), mouth, zb, 0.05, 6));
    // the brace: set 20 mm back from the front and turned a little toward the channel (the photo sees it near face on,
    // its edge a dark strip down one side), three tall ovals through it, 52 x 95 as the drawing's front view has them,
    // their rims chamfered so each catches a thin line of light, and the fin behind its horn-side edge to the back
    braces.pieces.push(brace(bx, cy, f - 0.02, bw, ch, [-1, 0, 1].map((k) => k * ch * 0.29), [mm(52), mm(95)], F215_BRACE_TURN, 0.003));
    // behind the brace's holes the channel is a dark slot: a black sheet just behind the plate, so each hole reads as
    // a lit ply edge round a deep oval rather than a flat circle
    const slot = brace(bx, cy, f - 0.02 - 0.03, bw, ch - 0.01, [], 0, F215_BRACE_TURN);
    braces.pieces.push({ geo: slot.geo, slot: "cavity" });
    braces.pieces.push(fade(sheet([t, ch, f - 0.038 - zb], [bx - bw / 2 + t / 2, cy, (f - 0.038 + zb) / 2]), mouth, zb, 0.05, 4));
    // the driver channel: near black at its back, a fixing block in its outer corner by the shelf
    chans.pieces.push(box("cavity", [w / 2 - t - cx0, ch, 0.004], [(w / 2 - t + cx0) / 2, cy, zb + 0.003]));
    chans.pieces.push(box("cavity", [bx - bw / 2 - xt, ch, 0.004], [(bx - bw / 2 + xt) / 2, cy, zb + 0.003]));
    // the channel's walls, floor and roof lit only at its mouth, falling to near black a fifth of a metre in, as the
    // photo shows it behind the brace
    const fin = bx - bw / 2 + t, cw = w / 2 - t - fin, dim = (p: Piece) => fade(p, f - 0.03, f - 0.22, 0.1);
    chans.pieces.push(dim(sheet([0.002, ch, deepL], [w / 2 - t - 0.001, cy, deepZ])), dim(sheet([0.002, ch, deepL], [fin + 0.001, cy, deepZ])));
    for (const y of [y0 + 0.001, y1 - 0.001]) chans.pieces.push(dim(sheet([cw - 0.004, 0.002, deepL], [fin + cw / 2, y, deepZ])));
    const by = y0 === t ? y0 + 0.02 : y1 - 0.02;
    chans.pieces.push(box("violet", [0.07, 0.022, 0.035], [w / 2 - t - 0.035, by, f - 0.06], { bevel: 0.003 }));
  }
  // the kidney handles in the top and the back's jack plate; the sides stay one clean painted panel, as the photo shows
  // them (the drivers' access lid sits flush and the fly points are inside the coat, so neither reads from the front)
  for (const s of [-1, 1]) hw.pieces.push(box("cavity", [mm(122), 0.004, mm(53)], [s * mm(212), h + 0.0004, -d / 2 + mm(250)], { bevel: 0.002 }));
  plate(hw, 0.13, 0.09, [0, h / 2, -d / 2 - 0.004]);
  socketPanel(hw, "stack-mid-bass", "back", [0, h / 2, -d / 2 - 0.008], [0.13, 0.09]);
  mark(hw, "grab", [w / 2 + 0.012, h * 0.55, 0], [1, 0, 0]);
  return { cabinet: cab, "horn-walls": walls, braces, channels: chans, hardware: hw };
}


/** A folded-horn bin's numbers off its drawing, in mm: the brace's outer edge in from the outside and its width, its
 * holes (how many, their width and height, centre to centre), the strut's distance off the centre line, the tray's
 * width, and the kidney handles' distance either side of half height. */
type BinSheet = { braceIn: number; braceW: number; holes: number; holeW: number; holeH: number; pitch: number; strutX: number; trayW: number; handleGap: number };

/** The F221 (F221-F1-WD=T0119-00, DD=T0217-00): 1686 x 582 x 867, three tall ovals in each brace. */
const F221: BinSheet = { braceIn: 465, braceW: 82, holes: 3, holeW: 45, holeH: 134, pitch: 171, strutX: 215, trayW: 480, handleGap: 105 };
/** The F218 MkII (F218_MK2-F1-WD=T0117-00, DD=T0209-00): 1326 x 496 x 723, four round holes in each brace. */
const F218: BinSheet = { braceIn: 347, braceW: 78, holes: 4, holeW: 40, holeH: 76, pitch: 117, strutX: 166, trayW: 332, handleGap: 126 };

/**
 * A Funktion-One horn bass bin as its drawings show it and it is built, piece by piece (no maker's name): a long low
 * box of 18 mm ply in textured violet paint, mirrored about a centre divider. The F221 and the F218 MkII are the same
 * build at two sizes; `sheet` carries what differs. Metres from the box's centre line, floor and front.
 * - cabinet: the open-fronted shell, the centre divider, the back
 * - horn walls: in each outer cell a curved wall sweeping from the outer front corner back to the throat behind the brace
 * - braces: a plate each side `braceIn` from the outside, its holes, a fin behind it
 * - channels: the driver channel each side of the divider, near black at the back, a strut down it, the tray across
 *   the middle, deep in
 * - hardware: the drivers' access lids in both sides with their kidney handles, the four locator recesses in the top
 *   and locator feet under the bottom, the connector panel high on the back
 */
function binPieces(id: GearId, sheet: BinSheet): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES[id], t = 0.018, f = d / 2, back = 0.03, zb = -d / 2 + back, mm = (v: number) => v / 1000;
  const P = (): Build => ({ pieces: [], marks: [] }), cab = P(), walls = P(), braces = P(), chans = P(), hw = P();
  const bw = mm(sheet.braceW), ih = h - 2 * t, cy = h / 2;
  well(cab, "violet", [w, h, d], d - back, t);
  cab.pieces.push(box("violet", [t, ih, d - back], [0, cy, back / 2]));
  for (const s of [-1, 1]) {
    const bx = s * (w / 2 - mm(sheet.braceIn) - bw / 2), inner = bx - s * bw / 2, outer = bx + s * bw / 2;
    // the horn wall: x(u) = throat + (mouth - throat) u^2 from the back (u = 0) to the front (u = 1)
    const xf = s * (w / 2 - t), xt = outer + s * mm(60), z0 = zb + 0.005, z1 = f - 0.002, n = 12;
    const curve = Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [xt + (xf - xt) * u * u, z0 + (z1 - z0) * u]; });
    walls.pieces.push(slab("violet", [...curve, ...[...curve].reverse().map(([x, z]) => [x! + s * t, z!])], t, h - t));
    // the brace: 20 mm back from the front and turned toward the centre, its round holes (the drawing's ovals seen at
    // the turn), and the fin behind its outer edge to the back
    const ys = Array.from({ length: sheet.holes }, (_, k) => (k - (sheet.holes - 1) / 2) * mm(sheet.pitch));
    braces.pieces.push(brace(bx, cy, f - 0.02, bw, ih, ys, Math.min(mm(sheet.holeH), bw / Math.cos(BRACE_TURN) - 0.03), -s * BRACE_TURN));
    braces.pieces.push(box("violet", [t, ih, f - 0.038 - zb], [outer - s * t / 2, cy, (f - 0.038 + zb) / 2]));
    // the channel: near black at its back, a strut down it, the throat slot's dark back behind the horn wall
    chans.pieces.push(box("cavity", [Math.abs(inner) - t / 2, ih, 0.004], [(inner + s * t / 2) / 2, cy, zb + 0.003]));
    chans.pieces.push(box("cavity", [Math.abs(xt - outer), ih, 0.004], [(xt + outer) / 2, cy, zb + 0.003]));
    chans.pieces.push(box("violet", [0.022, ih, 0.022], [s * mm(sheet.strutX), cy, zb + d * 0.23], { bevel: 0.004 }));
    chans.pieces.push(box("metal", [0.05, 0.03, 0.006], [s * mm(sheet.strutX), h - t - 0.03, zb + d * 0.23 + 0.012], { bevel: 0.002 }));
  }
  // the tray across both channels at half height, deep in
  chans.pieces.push(box("violet", [mm(sheet.trayW), 0.014, d * 0.32], [0, cy, zb + d * 0.16], { bevel: 0.003 }));
  // the access lids with their kidney handles, the locator recesses and feet, the connector panel
  for (const s of [-1, 1]) {
    hw.pieces.push(box("knob", [0.002, h - mm(60), d - mm(110)], [s * (w / 2 + 0.0008), cy, -mm(15)], { bevel: 0.0008 }));
    hw.pieces.push(box("violet", [0.003, h - mm(68), d - mm(118)], [s * (w / 2 + 0.0015), cy, -mm(15)], { bevel: 0.001 }));
    for (const y of [cy - mm(sheet.handleGap), cy + mm(sheet.handleGap)]) hw.pieces.push(box("cavity", [0.005, mm(110), mm(42)], [s * (w / 2 + 0.002), y, mm(40)], { bevel: 0.002 }));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    hw.pieces.push(box("knob", [mm(62), 0.004, mm(62)], [x * (w / 2 - mm(70)), h + 0.0004, z * (d / 2 - mm(70))], { bevel: 0.002 }));
    hw.pieces.push(block("rubber", [mm(56), 0.01, mm(56)], [x * (w / 2 - mm(70)), 0.005, z * (d / 2 - mm(70))], 0.003));
  }
  plate(hw, 0.16, 0.1, [0, h - mm(130), -d / 2 - 0.004]);
  socketPanel(hw, id, "back", [0, h - mm(130), -d / 2 - 0.008], [0.16, 0.1]);
  mark(hw, "grab", [w / 2 + 0.012, cy, 0], [1, 0, 0]);
  return { cabinet: cab, "horn-walls": walls, braces, channels: chans, hardware: hw };
}

const mm = (v: number) => v / 1000;
const pieceBuild = (): Build => ({ pieces: [], marks: [] });

/**
 * The 24" bass, as the Funktion-One F124 is drawn on its sheets (F124-F1-WD=T0120-00, TD=T0220-00, DD=T0221-00) and
 * built, piece by piece (no maker's name): a tall box stood upright, 702 wide, 992 tall and 1056 deep in 18 mm ply and
 * textured violet, one horn filling its open front. Metres from the box's centre line, floor and front.
 * - cabinet: the open-fronted shell and its back
 * - roof: the horn's top wall, sloping from the mouth's top edge down to the throat line 498 up at the back
 * - shelf: the plate across the mouth, its front edge 397 up, sloping 14 degrees down to the back (the front view sees
 *   it 220 to 396 up), three round holes 188 across and four 130 across
 * - centre plate: on the centre line under the roof, its front edge slanting from the floor up to the roof
 * - driver: the 24" cone low at the back, tilted up into the horn, the back round it near black
 * - hardware: the driver's access lid in the top with its two slot handles 360 apart, the rear and bottom handles,
 *   the NL4 panel on the back, the wheel points, the locator recesses at both side faces' corners
 */
function f124Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["horn-sub-24"], t = 0.018, f = d / 2, zb = -d / 2 + t, P = pieceBuild;
  const cab = P(), roof = P(), shelf = P(), plateC = P(), drv = P(), hw = P(), iw = w - 2 * t, throat = mm(498);
  well(cab, "violet", [w, h, d], d - t, t);
  // the back below the roof, near black where the light dies
  cab.pieces.push(box("cavity", [iw, throat - t, 0.004], [0, (throat + t) / 2, zb + 0.003]));

  // ---- roof: one ply wall across the inside, from the mouth's top edge down to the throat line at the back
  roof.pieces.push(prism("violet", [[f - 0.002, h - t], [f - 0.002, h - t - 0.03], [zb, throat], [zb, throat + t]], iw - 0.002));

  // ---- shelf: a plate laid in its own frame (x across, y back along its slope), turned down 14 degrees to the back
  const tilt = (14 * Math.PI) / 180, len = mm(730), circ = (x: number, y: number, r: number) =>
    Array.from({ length: 24 }, (_, j) => { const q = (j / 24) * Math.PI * 2; return [x + Math.cos(q) * r, y + Math.sin(q) * r]; });
  const holes = [...[-0.216, 0, 0.216].map((x) => circ(x, -mm(240), mm(94))), ...[-0.248, -0.1, 0.1, 0.248].map((x) => circ(x, -mm(500), mm(65)))];
  const sp = frontPlate("violet", [[-iw / 2, -len], [iw / 2, -len], [iw / 2, 0], [-iw / 2, 0]], holes, t, t);
  sp.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, mm(397), f - 0.02).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - tilt)));
  shelf.pieces.push(sp);
  // the screw heads along its back edge, two each side of the centre plate
  for (const x of [-0.29, -0.23, 0.23, 0.29]) shelf.pieces.push(disc("metal", 0.008, 0.006, "y", [x, mm(397) - Math.sin(tilt) * (len - 0.03) + t, f - 0.02 - Math.cos(tilt) * (len - 0.03)], 8));

  // ---- centre plate: on the centre line, floor to roof, its front edge slanting back as it rises
  plateC.pieces.push(prism("violet", [[f - 0.06, t], [zb + 0.32, t], [zb + 0.32, throat + 0.03], [f - 0.5, throat + 0.03]], t));

  // ---- driver: the 24" cone low on the back, tilted 30 degrees up into the horn, its rubber roll and dark cone
  const dm = new THREE.Matrix4().makeTranslation(0, mm(260), zb + 0.17).multiply(new THREE.Matrix4().makeRotationX(-0.52)), dr = mm(230);
  drv.pieces.push(lathe("knob", [[0, dr, dr], [0.008, dr * 0.92, dr * 0.92], [0.004, dr * 0.84, dr * 0.84]], { seg: 28, m: dm }));
  drv.pieces.push(...cone(dr * 0.84, 0.1, dm, 24));

  // ---- hardware: the lid on top, the slot handles, the NL4 panel, the wheel points, the locator recesses
  const lidZ = -d / 2 + mm(113) + mm(268), slot = (at: THREE.Vector3Tuple, s: THREE.Vector3Tuple) => hw.pieces.push(box("cavity", s, at, { bevel: 0.006 }));
  hw.pieces.push(box("knob", [mm(625), 0.002, mm(536)], [0, h + 0.0008, lidZ], { bevel: 0.0008 }), box("violet", [mm(617), 0.003, mm(528)], [0, h + 0.0015, lidZ], { bevel: 0.001 }));
  for (const x of [-0.18, 0.18]) {
    slot([x, h + 0.002, -d / 2 + mm(460)], [mm(130), 0.005, mm(52)]); // lid handles
    slot([x, mm(498), -d / 2 - 0.002], [mm(130), mm(52), 0.005]); // rear handles
    slot([x, 0.0005, f - mm(460)], [mm(130), 0.005, mm(52)]); // bottom handles, sunk into the floor face
    // their pockets standing on the floor inside the mouth
    hw.pieces.push(box("violet", [mm(160), mm(38), mm(100)], [x, t + mm(19), f - mm(460)], { bevel: 0.004 }));
  }
  plate(hw, mm(193), mm(147), [0, mm(674), -d / 2 - 0.004]);
  socketPanel(hw, "horn-sub-24", "back", [0, mm(690), -d / 2 - 0.008], [mm(183), mm(137)]);
  for (const x of [-1, 1]) for (const y of [mm(130), h - mm(130)]) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    hw.pieces.push(disc("metal", 0.006, 0.004, "z", [x * (w / 2 - mm(70)) + dx * mm(30), y + dy * mm(40), -d / 2 - 0.001], 8));
  for (const s of [-1, 1]) for (const y of [mm(85), h - mm(85)]) for (const z of [f - mm(85), -d / 2 + mm(85)])
    hw.pieces.push(box("cavity", [0.004, mm(81), mm(81)], [s * (w / 2 + 0.0008), y, z], { bevel: 0.004 }));
  mark(hw, "grab", [w / 2 + 0.012, h / 2, 0], [1, 0, 0]);
  return { cabinet: cab, roof, shelf, "centre-plate": plateC, driver: drv, hardware: hw };
}

/**
 * The infrasonic bass, as the Funktion-One Infrabass 218 is drawn on its data sheet (IB218-F1-DS=D0059-00) and its 2002
 * product drawing, piece by piece (no maker's name: the face either side of the slot, where it is embossed, stays
 * plain): two 18"s in a closed box of 18 mm birch ply, the F218's size (1326 x 496 x 723), textured violet.
 * - cabinet: the box either side of a slot 239 wide down the middle of the front, and behind the slot
 * - slot: its two ply walls, the near-black well at its back and the floor curving up into it
 * - grille: the hex-perforated steel bowed into the slot, flush at the top and 130 back at its foot
 * - hardware: an access lid in each side with two kidney handles, the four caster plates and the NL4 plate on the back
 */
function ib218Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["infra-sub-18"], t = 0.018, f = d / 2, sw = mm(239), deep = 0.2, P = pieceBuild;
  const cab = P(), slotB = P(), grille = P(), hw = P(), side = (w - sw) / 2, cy = h / 2;
  // ---- cabinet: the top and bottom run across the slot, the two halves either side of it and the block behind it
  for (const y of [t / 2, h - t / 2]) cab.pieces.push(box("violet", [w, t, d], [0, y, 0], { bevel: 0.006 }));
  for (const s of [-1, 1]) cab.pieces.push(box("violet", [side, h - 2 * t, d], [s * (sw / 2 + side / 2), cy, 0], { bevel: 0.002 }));
  cab.pieces.push(box("violet", [sw + 0.002, h - 2 * t, d - deep], [0, cy, -d / 2 + (d - deep) / 2]));
  // the back is one sheet across all three
  cab.pieces.push(box("violet", [w - 0.004, h - 2 * t, 0.002], [0, cy, -d / 2 - 0.0008]));
  // ---- slot: the walls a shade in, the dark back, the curved floor where the grille ends
  for (const s of [-1, 1]) slotB.pieces.push(box("violet", [0.004, h - 2 * t, deep], [s * (sw / 2 - 0.002), cy, f - deep / 2], { bevel: 0.001 }));
  slotB.pieces.push(box("cavity", [sw - 0.008, h - 2 * t, 0.004], [0, cy, f - deep + 0.003]));
  slotB.pieces.push(prism("cavity", [[f - 0.02, t], [f - deep, t], [f - deep, mm(110)], [f - 0.14, mm(64)], [f - 0.06, mm(28)]], sw - 0.008));
  // ---- grille: six bands down the slot, each turned to follow the bow
  const bands = 6, y0 = mm(70), y1 = h - t, z = (y: number) => f - 0.004 - 0.13 * (1 - (y - y0) / (y1 - y0)) ** 2;
  for (let i = 0; i < bands; i++) {
    const ya = y0 + ((y1 - y0) * i) / bands, yb = y0 + ((y1 - y0) * (i + 1)) / bands, ym = (ya + yb) / 2, tilt = Math.atan2(z(yb) - z(ya), yb - ya);
    const m = new THREE.Matrix4().makeTranslation(0, ym, z(ym)).multiply(new THREE.Matrix4().makeRotationX(tilt));
    grille.pieces.push(...grilleSlab(sw - 0.01, Math.hypot(yb - ya, z(yb) - z(ya)) + 0.002, 0.004, 0, -0.004, 0.002, m));
  }
  // ---- hardware: the access lids with their kidney handles, the caster plates, the NL4 plate
  const lidZ = f - mm(265) - mm(201);
  for (const s of [-1, 1]) {
    hw.pieces.push(box("knob", [0.002, mm(445), mm(411)], [s * (w / 2 + 0.0008), cy, lidZ], { bevel: 0.0008 }));
    hw.pieces.push(box("violet", [0.003, mm(437), mm(403)], [s * (w / 2 + 0.0015), cy, lidZ], { bevel: 0.001 }));
    for (const y of [cy - mm(119), cy + mm(119)]) hw.pieces.push(box("cavity", [0.005, mm(103), mm(46)], [s * (w / 2 + 0.002), y, f - mm(368)], { bevel: 0.002 }));
  }
  for (const x of [-0.435, 0.435]) for (const y of [mm(74), mm(401)]) {
    hw.pieces.push(box("metal", [mm(86), mm(86), 0.004], [x, y, -d / 2 - 0.002], { bevel: 0.001 }));
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) hw.pieces.push(disc("metal", 0.005, 0.004, "z", [x + dx * mm(32), y + dy * mm(32), -d / 2 - 0.004], 8));
  }
  plate(hw, mm(86), mm(128), [0, mm(272), -d / 2 - 0.004]);
  socketPanel(hw, "infra-sub-18", "back", [0, mm(272), -d / 2 - 0.008], [mm(78), mm(120)]);
  mark(hw, "grab", [w / 2 + 0.012, cy, 0], [1, 0, 0]);
  return { cabinet: cab, slot: slotB, grille, hardware: hw };
}

/**
 * The Res 2's two sections with no box round them (Funktion-One's "skeletal" horns), piece by piece (no maker's name:
 * the mark moulded in the rim's corner stays plain). Both have the Res2's 8" mid horn and axe-head plug in a moulded
 * face, the 8" driver's can behind and a stainless yoke on two M10 points, which the model shows swung back so it stays
 * inside the published size. Metres from the centre line, floor and front.
 * - Res 2SH (Res2SH-F1-WD=T0107-00), `skeletal-mid-high`: 484 x 447 x 357, grey; the face straight-sided to 307 and
 *   shouldered up to a 145 flat, the 1" HF horn above the mid (167 x 96, centred 371 up) and its driver behind
 * - Res 2S8 (Res2S8-F1-WD=T0055-00), `skeletal-mid`: 458 x 307 x 357, black; the mid alone in a rolled rim
 * - face: the moulded front, its mouths cut through
 * - mid horn: the facets from the mouth back 160 to the throat, the outside of them too
 * - plug: the axe head across the throat
 * - driver: the 8" can, 220 across, its clamp band
 * - hf horn (Res 2SH only): its walls to the compression driver's throat, and the driver
 * - yoke: the strap's two arms from the M10 points and the bar across them
 */
function skeletalPieces(id: "skeletal-mid-high" | "skeletal-mid"): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES[id], f = d / 2, hf = id === "skeletal-mid-high", skin: GearSlot = hf ? "horn" : "knob", P = pieceBuild;
  const face = P(), mid = P(), plugB = P(), drv = P(), hfB = P(), yoke = P(), ft = 0.012;
  // the numbers off each drawing: the mid mouth's half width and height and its centre, the yoke's pivot, arm and swing
  const s = hf ? { mA: mm(215), mC: mm(137.5), my: mm(163.5), py: mm(215), pz: f - mm(189), arm: mm(255), swing: (33 * Math.PI) / 180 }
    : { mA: mm(209), mC: mm(131.5), my: mm(153.5), py: mm(156), pz: f - mm(188), arm: mm(210), swing: (49 * Math.PI) / 180 };
  const hcy = mm(371), hA = mm(83.5), hC = mm(48);

  // ---- face: the Res 2SH's shouldered front with both mouths, or the Res 2S8's rounded rim round the one
  const outline = hf ? [[-w / 2, 0], [w / 2, 0], [w / 2, mm(307)], [mm(72.5), h], [-mm(72.5), h], [-w / 2, mm(307)]]
    : roundRect(0, h / 2, w, h, 0.02).map((v) => [v.x, v.y]);
  face.pieces.push(frontPlate(skin, outline, [rect(0, s.my, s.mA * 2, s.mC * 2), ...(hf ? [rect(0, hcy, hA * 2, hC * 2)] : [])], f, ft));

  // ---- mid horn: the Res2's rings scaled to this mouth and 160 deep, inside and out
  const k = s.mA / mm(211), zt = f - ft - 0.16, tipA = mm(154) * k, drR = mm(77);
  const mouth = ring8(0, s.my, f - ft, s.mA, s.mC);
  const bands = [ring8(0, s.my, f - ft - 0.04, mm(203) * k, mm(126) * k, mm(178) * k, mm(122) * k), ring8(0, s.my, f - ft - 0.093, mm(178) * k, mm(100) * k, mm(110) * k, mm(98) * k)];
  const throat = ring8(0, s.my, zt, tipA, drR, mm(54), drR), out = (r: THREE.Vector3[], e: number) => r.map((v) => new THREE.Vector3(v.x * (1 + e / Math.abs(v.x || 1)), s.my + (v.y - s.my) * (1 + e / Math.abs(v.y - s.my || 1)), v.z));
  mid.pieces.push(ringWalls(skin, [mouth, ...bands, throat]), ringWalls(skin, [mouth, ...bands, throat].map((r) => out(r, 0.005)), -1));
  mid.pieces.push(frontPlate("grime", throat.map((v) => [v.x, v.y]), [Array.from({ length: 20 }, (_, i) => [Math.cos((i / 20) * Math.PI * 2) * drR, s.my + Math.sin((i / 20) * Math.PI * 2) * drR])], zt + 0.004, 0.006));

  // ---- plug: the axe head, blunt on the driver, its ridge forward, pointed at both tips
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, s.my + y, zt + z), pt: THREE.Vector3[] = [];
  for (const q of [-1, 1]) pt.push(V(q * 0.09, 0.032, 0.01), V(q * 0.09, -0.032, 0.01), V(q * 0.09, 0.03, 0.06), V(q * 0.09, -0.03, 0.06), V(q * 0.08, 0, 0.11), V(q * tipA, 0, 0.04), V(q * 0.13 * k, 0.012, 0.026), V(q * 0.13 * k, -0.012, 0.026));
  plugB.pieces.push({ geo: toCreasedNormals(new ConvexGeometry(pt), 0.2), slot: skin });

  // ---- driver: the can from the throat to the back, domed at its end, and the clamp band the yoke bolts to
  const cr = mm(110);
  drv.pieces.push(disc("knob", cr, zt + d / 2 - 0.014, "z", [0, s.my, (zt - d / 2 + 0.014) / 2], 24), disc("knob", cr * 0.88, 0.014, "z", [0, s.my, -d / 2 + 0.007], 24));
  drv.pieces.push(disc("metal", cr + 0.006, 0.044, "z", [0, s.my, s.pz], 24));
  for (const q of [-1, 1]) drv.pieces.push(box("metal", [0.024, 0.03, 0.044], [q * (cr + 0.016), s.py, s.pz], { bevel: 0.003 }));

  // ---- hf horn: straight walls from the mouth to the compression driver's throat, and the driver behind
  if (hf) {
    const hd = 0.09, hr = [ring8(0, hcy, f - ft, hA, hC), ring8(0, hcy, f - ft - hd, 0.016, 0.012)];
    hfB.pieces.push(ringWalls(skin, hr), ringWalls(skin, [ring8(0, hcy, f - ft, hA + 0.004, hC + 0.004), ring8(0, hcy, f - ft - hd, 0.02, 0.016)], -1));
    hfB.pieces.push(disc("knob", mm(45), 0.06, "z", [0, hcy, f - ft - hd - 0.03], 16), disc("metal", mm(30), 0.008, "z", [0, hcy, f - ft - hd - 0.064], 12));
  }

  // ---- yoke: two flat stainless arms from the M10 points, swung back, and the bar across their tops
  const ax = cr + 0.032, top: THREE.Vector3Tuple = [0, s.py + s.arm * Math.cos(s.swing), s.pz - s.arm * Math.sin(s.swing)];
  for (const q of [-1, 1]) {
    yoke.pieces.push(box("metal", [0.005, s.arm, 0.036], [q * ax, s.py + (s.arm / 2) * Math.cos(s.swing), s.pz - (s.arm / 2) * Math.sin(s.swing)], { bevel: 0.0015, rot: [-s.swing, 0, 0] }));
    yoke.pieces.push(disc("metal", 0.011, 0.012, "x", [q * (ax + 0.006), s.py, s.pz], 6));
  }
  yoke.pieces.push(box("metal", [ax * 2 + 0.005, 0.005, 0.036], top, { bevel: 0.0015, rot: [-s.swing, 0, 0] }));

  // the jacks on the can's back: the Res 2SH's two NL4s, the Res 2S8's junction box
  plate(drv, 0.09, 0.05, [0, s.my, -d / 2 - 0.004]);
  socketPanel(drv, id, "back", [0, s.my, -d / 2 - 0.008], [mm(84), mm(46)]);
  mark(drv, "grab", top, [0, 1, 0]);
  return { face, "mid-horn": mid, plug: plugB, driver: drv, ...(hf ? { "hf-horn": hfB } : {}), yoke };
}

/**
 * The 15" passive top, as the JBL JRX215 is drawn on its spec sheet (SSJRX215, 2013), piece by piece: a carpeted
 * MDF box narrowing to the back (460 at the front, 353 at the back, 432 deep, 686 tall on 13 mm feet), a hex grille
 * in a steel frame over the whole front, the waveguide plate high up, the 15" under it with a port slot either side
 * of its top, a steel cup handle in each side, the jack plate on the back and the dual-angle pole socket underneath.
 */
function jrx215Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["top-15-passive"], P = pieceBuild;
  const cab = P(), grille = P(), guide = P(), woofer = P(), ports = P(), hw = P();
  const feet = mm(13), wb = mm(353), f = d / 2, ch = h - feet, rim = mm(22), cave = 0.06, yc = feet + ch / 2;
  // the side's x at depth z, and its outward normal (each side leans in toward the back)
  const half = (z: number) => wb / 2 + ((w - wb) / 2) * (z + d / 2) / d, lean = Math.atan2((w - wb) / 2, d);
  const side = (s: number): THREE.Vector3Tuple => [s * Math.cos(lean), 0, -Math.sin(lean)];
  // the side handles: a steel cup 220 tall and 162 deep, its foot 319 off the floor, 101 from the back
  const hz = -d / 2 + mm(101) + mm(81), hy = mm(319) + mm(110);
  const cup = (s: number): [THREE.Vector3Tuple, Well[]] => [side(s), [{ at: [s * half(hz), hy, hz], w: mm(162), h: mm(220), r: 0.018, deep: 0.055, lip: 0.003, walls: "metal", floor: "metal" }]];
  const gw = w - 2 * rim, gh = ch - 2 * rim, jy = mm(226) + mm(48.5), rec = 0.02;
  sunk(cab, rounded("tolex", { wf: w, wb, h: ch, d, r: 0.006, e: 0.006, y0: feet }), [
    [[0, 0, 1], [{ at: [0, yc, f], w: gw, h: gh, r: 0.004, deep: cave, lip: 0.002, walls: "knob", floor: "knob" }]],
    cup(-1), cup(1),
    [[0, 1, 0], [{ at: [0, h, 0], w: mm(130), h: mm(45), r: 0.016, deep: 0.04, lip: 0.004, walls: "metal", floor: "metal" }]],
    [[0, 0, -1], [{ at: [0, jy, -d / 2], w: mm(150), h: mm(109), r: 0.008, deep: rec, lip: 0.003, draft: 0.002 }]],
  ]);
  // the grille: hex-perforated steel, its face a millimetre proud of the carpet, in a bright steel frame
  grille.pieces.push(...grilleSlab(gw - 0.002, gh - 0.002, 0.008, yc, f - 0.007, 0.004));
  const fr = mm(12);
  for (const y of [-1, 1]) grille.pieces.push(box("metal", [gw + 0.004, fr, 0.004], [0, yc + y * (gh / 2 - fr / 2 + 0.002), f + 0.002], { bevel: 0.0012 }));
  for (const x of [-1, 1]) grille.pieces.push(box("metal", [fr, gh - 2 * fr + 0.004, 0.004], [x * (gw / 2 - fr / 2 + 0.002), yc, f + 0.002], { bevel: 0.0012 }));
  grillePlate(grille, new THREE.Matrix4().makeTranslation(0, feet + rim + 0.03, f + 0.001));
  // behind it, on the black baffle: the waveguide plate, 316 x 167, its top 49 under the top
  const floor = f - cave, gy = h - mm(49) - mm(83.5), plateZ = floor + 0.045;
  guide.pieces.push(onto(new THREE.Matrix4().makeTranslation(0, gy, 0), [frontPlate("panel", rect(0, 0, mm(316), mm(167)), [rect(0, 0, mm(276), mm(126))], plateZ, 0.006)])[0]!);
  guide.pieces.push(...horn(mm(262), mm(112), 0.04, new THREE.Matrix4().makeTranslation(0, gy, plateZ - 0.002), 16));
  for (const [x, y] of [[-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], [1, -1]]) guide.pieces.push(...screw([x * mm(146), gy + y * mm(72), plateZ + 0.001], "z", 0.004, "metal", 6));
  // the 15": its frame 390 across, centred 224 above the cabinet's floor
  woofer.pieces.push(...cone(mm(162), 0.035, new THREE.Matrix4().makeTranslation(0, feet + mm(224), floor + 0.038), 20));
  // the two port slots, 86 x 63, either side of the woofer's top, under the waveguide
  for (const x of [-1, 1]) ports.pieces.push(box("cavity", [mm(86), mm(63), 0.004], [x * mm(127), h - mm(266), floor + 0.002], { bevel: 0.012 }));
  // the side cups' grip bars and steel flanges
  for (const s of [-1, 1]) {
    const n = new THREE.Vector3(...side(s)), at = new THREE.Vector3(s * half(hz), hy, hz), rot: THREE.Vector3Tuple = [0, s * lean, 0];
    hw.pieces.push(box("metal", [0.012, mm(24), mm(150)], at.clone().addScaledVector(n, -0.03).toArray(), { rot, bevel: 0.004 }));
    for (const y of [-1, 1]) hw.pieces.push(box("metal", [0.003, mm(14), mm(186)], at.clone().addScaledVector(n, 0.0015).add(new THREE.Vector3(0, y * mm(117), 0)).toArray(), { rot }));
    for (const k of [-1, 1]) hw.pieces.push(box("metal", [0.003, mm(248), mm(12)], at.clone().addScaledVector(n, 0.0015).add(new THREE.Vector3(Math.sin(lean) * s * k * mm(87), 0, Math.cos(lean) * k * mm(87))).toArray(), { rot }));
  }
  // the jack plate, 138 x 97 in a shallow cup in the back, its foot 226 up: the Speakon and the 1/4" jack
  const bz = -d / 2 + rec - 0.008;
  plate(hw, mm(138), mm(97), [0, jy, bz + 0.004]);
  socketPanel(hw, "top-15-passive", "back", [0, jy, bz], [mm(138), mm(97)]);
  // the pole socket underneath (two cups, 0 and 10 degrees, 53 apart) and the four feet, 32 in from each edge
  for (const z of [-mm(32), mm(21)]) hw.pieces.push(disc("metal", 0.024, 0.004, "y", [0, feet - 0.002, z], 14), disc("knob", 0.018, 0.003, "y", [0, feet - 0.0035, z], 14));
  for (const [x, z] of [[mm(195.5), f - mm(32)], [mm(147), -d / 2 + mm(32)]]) for (const s of [-1, 1]) hw.pieces.push(block("rubber", [0.04, feet, 0.04], [s * x, feet / 2, z], 0.004));
  mark(hw, "grab", [0, h + 0.02, 0]);
  mark(hw, "pole-cup", [0, feet, -mm(32)], [0, -1, 0]);
  return { cabinet: cab, grille, waveguide: guide, woofer, ports, hardware: hw };
}

/**
 * The 12" passive wedge, as the JBL PRX412M is drawn on its spec sheet (SS PRX412M, 2012), laid as a stage monitor on
 * the 30-degree facet across one back corner. Its section, drawn standing up (`SECTION`, mm, x across the front from
 * the facet's side, f back from the front): the front's corners rounded, the back flat for 152 then the facet, so
 * the facet's side panel is 283 deep. Lying on the facet, the 574 mm height runs across the stage (x) and the baffle
 * looks up at the player at 60 degrees. Pieces: the cabinet (DuraFlex-coated ply), the two-panel grille, the
 * waveguide across the top of the baffle, the 12", four round ports at its corners, and the hardware (the double cup
 * handle in the full-depth side, the M10 points, the jack plate in the back's flat, the pole socket, the feet).
 */
const PRX_SECTION = [[0, 46], [12, 14], [34, 0], [318.8, 0], [340.8, 14], [352.8, 46], [352.8, 398.6], [201, 398.6], [0, 282.6]] as const;

function prx412mPieces(): Record<string, Build> {
  const [w] = GEAR_SIZES["wedge-12-passive"], P = pieceBuild;
  const cab = P(), grille = P(), guide = P(), woofer = P(), ports = P(), hw = P();
  const foot = mm(6), c = Math.cos(Math.PI / 6), s = 0.5, f0 = mm(282.6);
  // a point of the section (metres) laid on the facet: up runs out of the facet, z along the floor toward the baffle
  const raw = (x: number, f: number): [number, number] => [-(c * x + s * (f - f0)), s * x - c * (f - f0) + foot];
  const zs = PRX_SECTION.map(([x, f]) => raw(mm(x), mm(f))[0]), zc = -(Math.min(...zs) + Math.max(...zs)) / 2;
  const at = (x: number, f: number, gx = 0): THREE.Vector3 => { const [z, y] = raw(x, f); return new THREE.Vector3(gx, y, z + zc); };
  const X = new THREE.Vector3(1, 0, 0), OUT = new THREE.Vector3(0, c, s), ACROSS = new THREE.Vector3(0, s, -c), BACK = new THREE.Vector3(0, -c, -s);
  // the baffle's frame at (u along x, v across the baffle from its middle), `lift` out of it
  const baffle = (u: number, v = 0, lift = 0) => new THREE.Matrix4().makeBasis(X, ACROSS, OUT).setPosition(at(mm(176.4) + v, 0, u).addScaledVector(OUT, lift));
  const fw = mm(318.8 - 34), gl = w - 0.03, gv = fw - 0.012, top = w / 2;
  // the handle: a double cup in the full-depth side, centred 290 under the top (across, here) and 229 from the back
  const hc = at(mm(352.8), mm(398.6 - 229.4), top - mm(289.6));
  // (the bar between its two halves is the grip)
  const cups: Well[] = [-1, 1].map((k) => ({ at: hc.clone().addScaledVector(X, k * mm(70)).toArray(), w: mm(116), h: mm(183), r: 0.03, deep: 0.05, lip: 0.006, draft: 0.004, walls: "knob", floor: "knob" }));
  // the jack plate, recessed in the back's flat, which faces the floor behind the box: the drawing has it in the
  // flat's middle; it sits 10 mm up the flat here, and its sockets near the flat's top edge, so a plug reaches them
  const jf = at(mm(305), mm(398.6));
  sunk(cab, prism("coat", PRX_SECTION.map(([x, f]) => { const [z, y] = raw(mm(x), mm(f)); return [z + zc, y]; }), w, 0, 0.006), [
    [OUT.toArray(), [{ at: at(mm(176.4), 0).toArray(), w: gl, h: gv, r: 0.006, deep: 0.05, lip: 0.002, walls: "knob", floor: "knob" }]],
    [ACROSS.toArray(), cups],
    [BACK.toArray(), [{ at: jf.toArray(), w: mm(174), h: mm(92), r: 0.01, deep: 0.014, lip: 0.003, draft: 0.002 }]],
  ]);
  // the grille: two panels, the seam stepping between the waveguide and the woofer 236 under the top
  const seam = top - mm(236);
  for (const [u0, u1] of [[seam + 0.002, gl / 2], [-gl / 2, seam - 0.002]] as const) {
    grille.pieces.push(...grilleSlab(u1 - u0, gv - 0.002, 0.01, 0, -0.009, 0.006, baffle((u0 + u1) / 2)));
    for (const u of [u0 + 0.012, u1 - 0.012]) for (const v of [-1, 1]) grille.pieces.push(...onto(baffle(u, v * (gv / 2 - 0.012), 0.001), screw([0, 0, 0], "z", 0.004, "knob", 6)));
  }
  grille.pieces.push(...onto(baffle(-top + mm(55), 0, 0.001), [box("metal", [mm(26), mm(44), 0.003], [0, 0, 0.0015], { bevel: 0.001 })]));
  // the waveguide: a plate across the top of the baffle, its 90 x 50 mouth, ten screws round it
  const gu = top - mm(30) - mm(85), back = -0.012;
  guide.pieces.push(...onto(baffle(gu), [frontPlate("knob", rect(0, 0, mm(168), gv - 0.016), [rect(0, 0, mm(132), mm(200))], back, 0.005)]));
  guide.pieces.push(...horn(mm(118), mm(186), 0.034, baffle(gu, 0, back - 0.001), 16));
  for (const [x, y] of [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1], [0, -1], [0, 1]]) guide.pieces.push(...onto(baffle(gu + x * mm(76), y * mm(112), back + 0.001), screw([0, 0, 0], "z", 0.0035, "metal", 6)));
  // the 12", centred 193 above the bottom (along x, here), and a round port at each of its corners
  const wu = -top + mm(193);
  woofer.pieces.push(...cone(mm(112), 0.03, baffle(wu, 0, -0.014), 20));
  for (const u of [top - mm(250), -top + mm(68)]) for (const v of [-1, 1]) ports.pieces.push(...onto(baffle(u, v * mm(116), -0.048), [disc("cavity", mm(18), 0.003, "z", [0, 0, 0], 12)]));
  // the hardware: the M10 points (three in each end, two in the handle's side), the jack plate
  const m10 = (p: THREE.Vector3, n: THREE.Vector3) => {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n, Math.abs(n.y) > 0.9 ? X : new THREE.Vector3(0, 1, 0)).setPosition(p.clone().addScaledVector(n, 0.001));
    hw.pieces.push(...onto(m, [disc("metal", 0.012, 0.002, "z", [0, 0, 0], 10), disc("knob", 0.006, 0.0025, "z", [0, 0, 0], 6)]));
  };
  for (const e of [-1, 1]) {
    for (const [x, f] of [[176.4 - 135.7, 114.3], [176.4 + 135.7, 114.3], [176.4, 336]]) m10(at(mm(x), mm(f), e * top), new THREE.Vector3(e, 0, 0));
    m10(at(mm(352.8), mm(114.3), e * (top - mm(43.4))), ACROSS);
  }
  // the jack plate's two combo sockets, side by side along x; a plug comes in from behind
  const jp = new THREE.Matrix4().makeBasis(X.clone().negate(), ACROSS, BACK).setPosition(jf.clone().addScaledVector(BACK, -0.011));
  hw.pieces.push(...onto(jp, [box("panel", [mm(160), mm(84), 0.006], [0, 0, 0.003], { bevel: 0.002 })]));
  ["speaker-in", "speaker-out"].forEach((name, i) => {
    const u = (i - 0.5) * mm(70), sock = new THREE.Matrix4().copy(jp).multiply(new THREE.Matrix4().makeTranslation(u, mm(28), 0.006));
    hw.pieces.push(...onto(sock, socketPieces(PANELS["wedge-12-passive"]!.sockets[i]!.type, PANELS["wedge-12-passive"]!.sockets[i]!.gender)));
    const p = new THREE.Vector3(u, mm(28), 0.006 + SOCKET_TIP).applyMatrix4(jp);
    hw.marks.push({ name: `jack:${name}`, at: p.toArray(), out: [0, 0, -1] });
  });
  // the pole socket in the bottom (an end, here), and the rubber feet the facet stands on
  hw.pieces.push(disc("metal", 0.023, 0.004, "x", at(mm(176.4), mm(398.6 - 221), -top - 0.002).toArray(), 14), disc("knob", 0.0175, 0.005, "x", at(mm(176.4), mm(398.6 - 221), -top - 0.002).toArray(), 14));
  const fa = at(0, f0), fb = at(mm(201), mm(398.6));
  for (const t of [0.22, 0.78]) for (const e of [-1, 1]) hw.pieces.push(block("rubber", [0.05, foot, 0.018], [e * (top - 0.05), foot / 2, fa.z + (fb.z - fa.z) * t], 0.004));
  mark(hw, "grab", hc.clone().addScaledVector(ACROSS, 0.02).toArray(), ACROSS.toArray());
  return { cabinet: cab, grille, waveguide: guide, woofer, ports, hardware: hw };
}

/**
 * The hung line array box, as the JBL VTX A12 is drawn (customer drawing 1000303221 rev A, spec sheet 5082886-00 rev
 * E), piece by piece: a Finnish birch cabinet 1091 wide between its rigging plates (1117 over them), 330 tall at the
 * front and 311 at the back, 495 deep; the black cloth-backed grille across the whole front; behind it, a 12" at each
 * end, four mids and the waveguide between them; the rigging (the front lug at each top corner, the hinge 81 behind
 * it, the rear lug 466 behind that, the pins at the bottom corners, the angle bar with its two rows of pins at the
 * back of each side); and the hardware (a double cup handle in each side, centred 165 down and 179 back, the side
 * screws, the input plate). The lugs stand 15 mm over the top, into the box above.
 */
function a12Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["line-array-box"], P = pieceBuild;
  const cab = P(), grille = P(), drivers = P(), rig = P(), hw = P();
  const inner = mm(1091), f = d / 2 - 0.002, back = -d / 2, taper = mm(9.5), lug = 0.012, cave = 0.06;
  const top = (z: number) => h - (taper * (f - z)) / (f - back);
  // the side's own wells: the double cup handle, and the angle bar's pocket at the back
  const hz = f - mm(179), hy = h - mm(165), az = f - mm(368), ay = mm(164);
  const sideWells = (s: number): [THREE.Vector3Tuple, Well[]] => [[s, 0, 0], [
    ...[-1, 1].map((k): Well => ({ at: [s * inner / 2, hy + k * mm(50), hz], w: mm(150), h: mm(84), r: 0.02, deep: 0.05, lip: 0.005, draft: 0.004, walls: "knob", floor: "knob" })),
    { at: [s * inner / 2, ay, az], w: mm(140), h: mm(134), r: 0.02, deep: 0.03, lip: 0.003, walls: "panel", floor: "panel" },
  ]];
  sunk(cab, prism("coat", [[f, 0], [f, h], [back, h - taper], [back, taper]], inner, 0, 0.004), [
    [[0, 0, 1], [{ at: [0, h / 2, f], w: inner - 0.008, h: h - 0.008, r: 0.003, deep: cave, lip: 0.001, walls: "knob", floor: "knob" }]],
    sideWells(-1), sideWells(1),
  ]);
  // the grille: 1092 across the whole front, black perforated steel backed with cloth
  const [sheet, edge] = grilleSlab(inner - 0.01, h - 0.01, 0.01, h / 2, f - 0.009, 0.003);
  grille.pieces.push({ ...sheet!, slot: "mesh" }, { ...edge!, slot: "knob" });
  // behind it: a 12" at each end, two mids either side of the middle, the waveguide's mouth between them
  const floor = f - cave;
  for (const x of [-1, 1]) drivers.pieces.push(...cone(mm(120), 0.04, new THREE.Matrix4().makeTranslation(x * mm(372), h / 2, floor + 0.042), 12));
  for (const x of [-1, 1]) for (const y of [-1, 1]) drivers.pieces.push(...cone(mm(50), 0.02, new THREE.Matrix4().makeTranslation(x * mm(200), h / 2 + y * mm(72), floor + 0.022), 8));
  drivers.pieces.push(...horn(mm(230), mm(270), 0.05, new THREE.Matrix4().makeTranslation(0, h / 2, floor + 0.052), 12));
  // the rigging: a steel plate along the front and back edges of each side, the lugs and their pins
  const px = (s: number) => s * (inner / 2 + (w - inner) / 4), pw = (w - inner) / 2;
  // a quick-release pin through a lug, its ring head outside and its lanyard running in toward the box's middle
  const pin = (s: number, y: number, z: number, hang: 1 | -1) => {
    const x = px(s);
    rig.pieces.push(disc("chrome", 0.0065, pw + 0.02, "x", [x, y, z], 8), disc("chrome", 0.008, 0.008, "x", [x + s * (pw / 2 + 0.014), y, z], 8));
    rig.pieces.push(rod("metal", [x + s * (pw / 2 + 0.014), y, z], [x + s * (pw / 2 + 0.01), y + hang * 0.03, z - 0.01], 0.0012, 3));
  };
  // a hang stacks boxes `h` apart: the top pin is the bottom pin's height over the top, so box to box they meet
  const fz = f - mm(17), hingeZ = fz - mm(81), rz = fz - mm(466), py = lug - 0.004;
  for (const s of [-1, 1]) {
    const x = px(s);
    rig.pieces.push(box("panel", [pw, h - 0.004, mm(70)], [x, h / 2, f - mm(35)], { bevel: 0.003 }));
    rig.pieces.push(box("panel", [pw, top(back) - taper - 0.004, mm(60)], [x, h / 2, back + mm(30)], { bevel: 0.003 }));
    // the lugs: the front one at the top corner, the rear one at the back's top, each standing up past the top
    for (const z of [fz, rz]) rig.pieces.push(box("panel", [pw - 0.002, 0.04, mm(34)], [x, top(z) + lug - 0.02, z], { bevel: 0.006 }));
    rig.pieces.push(disc("panel", mm(10), pw - 0.002, "x", [x, h - mm(1.5) - 0.004, hingeZ], 10));
    pin(s, h + py, fz, -1);
    pin(s, py, fz, 1);
    pin(s, taper + mm(14), rz, 1);
    // the angle bar in its pocket: two rows of five pins (0.25 to 10 degrees)
    for (let i = 0; i < 5; i++) for (const k of [-1, 1]) rig.pieces.push(disc("chrome", 0.006, 0.006, "x", [s * (inner / 2 - 0.026), ay + k * mm(42), az + (i - 2) * mm(26)], 6));
    rig.pieces.push(box("metal", [0.006, mm(18), mm(120)], [s * (inner / 2 - 0.027), ay, az], { bevel: 0.002 }));
  }
  // the hardware: the side screws (the bar between the handle's two cups is its grip), the input plate on the back
  for (const s of [-1, 1]) {
    for (const [y, z] of [[0.04, f - mm(70)], [h - 0.04, f - mm(70)], [0.04, f - mm(290)], [h - 0.045, f - mm(290)], [0.045, back + mm(70)], [h - 0.05, back + mm(70)]])
      hw.pieces.push(...screw([s * (inner / 2 + 0.001), y, z], "x", 0.006, "knob", 8));
  }
  plate(hw, mm(200), mm(90), [0, h / 2, back - 0.004]);
  socketPanel(hw, "line-array-box", "back", [0, h / 2, back - 0.008], [mm(200), mm(90)]);
  mark(hw, "hinge-top", [0, h + py, fz], [1, 0, 0]);
  mark(hw, "hinge-bottom", [0, py, fz], [1, 0, 0]);
  mark(hw, "grab", [0, h, 0]);
  return { cabinet: cab, grille, drivers, rigging: rig, hardware: hw };
}

// ---- the other rigs on the sand (Qollab Studio's Desert Gathering, packages/gear systems.ts) -------------------------

/** A horn box's shell, `w` by `h` by `d`, open at the front: a back panel and four walls the full depth, one piece
 * each, so no seam runs round the box (its front is the well `deep` into it that the horn mouths fill). */
function well(b: Build, skin: GearSlot, [w, h, d]: readonly number[], deep: number, t: number) {
  const back = Math.max(t, d - deep);
  b.pieces.push(box(skin, [w - 2 * t, h - 2 * t, back], [0, h / 2, -d / 2 + back / 2]));
  for (const s of [-1, 1]) b.pieces.push(box(skin, [t, h, d], [s * (w / 2 - t / 2), h / 2, 0], { bevel: 0.008 }));
  for (const y of [t / 2, h - t / 2]) b.pieces.push(box(skin, [w - 2 * t + 0.002, t, d], [0, y, 0], { bevel: 0.006 }));
}

/**
 * The synergy horn, as the Danley SH50 is given on its spec sheet (Rev. 202209301629: 711 x 711 x 647 mm, 18 mm
 * Baltic birch in black polyurea, 2 x 12" + 4 x 5" + 1" in one 50 x 50 degree horn) and shown in the maker's
 * renders (front, side, back, no grille), piece by piece, no maker's name. The sheet gives no plan drawing, so the
 * plan is read off the back render: the sides run straight 72 mm, then close 25 degrees each (half the horn's 50, so
 * boxes side by side splay to an arc) to a 174 mm flat back. Metres from the box's centre line, floor and front.
 * - cabinet: the top and bottom in the box's plan, the straight and closing sides, the back flat, the front frame
 *   round the mouth (18 mm), two rubber runners under it
 * - horn: one flat-walled pyramid from the 675 mm mouth to a 115 mm throat 580 deep, its walls 25 degrees off the
 *   axis, parallel to the box's closing sides; the compression driver behind the throat
 * - ports: the four 5" mids' round ports in the side walls part way down, the two 12" woofers' slots in the top and
 *   bottom walls near the mouth
 * - grille: the perforated steel sheet inside the frame, held by 22 black screws
 * - hardware: four hand pockets in each closing side, the M10 points (5 on the top, 5 under, 4 in each side), the
 *   jack plate low on the back flat with its two speaker jacks, the label recess above it
 */
function sh50Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["synergy-horn"], P = pieceBuild, cab = P(), horn = P(), ports = P(), grille = P(), hw = P();
  const t = mm(18), f = d / 2, zb = -d / 2, rim = mm(18), feet = mm(10), cy = (h + feet) / 2;
  const zk = f - mm(72), bh = mm(87), knee = w / 2;
  // the right closing side: its run, its turn about y (local +z along it, back to front) and its outward normal
  const run = Math.hypot(knee - bh, zk - zb), turn = Math.atan2(knee - bh, zk - zb), out: THREE.Vector3Tuple = [Math.cos(turn), 0, -Math.sin(turn)];
  // a point on a closing side's outside, `s` from the knee (0) to the back (1), `lift` out of it, `y` up; x mirrored by `side`
  const onSide = (side: number, s: number, y: number, lift = 0): THREE.Vector3Tuple =>
    [side * (knee + (bh - knee) * s + out[0] * lift), y, zk + (zb - zk) * s + out[2] * lift];
  const plan = [[-w / 2, f], [w / 2, f], [w / 2, zk], [bh, zb], [-bh, zb], [-w / 2, zk]];

  // cabinet: top and bottom in the plan, the sides straight then closing, the back flat, the frame round the mouth
  cab.pieces.push(slab("coat", plan, feet, feet + t), slab("coat", plan, h - t, h));
  for (const s of [-1, 1]) {
    cab.pieces.push(box("coat", [t, h - feet - 2 * t, f - zk], [s * (w / 2 - t / 2), cy, (f + zk) / 2]));
    const mid = onSide(s, 0.5, cy, -t / 2);
    cab.pieces.push(box("coat", [t, h - feet - 2 * t, run], mid, { rot: [0, s * turn, 0] }));
  }
  cab.pieces.push(box("coat", [2 * bh, h - feet - 2 * t, t], [0, cy, zb + t / 2]));
  cab.pieces.push(frontPlate("coat", rect(0, cy, w, h - feet), [rect(0, cy, w - 2 * rim, h - feet - 2 * rim)], f, t));
  for (const s of [-1, 1]) cab.pieces.push(box("rubber", [mm(100), feet, mm(360)], [s * mm(160), feet / 2, mm(120)], { bevel: 0.003 }));

  // horn: the mouth inside the frame back to the throat, the compression driver's round mouth behind it
  const deep = mm(580), zf = f - mm(26), mo = (w - 2 * rim) / 2, th = mm(57.5), slope = (mo - th) / deep;
  horn.pieces.push(frustum("coat", [-mo, mo, cy - mo, cy + mo], [-th, th, cy - th, cy + th], zf, deep));
  horn.pieces.push(box("cavity", [2 * th, 2 * th, 0.004], [0, cy, zf - deep - 0.002]));
  horn.pieces.push(disc("knob", mm(25), mm(12), "z", [0, cy, zf - deep - 0.004], 16));

  // ports: a 5" mid's round port (70 mm) in each side wall 300 back, above and below centre; the 12"s' slots
  // (300 x 50) in the top and bottom walls 120 back
  const wall = Math.atan(slope), half = (u: number) => mo - slope * u;
  for (const s of [-1, 1]) for (const dy of [-mm(110), mm(110)]) {
    const u = mm(300), p = disc("cavity", mm(35), 0.004, "x", [0, 0, 0], 16);
    p.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(s * (half(u) - 0.002), cy + dy, zf - u).multiply(new THREE.Matrix4().makeRotationY(s * wall)));
    ports.pieces.push(p);
  }
  for (const s of [-1, 1]) { const u = mm(120); ports.pieces.push(box("cavity", [mm(300), 0.004, mm(50) / Math.cos(wall)], [0, cy + s * (half(u) - 0.002), zf - u], { rot: [-s * wall, 0, 0] })); }

  // grille: the perforated sheet inside the frame, six black screws along its top and bottom, five down each side
  const gw = w - 2 * rim - 0.004, gh = h - feet - 2 * rim - 0.004;
  grille.pieces.push(...grilleSlab(gw, gh, mm(12), cy, f - mm(13), mm(4)));
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) grille.pieces.push(...screw([(i / 5 - 0.5) * (gw - 0.03), cy + s * (gh / 2 - 0.011), f + 0.001], "z", 0.004, "knob", 6));
  for (const s of [-1, 1]) for (let i = 1; i < 6; i++) grille.pieces.push(...screw([s * (gw / 2 - 0.011), cy + (i / 6 - 0.5) * (gh - 0.03), f + 0.001], "z", 0.004, "knob", 6));

  // hardware: the hand pockets (110 x 50) high and low in each closing side, the M10 points, the back's jack plate
  for (const s of [-1, 1]) for (const a of [0.3, 0.72]) for (const y of [mm(75), h - mm(75)])
    hw.pieces.push(box("cavity", [0.004, mm(50), mm(110)], onSide(s, a, y, 0.0004), { rot: [0, s * turn, 0], bevel: 0.001 }));
  for (const s of [-1, 1]) for (const [a, y] of [[0.12, mm(40)], [0.12, h - mm(40)], [0.52, h / 2 + mm(140)], [0.52, h / 2 - mm(140)]] as const) {
    const p = disc("metal", 0.009, 0.003, "x", [0, 0, 0], 10);
    p.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(...onSide(s, a, y, 0.0015)).multiply(new THREE.Matrix4().makeRotationY(s * turn)));
    hw.pieces.push(p);
  }
  for (const y of [h + 0.0015, feet - 0.0015]) for (const [x, z] of [[-mm(250), f - mm(45)], [mm(250), f - mm(45)], [-mm(120), zb + mm(200)], [mm(120), zb + mm(200)], [0, zb + mm(40)]])
    hw.pieces.push(disc("metal", 0.009, 0.003, "y", [x, y, z], 10));
  plate(hw, mm(105), mm(240), [0, mm(270), zb - 0.001]);
  socketPanel(hw, "synergy-horn", "back", [0, mm(270), zb - 0.005], [mm(95), mm(230)]);
  hw.pieces.push(box("cavity", [mm(80), mm(45), 0.004], [0, h / 2 + mm(30), zb - 0.0004], { bevel: 0.001 }));
  mark(hw, "grab", onSide(1, 0.3, h - mm(75), 0.012), out);
  return { cabinet: cab, horn, ports, grille, hardware: hw };
}

/**
 * The tapped horn, as the Danley TH118 is drawn on its spec sheet (V3.0, drawing TH118I rev 2, 2017, inches; sheet
 * Rev. 202209231214) and shown in the maker's renders, piece by piece, no maker's name: a tall box of 18 mm Baltic
 * birch in black polyurea, 22.5 in (572) wide, 40 (1016) tall and 28.5 (724) deep (the sheet's metric line says 734,
 * but its drawing and inch line say 28.5). Metres from the box's centre line, floor and front.
 * - cabinet: the sides, top, bottom, back and the plain front above the mouth, the back's bottom corner cut off on a
 *   slant (135 in, 230 up, read off the side render) where the casters sit
 * - mouth: the 20 in (508) tall well across the bottom of the front, dark at its back, the 18" driver standing in it
 *   on its side, cone to the right, magnet to the left, as the sheet's photo shows it with the grille off
 * - grille: the perforated steel sheet over the mouth, a black screw each side
 * - hardware: a bar handle in a 1.72 in slot 19.66 long, 3.12 back from the front, high (4.00 down) and low (5.72 up)
 *   in each side; a pole cup in each side (13.25 back, 20.50 down) and in the top; two hand pockets in the top at the
 *   back; the 3/8-16 points (4 top, 4 under, 6 each side, 4 back); the jack plate and label on the back; two casters
 */
function th118Pieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["tapped-horn-18"], P = pieceBuild, cab = P(), mouth = P(), grille = P(), hw = P();
  const t = mm(18), f = d / 2, zb = -d / 2, inch = (v: number) => v * 0.0254, mh = inch(20), cw = mm(135), ch = mm(230);
  const side: [number, number][] = [[f, 0], [f, h], [zb, h], [zb, ch], [zb + cw, 0]];

  // cabinet: the two sides in the profile, top, bottom (stopping at the slant), back above the slant, the slant
  // panel, the front above the mouth
  for (const s of [-1, 1]) cab.pieces.push(prism("coat", side, t, s * (w / 2 - t / 2), 0.003));
  cab.pieces.push(box("coat", [w - 2 * t, t, d], [0, h - t / 2, 0]));
  cab.pieces.push(box("coat", [w - 2 * t, t, d - cw], [0, t / 2, (f + zb + cw) / 2]));
  cab.pieces.push(box("coat", [w - 2 * t, h - ch - t, t], [0, (h - t + ch) / 2, zb + t / 2]));
  const slant = Math.atan2(cw, ch);
  cab.pieces.push(box("coat", [w - 2 * t, Math.hypot(cw, ch), t], [0, ch / 2 + (Math.sin(slant) * t) / 2, zb + cw / 2 + (Math.cos(slant) * t) / 2], { rot: [-slant, 0, 0] }));
  cab.pieces.push(box("coat", [w - 2 * t, h - mh - t, t], [0, (h - t + mh) / 2, f - t / 2]));

  // mouth: the well under the front, its back 400 in, its roof the fold's floor; the 18" on its side in it
  const back = mm(480), my = mh / 2;
  mouth.pieces.push(box("cavity", [w - 2 * t, mh - t, 0.004], [0, (mh + t) / 2, f - back]));
  mouth.pieces.push(box("coat", [w - 2 * t, t, back], [0, mh - t / 2, f - back / 2]));
  mouth.pieces.push(...cone(mm(190), mm(120), new THREE.Matrix4().makeTranslation(-mm(40), my, f - mm(245)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), 20));
  mouth.pieces.push(disc("metal", mm(85), mm(70), "x", [-mm(200), my, f - mm(245)], 16));

  // grille: the sheet over the mouth inside a thin lip, one black screw each side at half height
  const gw = w - mm(16), gh = mh - mm(12);
  grille.pieces.push(...grilleSlab(gw, gh, mm(12), mm(6) + gh / 2, f - mm(13), mm(3)));
  for (const s of [-1, 1]) grille.pieces.push(...screw([s * (gw / 2 - 0.011), mm(6) + gh / 2, f + 0.001], "z", 0.004, "knob", 6));

  // hardware: the side rails (a slot, a bar in it), the pole cups, the top's pockets, the points, the back, casters
  const railZ = f - inch(3.12) - inch(19.66) / 2, slotH = inch(1.72);
  for (const s of [-1, 1]) for (const y of [h - inch(4.0) - slotH / 2, inch(5.72) + slotH / 2]) {
    hw.pieces.push(box("cavity", [0.004, slotH, inch(19.66)], [s * (w / 2 - 0.0015), y, railZ], { bevel: 0.001 }));
    hw.pieces.push(rod("metal", [s * (w / 2 - 0.004), y, railZ - inch(19.66) / 2 + 0.02], [s * (w / 2 - 0.004), y, railZ + inch(19.66) / 2 - 0.02], 0.011, 8));
  }
  for (const s of [-1, 1]) {
    hw.pieces.push(disc("rubber", mm(50), 0.006, "x", [s * (w / 2 + 0.001), h - inch(20.5), f - inch(13.25)], 18));
    hw.pieces.push(disc("cavity", mm(36), 0.008, "x", [s * (w / 2 + 0.0015), h - inch(20.5), f - inch(13.25)], 16));
  }
  hw.pieces.push(disc("rubber", mm(50), 0.006, "y", [0, h + 0.001, zb + inch(13.85)], 18), disc("cavity", mm(36), 0.008, "y", [0, h + 0.0015, zb + inch(13.85)], 16));
  for (const s of [-1, 1]) hw.pieces.push(box("cavity", [mm(110), 0.004, mm(45)], [s * mm(150), h + 0.0004, zb + mm(60)], { bevel: 0.001 }));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    hw.pieces.push(disc("metal", 0.009, 0.003, "y", [x * (w / 2 - mm(60)), h + 0.0015, z * (d / 2 - mm(60))], 10));
    hw.pieces.push(disc("metal", 0.009, 0.003, "y", [x * (w / 2 - mm(60)), -0.0005, z > 0 ? f - mm(60) : zb + cw + mm(60)], 10));
    hw.pieces.push(disc("metal", 0.009, 0.003, "z", [x * (w / 2 - mm(60)), z > 0 ? h - mm(60) : ch + mm(60), zb - 0.0015], 10));
  }
  for (const s of [-1, 1]) for (const y of [mm(60), h / 2, h - mm(60)]) for (const z of [f - mm(60), zb + mm(60)])
    if (!(y < ch && z < 0)) hw.pieces.push(disc("metal", 0.009, 0.003, "x", [s * (w / 2 + 0.0015), y, z], 10));
  hw.pieces.push(disc("metal", 0.009, 0.003, "x", [w / 2 + 0.0015, ch + mm(60), zb + mm(60)], 10), disc("metal", 0.009, 0.003, "x", [-w / 2 - 0.0015, ch + mm(60), zb + mm(60)], 10));
  plate(hw, mm(110), mm(240), [-mm(60), h * 0.66, zb - 0.001]);
  socketPanel(hw, "tapped-horn-18", "back", [-mm(60), h * 0.66, zb - 0.005], [mm(100), mm(230)]);
  hw.pieces.push(box("cavity", [mm(70), mm(45), 0.004], [mm(130), h * 0.66, zb - 0.0004], { bevel: 0.001 }));
  // the casters: a wheel on a fork either side, half out of the slant
  const nz = -Math.cos(slant), ny = -Math.sin(slant), wz = zb + cw / 2 + nz * mm(20), wy = ch / 2 + ny * mm(20);
  for (const s of [-1, 1]) {
    hw.pieces.push(disc("rubber", mm(50), mm(36), "x", [s * (w / 2 - mm(55)), wy, wz], 18));
    hw.pieces.push(box("metal", [mm(46), mm(30), mm(70)], [s * (w / 2 - mm(55)), ch / 2 - ny * mm(5), zb + cw / 2 - nz * mm(5)], { rot: [-slant, 0, 0] }));
  }
  mark(hw, "grab", [w / 2 + 0.012, h - inch(4.0) - slotH / 2, railZ], [1, 0, 0]);
  return { cabinet: cab, mouth, grille, hardware: hw };
}

/** A circle's outline [x, y], `n` points counter-clockwise round (x, y). */
const circle = (x: number, y: number, r: number, n = 32) => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, y + Math.sin((i / n) * Math.PI * 2) * r]);

/**
 * A square-mouthed horn turning round, as a TurboMid or TurboBass device's flare is drawn: its mouth the cell
 * [x0, x1, y0, y1] at z `zf`, its throat the circle `r` round (cx, cy) `deep` behind. Rings of 16 points (the cell's
 * corners and three along each edge) slide from the rectangle to the circle, squarest at the front: the creases run in
 * from the mouth's corners, as on the drawing, and the throat is round.
 */
function squareToRound(slot: GearSlot, [x0, x1, y0, y1]: number[], cx: number, cy: number, r: number, zf: number, deep: number): Piece {
  const my = (y0 + y1) / 2;
  const edge = (a: number[], b: number[]) => [0, 1, 2, 3].map((k) => [a[0]! + ((b[0]! - a[0]!) * k) / 4, a[1]! + ((b[1]! - a[1]!) * k) / 4]);
  // counter-clockwise from the right edge's middle, so point j sits at the same angle on the circle
  const rect = [...edge([x1, my], [x1, y1]).slice(0, 2), ...edge([x1, y1], [x0, y1]), ...edge([x0, y1], [x0, y0]), ...edge([x0, y0], [x1, y0]), ...edge([x1, y0], [x1, my]).slice(0, 2)];
  const roundAt = (j: number) => [cx + Math.cos((j / 16) * Math.PI * 2) * r, cy + Math.sin((j / 16) * Math.PI * 2) * r];
  const rings = [0, 0.2, 0.45, 0.72, 1].map((s) => {
    const k = s ** 0.7;
    return rect.map(([x, y], j) => { const [rx, ry] = roundAt(j); return new THREE.Vector3(x! + (rx! - x!) * k, y! + (ry! - y!) * k, zf - deep * s); });
  });
  // every quad split on the same diagonal and turned to look forward, smoothed round the throat but creased where the
  // mouth's corners fold
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    pos.push(...(n.z >= 0 ? [a, b, c] : [a, c, b]).flatMap((v) => v.toArray()));
  };
  for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < 16; j++) {
    const k = (j + 1) % 16, a = rings[i]!, b = rings[i + 1]!;
    tri(a[j]!, a[k]!, b[k]!); tri(a[j]!, b[k]!, b[j]!);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return { geo: toCreasedNormals(geo, 0.5), slot };
}

/** A TurboMid's throat, `deep` behind the front `f`: the flat ring round the driver (`ro` out, `ri` in), the dark
 * driver behind it and the phase plug, a bar `bw` wide standing up across the throat and `over` past the ring. */
function turboThroat(b: Build, cx: number, cy: number, ro: number, ri: number, bw: number, over: number, z: number) {
  b.pieces.push(frontPlate("turbo", circle(cx, cy, ro), [circle(cx, cy, ri)], z, 0.006));
  b.pieces.push(disc("cavity", ri, 0.004, "z", [cx, cy, z - 0.03], 24));
  b.pieces.push(box("turbo", [bw, 2 * (ro + over), 0.05], [cx, cy, z + 0.022], { bevel: bw * 0.3 }));
}

/**
 * The Flashlight's shared shell, 574 wide, 825 tall and 773 deep in 18 mm birch and TurboBlue paint (TFS-780
 * datasheet, dimensions p.15), and its hardware: four dog-bone hand recesses in each side (four in all on the bass),
 * pointing at the side's keyhole fly cup, and the fly track plates top and bottom of the back.
 */
function flashlightShell(id: "tri-amp-top" | "tri-amp-bass", handles: number[][]): { cabinet: Build; hardware: Build } {
  const [w, h, d] = GEAR_SIZES[id], t = 0.018, mm = (v: number) => v / 1000, cab: Build = { pieces: [], marks: [] }, hw: Build = { pieces: [], marks: [] };
  well(cab, "turbo", [w, h, d], mm(340), t);
  const cupY = h - mm(308), cupZ = d / 2 - mm(408);
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 0.0006);
    for (const [y, z] of handles) hw.pieces.push(box("cavity", [0.004, mm(50), mm(115)], [x, y!, z!], { bevel: 0.012, rot: [Math.sign((y! - cupY) * (z! - cupZ)) * -Math.PI / 4, 0, 0] }));
    hw.pieces.push(disc("metal", mm(46), 0.004, "x", [s * (w / 2 + 0.002), cupY, cupZ], 20), disc("cavity", mm(10), 0.005, "x", [s * (w / 2 + 0.002), cupY + mm(8), cupZ], 10));
  }
  for (const y of [h - mm(20), mm(20)]) hw.pieces.push(box("metal", [mm(160), mm(39), 0.004], [0, y, -d / 2 - 0.002], { bevel: 0.001 }));
  mark(hw, "grab", [w / 2 + 0.012, handles[0]![0]!, 0], [1, 0, 0]);
  return { cabinet: cab, hardware: hw };
}

/**
 * The tri-amp top, as the Turbosound Flashlight TFS-780H is drawn on its datasheet (dimensions p.15) and built, piece
 * by piece (no maker's name: the plate under the waveguide stays plain). Every number is the drawing's, in mm from the
 * face's left edge and its top: 574 wide, 825 tall, 773 deep, 87 kg; a 12" and a 6.5" on TurboMid horns and a 1"
 * compression driver on a waveguide, tri-amped, 25 x 25 degrees.
 * - cabinet: the shell, 18 mm walls the full depth
 * - face: the frame round the face (28 in at the sides) and the dividers between the three cells
 * - lmf horn: the 12"'s cell 28 to 550 across and 297 to 802 down, its square mouth turning round to the throat ring
 *   (248 across, centred 286 across and 544 down) 300 behind the front; the plug, a bar 28 wide standing 31 past the ring
 * - hmf horn: the 6.5"'s cell 28 to 284 across and 23 to 286 down, its ring 129 across round (160, 150), bar 26 wide
 * - hf waveguide: a flat baffle in the cell 292 to 550 across, the 163 square mouth round (413, 150) closing to 108 and
 *   the 21 mm throat; the plain plate under it at 260 down
 * - back: the hinged oval door (396 x 657, centred 407 down), the round cover (212) in its top with the two EP6 jacks
 * - hardware: eight dog-bone hand recesses (115 x 50) and the keyhole fly cups in the sides, the back's track plates
 * The detachable wheel board is left off: a top stands on its bass without it.
 */
function tfs780hPieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["tri-amp-top"], f = d / 2, mm = (v: number) => v / 1000, X = (v: number) => mm(v) - w / 2, Y = (v: number) => h - mm(v);
  const P = (): Build => ({ pieces: [], marks: [] }), face = P(), lmf = P(), hmf = P(), hf = P(), back = P();
  const { cabinet, hardware } = flashlightShell("tri-amp-top", [[Y(136), f - mm(146)], [Y(136), f - mm(632)], [Y(604), f - mm(146)], [Y(604), f - mm(632)]]);
  const cell = (a: number, b: number, c: number, e: number) => [X(a), X(b), Y(e), Y(c)];
  const lc = cell(28, 550, 297, 802), mc = cell(28, 284, 23, 286), hc = cell(292, 550, 23, 286);
  const hole = ([x0, x1, y0, y1]: number[]) => [[x0!, y0!], [x1!, y0!], [x1!, y1!], [x0!, y1!]];
  face.pieces.push(frontPlate("turbo", hole([-w / 2 + 0.018, w / 2 - 0.018, 0.018, h - 0.018]), [lc, mc, hc].map(hole), f, 0.018));
  // the 12" TurboMid
  lmf.pieces.push(squareToRound("turbo", lc, X(286), Y(544), mm(124), f - 0.002, mm(300)));
  turboThroat(lmf, X(286), Y(544), mm(124), mm(87.5), mm(28), mm(31), f - mm(300));
  // the 6.5" TurboMid
  hmf.pieces.push(squareToRound("turbo", mc, X(160), Y(150), mm(64.5), f - 0.002, mm(180)));
  turboThroat(hmf, X(160), Y(150), mm(64.5), mm(49), mm(26), mm(10), f - mm(180));
  // the 1" waveguide in its flat baffle, the plain plate under it
  const hx = X(413), hy = Y(150), bz = f - mm(20), sq = (s: number, z: number) => ring8(hx, hy, z, s / 2, s / 2);
  hf.pieces.push(frontPlate("turbo", hole(hc), [hole([hx - mm(81.5), hx + mm(81.5), hy - mm(81.5), hy + mm(81.5)])], bz, 0.012));
  hf.pieces.push(ringWalls("knob", [sq(mm(163), bz), sq(mm(108), bz - mm(30)), ring8(hx, hy, bz - mm(120), mm(10.5), mm(10.5), mm(7.4), mm(7.4))]));
  hf.pieces.push(disc("cavity", mm(13), 0.004, "z", [hx, hy, bz - mm(122)], 12));
  hf.pieces.push(box("panel", [mm(160), mm(20), 0.003], [hx, Y(260), bz + 0.0015]));
  // the back: the hinged oval door (a stadium, its ends half circles) in its dark gap, its round cover and the jacks in it
  const stadium = (r: number, straight: number) => [0, 1].flatMap((half) => Array.from({ length: 17 }, (_, i) => {
    const q = half * Math.PI + (i / 16) * Math.PI;
    return [Math.cos(q) * r, Y(407) + (half ? -1 : 1) * straight / 2 + Math.sin(q) * r];
  }));
  back.pieces.push(frontPlate("cavity", stadium(mm(202), mm(261)), [], -d / 2, 0.002));
  back.pieces.push(frontPlate("turbo", stadium(mm(198), mm(261)), [], -d / 2, 0.006));
  back.pieces.push(box("metal", [0.008, mm(300), 0.006], [mm(198), Y(407), -d / 2 - 0.003]));
  back.pieces.push(disc("panel", mm(106), 0.006, "z", [0, Y(274), -d / 2 - 0.007], 32));
  socketPanel(back, "tri-amp-top", "back", [-mm(68), Y(210), -d / 2 - 0.01], [mm(90), mm(130)]);
  return { cabinet, face, "lmf-horn": lmf, "hmf-horn": hmf, "hf-waveguide": hf, back, hardware };
}

/**
 * The tri-amp bass, as the Turbosound Flashlight TFS-780L's sheet gives it (TFS-780 datasheet p.3; its own dimension
 * drawing is not in the datasheet, so the front is the TFS-780H's shell and frame round one cell): the same 574 x 825 x
 * 773 shell, 90 kg, one 21" on a TurboBass device, four hand recesses, two XLR-3 jacks on a plate on the back.
 * - cabinet, hardware: the shell, as the top's
 * - face: the frame round the one cell, 28 to 550 across and 23 to 802 down
 * - bass horn: the cell's square mouth turning round to a 21" throat ring (440 across, a guess until the drawing),
 *   centred in the cell 330 behind the front; the plug bar 40 wide
 * - back: the jack plate
 */
function tfs780lPieces(): Record<string, Build> {
  const [w, h, d] = GEAR_SIZES["tri-amp-bass"], f = d / 2, mm = (v: number) => v / 1000, X = (v: number) => mm(v) - w / 2, Y = (v: number) => h - mm(v);
  const P = (): Build => ({ pieces: [], marks: [] }), face = P(), horn = P(), back = P();
  const { cabinet, hardware } = flashlightShell("tri-amp-bass", [[Y(136), f - mm(146)], [Y(136), f - mm(632)]]);
  const c = [X(28), X(550), Y(802), Y(23)], cx = X(289), cy = Y(412.5);
  const hole = ([x0, x1, y0, y1]: number[]) => [[x0!, y0!], [x1!, y0!], [x1!, y1!], [x0!, y1!]];
  face.pieces.push(frontPlate("turbo", hole([-w / 2 + 0.018, w / 2 - 0.018, 0.018, h - 0.018]), [hole(c)], f, 0.018));
  horn.pieces.push(squareToRound("turbo", c, cx, cy, mm(220), f - 0.002, mm(330)));
  turboThroat(horn, cx, cy, mm(220), mm(165), mm(40), mm(40), f - mm(330));
  plate(back, mm(170), mm(110), [0, Y(300), -d / 2 - 0.004]);
  socketPanel(back, "tri-amp-bass", "back", [0, Y(300), -d / 2 - 0.008], [mm(170), mm(110)]);
  return { cabinet, face, "bass-horn": horn, back, hardware };
}

/**
 * A moulded horn: a fibreglass shell `t` thick round its axis (local y; the mouth's plane at 0, the throat `len`
 * behind), its walls flaring from a round throat `rt` to the lip `lip` (as u^k along it: 1 a straight cone, 2 a bell),
 * then rolling out to a round rim `rim` that stands 6 mm in front of the mouth's plane. One closed ring of rings, so it
 * has an inside and an outside, as a moulded horn has.
 */
function hornShell(rim: number, lip: number, rt: number, len: number, k: number, m: THREE.Matrix4, seg: number, t = 0.006): Piece {
  const n = 6, inner: Ring[] = [], outer: Ring[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, r = rt + (lip - rt) * u ** k, y = -len * (1 - u);
    inner.push(R(y, r));
    outer.unshift(R(i === n ? -0.014 : y, r + t));
  }
  const roll = [R(0.003, lip + (rim - lip) * 0.45), R(0.006, rim - 0.005), R(0.003, rim), R(-0.004, rim - 0.002), R(-0.009, (rim + lip + t) / 2)];
  return loft("shell", [...inner, ...roll, ...outer], { seg, closed: true, caps: false, smooth: true, m });
}

/**
 * The sculpted three-way is Void's Air Motion V2, built from its line drawing (Air-Motion-V2-Line-Drawing-RH, 853.9 x
 * 671.2 x 659.9 mm) and spec sheet (TD10745). No cabinet: three moulded fibreglass conical horns bolted to a steel
 * frame, each driver in a round can behind its horn, gloss teal (a custom colour; Void's own are red, black and white).
 * Seen from the front, right-handed: the 12" LF horn on the left, the 8" MF on the right, the 1.5" HF above, between
 * them. `hand` -1 is the left-handed one (Air-Motion-Line-Drawing-LH), the same box mirrored left to right with the
 * same connector plate. Measured off the front and side views (about 10 mm):
 * - lf horn: rim 537 across, lip 485, throat 220, centre 268 from the left and 269 up; it runs back to its can, 380
 *   across and 246 deep, whose back is the box's back
 * - mf horn: rim 299, lip 257, throat 134, centre 703 from the left and 269 up, 229 long; can 282 across, 190 deep
 * - hf horn: rim 262, a bell to a 38 mm throat, centre 583 from the left and 541 up, 109 long; can 181 across, 120 deep
 * - plug: the cone in the MF horn's throat
 * - frame: the powder-coated steel post between the cans, an arm to each can, a foot plate under it (the stand fixing)
 * - jacks: the two NL4s; the real box has them under the HF can, where no plug reaches from outside the box, so the
 *   model has them under the frame's foot
 * - cables: the armoured hoses from the HF unit to the LF and MF cans
 * - badge: the plain oval on the HF horn, where the real one carries the maker's name
 */
function airMotionPieces(hand: 1 | -1): Record<string, Build> {
  const [w, , d] = GEAR_SIZES["sculpted-3way"], f = d / 2, mm = (v: number) => v / 1000, X = (fromLeft: number) => hand * (mm(fromLeft) - w / 2);
  const P = (): Build => ({ pieces: [], marks: [] }), plane = f - 0.006; // the horns' mouths; their rims stand 6 mm in front
  const lf = P(), mf = P(), hf = P(), cans = P(), plug = P(), frame = P(), jack = P(), cables = P(), badge = P();
  // x, y, rim, lip, throat, length, flare power, can radius, can depth, segments
  const H = [
    [lf, X(268), mm(269), mm(268.5), mm(242.5), mm(110), d - 0.006 - mm(246), 1.3, mm(190), mm(246), 24],
    [mf, X(703), mm(269), mm(149.5), mm(128.5), mm(67), mm(229), 1.3, mm(141), mm(190), 24],
    [hf, X(583), mm(541), mm(131), mm(118), mm(19), mm(109), 2, mm(90.5), mm(120), 24],
  ] as const;
  for (const [b, x, y, rim, lip, rt, len, k, rc, dc, seg] of H) {
    b.pieces.push(hornShell(rim, lip, rt, len, k, along("z", [x, y, plane]), seg));
    // the can: a half ellipsoid behind the throat, a flange ring where it bolts to the horn
    const z0 = plane - len;
    cans.pieces.push(loft("shell", [R(0, 0), R(0, rc), ...[0.15, 0.4, 0.65, 0.85, 0.97].map((s) => R(-dc * s, rc * Math.sqrt(1 - s * s))), R(-dc, 0)], { seg: 20, smooth: true, m: along("z", [x, y, z0]) }));
    cans.pieces.push(disc("knob", rc + 0.003, 0.006, "z", [x, y, z0 + 0.001], 16));
  }
  // the MF horn's phase plug, a cone standing out of its throat
  const [, mx, my, , , , mlen] = H[1];
  plug.pieces.push(loft("shell", [R(0, 0.05), R(0.04, 0.032), R(0.09, 0)], { seg: 16, smooth: true, m: along("z", [mx, my, plane - mlen]) }));
  // the frame: a post between the cans, arms to each, the foot plate the stand fixes to
  const px = X(510), pz = -0.1, foot = 0.0125;
  frame.pieces.push(box("knob", [0.04, 0.5 - foot, 0.04], [px, (0.5 + foot) / 2, pz], { bevel: 0.003 }));
  frame.pieces.push(box("knob", [0.16, 0.008, 0.16], [px, foot + 0.004, pz], { bevel: 0.002 }));
  const arms: [THREE.Vector3Tuple, THREE.Vector3Tuple][] = [[[px, 0.3, pz], [hand * 0.03, 0.3, -0.14]], [[px, 0.27, pz], [hand * 0.165, 0.27, -0.02]], [[px, 0.49, pz], [X(583), 0.465, 0.15]]];
  for (const [a, b] of arms)
    frame.pieces.push(rod("knob", a, b, 0.012));
  mark(frame, "grab", [px, 0.51, pz]);
  mark(frame, "pole-cup", [px, foot, pz], [0, -1, 0]);
  socketPanel(jack, "sculpted-3way", "bottom", [px, foot, pz], [0.12, 0.08]);
  // the hoses from the HF unit to the two cans, each in two runs
  const hoses: THREE.Vector3Tuple[][] = [[[X(583), 0.465, 0.13], [hand * 0.06, 0.45, -0.02], [hand * -0.08, 0.44, -0.16]], [[X(583) + hand * 0.02, 0.465, 0.12], [hand * 0.22, 0.43, 0.06], [hand * 0.24, 0.4, 0.03]]];
  for (const run of hoses)
    for (let i = 0; i + 1 < run.length; i++) cables.pieces.push(rod("metal", run[i]!, run[i + 1]!, 0.006));
  badge.pieces.push(box("badge", [0.046, 0.002, 0.018], [X(583), mm(541) - 0.094, plane - 0.02], { rot: [0.95, 0, 0] }));
  return { "lf-horn": lf, "mf-horn": mf, "hf-horn": hf, cans, plug, frame, jacks: jack, cables, badge };
}

/**
 * A sub built `w` wide and `d` deep stood on its skids: every piece lifted `skid`, and two runners that tall under it,
 * front to back, `inset` in from each side. The box keeps its published height with the skids inside it, so the body is
 * `skid` shorter than its sheet's, and a box stacks on the skids' top cup as the catalog's height says.
 */
function onSkids(pieces: Record<string, Build>, skid: number, w: number, d: number, inset: number): Record<string, Build> {
  for (const b of Object.values(pieces)) {
    for (const p of b.pieces) p.geo.translate(0, skid, 0);
    for (const m of b.marks) m.at = [m.at[0], m.at[1] + skid, m.at[2]];
  }
  const skids: Build = { pieces: [], marks: [] };
  for (const s of [-1, 1]) skids.pieces.push(box("rubber", [0.05, skid, d - 0.04], [s * (w / 2 - inset), skid / 2, 0], { bevel: Math.min(0.003, skid / 3) }));
  return { ...pieces, skids };
}

/**
 * The triple 21 is Void's Incubus Sub, built from its spec sheet's drawings (TD10760, 1479 x 696 x 1218 mm; 703.5 on
 * its 7.5 mm skids, which the model keeps inside the 696, so a box stacks on it there): three 21" in a hybrid horn bandpass, 18 mm birch
 * in a black textured coat, red aluminium braces. Measured off the front, side, rear and plan views (about 10 mm):
 * - cabinet: the shell open at the front, and the two dividers 168 in from each end
 * - horn walls: the main mouth, 1107 between the dividers, its two walls slanting back at about 45 degrees from the
 *   dividers to the grille, not flat panels facing front (#6161): in the drawing's isometric view the wall meets the
 *   floor along a level line, where a flat panel's edge would drop at 30 degrees (the fold behind is not drawn or built)
 * - grille: 443 wide, centred, 345 back, the chamber dark behind it
 * - braces: two uprights with stepped edges and a window above and below, 25 to 285 back, at the grille's edges; a
 *   cross bar at half height, 200 back, from wall to wall, its flanges lying along the walls
 * - slots: the two end slots, 150 wide, full height and depth, with two red brackets each, 234 and 456 down
 * - handles: two recessed in each side (582 and 1081 back from the front), two in the back (302 either side of centre)
 * - jacks: the two 8-pin sockets on a plate between the back handles
 * - hardware: the screws down each side that hold the slot brackets, the stacking cups in the top
 * The real box has the maker's name on both horn walls; the model's are plain.
 */
function incubusPieces(): Record<string, Build> {
  const [w, full, d] = GEAR_SIZES["triple-21-sub"], skid = 0.0075, h = full - skid, t = 0.018, f = d / 2, cy = h / 2, ih = h - 2 * t, mm = (v: number) => v / 1000;
  const P = (): Build => ({ pieces: [], marks: [] }), cab = P(), walls = P(), grille = P(), braces = P(), slots = P(), handles = P(), jack = P(), hw = P();
  well(cab, "coat", [w, h, d], d - t, t);
  const xd = w / 2 - mm(177); // the dividers' middles
  for (const s of [-1, 1]) cab.pieces.push(box("coat", [t, ih, d - t], [s * xd, cy, t / 2]));
  // the horn walls: from each divider at the front back to the grille's edge
  const zg = f - mm(345), xg = mm(221.5);
  for (const s of [-1, 1]) {
    const a = [s * (xd - t / 2), f - 0.004], b = [s * xg, zg], dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, l = Math.hypot(dx, dz);
    const n = [(s * -dz * t) / l, (s * dx * t) / l]; // the wall's thickness, away from the mouth
    walls.pieces.push(slab("coat", [a, b, [b[0]! + n[0]!, b[1]! + n[1]!], [a[0]! + n[0]!, a[1]! + n[1]!]], t, h - t));
  }
  grille.pieces.push(...grilleSlab(2 * xg, ih - 0.004, 0.012, cy, zg - 0.012, 0.004));
  grille.pieces.push(box("cavity", [2 * xg, ih, 0.004], [0, cy, zg - 0.2]));
  // the braces: the cross bar at half height, its flanges flat on the walls; the stepped uprights, short of the grille
  const wallZ = (x: number) => f - 0.004 - ((xd - t / 2 - x) / (xd - t / 2 - xg)) * (f - 0.004 - zg); // a wall's depth at |x|
  const zb = f - mm(200), xb = xg + ((zb - zg) / (f - 0.004 - zg)) * (xd - t / 2 - xg);
  braces.pieces.push(box("body", [2 * xb, 0.03, 0.012], [0, cy, zb], { bevel: 0.002 }));
  for (const s of [-1, 1]) {
    const on = [mm(382), mm(235)].map((x) => [s * x, wallZ(x)]); // the flange's ends on the wall, then 6 proud of it
    braces.pieces.push(slab("body", [...on, ...[...on].reverse().map(([x, z]) => [x! - s * 0.006, z! + 0.006])], cy - 0.021, cy + 0.021));
    const steps = 8, edge = Array.from({ length: steps + 1 }, (_, k) => [mm(30) * (k % 2), t + (ih * k) / steps]);
    const outline = [...edge, ...[...edge].reverse().map(([u, y]) => [u! + mm(230), y!])];
    const windows = [-1, 1].map((k) => rect(mm(130), cy + k * ih * 0.24, mm(140), ih * 0.3));
    const up = frontPlate("body", outline, windows, 0.004, 0.008);
    up.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(s * mm(144), 0, f - mm(285)).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
    braces.pieces.push(up);
    for (const y of [t + 0.003, h - t - 0.003]) braces.pieces.push(box("body", [0.05, 0.006, mm(260)], [s * mm(144), y, f - mm(155)], { bevel: 0.001 }));
  }
  // the end slots: dark at the back, two red brackets across each
  for (const s of [-1, 1]) {
    const xs = s * (w / 2 - mm(93)), sw = mm(150);
    slots.pieces.push(box("cavity", [sw, ih, 0.004], [xs, cy, -f + t + 0.003]));
    for (const y of [h - mm(234), h - mm(456)]) {
      slots.pieces.push(box("body", [sw, 0.012, 0.03], [xs, y, f - 0.06], { bevel: 0.002 }));
      for (const e of [-1, 1]) slots.pieces.push(box("body", [0.008, 0.04, 0.05], [xs + e * (sw / 2 - 0.004), y, f - 0.06], { bevel: 0.001 }));
    }
  }
  for (const s of [-1, 1]) {
    for (const z of [f - mm(582), f - mm(1081)]) handles.pieces.push(box("cavity", [0.005, mm(96), mm(96)], [s * (w / 2 + 0.002), cy, z], { bevel: 0.002 }));
    handles.pieces.push(box("cavity", [mm(96), mm(96), 0.005], [s * mm(302), cy, -f - 0.002], { bevel: 0.002 }));
    for (const z of [137, 280, 422]) for (const y of [h - mm(234), h - mm(456)]) for (const k of [-1, 1])
      hw.pieces.push(disc("metal", 0.006, 0.003, "x", [s * (w / 2 + 0.0015), y + k * 0.009, f - mm(z)], 6));
  }
  mark(handles, "grab", [w / 2 + 0.012, cy, f - mm(582)], [1, 0, 0]);
  plate(jack, mm(72), mm(144), [0, cy, -f - 0.004]);
  socketPanel(jack, "triple-21-sub", "back", [0, cy, -f - 0.008], [mm(72), mm(144)]);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => [a! * (w / 2 - mm(54)), b! * (f - mm(54))]).concat([[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a! * mm(63), b! * (f - mm(54))])))
    hw.pieces.push(disc("cavity", mm(30), 0.004, "y", [x!, h - 0.0015, z!], 12));
  return onSkids({ cabinet: cab, "horn-walls": walls, grille, braces, slots, handles, jacks: jack, hardware: hw }, skid, w, d, mm(180));
}

/**
 * The arc sub is Void's Arcline 118, built from its spec sheet's drawings (TD10753, 656.8 x 550 x 695.2 mm; 671.8 over
 * its corner fittings, 708 over the bowed grille, 565 on 15 mm skids, which the model keeps inside the 550): one 18" in a ported
 * multi-ply box, a textured black coat. Measured off the front, side, plan and rear views (about 5 mm):
 * - cabinet: the shell, its front baffle cut for the driver and the port
 * - grille: one perforated sheet over the whole front, 17 in from each edge, bowed 12.8 out at the middle, a bar
 *   between the driver's part (459 wide) and the port's (143, on the right)
 * - driver: the 18", centred in its part of the front
 * - port: the flared slot behind the grille's right part
 * - handles: two recessed in each side and two in the top, 110 square; the M20 top-hat socket in the top
 * - fittings: the rigging fittings standing 7.5 mm out of each side at its corners
 * - jacks: the rear plate of 4-pin sockets, low and left of centre seen from behind
 * The badge on the grille, where the real one carries the maker's mark, is plain.
 */
function arcline118Pieces(): Record<string, Build> {
  const [w, full, d] = GEAR_SIZES["arc-sub-18"], skid = 0.015, h = full - skid, t = 0.018, mm = (v: number) => v / 1000, X = (fromLeft: number) => mm(fromLeft) - w / 2;
  const P = (): Build => ({ pieces: [], marks: [] }), cab = P(), grille = P(), driver = P(), port = P(), handles = P(), fittings = P(), jack = P();
  const bow = mm(12.8), zf = d / 2 - bow - 0.004, zc = (zf - d / 2) / 2, dc = zf + d / 2, cy = h / 2;
  const arc = (x: number) => d / 2 - bow * (x / (w / 2)) ** 2;
  // the shell: sides, top and bottom, back, and the baffle cut for the driver and the port
  for (const s of [-1, 1]) cab.pieces.push(box("coat", [t, h, dc], [s * (w / 2 - t / 2), cy, zc], { bevel: 0.006 }));
  for (const y of [t / 2, h - t / 2]) cab.pieces.push(box("coat", [w - 2 * t + 0.002, t, dc], [0, y, zc], { bevel: 0.004 }));
  cab.pieces.push(box("coat", [w - 2 * t, h - 2 * t, t], [0, cy, -d / 2 + t / 2]));
  const xd = X(246), rd = 0.205, circle = Array.from({ length: 28 }, (_, j) => [xd + Math.cos((j / 28) * Math.PI * 2) * rd, cy + Math.sin((j / 28) * Math.PI * 2) * rd]);
  cab.pieces.push(frontPlate("coat", rect(0, cy, w - 2 * t, h - 2 * t), [circle, rect(X(557), cy, mm(130), h - 0.07)], zf, t));
  // the grille: one bowed sheet, a bar between its two parts, the plain badge
  const gx = w / 2 - mm(17), n = 12, front = Array.from({ length: n + 1 }, (_, i) => { const x = -gx + (2 * gx * i) / n; return [x, arc(x)]; });
  grille.pieces.push(slab("grille", [...front, ...[...front].reverse().map(([x, z]) => [x!, z! - 0.004])], mm(15), h - mm(15)));
  grille.pieces.push(box("coat", [0.01, h - mm(30), 0.006], [X(481), cy, arc(X(481)) - 0.004]));
  grille.pieces.push(disc("badge", 0.014, 0.003, "z", [X(58), mm(270), arc(X(58)) + 0.0005], 12));
  driver.pieces.push(...cone(0.17, 0.11, new THREE.Matrix4().makeTranslation(xd, cy, zf - t + 0.002)));
  port.pieces.push(frustum("cavity", [X(492), X(622), 0.035, h - 0.035], [X(530), X(585), 0.12, h - 0.12], zf - t, 0.32));
  for (const s of [-1, 1]) {
    for (const z of [-0.174, 0.174]) handles.pieces.push(box("cavity", [0.005, mm(110), mm(110)], [s * (w / 2 + 0.002), cy, z], { bevel: 0.003 }));
    handles.pieces.push(box("cavity", [mm(112), 0.005, mm(112)], [0, h + 0.002, s * 0.177], { bevel: 0.003 }));
    for (const y of [mm(45), h - mm(45)]) for (const z of [-d / 2 + mm(45), zf - mm(45)]) for (const k of [0, 1])
      fittings.pieces.push(disc("metal", 0.016, 0.0075, "x", [s * (w / 2 + 0.00375), y, z + (z < 0 ? 1 : -1) * k * mm(76)], 10));
  }
  handles.pieces.push(disc("metal", mm(30), 0.006, "y", [0, h, 0], 16), disc("knob", mm(19), 0.007, "y", [0, h, 0], 12));
  mark(handles, "grab", [w / 2 + 0.012, cy, 0.174], [1, 0, 0]);
  mark(handles, "pole", [0, h - 0.005, 0], [0, 1, 0]);
  const jx = w / 2 - mm(408); // 408 from the left seen from behind
  plate(jack, mm(68), mm(177), [jx, mm(163), -d / 2 - 0.004]);
  socketPanel(jack, "arc-sub-18", "back", [jx, mm(163), -d / 2 - 0.008], [mm(68), mm(177)]);
  return onSkids({ cabinet: cab, grille, driver, port, handles, fittings, jacks: jack }, skid, w, d, mm(80));
}

/** A stage's 12U rack: three PLD4.5s with a blank between each (catalog's `rack`), the case's panel behind. */
const ampRack12 = (): Build => rackCase("amp-rack-12u", 12, [2, 5, 8], 0.045, { y: 0.77, area: [0.5, 0.32] });

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


/** A moulded shell from its plan: the convex polygon `poly` ([x, z] corners, the front at the largest z) pushed up
 * `h` from y0, its upright edges rounded `r` and its top and bottom edges `e`. Its top falls `fall` from the front to
 * the back, and its rear top edge rounds over `round`, as a moulded box's does seen from the side. */
function planShell(slot: GearSlot, poly: [number, number][], { r, e, y0, h, fall = 0, round = 0 }: { r: number; e: number; y0: number; h: number; fall?: number; round?: number }): Piece {
  const zs = poly.map((p) => p[1]), zf = Math.max(...zs), zb = Math.min(...zs);
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const normal = (a: [number, number], b: [number, number]) => {
    const n = new THREE.Vector2(b[1] - a[1], -(b[0] - a[0])).normalize();
    return n.dot(new THREE.Vector2((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz)) < 0 ? n.negate() : n;
  };
  // each corner's round is centred `r` in from both its edges
  const centres = poly.map((v, i) => {
    const n1 = normal(poly[(i + poly.length - 1) % poly.length]!, v), n2 = normal(v, poly[(i + 1) % poly.length]!), k = r / (1 + n1.dot(n2));
    return [v[0] - (n1.x + n2.x) * k, v[1] - (n1.y + n2.y) * k] as const;
  });
  const top = (z: number) => y0 + h - (fall * (zf - z)) / (zf - zb), pts: THREE.Vector3[] = [], layers = 4, seg = 12;
  for (let k = 0; k <= layers; k++) {
    const t = (k / layers) * (Math.PI / 2), off = e * (1 - Math.sin(t)), rr = Math.max(r - e * (1 - Math.cos(t)), 0.0004);
    for (const [x0, z0] of centres) for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr;
      pts.push(new THREE.Vector3(x, y0 + off, z), new THREE.Vector3(x, top(z) - off, z));
    }
  }
  if (round > 0) {
    // the rear top edge: every point behind the round's centre and above it pulled onto the round, and the round itself
    const rz = zb + round, ry = top(rz) - round, rear = pts.filter((p) => p.z < zb + r + 0.001 && p.y > ry);
    for (const p of pts) if (p.z < rz && p.y > ry) { const v = new THREE.Vector2(p.z - rz, p.y - ry); if (v.length() > round) { v.setLength(round); p.z = rz + v.x; p.y = ry + v.y; } }
    for (const p of rear) for (let a = 1; a <= 6; a++) { const t = (a / 6) * (Math.PI / 2); pts.push(new THREE.Vector3(p.x, ry + round * Math.sin(t), rz - round * Math.cos(t))); }
  }
  let geo: THREE.BufferGeometry = new ConvexGeometry(pts);
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  geo = toCreasedNormals(geo.index ? geo.toNonIndexed() : geo, 0.6);
  return { geo, slot };
}

/** The QSC K.2 drawings' numbers (K.2 user manual, figures 23 and 25), in mm: each box's plan (its front corners, the
 * monitor facet cut off its rear left corner, its back), the grille, the top handle, the hardware and the drivers. */
const K2 = {
  "top-12-powered": {
    w: 356, h: 602, d: 350, feet: 4, plan: [[-178, 175], [178, 175], [139, -175], [-11, -175], [-158, -63]], r: 18, fall: 15, round: 50,
    grille: [280, 590], screws: [[-117, 0, 116], [-117, -56, 56, 117]], badge: [79, 31, 33], recess: [126, 259, -42], bar: [166, 34, 4],
    m10: [261, 27, 65], insert: [173, 315], feetAt: [131, 152], woofer: 125, wooferY: 205, horn: [220, 140, 110], amp: [100, 300, 340],
  },
  "fill-8-powered": {
    w: 280, h: 449, d: 269, feet: 4, plan: [[-140, 134.5], [140, 134.5], [106, -134.5], [-10, -134.5], [-121, -51]], r: 15, fall: 9, round: 34,
    grille: [221, 437], screws: [[-100, 0, 100], [-100, -54, 54, 100]], badge: [80, 34, 30], recess: [95, 200, -32], bar: [143, 30, 3],
    m10: [222, 24, 58], insert: [133, 254], feetAt: [102, 116], woofer: 83, wooferY: 150, horn: [170, 100, 85], amp: [76, 280, 262],
  },
} as const;

/**
 * The PA top and the front fill, as QSC's K12.2 and K8.2 are drawn in the K.2 user manual (figures 25 and 23) and
 * built, piece by piece (no maker's name; the badge is a plain plate): a moulded ABS shell that narrows from the full
 * width at the front to a narrow back, one rear corner cut flat so the box lies on it as a floor monitor, its top
 * falling a little to the back and rounding over there. Every number is the drawing's, in metres from the box's
 * centre line, floor and depth centre.
 * - shell: the moulding, the grille's dark cavity between the two front bezels, the handle's well in the top
 * - grille: the steel grille, its badge plate, its screws (three along the top, four along the bottom)
 * - drivers: the woofer low and the horn high behind the grille (not drawn on the sheet: from the spec, 75 and 105 degrees)
 * - handle: the grip bar across the top well, three screws in it
 * - hardware: the two M10 fly points in the top, the insert in each side, the feet, the pole cup
 * - amp-plate: the back's amp plate with its jacks
 */
function k2Pieces(id: keyof typeof K2): Record<string, Build> {
  const k = K2[id], mm = (v: number) => v / 1000, [, h, d] = GEAR_SIZES[id], y0 = mm(k.feet), body = h - y0, f = d / 2;
  const P = (): Build => ({ pieces: [], marks: [] }), shell = P(), grille = P(), drivers = P(), grip = P(), hw = P(), amp = P();
  const top = (z: number) => h - (mm(k.fall) * (f - z)) / d;
  const [gw, gh] = k.grille.map(mm) as [number, number], yc = y0 + body / 2, cave = mm(70), g = 0.008;
  // the well runs out over the rear round on the real box; here it stops where the round starts
  const [rw, rl0, rz0] = k.recess.map(mm) as [number, number, number], rb = Math.max(rz0 - rl0 / 2, -f + mm(k.round) + 0.03), rf = rz0 + rl0 / 2, rl = rf - rb, rz = (rf + rb) / 2;
  sunk(shell, planShell("paint", k.plan.map(([x, z]) => [mm(x), mm(z)]), { r: mm(k.r), e: 0.008, y0, h: body, fall: mm(k.fall), round: mm(k.round) }), [
    [[0, 0, 1], [{ at: [0, yc, f], w: gw - 0.004, h: Math.min(gh, body - 0.016) - 0.008, r: 0.01, deep: cave, lip: 0.003, walls: "knob" }]],
    [[0, 1, 0], [{ at: [0, top(rz), rz], w: rw, h: rl, r: 0.02, deep: 0.035, lip: 0.006, draft: 0.003 }]],
    // the amp plate sits in a recess 16 deep in the narrow back
    [[0, 0, -1], [{ at: [mm((k.plan[2][0] + k.plan[3][0]) / 2), h - mm(k.amp[2]), -f], w: mm(k.amp[0]) + 0.016, h: mm(k.amp[1]) + 0.016, r: 0.01, deep: 0.016, lip: 0.004, draft: 0.002 }]],
  ]);
  grille.pieces.push(...grilleSlab(gw, gh, g, yc, f - g - 0.002, 0.01));
  const [bw, bh, by] = k.badge.map(mm) as [number, number, number];
  grille.pieces.push(box("metal", [bw, bh, 0.003], [0, by, f + 0.0005], { bevel: 0.001 }));
  const [topRow, footRow] = k.screws;
  for (const x of topRow) grille.pieces.push(...screw([mm(x), yc + gh / 2 - 0.009, f - 0.001], "z", 0.004, "knob", 6));
  for (const x of footRow) grille.pieces.push(...screw([mm(x), y0 + 0.018, f - 0.001], "z", 0.004, "knob", 6));
  // the drivers sit back in the cavity, the woofer low, the horn high (75 degrees on the 12, 105 on the 8)
  const dz = (y: number, x = 0) => new THREE.Matrix4().makeTranslation(x, y, f - g - 0.006), deep = cave - g - 0.012;
  drivers.pieces.push(...cone(mm(k.woofer), deep, dz(y0 + mm(k.wooferY))));
  const [hw0, hh0, hy] = k.horn.map(mm) as [number, number, number];
  drivers.pieces.push(...horn(hw0, hh0, deep, dz(h - hy)));
  // the grip bar spans the well, its ends on the top's flat, a screw at each end and one in the middle
  const [gbw, gbd, gbz] = k.bar.map(mm) as [number, number, number], gy = top(gbz) + 0.005;
  grip.pieces.push(rounded("paint", { wf: gbw, h: 0.012, d: gbd, r: 0.008, e: 0.005, y0: gy - 0.009, z0: gbz, detail: 1 }));
  for (const x of [-1, 0, 1]) grip.pieces.push(...screw([x * (gbw / 2 - 0.014), gy + 0.0035, gbz], "y", 0.0045));
  mark(grip, "grab", [0, gy + 0.025, gbz]);
  const [m10gap, m10r, m10z] = k.m10.map(mm) as [number, number, number];
  for (const x of [-1, 1]) hw.pieces.push(disc("metal", m10r / 2, 0.003, "y", [(x * m10gap) / 2, top(f - m10z) + 0.0005, f - m10z], 10), disc("knob", m10r / 4, 0.004, "y", [(x * m10gap) / 2, top(f - m10z) + 0.0005, f - m10z], 8));
  // the insert in each side: the side leans in toward the back, so it sits on the side's own line at that depth
  const [iz, iy] = k.insert.map(mm) as [number, number], zi = f - iz;
  const sideX = (z: number, s: number) => { const [a, b] = s > 0 ? [k.plan[1], k.plan[2]] : [k.plan[0], k.plan[4]]; const t = (mm(a[1]) - z) / (mm(a[1]) - mm(b[1])); return mm(a[0]) + (mm(b[0]) - mm(a[0])) * t; };
  for (const s of [-1, 1]) hw.pieces.push(disc("metal", 0.017, 0.004, "x", [sideX(zi, s) + s * 0.001, h - iy, zi], 12), disc("knob", 0.011, 0.005, "x", [sideX(zi, s) + s * 0.0015, h - iy, zi], 10));
  const [fx, fz] = k.feetAt.map(mm) as [number, number];
  for (const x of [-1, 1]) hw.pieces.push(block("rubber", [0.024, y0 + 0.002, 0.03], [x * fx, (y0 + 0.002) / 2, f - 0.03], 0.004), block("rubber", [0.024, y0 + 0.002, 0.03], [x * fx * 0.4, (y0 + 0.002) / 2, -fz], 0.004));
  hw.pieces.push(disc("metal", 0.024, 0.004, "y", [0, y0 - 0.0015, 0], 16), disc("knob", 0.018, 0.003, "y", [0, y0 - 0.003, 0], 16));
  mark(hw, "pole-cup", [0, y0, 0], [0, -1, 0]);
  // the amp plate on the narrow back, its jacks in a column: mains low, the XLRs above it
  const [pw, ph, py] = k.amp.map(mm) as [number, number, number], px = mm((k.plan[2][0] + k.plan[3][0]) / 2), bz = -f + 0.016 - 0.008;
  plate(amp, pw, ph, [px, h - py, bz + 0.004]);
  for (let i = 0; i < (pw > 0.09 ? 7 : 3); i++) amp.pieces.push(box("metal", [pw * 0.7, 0.003, 0.008], [px, h - py + ph * 0.3 - i * 0.012, bz - 0.006]));
  // the gain knob and the LED under the fins (on the narrow K8.2 plate, up among them, to leave the sockets room)
  const ky = h - py + ph * (pw > 0.09 ? -0.08 : 0.1);
  knob(amp, [px - pw * 0.2, ky, bz - 0.004], -1, 0.009);
  amp.pieces.push(disc("light", 0.0035, 0.004, "z", [px + pw * 0.25, ky, bz - 0.006], 8));
  // the amp plate's heatsink fins and knob are across its top half: the sockets go in its lower half
  socketPanel(amp, id, "back", [px, h - py - ph * (id === "fill-8-powered" ? 0.27 : 0.3), bz - 0.004], [pw, ph * (id === "fill-8-powered" ? 0.48 : 0.36)]);
  return { shell, grille, drivers, handle: grip, hardware: hw, "amp-plate": amp };
}

/**
 * The 18" sub, as QSC's KS118 is drawn on its 2D sheet (FG-901258-2D) and built, piece by piece (no maker's name): a
 * 15 mm birch-ply box 512 wide and 624 tall on 14 mm skids, 674 deep, with four casters on the back (784 deep over
 * them) so it tips back and rolls. Every number is the drawing's, in metres from the box's centre line, floor and the
 * depth centre over the casters (the cabinet's face is at d / 2).
 * - cabinet: the box, the driver's well and the two port slots across the bottom of the face, a handle well in each side
 * - driver: the 18" cone, 454 across its ring, centre 249 below the top (the drawing's 325 is to the centre of balance); its dish and dust cap a part that pumps (`coneThrow`)
 * - ports: the divider between the two slots
 * - grille: the steel grille over the whole face (the drawing leaves it off), a plain plate, its screws
 * - handles: the grip bar splitting each side well into two cells
 * - skids: the 45 mm corner pads, four a side, four on top and the four underneath it stands on
 * - pole-cup: the M20 socket on top, 381 from the back
 * - amp-plate: the back's amp plate, its jacks, and the two rails it sits between
 * - casters: four on the back's corners, sticking out 110 behind it
 */
function ks118Pieces(): Record<string, Build> {
  const [, h, d] = GEAR_SIZES["sub-18"], mm = (v: number) => v / 1000, P = (): Build => ({ pieces: [], marks: [] });
  const cab = P(), drv = P(), ports = P(), grille = P(), grips = P(), skids = P(), pole = P(), amp = P(), casters = P();
  const bw = mm(512), y0 = mm(14), bh = mm(624), bd = mm(674), f = d / 2, back = f - bd, g = 0.014, cy = h - mm(249);
  const py = mm(86), ph = mm(110), pw = mm(235), hy = h - mm(273), hz = f - mm(253);
  const hand = (s: number): [THREE.Vector3Tuple, Well[]] => [[s, 0, 0], [{ at: [s * bw / 2, hy, hz], w: mm(288), h: mm(162), r: 0.03, deep: 0.06, lip: 0.008, draft: 0.004 }]];
  sunk(cab, rounded("paint", { wf: bw, h: bh, d: bd - g, r: 0.01, y0, z0: back + (bd - g) / 2 }), [[[0, 0, 1], [
    { at: [0, cy, f - g], w: 0.456, h: 0.456, r: 0.05, deep: 0.075, lip: 0.004, walls: "knob" },
    ...[-1, 1].map((x): Well => ({ at: [x * (pw / 2 + mm(5.5)), py, f - g], w: pw, h: ph, r: 0.012, deep: 0.25, lip: 0.008, walls: "knob" })),
  ]], hand(-1), hand(1)]);
  ports.pieces.push(box("knob", [mm(11), ph - 0.004, 0.25], [0, py, f - g - 0.125]));
  const throw_ = 0.006, [dish, surround, cap, rim] = cone(mm(189), 0.06, new THREE.Matrix4()), cz = f - g - 0.004 - throw_;
  for (const p of [surround, rim]) { p.geo.translate(0, cy, cz); drv.pieces.push(p); }
  drv.parts = [{ name: "cone", at: [0, cy, cz], pieces: [dish, cap] }];
  drv.data = { coneThrow: throw_ };
  grille.pieces.push(...grilleSlab(bw - 0.016, bh - 0.01, g + 0.002, y0 + bh / 2, f - g - 0.001, 0.01));
  grillePlate(grille, new THREE.Matrix4().makeTranslation(bw / 2 - 0.07, py + ph / 2 + 0.02, f + 0.001));
  grilleScrews(grille, bw - 0.016, bh - 0.01, new THREE.Matrix4().makeTranslation(0, y0 + bh / 2, f + 0.001), 4);
  for (const s of [-1, 1]) grips.pieces.push(box("paint", [0.03, mm(162) - 0.02, mm(28)], [s * (bw / 2 - 0.035), hy, hz + mm(288) * 0.12], { bevel: 0.004 }));
  mark(grips, "grab", [bw / 2 + 0.012, hy, hz], [1, 0, 0]);
  // the pads: on the sides 43 and 554 from the back, 63 and 560 down; on the top and under it 217 out from the centre, 33 and 580 from the back
  const pad = mm(45);
  for (const s of [-1, 1]) for (const z of [back + mm(43) + pad / 2, back + mm(554)]) for (const y of [h - mm(63), h - mm(560)])
    skids.pieces.push(box("rubber", [0.004, pad, pad], [s * (bw / 2 + 0.002), y, z]));
  for (const x of [-1, 1]) for (const z of [back + mm(33) + pad / 2, back + mm(580)]) {
    skids.pieces.push(box("rubber", [pad, 0.004, pad], [x * mm(217), h + 0.002, z]));
    skids.pieces.push(block("rubber", [pad, y0, pad], [x * mm(217), y0 / 2, z], 0.004));
  }
  const pz = back + mm(381);
  pole.pieces.push(box("panel", [mm(113), 0.003, mm(113)], [0, h - 0.0005, pz], { bevel: 0.001 }), disc("metal", 0.026, 0.005, "y", [0, h - 0.0005, pz], 16), disc("knob", 0.019, 0.002, "y", [0, h + 0.002, pz], 16));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pole.pieces.push(...screw([x * 0.04, h + 0.001, pz + z * 0.04], "y", 0.0035));
  mark(pole, "pole", [0, h - 0.005, pz], [0, 1, 0]);
  // the amp plate, 251 x 157, 267 below the top, between two upright rails 348 long
  const ay = h - mm(267), aw = mm(251), ah = mm(157), bz = back - 0.004;
  plate(amp, aw, ah, [0, ay, bz]);
  for (const s of [-1, 1]) amp.pieces.push(box("metal", [0.03, mm(348), 0.012], [s * mm(142), h - mm(293), back - 0.006], { bevel: 0.002 }));
  for (const x of [-0.3, -0.1]) knob(amp, [x * aw, ay + ah * 0.2, bz - 0.004], -1, 0.009);
  amp.pieces.push(box("knob", [0.04, 0.02, 0.004], [aw * 0.25, ay + ah * 0.25, bz - 0.006]), disc("light", 0.0035, 0.004, "z", [aw * 0.05, ay + ah * 0.2, bz - 0.006], 8));
  // the knobs and the screen are across the plate's top: the IEC and the jacks go below them
  socketPanel(amp, "sub-18", "back", [0, ay - ah * 0.2, bz - 0.004], [aw, ah * 0.5]);
  // the casters: a plate on the back's corner, a fork out behind it, the wheel turning about x
  const wr = mm(28);
  for (const x of [-1, 1]) for (const y of [h - mm(43), mm(36)]) {
    casters.pieces.push(box("metal", [0.06, 0.06, 0.004], [x * mm(203), y, back - 0.002]));
    casters.pieces.push(box("metal", [0.03, 0.02, back + d / 2 - wr], [x * mm(203), y, (back - d / 2 + wr) / 2]));
    casters.pieces.push(disc("rubber", wr, 0.024, "x", [x * mm(203), y, -d / 2 + wr], 10));
  }
  return { cabinet: cab, driver: drv, ports, grille, handles: grips, skids, "pole-cup": pole, "amp-plate": amp, casters };
}

/** Every piece turned by `m`: its geometry, and its marks' places and the way they face. */
function turned(pieces: Record<string, Build>, m: THREE.Matrix4): Record<string, Build> {
  const n = new THREE.Matrix3().getNormalMatrix(m);
  for (const b of Object.values(pieces)) {
    for (const p of b.pieces) p.geo.applyMatrix4(m);
    b.marks = b.marks.map((k) => ({ ...k, at: new THREE.Vector3(...k.at).applyMatrix4(m).toArray(), out: new THREE.Vector3(...k.out).applyMatrix3(n).normalize().toArray() }));
  }
  return pieces;
}

/**
 * The floor monitor, as QSC's CP12 is drawn on the CP spec sheet (page 4: front, top, side and back) and lies on stage:
 * built upright as the sheet draws it (350 wide, 516 tall, 323 deep, no maker's name), then laid on the flat cut off
 * its rear left corner, the CP's monitor pose, so its face looks up at the player at 45 degrees and its height runs
 * across the stage. Every number is the drawing's, in metres from the upright box's centre line, floor and depth centre.
 * - shell: the moulding, the face's dark cavity, the handle well in its top and the side panel in its right side
 * - grille: the steel grille and its four screws
 * - drivers: the 12" woofer low on the face, the horn's waveguide over it to the left, its throat
 * - port: the upright slot beside the horn
 * - handle: the grip bar across the top's well
 * - feet: the two corner feet and the strip under the upright box, and two pads on the monitor flat it lies on
 * - back-panel: the amp plate on the narrow back, its jacks
 */
function cp12Pieces(): Record<string, Build> {
  const mm = (v: number) => v / 1000, P = (): Build => ({ pieces: [], marks: [] });
  const shell = P(), grille = P(), drivers = P(), port = P(), grip = P(), feet = P(), back = P();
  const w = mm(350), h = mm(516), d = mm(323), f = d / 2, y0 = mm(14), body = h - y0, fall = mm(25), g = 0.008, cave = mm(60);
  const plan: [number, number][] = [[-175, 161.5], [175, 161.5], [152, -161.5], [-33, -161.5], [-164, -30.5]].map(([x, z]) => [mm(x!), mm(z!)]);
  const top = (z: number) => h - (fall * (f - z)) / d, yc = y0 + body / 2, gw = w - 0.03, gh = body - 0.024;
  // the top's well, from 84 in front of the centre to where the rear round starts; the side panel, 232 x 363 on the
  // sheet, cut to 220 long here so it stops short of the back's round
  const rb = -f + mm(20) + 0.02, rf = mm(84.5), rz = (rb + rf) / 2;
  const right = (z: number) => mm(175) + ((mm(152) - mm(175)) * (f - z)) / d, lean = Math.atan2(mm(175 - 152), d);
  sunk(shell, planShell("paint", plan, { r: mm(14), e: 0.008, y0, h: body, fall, round: mm(20) }), [
    [[0, 0, 1], [{ at: [0, yc, f], w: gw - 0.004, h: gh - 0.004, r: 0.012, deep: cave, lip: 0.003, walls: "knob" }]],
    [[0, 1, 0], [{ at: [0, top(rz), rz], w: mm(114), h: rf - rb, r: 0.02, deep: 0.035, lip: 0.006, draft: 0.003 }]],
    [[Math.cos(lean), 0, -Math.sin(lean)], [{ at: [right(mm(-30.5)), h - mm(268.5), mm(-30.5)], w: mm(220), h: mm(363), r: 0.03, deep: 0.018, lip: 0.006, draft: 0.003 }]],
  ]);
  grille.pieces.push(...grilleSlab(gw, gh, g, yc, f - g - 0.002, 0.012));
  for (const x of [-1, 1]) for (const y of [h - mm(14), mm(31)]) grille.pieces.push(...screw([x * mm(90), y, f - 0.001], "z", 0.004, "knob", 6));
  const at = (x: number, y: number) => new THREE.Matrix4().makeTranslation(x, y, f - g - 0.006), deep = cave - g - 0.012;
  drivers.pieces.push(...cone(mm(124), deep, at(0, mm(186))));
  // the waveguide: 242 x 169 at the face, its throat 96 across, centred 36 left of the centre line and 408 up
  drivers.pieces.push(...horn(mm(242), mm(169), deep, at(mm(-36), mm(408))));
  port.pieces.push(box("knob", [mm(60), mm(132), 0.004], [mm(125), mm(392), f - cave + 0.006], { bevel: 0.002 }));
  for (const x of [-1, 1]) port.pieces.push(box("knob", [0.004, mm(132), cave - 0.012], [mm(125) + x * mm(30), mm(392), f - cave / 2 - 0.004]));
  const gz = mm(-5.5), gy = top(gz) + 0.005;
  grip.pieces.push(rounded("paint", { wf: mm(176), h: 0.012, d: mm(30), r: 0.008, e: 0.005, y0: gy - 0.009, z0: gz, detail: 1 }));
  for (const x of [-1, 0, 1]) grip.pieces.push(...screw([x * mm(74), gy + 0.0035, gz], "y", 0.0045));
  mark(grip, "grab", [0, gy + 0.025, gz]);
  // feet under the upright box: one in each front corner, a strip between them
  for (const [x, fw] of [[-127, 42], [127, 42], [27, 153]] as const) feet.pieces.push(block("rubber", [mm(fw), y0 + 0.002, 0.03], [mm(x), (y0 + 0.002) / 2, f - 0.03], 0.004));
  // and two pads on the monitor flat (its outward normal is (-1, 0, -1) / root 2), near each end
  const fm = new THREE.Vector3(mm(-98.5), 0, mm(-96)), fo = new THREE.Vector3(-1, 0, -1).normalize();
  for (const y of [0.07, h - 0.07]) feet.pieces.push(box("rubber", [0.09, 0.03, 0.006], [fm.x + fo.x * 0.003, y, fm.z + fo.z * 0.003], { rot: [0, Math.PI / 4, 0] }));
  // the amp plate on the 185-wide back: the jacks and the mains inlet down its +x side (the sheet's back view is seen
  // from behind, so its left), the heat sink and knob toward the monitor flat
  const px = mm((152 - 33) / 2), pw = mm(150), ph = mm(420), py = h / 2, bz = -f - 0.004;
  plate(back, pw, ph, [px, py, bz]);
  for (let i = 0; i < 7; i++) back.pieces.push(box("metal", [pw * 0.45, 0.003, 0.008], [px - pw * 0.18, py + ph * 0.32 - i * 0.012, bz - 0.006]));
  knob(back, [px - pw * 0.18, py - ph * 0.05, bz - 0.004], -1, 0.009);
  back.pieces.push(disc("light", 0.0035, 0.004, "z", [px - pw * 0.18, py + ph * 0.05, bz - 0.006], 8));
  // the fins and the knob run down the plate's left: the sockets go in a column down its right
  socketPanel(back, "wedge-12", "back", [px + pw * 0.24, py, bz - 0.004], [pw * 0.48, ph * 0.8]);
  const pieces = { shell, grille, drivers, port, handle: grip, feet, "back-panel": back };
  // Lay it down: the upright box's height runs along -x, the monitor flat's normal turns to look down, and the face
  // looks up at 45 degrees toward +z, where the player stands. Then sit it on the floor, centred.
  const lay = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, Math.SQRT1_2, -Math.SQRT1_2), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2));
  turned(pieces, lay);
  const all = new THREE.Box3();
  for (const b of Object.values(pieces)) for (const p of b.pieces) { p.geo.computeBoundingBox(); all.union(p.geo.boundingBox!); }
  const c = all.getCenter(new THREE.Vector3());
  return turned(pieces, new THREE.Matrix4().makeTranslation(-c.x, -all.min.y, -c.z));
}

/**
 * The hung line array box, as QSC's L Class LA108 is drawn on its 2D sheet (FG-901522-2D) and built, piece by piece
 * (no maker's name): a cabinet 482 wide between its rigging, 271 tall at the face, closing 6 degrees top and bottom
 * toward the back (the sheet's 12 degrees between them), 374 deep. The 8" woofer sits right of centre with the
 * waveguide left of it and the port slot at the far left; the rigging brackets stand 15 mm proud each side (512 over
 * them), their front pins 15 behind the face and 247 apart, the rear pin 275 behind them at the foot. Every number is
 * the drawing's, in metres from the box's centre line, floor and depth centre.
 * - cabinet: the shell, the face's wells (woofer, waveguide, port), two hand pockets in each side, the back
 * - grille: the black steel grille over the face
 * - drivers: the woofer, the waveguide
 * - rigging: each side's front bracket with its top and bottom pins, the rear bracket and its pin
 * - pole-cups: the two sockets underneath (0 and 7.5 degrees)
 * - amp-plate: the back's amp plate, its heat sink and jacks, the M10 point under it
 */
function la108Pieces(): Record<string, Build> {
  const [, h, d] = GEAR_SIZES["line-array-10"], mm = (v: number) => v / 1000, P = (): Build => ({ pieces: [], marks: [] });
  const cab = P(), grille = P(), drv = P(), rig = P(), cups = P(), amp = P();
  const cw = mm(482), f = d / 2, b = -d / 2, taper = d * Math.tan((6 * Math.PI) / 180), yc = h / 2, ch = 0.008, cave = mm(70);
  const foot = (z: number) => (taper * (f - z)) / (f - b);
  const pocket = (s: number): [THREE.Vector3Tuple, Well[]] => [[s, 0, 0], [-1, 1].map((k): Well => ({ at: [s * cw / 2, yc + k * mm(45), mm(17)], w: mm(90), h: mm(40), r: 0.012, deep: 0.03, lip: 0.005, draft: 0.003 }))];
  sunk(cab, prism("coat", [[f, 0], [f, h], [b, h - taper], [b, taper]], cw, 0, ch), [
    [[0, 0, 1], [
      { at: [mm(106), yc, f], w: mm(220), h: mm(220), r: mm(100), deep: cave, lip: 0.003, walls: "knob" },
      { at: [mm(-90), yc, f], w: mm(160), h: mm(235), r: 0.01, deep: cave, lip: 0.003, walls: "knob" },
      { at: [mm(-204), yc, f], w: mm(35), h: mm(190), r: mm(16), deep: 0.15, lip: 0.004, walls: "knob", floor: "knob" },
    ]],
    pocket(-1), pocket(1),
    [[0, 0, -1], [{ at: [0, yc, b], w: mm(358) + 0.02, h: h - 2 * taper - 0.03, r: 0.01, deep: 0.016, lip: 0.004, draft: 0.002 }]],
  ]);
  const [sheet, edge] = grilleSlab(cw - 0.02, h - 0.02, 0.008, yc, f - 0.004, 0.004);
  grille.pieces.push({ ...sheet, slot: "mesh" }, { ...edge, slot: "knob" });
  const at = (x: number) => new THREE.Matrix4().makeTranslation(x, yc, f - 0.012), deep = cave - 0.02;
  drv.pieces.push(...cone(mm(88), deep, at(mm(106))), ...horn(mm(150), mm(225), deep, at(mm(-90))));
  // the rigging: each pin a steel pin through its bracket, its head outboard
  const pz = f - mm(15), top = h - 0.014, bottom = top - mm(247), rz = pz - mm(275), rb = foot(rz) + 0.012;
  const pin = (x: number, y: number, z: number, s: number) => rig.pieces.push(disc("chrome", mm(6.4) / 2 + 0.002, 0.02, "x", [x, y, z], 8), disc("knob", 0.01, 0.006, "x", [x + s * 0.008, y, z], 8));
  for (const s of [-1, 1]) {
    const x = s * (cw / 2 + 0.0075);
    rig.pieces.push(box("panel", [0.015, h - 0.004, 0.03], [x, yc, pz], { bevel: 0.003 }));
    pin(x, top, pz, s); pin(x, bottom, pz, s);
    rig.pieces.push(box("panel", [0.015, 0.05, 0.045], [x, rb + 0.01, rz], { bevel: 0.003 }));
    pin(x, rb, rz, s);
  }
  mark(rig, "hinge-top", [0, top, pz], [1, 0, 0]);
  mark(rig, "hinge-bottom", [0, bottom, pz], [1, 0, 0]);
  mark(rig, "grab", [0, h, 0]);
  // the pole sockets, side by side underneath on the centre line
  for (const z of [mm(35), mm(-15)]) cups.pieces.push(disc("metal", 0.022, 0.004, "y", [0, foot(z) - 0.0015, z], 14), disc("knob", 0.017, 0.003, "y", [0, foot(z) - 0.003, z], 14));
  // the amp plate: 358 wide; seen from behind (the sheet's back view), the jacks to the left of it and the heat sink's fins to
  // the right, so the jacks on +x and the fins on -x
  const ph = h - 2 * taper - 0.04, bz = b + 0.016 - 0.008;
  plate(amp, mm(358), ph, [0, yc, bz + 0.004]);
  for (let i = 0; i < 12; i++) amp.pieces.push(box("metal", [0.003, mm(90), 0.008], [mm(-60) - mm(104) + (i * mm(208)) / 11, yc + mm(23) * Math.min(1, ph / 0.19), bz - 0.006]));
  // the fins cover the plate's left two thirds: the sockets go in its right third
  socketPanel(amp, "line-array-10", "back", [mm(112), yc, bz - 0.004], [mm(130), ph]);
  amp.pieces.push(disc("light", 0.0035, 0.004, "z", [mm(61), yc + ph * 0.25, bz - 0.006], 8), disc("metal", 0.01, 0.006, "z", [0, taper + 0.008, b - 0.003], 8));
  return { cabinet: cab, grille, drivers: drv, rigging: rig, "pole-cups": cups, "amp-plate": amp };
}

/** The boxes built piece by piece from their makers' drawings, each piece named, so the turntable can show them one at
 * a time or pulled apart (`gearPieces`) and `gear` merges them (`whole`). */
const PIECES: Partial<Record<GearId, () => Record<string, Build>>> = {
  "stack-mid-high": res2Pieces, "stack-mid-bass": f215Pieces,
  "horn-sub-21": () => binPieces("horn-sub-21", F221), "horn-sub-18": () => binPieces("horn-sub-18", F218), "horn-sub-24": f124Pieces, "infra-sub-18": ib218Pieces,
  "skeletal-mid-high": () => skeletalPieces("skeletal-mid-high"), "skeletal-mid": () => skeletalPieces("skeletal-mid"),
  "sculpted-3way": () => airMotionPieces(1), "sculpted-3way-lh": () => airMotionPieces(-1), "triple-21-sub": incubusPieces, "arc-sub-18": arcline118Pieces,
  "tri-amp-top": tfs780hPieces, "tri-amp-bass": tfs780lPieces,
  "top-15-passive": jrx215Pieces, "wedge-12-passive": prx412mPieces, "line-array-box": a12Pieces,
  "top-12-powered": () => k2Pieces("top-12-powered"), "fill-8-powered": () => k2Pieces("fill-8-powered"), "sub-18": ks118Pieces, "wedge-12": cp12Pieces, "line-array-10": la108Pieces,
  "synergy-horn": sh50Pieces, "tapped-horn-18": th118Pieces, "cab-4x12": cab1960aPieces,
};

/** A box built piece by piece, every piece merged into one build. */
const whole = (id: GearId) => (): Build => {
  const b: Build = { pieces: [], marks: [] };
  for (const p of Object.values(PIECES[id]!())) { b.pieces.push(...p.pieces); b.marks.push(...p.marks); if (p.parts) (b.parts ??= []).push(...p.parts); if (p.data) b.data = { ...b.data, ...p.data }; }
  return b;
};

const BUILDERS: Record<GearId, (height: number) => Build> = {
  "top-12-powered": whole("top-12-powered"),
  "top-15-passive": whole("top-15-passive"),
  "sub-18": whole("sub-18"),
  "wedge-12": whole("wedge-12"),
  "amp-head": ampHead,
  "cab-4x12": whole("cab-4x12"),
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
  "line-array-box": whole("line-array-box"),
  "line-array-10": whole("line-array-10"),
  "fill-8-powered": whole("fill-8-powered"),
  guitar,
  "di-box": diBox,
  "mic-condenser": micCondenser,
  "wedge-12-passive": whole("wedge-12-passive"),
  "deck-media": deckMedia,
  turntable,
  "mixer-dj": mixerDj,
  "deck-cd": deckCd,
  "mixer-club-4": mixerClub4,
  "stack-mid-high": whole("stack-mid-high"),
  "stack-mid-bass": whole("stack-mid-bass"),
  "horn-sub-21": whole("horn-sub-21"),
  "horn-sub-18": whole("horn-sub-18"),
  "horn-sub-24": whole("horn-sub-24"),
  "infra-sub-18": whole("infra-sub-18"),
  "skeletal-mid-high": whole("skeletal-mid-high"),
  "skeletal-mid": whole("skeletal-mid"),
  "sculpted-3way": whole("sculpted-3way"),
  "sculpted-3way-lh": whole("sculpted-3way-lh"),
  "arc-sub-18": whole("arc-sub-18"),
  "amp-rack-12u": ampRack12,
  "qsc-pld4-5": pld,
  "generator-100kva": siteGenerator,
  "synergy-horn": whole("synergy-horn"),
  "tapped-horn-18": whole("tapped-horn-18"),
  "triple-21-sub": whole("triple-21-sub"),
  "tri-amp-top": whole("tri-amp-top"),
  "tri-amp-bass": whole("tri-amp-bass"),
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

/** A box's pieces, each its own group in the box's frame (`gear` merges them), or null for gear not built that way. */
export function gearPieces(id: GearId, { look = gearLook() }: GearOptions = {}): { name: string; group: THREE.Group }[] | null {
  const make = PIECES[id];
  if (!make) return null;
  return Object.entries(make()).map(([name, b]) => ({ name, group: assemble(`${id}~${name}`, built(`${id}~${name}`, () => b), look, { gear: id, piece: name }) }));
}

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
