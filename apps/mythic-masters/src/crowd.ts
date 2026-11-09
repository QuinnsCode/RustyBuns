// The stadium crowd: people made with codeSplitter's avatar maker (@rustybuns/util/avatar), cheering clips recorded
// once by `bun run crowd` (scripts/crowd.ts, into crowd.json). Each cast member's body is merged into one geometry
// whose vertices say which colour slot they wear (skin, hair, top, bottom, or a fixed colour) and which arm they hang
// from; every seat is an instance of one cast member with its own colours, clip and timing. The vertex shader poses
// the arms and body from the recorded frames, so a cheering stadium costs one draw call per cast member and two
// uniforms a frame, not a matrix per arm per person. Figures are in metres, local +x pointing away from the ring
// (they face -x), shoulders along z.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cleanAvatar, drawFace, PARTS, type Avatar } from "@rustybuns/util/avatar";
import RECORDED from "./crowd.json";

/** `shade` darkens a seat out of the light (the stands' back rows under the roof), 1 in full light. */
export interface Seat { pos: THREE.Vector3; yaw: number; shade?: number }
/** A recorded cheer: `frames` poses over a loop of `seconds`, each [bob, lean, latL, fwdL, latR, fwdR] (scripts/crowd.ts). */
export interface Clip { name: string; seconds: number; weight: number; frames: number[][] }

/** The cast, each checked as a codeSplitter profile would check it (a hand edit that breaks one drops it). */
export const CAST: Avatar[] = RECORDED.cast.map(cleanAvatar).filter((a): a is Avatar => !!a);
export const CLIPS: Clip[] = RECORDED.clips.filter((c) => c.frames.length === RECORDED.frames && c.frames.every((f) => f.length === 6));

const SIZE = 1.35; // people are drawn this much bigger than their model, so fewer of them read as people, not dots
const MODEL = 0.36; // an avatar is built about 1.7 tall (as in the code city), this shrinks it to the stands' 0.6
const SLOT = { fixed: 0, skin: 1, hair: 2, top: 3, bottom: 4, face: 5 } as const;
type Slot = keyof typeof SLOT;
const FACE = 64, ATLAS_COLS = 8; // face cells in the atlas, pixels and columns

const BOX = new THREE.BoxGeometry(1, 1, 1), BALL = new THREE.SphereGeometry(0.5, 8, 5), CAP = new THREE.SphereGeometry(0.5, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.44);
const CONE = new THREE.ConeGeometry(0.5, 1, 6), CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8), PLANE = new THREE.PlaneGeometry(1, 1);

/** One cast member's body, merged: feet at the origin, facing -x, with `aSlot`, `aArm` (shoulder pivot, side) and `color` per vertex. */
export function personGeometry(a: Avatar, face = -1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legH = a.build === "tall" ? 0.62 : a.build === "short" ? 0.3 : 0.45, w = a.build === "round" ? 0.5 : a.build === "slim" ? 0.34 : 0.42, torso = 0.5, r = 0.31;
  // Built as the code city builds a person (facing -z, x across), then turned to face -x.
  const add = (geo: THREE.BufferGeometry, slot: Slot | string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, arm?: { px: number; py: number }) => {
    const g = geo.clone().scale(sx, sy, sz).translate(x, y, z);
    const n = g.attributes.position!.count, c = new THREE.Color(slot in SLOT ? "#ffffff" : slot);
    g.setAttribute("aSlot", new THREE.Float32BufferAttribute(new Array(n).fill(slot in SLOT ? SLOT[slot as Slot] : 0), 1));
    g.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    // after the turn and shrink below the city's +x is -z: the pivot is stored as it will stand, its side the sign of z
    g.setAttribute("aArm", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => (arm ? [0, arm.py * MODEL, -arm.px * MODEL, -Math.sign(arm.px)] : [0, 0, 0, 0])).flat(), 4));
    parts.push(g);
  };
  const top: Slot | string = a.top === "suit" ? "#2e3439" : "top";
  for (const s of [-1, 1]) {
    add(BOX, "bottom", s * w * 0.24, legH / 2, 0, w * 0.4, legH, 0.2);
    add(BOX, "#16191c", s * w * 0.24, 0.04, -0.03, w * 0.42, 0.08, 0.28);
    const pivot = { px: s * (w / 2 + 0.07), py: legH + torso - 0.04 };
    add(BOX, top, pivot.px, legH + torso - 0.2, 0, 0.12, 0.36, 0.12, pivot);
    add(BOX, "skin", pivot.px, legH + torso - 0.42, 0, 0.1, 0.1, 0.1, pivot);
  }
  add(BOX, top, 0, legH + torso / 2, 0, w, torso, 0.26);
  if (a.top === "dress") add(CONE, top, 0, legH + 0.08, 0, w * 1.15, 0.34, w * 1.15);
  if (a.top === "overalls") add(BOX, "#3a6bd8", 0, legH + 0.15, -0.02, w * 1.02, 0.3, 0.27);
  if (a.top === "suit") add(BOX, "#f4f5f5", 0, legH + torso * 0.6, -0.14, 0.07, torso * 0.7, 0.02);
  if (a.top === "hoodie") add(BALL, top, 0, legH + torso, 0.12, w * 0.9, 0.16, 0.2);
  if (a.top === "labcoat") add(BOX, "#f4f5f5", 0, legH + torso / 2 - 0.02, 0, w * 1.06, torso * 0.9, 0.28);
  if (a.top === "lanyard") add(BOX, "#f4f5f5", 0, legH + torso * 0.5, -0.14, 0.15, 0.2, 0.01);
  if (a.top === "hawaiian") for (const [dx, dy] of [[-0.1, 0.35], [0.08, 0.2], [0.12, 0.4]] as const) add(BALL, "#f4f5f5", dx * w * 2.4, legH + dy, -0.14, 0.07, 0.07, 0.02);
  const hy = legH + torso + r * 0.95;
  add(BALL, "skin", 0, hy, 0, r * 2, r * 2.05, r * 2);
  if (face >= 0) {
    // the face is a cell of the atlas (faceAtlas): its plane's UVs point there
    const f = PLANE.clone(), uv = f.attributes.uv!, cx = (face % ATLAS_COLS) / ATLAS_COLS, cy = Math.floor(face / ATLAS_COLS), rows = Math.ceil(CAST.length / ATLAS_COLS) || 1;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cx + uv.getX(i) / ATLAS_COLS, 1 - (cy + 1 - uv.getY(i)) / rows);
    add(f.rotateY(Math.PI), "face", 0, hy, -r * 1.0, 0.5, 0.5, 1);
  }
  // hair: one cap and a shape or two, like the code city's but fewer pieces
  const hair = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number) => add(geo, "hair", x, y, z, sx, sy, sz);
  const cap = (k = 1.08) => hair(CAP, 0, hy + 0.01, 0.01, r * 2 * k, r * 2 * k, r * 2 * k);
  if (!["none", "afro", "mohawk", "spiky", "flat-top"].includes(a.hair)) cap(a.hair === "buzz" ? 1.03 : 1.08);
  if (a.hair === "bob") hair(BOX, 0, hy - 0.05, 0.12, r * 2.1, 0.32, r * 1.3);
  if (a.hair === "long" || a.hair === "locs") hair(BOX, 0, hy - 0.2, 0.12, r * 2.1, 0.6, r * 1.2);
  if (a.hair === "mullet") hair(BOX, 0, hy - 0.16, 0.13, r * 1.7, 0.4, r * 1.1);
  if (a.hair === "bun" || a.hair === "topknot") hair(BALL, 0, hy + r * 1.1, 0.04, 0.2, 0.2, 0.2);
  if (a.hair === "pigtails" || a.hair === "braids") for (const s of [-1, 1]) hair(BALL, s * r * 1.15, hy - 0.08, 0.05, 0.16, 0.24, 0.16);
  if (a.hair === "space-buns") for (const s of [-1, 1]) hair(BALL, s * r * 0.8, hy + r * 0.85, 0, 0.17, 0.17, 0.17);
  if (a.hair === "ponytail") hair(BALL, 0, hy - 0.04, r * 1.1, 0.14, 0.36, 0.14);
  if (a.hair === "afro" || a.hair === "curly") hair(BALL, 0, hy + 0.08, 0.04, r * (a.hair === "afro" ? 3.2 : 2.4), r * (a.hair === "afro" ? 3 : 2.2), r * (a.hair === "afro" ? 3 : 2.4));
  if (a.hair === "pompadour") hair(BALL, 0, hy + r * 0.95, -r * 0.3, r * 1.7, 0.28, r * 1.5);
  if (a.hair === "flat-top") hair(BOX, 0, hy + r * 0.8, 0, r * 1.9, 0.2, r * 1.9);
  if (a.hair === "mohawk") hair(BOX, 0, hy + r * 0.95, 0, 0.07, 0.24, r * 1.5);
  if (a.hair === "spiky") for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; hair(CONE, Math.cos(t) * r * 0.55, hy + r * 0.85, Math.sin(t) * r * 0.55, 0.14, 0.26, 0.14); }
  // hats, in the code city's colours
  const hat = (c: string, k = 1.14) => add(CAP, c, 0, hy + 0.04, 0.01, r * 2 * k, r * 2 * k, r * 2 * k);
  const crown = hy + r * 0.95;
  if (a.hat === "cap") { hat("#e8590c"); add(BOX, "#e8590c", 0, hy + 0.1, -r * 1.05, r * 1.7, 0.03, 0.25); }
  else if (a.hat === "beanie") { hat("#3a6bd8", 1.18); add(BALL, "#f4f5f5", 0, hy + r * 1.25, 0, 0.12, 0.12, 0.12); }
  else if (a.hat === "tophat") { add(CYL, "#16191c", 0, crown, 0, r * 2.5, 0.03, r * 2.5); add(CYL, "#16191c", 0, crown + 0.17, 0, r * 1.5, 0.34, r * 1.5); }
  else if (a.hat === "hardhat") hat("#f4d03a");
  else if (a.hat === "cat-ears") for (const s of [-1, 1]) add(CONE, "hair", s * r * 0.68, hy + r * 0.82, 0, 0.16, 0.22, 0.12);
  else if (a.hat === "propeller") { hat("#3a6bd8"); add(BOX, "#e8590c", 0, hy + r * 1.15 + 0.07, 0, r * 1.8, 0.02, 0.1); }
  else if (a.hat === "wizard") { add(CYL, "#4a3a8a", 0, crown, 0, r * 2.7, 0.03, r * 2.7); add(CONE, "#4a3a8a", 0, crown + 0.3, 0, r * 1.7, 0.6, r * 1.7); }
  else if (a.hat === "party") add(CONE, "#c23a6b", 0, crown + 0.17, 0, r * 1.1, 0.4, r * 1.1);
  else if (a.hat === "cone") add(CONE, "#e8590c", 0, crown + 0.16, 0, r * 1.5, 0.45, r * 1.5);
  else if (a.hat === "headphones") for (const s of [-1, 1]) add(BOX, "#16191c", s * r * 1.07, hy, 0, 0.1, 0.18, 0.18);
  else if (a.hat === "crown") add(CYL, "#f4d03a", 0, crown + 0.04, 0, r * 1.5, 0.1, r * 1.5);
  else if (a.hat === "rubber-duck") { add(BALL, "#f4d03a", 0, crown + 0.06, 0, 0.2, 0.14, 0.2); add(BALL, "#f4d03a", 0, crown + 0.17, -0.04, 0.12, 0.12, 0.12); }
  else if (a.hat === "bucket") { add(CYL, "#8a9a5c", 0, hy + r * 0.9, 0, r * 2.5, 0.03, r * 2.5); add(CYL, "#8a9a5c", 0, hy + r * 0.9 + 0.09, 0, r * 1.7, 0.18, r * 1.7); }
  else if (a.hat === "halo") add(CYL, "#f4d03a", 0, hy + r * 1.5, 0, 0.26, 0.02, 0.26);
  const g = mergeGeometries(parts);
  g.setAttribute("aFaceUv", g.attributes.uv!.clone()); // three only declares uv for a material with a map; the face reads its own copy
  return g.rotateY(Math.PI / 2).scale(MODEL, MODEL, MODEL);
}

/** Every cast member's face (codeSplitter's drawFace) in one texture, a cell each; a blank one where there is no canvas. */
function faceAtlas(cast: Avatar[]): THREE.Texture {
  if (typeof document === "undefined") return new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const rows = Math.ceil(cast.length / ATLAS_COLS) || 1, c = document.createElement("canvas");
  c.width = FACE * ATLAS_COLS; c.height = FACE * rows;
  const g = c.getContext("2d")!;
  cast.forEach((a, i) => drawFace(g, a, (i % ATLAS_COLS) * FACE + FACE / 2, Math.floor(i / ATLAS_COLS) * FACE + FACE * 0.52, FACE / 41));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The clips as a float texture: a row per clip, two texels a frame ([bob, lean, latL, fwdL], [latR, fwdR, -, -]). */
function clipTexture(clips: Clip[]): THREE.DataTexture {
  const frames = clips[0]?.frames.length ?? 1, data = new Float32Array(Math.max(1, clips.length) * frames * 8);
  clips.forEach((c, row) => c.frames.forEach((f, i) => data.set([...f.slice(0, 4), f[4]!, f[5]!, 0, 0], (row * frames + i) * 8)));
  const t = new THREE.DataTexture(data, frames * 2, Math.max(1, clips.length), THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true;
  return t;
}

const VERT_HEAD = /* glsl */ `
attribute float aSlot; attribute vec4 aArm; attribute vec2 aFaceUv;
attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iTop; attribute vec3 iBottom; attribute vec4 iSeat;
uniform sampler2D uClips; uniform float uTime; uniform float uExcite; uniform float uClip; uniform float uFrames; uniform float uSecs[8];
varying float vFace; varying vec2 vFaceUv;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }
vec4 frameAt(int clip, float t, int k) {
  float f = fract(t) * uFrames; int i0 = int(floor(f)), i1 = (i0 + 1) % int(uFrames);
  return mix(texelFetch(uClips, ivec2(i0 * 2 + k, clip), 0), texelFetch(uClips, ivec2(i1 * 2 + k, clip), 0), fract(f));
}
`;
// Poses one vertex: how far this seat is on its feet (a big cheer reaches everyone, a small one the keen), its clip at
// its own phase, mixed from arms hanging. Shared by the position and the normal so the light turns with the arm.
const POSE = /* glsl */ `
  float fire = iSeat.x, upness = clamp(uExcite * 1.6 - fire * 0.6, 0., 1.);
  int clip = uClip >= 0. ? int(uClip) : int(iSeat.y);
  float t = uTime / uSecs[clip] * iSeat.w + iSeat.z;
  vec4 a = frameAt(clip, t, 0), b = frameAt(clip, t, 1);
  float idle = 0.008 * sin(uTime * 1.7 + fire * 40.);
  float bob = mix(idle, a.x, upness), lean = a.y * upness;
  float side = aArm.w, lat = mix(0.08, side > 0. ? a.z : b.x, upness), fwd = mix(0., side > 0. ? a.w : b.y, upness); // facing -x, +z is the left hand
  mat3 arm = abs(side) > 0. ? rotZ(-fwd) * rotX(-side * lat) : mat3(1.);
  mat3 body = rotZ(lean);
`;

/** The crowd's one material: MeshStandardMaterial posed and coloured per seat in its shader. */
function crowdMaterial(faces: THREE.Texture, clips: Clip[]) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
  const uniforms = {
    uClips: { value: clipTexture(clips) }, uFaces: { value: faces }, uTime: { value: 0 }, uExcite: { value: 0 }, uClip: { value: -1 },
    uFrames: { value: clips[0]?.frames.length ?? 1 }, uSecs: { value: Array.from({ length: 8 }, (_, i) => clips[i]?.seconds ?? 1) },
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = VERT_HEAD + s.vertexShader
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${POSE}\n  objectNormal = body * (arm * objectNormal);`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n  transformed = body * (arm * (transformed - aArm.xyz) + aArm.xyz) + vec3(0., bob, 0.);`)
      .replace("#include <color_vertex>", `#include <color_vertex>
  vColor = aSlot < 0.5 ? color : aSlot < 1.5 ? iSkin : aSlot < 2.5 ? iHair : aSlot < 3.5 ? iTop : aSlot < 4.5 ? iBottom : iSkin;
  vFace = aSlot > 4.5 ? 1. : 0.; vFaceUv = aFaceUv;`);
    s.fragmentShader = "uniform sampler2D uFaces; varying float vFace; varying vec2 vFaceUv;\n" + s.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>
  if (vFace > 0.5) { vec4 f = texture2D(uFaces, vFaceUv); if (f.a < 0.5) discard; diffuseColor.rgb = f.rgb; } // only the eyes, mouth and glasses: the head shows through`);
  };
  mat.customProgramCacheKey = () => "crowd";
  return { mat, uniforms };
}

export interface Crowd {
  group: THREE.Group;
  people: number;
  /** How many draw calls the whole crowd takes: one per cast member seated. */
  draws: number;
  /** A hit landed: the stands get to their feet, in proportion (0..1). */
  cheer(strength: number): void;
  /** Eases the cheer off and moves the clock the clips play by; call each frame. */
  update(dt: number): void;
  /** Everyone does this clip, on their feet, until `play(null)` gives them back their own and the cheer: for looking at a take. */
  play(clip: string | null): boolean;
  state(): { people: number; draws: number; cast: number; clips: string[]; excite: number; playing: string | null };
}

const hex = (c: string) => new THREE.Color(c);
const REAL_SKIN = PARTS.skin.slice(0, 6), ODD_SKIN = PARTS.skin.slice(6);

export function buildCrowd(seats: Seat[], rnd: () => number, cast = CAST, clips = CLIPS): Crowd {
  const group = new THREE.Group(), { mat, uniforms } = crowdMaterial(faceAtlas(cast), clips);
  const pickOf = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const total = clips.reduce((s, c) => s + c.weight, 0);
  const clipPick = () => { let r = rnd() * total; for (let i = 0; i < clips.length; i++) if ((r -= clips[i]!.weight) < 0) return i; return 0; };
  const by = new Map<number, Seat[]>();
  for (const seat of seats) { const k = Math.floor(rnd() * cast.length); by.set(k, [...(by.get(k) ?? []), seat]); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(SIZE, SIZE, SIZE);
  for (const [k, list] of by) {
    const geo = personGeometry(cast[k]!, k), n = list.length;
    const col = (name: string) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); geo.setAttribute(name, a); return a; };
    const skin = col("iSkin"), hair = col("iHair"), top = col("iTop"), bottom = col("iBottom");
    const seatAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    geo.setAttribute("iSeat", seatAttr);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false; mesh.castShadow = false;
    list.forEach((seat, i) => {
      mesh.setMatrixAt(i, m4.compose(seat.pos, q.setFromAxisAngle(Y, seat.yaw), one));
      // the cast member's shape and face, this seat's colours: mostly human skin, now and then a mythic green or blue
      const k = seat.shade ?? 1, set = (a: THREE.InstancedBufferAttribute, c: THREE.Color) => a.setXYZ(i, c.r * k, c.g * k, c.b * k);
      set(skin, hex(rnd() < 0.05 ? pickOf(ODD_SKIN) : pickOf(REAL_SKIN)));
      set(hair, hex(pickOf(PARTS.hairColor)));
      set(top, hex(pickOf(PARTS.topColor)).lerp(new THREE.Color(0x707070), 0.25));
      set(bottom, hex(pickOf(PARTS.bottomColor)));
      seatAttr.setXYZW(i, rnd(), clipPick(), rnd(), 0.85 + rnd() * 0.3);
    });
    group.add(mesh);
  }
  let excite = 0, playing: string | null = null;
  return {
    group, people: seats.length, draws: by.size,
    cheer(strength) { excite = Math.min(1, Math.max(excite, strength)); },
    update(dt) {
      uniforms.uTime.value += dt;
      excite = playing ? 1 : Math.max(0, excite - dt * 0.45);
      uniforms.uExcite.value = excite;
    },
    play(clip) {
      const i = clip === null ? -1 : clips.findIndex((c) => c.name === clip);
      if (clip !== null && i < 0) return false;
      playing = clip; uniforms.uClip.value = i;
      if (!clip) excite = 0;
      return true;
    },
    state: () => ({ people: seats.length, draws: by.size, cast: cast.length, clips: clips.map((c) => c.name), excite: +excite.toFixed(3), playing }),
  };
}
