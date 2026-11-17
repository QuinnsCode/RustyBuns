// A person's character in 3D (#4987): the parts of @rustybuns/util/avatar (skin, hair, hat, eyes, mouth, glasses, top,
// colours, build) on a jointed figure with shoulders, elbows, knees, hands and a modelled face. It stands, walks, sits and
// plays (hands on keys, sticks or strings) from one `pose` call a frame. Feet at y 0, facing -z (as a three.js camera does),
// about 1.7 m tall. The seed only shifts the idle sway and the blinks, so two people in the same clothes don't move as one.
// No DOM: the face is geometry, not a canvas texture, so it builds anywhere (a test, a Worker writing a GLB).
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";

/** What the hands are on while playing: a keyboard or pads in front, drums, or a guitar's neck and strings. */
export type Play = "keys" | "sticks" | "strings";
export interface Pose {
  /** Seconds since the page opened. */
  t: number;
  /** Walking speed, m/s: 0 stands, about 1.4 is a stroll. */
  speed?: number;
  seated?: boolean;
  /** Playing, and on what; null or left out is hands free. */
  play?: Play | null;
}
export interface Character {
  group: THREE.Group;
  /** The head, for a name tag or a camera to follow; its world position moves as the figure sits and walks. */
  head: THREE.Object3D;
  /** Standing height to the top of the head, metres (hair and hats not counted). */
  height: number;
  /** How high a seat is for this figure: seated, its thighs sit on it with its feet flat on the floor. */
  seat: number;
  pose(p: Pose): void;
  dispose(): void;
}

const INK = "#16191c";
/** The hat colours the 2D figure draws (drawAvatar), so a hat is the same colour in both. */
const HAT: Record<string, string> = {
  cap: "#e8590c", beanie: "#3a6bd8", tophat: INK, hardhat: "#f4d03a", propeller: "#3a6bd8", wizard: "#4a3a8a", party: "#c23a6b",
  cone: "#e8590c", headphones: "#2e3439", crown: "#f4d03a", "rubber-duck": "#f4d03a", bucket: "#8a9a5c", halo: "#f4d03a",
};

export function character(a: Avatar, o: { seed?: number; material?: (color: string) => THREE.Material } = {}): Character {
  const rand = mulberry32(o.seed ?? 1), phase = rand() * 10, blinkEvery = 2.5 + rand() * 2.5;
  const mats = new Map<string, THREE.Material>();
  const mat = (c: string) => { let m = mats.get(c); if (!m) mats.set(c, m = o.material?.(c) ?? new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 })); return m; };
  const mesh = (g: THREE.BufferGeometry, c: string, at?: [number, number, number]) => { const m = new THREE.Mesh(g, mat(c)); if (at) m.position.set(...at); return m; };
  const node = (parent: THREE.Object3D, at: [number, number, number]) => { const n = new THREE.Object3D(); n.position.set(...at); parent.add(n); return n; };
  /** A capsule hanging down from its top, `len` long between the caps' centres. */
  const limb = (r: number, len: number, c: string, r2 = r) => {
    const g = r2 === r ? new THREE.CapsuleGeometry(r, len, 6, 12) : new THREE.CylinderGeometry(r, r2, len, 12);
    g.translate(0, -len / 2, 0);
    const m = mesh(g, c);
    if (r2 !== r) { m.add(mesh(new THREE.SphereGeometry(r, 12, 8), c)); m.add(mesh(new THREE.SphereGeometry(r2, 12, 8), c, [0, -len, 0])); }
    return m;
  };

  const tall = a.build === "tall" ? 1.1 : a.build === "short" ? 0.88 : 1, wide = a.build === "round" ? 1.3 : a.build === "slim" ? 0.86 : 1;
  const skin = a.skin, top = a.top === "suit" ? "#2e3439" : a.top === "labcoat" ? "#f4f5f5" : a.topColor, bottom = a.top === "overalls" ? "#3a6bd8" : a.bottomColor;
  const longSleeves = ["hoodie", "suit", "labcoat"].includes(a.top);

  // lengths (metres): legs, then the torso from the hips to the shoulders, then the head on its neck
  const thighL = 0.4 * tall, shinL = 0.38 * tall, ankleH = 0.07, hipY = thighL + shinL + ankleH;
  const torsoL = 0.48 * tall, headR = 0.125, neckL = 0.06;
  const height = hipY + torsoL + neckL + headR * 2.1;
  const shoulderX = 0.17 * wide, hipX = 0.085 * wide;

  const group = new THREE.Group();
  const hips = node(group, [0, hipY, 0]);
  hips.add(mesh(new THREE.SphereGeometry(0.15 * wide, 16, 12).scale(1, 0.62, 0.72), bottom, [0, 0.02, 0]));

  // the torso: a lathe from the waist out to the chest and in over the shoulders to the neck, flattened front to back
  const spine = node(hips, [0, 0.04, 0]);
  const profile = [[0.135, 0], [0.13, 0.12], [0.155, 0.27], [0.175, 0.38], [0.16, 0.44], [0.1, torsoL / tall], [0.05, torsoL / tall + 0.01]]
    .map(([r, y]) => new THREE.Vector2(r! * wide, y! * tall));
  const torso = mesh(new THREE.LatheGeometry(profile, 24).scale(1, 1, 0.68), top);
  spine.add(torso);
  if (a.top === "overalls") {
    torso.add(mesh(new THREE.BoxGeometry(0.2 * wide, 0.2 * tall, 0.02), "#3a6bd8", [0, 0.2 * tall, -0.118 * wide]));
    for (const s of [-1, 1]) { const strap = mesh(new THREE.BoxGeometry(0.03, 0.2 * tall, 0.015), "#3a6bd8", [s * 0.07 * wide, 0.36 * tall, -0.112 * wide]); torso.add(strap); }
  }
  if (a.top === "suit") {
    torso.add(mesh(new THREE.BoxGeometry(0.07, 0.3 * tall, 0.02), "#f4f5f5", [0, 0.31 * tall, -0.115 * wide]));
    torso.add(mesh(new THREE.BoxGeometry(0.03, 0.2 * tall, 0.012), "#e8590c", [0, 0.31 * tall, -0.128 * wide]));
  }
  if (a.top === "lanyard") {
    for (const s of [-1, 1]) { const cord = mesh(new THREE.BoxGeometry(0.012, 0.2 * tall, 0.01), "#e8590c", [s * 0.035, 0.36 * tall, -0.12 * wide]); cord.rotation.z = s * 0.25; torso.add(cord); }
    torso.add(mesh(new THREE.BoxGeometry(0.07, 0.09, 0.008), "#f4f5f5", [0, 0.24 * tall, -0.122 * wide]));
  }
  if (a.top === "hawaiian") for (const [x, y] of [[-0.07, 0.3], [0.05, 0.36], [-0.02, 0.18], [0.08, 0.22], [-0.09, 0.4]])
    torso.add(mesh(new THREE.SphereGeometry(0.018, 8, 6).scale(1, 1, 0.3), "#f4f5f5", [x! * wide, y! * tall, -0.112 * wide]));
  if (a.top === "dress") torso.add(mesh(new THREE.CylinderGeometry(0.14 * wide, 0.24 * wide, 0.42 * tall, 20, 1, true), a.topColor, [0, -0.17 * tall, 0]));
  if (a.top === "labcoat") torso.add(mesh(new THREE.CylinderGeometry(0.15 * wide, 0.19 * wide, 0.36 * tall, 20, 1, true), "#f4f5f5", [0, -0.12 * tall, 0.01]));
  if (a.top === "hoodie") { const hood = mesh(new THREE.TorusGeometry(0.075, 0.035, 8, 16), a.topColor, [0, torsoL - 0.02, 0.05]); hood.rotation.x = Math.PI / 2 - 0.4; spine.add(hood); }

  // neck and head
  const neck = node(spine, [0, torsoL, 0]);
  neck.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, neckL + 0.04, 12), skin, [0, neckL / 2, 0]));
  const head = node(neck, [0, neckL + headR * 0.95, 0]);
  head.add(mesh(new THREE.SphereGeometry(headR, 28, 20).scale(1, 1.08, 1.02), skin));
  head.add(mesh(new THREE.SphereGeometry(headR * 0.62, 16, 12).scale(1, 0.8, 0.9), skin, [0, -headR * 0.45, -headR * 0.22])); // jaw and cheeks
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(headR * 0.2, 10, 8).scale(0.5, 1, 0.8), skin, [s * headR * 0.98, -headR * 0.05, 0]));
  head.add(mesh(new THREE.SphereGeometry(headR * 0.13, 10, 8).scale(1, 0.9, 1.1), skin, [0, -headR * 0.15, -headR * 1.04]));
  const eyes = face(a, head, headR, mesh);

  hair(a, head, headR, mesh);
  hat(a, head, headR, mesh);

  // arms: shoulder, elbow, wrist; sleeves to the elbow on a tee, to the wrist on the long ones
  const upperL = 0.29 * tall, foreL = 0.26 * tall;
  const arms = [-1, 1].map((s) => {
    const shoulder = node(spine, [s * shoulderX, torsoL - 0.06, 0]);
    shoulder.add(mesh(new THREE.SphereGeometry(0.058 * Math.sqrt(wide), 12, 10), top));
    shoulder.add(limb(0.05 * Math.sqrt(wide), upperL - 0.05, top));
    const elbow = node(shoulder, [0, -upperL, 0]);
    elbow.add(limb(0.042, foreL - 0.04, longSleeves ? top : skin, 0.036));
    if (!longSleeves) elbow.add(mesh(new THREE.CylinderGeometry(0.055, 0.052, 0.04, 12), top, [0, 0.02, 0]));
    const wrist = node(elbow, [0, -foreL, 0]);
    wrist.add(mesh(new THREE.SphereGeometry(0.045, 12, 10).scale(0.8, 1.15, 0.55), skin, [0, -0.045, 0]));
    const thumb = mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), skin, [s * -0.02, -0.035, -0.022]);
    thumb.rotation.z = s * 0.5; wrist.add(thumb);
    return { shoulder, elbow, wrist, s };
  });

  // legs: hip, knee, ankle, and a shoe pointing forward
  const legs = [-1, 1].map((s) => {
    const hip = node(hips, [s * hipX, 0, 0]);
    hip.add(limb(0.072 * Math.sqrt(wide), thighL - 0.05, bottom, 0.058));
    const knee = node(hip, [0, -thighL, 0]);
    knee.add(limb(0.055, shinL - 0.05, bottom, 0.045));
    const ankle = node(knee, [0, -shinL, 0]);
    ankle.add(mesh(new THREE.SphereGeometry(0.06, 14, 10).scale(0.85, 0.55, 1.75), INK, [0, -ankleH + 0.032, -0.05]));
    return { hip, knee, ankle, s };
  });

  // the seated height: thighs level, shins straight down to the floor
  const seatY = shinL + ankleH;
  return {
    group, head, height, seat: seatY - 0.07,
    pose({ t, speed = 0, seated = false, play = null }) {
      const walk = seated ? 0 : Math.min(1, speed / 1.4), step = t * (5 + speed * 2.4), swing = Math.sin(step) * 0.55 * walk;
      const idle = Math.sin((t + phase) * 1.3);
      hips.position.y = seated ? seatY : hipY - Math.abs(Math.cos(step)) * 0.03 * walk + idle * 0.003 * (1 - walk);
      spine.rotation.x = seated ? -0.05 : 0.04 * walk + (play ? -0.06 : 0);
      torso.scale.set(1, 1, 1 + idle * 0.01);
      head.rotation.set(play ? 0.12 : 0, Math.sin((t + phase) * 0.4) * 0.12 * (1 - walk), Math.sin((t + phase) * 0.7) * 0.03);
      for (const l of legs) {
        const f = l.s > 0 ? swing : -swing;
        l.hip.rotation.set(seated ? Math.PI / 2 - 0.05 : f, 0, seated ? l.s * 0.06 : 0);
        l.knee.rotation.x = seated ? -(Math.PI / 2 - 0.05) : -Math.max(0, Math.sin(step + (l.s > 0 ? Math.PI : 0) + 1)) * 0.75 * walk;
        l.ankle.rotation.x = seated ? 0 : -l.hip.rotation.x - l.knee.rotation.x;
      }
      for (const arm of arms) armPose(arm, { t, walk, swing, seated, play, idle });
      // a blink every few seconds: the eyes squash for a tenth of a second
      const blink = ((t + phase) % blinkEvery) < 0.1 ? 0.15 : 1;
      for (const e of eyes) e.scale.y = blink;
    },
    dispose() {
      group.traverse((m) => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
      if (!o.material) for (const m of mats.values()) m.dispose();
    },
  };
}

type Arm = { shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; s: number };
/**
 * Where the arms go. Rotation x swings an arm forward, z out to its own side (`s`: -1 left, 1 right, as the figure stands).
 * Keys: forearms level, hands over the keys, fingers tapping in turn. Sticks: both hands up, striking down one after the
 * other. Strings: the left hand out on the neck, the right across the body strumming.
 */
function armPose({ shoulder, elbow, wrist, s }: Arm, p: { t: number; walk: number; swing: number; seated: boolean; play: Play | null; idle: number }) {
  const { t, play } = p;
  let sx: number, sz: number, ex: number, wx = 0;
  if (play === "keys") {
    const tap = Math.max(0, Math.sin(t * 11 + (s > 0 ? 0 : 1.9)));
    sx = 0.35; sz = -s * 0.12; ex = 1.15 - tap * 0.12; wx = -0.25 + tap * 0.25;
  } else if (play === "sticks") {
    const hit = Math.pow(Math.max(0, Math.sin(t * 9 + (s > 0 ? 0 : Math.PI))), 3);
    sx = 0.55 + (1 - hit) * 0.3; sz = s * 0.18; ex = 1.4 - hit * 0.6; wx = -0.4 + hit * 0.5;
  } else if (play === "strings") {
    if (s < 0) { sx = 0.75; sz = -0.35; ex = 0.9 + Math.sin(t * 2) * 0.05; wx = -0.3; }
    else { const strum = Math.sin(t * 12); sx = 0.2; sz = -0.4; ex = 1.05 + strum * 0.15; wx = strum * 0.25; }
  } else if (p.seated) { sx = 0.35; sz = s * 0.05; ex = 0.75; }
  else { sx = s > 0 ? -p.swing : p.swing; sz = s * (0.08 + p.idle * 0.01); ex = 0.15 + p.walk * 0.25; }
  shoulder.rotation.set(sx, 0, sz);
  elbow.rotation.x = ex;
  wrist.rotation.x = wx;
}

type Mesh = (g: THREE.BufferGeometry, c: string, at?: [number, number, number]) => THREE.Mesh;

/** A point on the front of the head at (x, y) in head radii: a holder there, facing out, to put a feature on. */
function onFace(head: THREE.Object3D, r: number, x: number, y: number) {
  const pivot = new THREE.Object3D();
  pivot.rotation.set(Math.asin(y), -Math.asin(x), 0);
  head.add(pivot);
  const spot = new THREE.Object3D();
  spot.position.z = -r * 1.04;
  pivot.add(spot);
  return spot;
}

/** Eyes, brows, mouth and glasses as geometry on the head. Returns the eyes, which blink. */
function face(a: Avatar, head: THREE.Object3D, r: number, mesh: Mesh): THREE.Object3D[] {
  const eyes: THREE.Object3D[] = [];
  const arc = (rad: number, tube: number, c: string, up: boolean, len = Math.PI) => {
    const m = mesh(new THREE.TorusGeometry(rad, tube, 6, 16, len), c);
    m.rotation.z = up ? (Math.PI - len) / 2 : Math.PI + (Math.PI - len) / 2;
    return m;
  };
  const line = (w: number, c = INK) => { const m = mesh(new THREE.CapsuleGeometry(0.005, w, 4, 6), c); m.rotation.z = Math.PI / 2; return m; };
  for (const s of [-1, 1]) {
    const spot = onFace(head, r, s * 0.32, 0.1), eye = new THREE.Object3D();
    spot.add(eye); eyes.push(eye);
    const kind = a.eyes === "wink" ? (s < 0 ? "dot" : "sleepy") : a.eyes;
    if (kind === "dot") eye.add(mesh(new THREE.SphereGeometry(0.014, 12, 10).scale(1, 1.25, 0.6), INK));
    else if (kind === "wide") { eye.add(mesh(new THREE.SphereGeometry(0.024, 14, 10).scale(1, 1.1, 0.5), "#f4f5f5")); eye.add(mesh(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 1, 0.5), INK, [0, 0, -0.01])); }
    else if (kind === "sleepy") eye.add(line(0.02));
    else if (kind === "happy") eye.add(arc(0.013, 0.004, INK, true));
    else {
      eye.add(mesh(new THREE.SphereGeometry(0.013, 12, 10).scale(1, 1.2, 0.6), INK));
      const brow = mesh(new THREE.BoxGeometry(0.035, 0.007, 0.006), INK, [0, 0.026, 0]);
      brow.rotation.z = s * -0.35; spot.add(brow);
    }
  }
  const mouth = onFace(head, r, 0, -0.38);
  if (a.mouth === "smile" || a.mouth === "tongue") mouth.add(arc(0.026, 0.005, INK, false, Math.PI * 0.75));
  if (a.mouth === "tongue") mouth.add(mesh(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 1, 0.5), "#e8590c", [0.008, -0.03, 0]));
  if (a.mouth === "grin") {
    mouth.add(mesh(new THREE.CircleGeometry(0.03, 16, Math.PI, Math.PI).rotateY(Math.PI), INK, [0, 0.004, 0.001]));
    mouth.add(mesh(new THREE.CircleGeometry(0.026, 16, Math.PI, Math.PI).rotateY(Math.PI), "#f4f5f5", [0, 0.002, -0.001]));
  }
  if (a.mouth === "flat") mouth.add(line(0.03));
  if (a.mouth === "o") mouth.add(mesh(new THREE.TorusGeometry(0.012, 0.005, 6, 16), INK));
  if (a.mouth === "frown") mouth.add(arc(0.024, 0.005, INK, true, Math.PI * 0.7)).position.y = -0.016;

  if (a.glasses !== "none") {
    const frame = a.glasses === "shades" ? INK : "#2e3439";
    const lens = (s: number) => onFace(head, r, s * 0.32, 0.1);
    const bridge = () => { const b = onFace(head, r, 0, 0.12); b.position.z -= 0.012; b.add(line(0.03, frame)); };
    if (a.glasses === "round") { for (const s of [-1, 1]) lens(s).add(mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 20), frame, [0, 0, -0.012])); bridge(); }
    if (a.glasses === "square") {
      for (const s of [-1, 1]) {
        const l = lens(s);
        for (const [x, y, w, h] of [[0, 0.025, 0.066, 0.006], [0, -0.025, 0.066, 0.006], [-0.03, 0, 0.006, 0.05], [0.03, 0, 0.006, 0.05]]) l.add(mesh(new THREE.BoxGeometry(w!, h!, 0.006), frame, [x!, y!, -0.012]));
      }
      bridge();
    }
    if (a.glasses === "shades") { for (const s of [-1, 1]) lens(s).add(mesh(new THREE.BoxGeometry(0.066, 0.042, 0.008), INK, [0, 0, -0.012])); bridge(); }
    if (a.glasses === "monocle") { const l = lens(1); l.add(mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 20), "#c9a227", [0, 0, -0.012])); const chain = mesh(new THREE.CapsuleGeometry(0.0025, 0.08, 4, 6), "#c9a227", [0.02, -0.06, -0.01]); chain.rotation.z = 0.3; l.add(chain); }
    if (a.glasses === "vr") { const v = onFace(head, r, 0, 0.1); v.add(mesh(new THREE.BoxGeometry(0.2, 0.075, 0.07), "#2e3439", [0, 0, -0.01])); v.add(mesh(new THREE.BoxGeometry(0.17, 0.014, 0.01), "#8a5cff", [0, 0, -0.048])); }
    if (a.glasses === "pixel") for (const s of [-1, 1]) { const l = lens(s); for (const [x, y, w] of [[0, 0.012, 0.06], [-0.006, 0, 0.048], [-0.01, -0.012, 0.036]]) l.add(mesh(new THREE.BoxGeometry(w!, 0.012, 0.008), INK, [x!, y!, -0.012])); }
  }
  return eyes;
}

/** A shell over the top and back of the head, open at the face: `down` is how far it comes (radians from the crown). */
const shell = (r: number, down: number, open = Math.PI * 0.62) =>
  new THREE.SphereGeometry(r, 24, 14, Math.PI * 1.5 + open / 2, Math.PI * 2 - open, 0, down);

function hair(a: Avatar, head: THREE.Object3D, r: number, mesh: Mesh) {
  if (a.hair === "none") return;
  const c = a.hairColor, R = r * 1.06;
  const add = (g: THREE.BufferGeometry, at: [number, number, number], rot?: [number, number, number]) => { const m = mesh(g, c, at); if (rot) m.rotation.set(...rot); head.add(m); return m; };
  const ball = (rad: number, at: [number, number, number]) => add(new THREE.SphereGeometry(rad, 12, 10), at);
  // the cap every style starts from: a fringe over the brow at the front, down to the nape at the back
  const cap = (down = 1.55) => { add(new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, 1.15), [0, 0.01, 0]); add(shell(R, down), [0, 0.01, 0]); };
  switch (a.hair) {
    case "buzz": add(new THREE.SphereGeometry(r * 1.02, 24, 14, 0, Math.PI * 2, 0, 1.3), [0, 0, 0.005]); break;
    case "short": cap(); break;
    case "bob": cap(2.05); break;
    case "long": cap(2.1); add(new THREE.CapsuleGeometry(r * 0.75, r * 1.6, 6, 12).scale(1.15, 1, 0.45), [0, -r * 1.2, r * 0.6]); break;
    case "mullet": cap(1.7); add(new THREE.CapsuleGeometry(r * 0.6, r * 0.9, 6, 12).scale(1.2, 1, 0.45), [0, -r * 1.05, r * 0.7]); break;
    case "spiky": cap(1.4); for (let i = 0; i < 7; i++) { const a2 = (i / 7) * Math.PI * 2; add(new THREE.ConeGeometry(r * 0.22, r * 0.6, 8), [Math.cos(a2) * r * 0.55, r * 0.95, Math.sin(a2) * r * 0.55 + r * 0.1], [Math.sin(a2) * 0.6, 0, -Math.cos(a2) * 0.6]); } break;
    // a big round ring of hair around the face, open at the front, with a crown over the top: never over the eyes
    case "afro": for (const [k, flip] of [[1.45, 1], [1.3, -1]] as const) { // the outside, then the inside turned to face in (x mirrored flips the winding)
      add(new THREE.SphereGeometry(r * k, 24, 8, 0, Math.PI * 2, 0, 0.95).scale(flip, 1, 1), [0, r * 0.3, r * 0.2]);
      add(shell(r * k, 2.2, Math.PI * 0.72).scale(flip, 1, 1), [0, r * 0.3, r * 0.2]);
    } break;
    case "curly": cap(1.6); for (let i = 0; i < 12; i++) { const a2 = (i / 12) * Math.PI * 2; ball(r * 0.3, [Math.cos(a2) * R * 0.95, r * 0.35 + Math.sin(a2 * 3) * r * 0.1, Math.sin(a2) * R * 0.95 + r * 0.08]); } break;
    case "mohawk": add(new THREE.SphereGeometry(r * 1.02, 24, 14, 0, Math.PI * 2, 0, 1.2), [0, 0, 0]); add(new THREE.BoxGeometry(r * 0.22, r * 0.6, r * 1.8), [0, r * 1.05, r * 0.15]); break;
    case "flat-top": cap(1.35); add(new THREE.CylinderGeometry(r * 0.95, r * 0.95, r * 0.55, 20), [0, r * 0.95, r * 0.05]); break;
    case "pompadour": cap(1.45); add(new THREE.SphereGeometry(r * 0.75, 16, 12).scale(1.2, 0.7, 1.1), [0, r * 0.95, -r * 0.35]); break;
    case "bun": cap(); ball(r * 0.42, [0, r * 1.05, r * 0.45]); break;
    case "topknot": cap(); add(new THREE.CylinderGeometry(r * 0.16, r * 0.2, r * 0.4, 10), [0, r * 1.2, 0]); ball(r * 0.3, [0, r * 1.5, 0]); break;
    case "space-buns": cap(); for (const s of [-1, 1]) ball(r * 0.4, [s * r * 0.7, r * 0.95, r * 0.1]); break;
    case "ponytail": cap(); { const tail = add(new THREE.CapsuleGeometry(r * 0.22, r * 1.4, 6, 10), [0, -r * 0.35, r * 1.25]); tail.rotation.x = -0.45; } break;
    case "pigtails": cap(); for (const s of [-1, 1]) { const tail = add(new THREE.CapsuleGeometry(r * 0.2, r * 1.1, 6, 10), [s * r * 1.15, -r * 0.55, r * 0.2]); tail.rotation.z = s * 0.25; } break;
    case "braids": cap(1.9); for (const s of [-1, 1]) for (let j = 0; j < 6; j++) ball(r * 0.17, [s * r * 0.9, -r * (0.4 + j * 0.28), r * 0.3]); break;
    case "locs": cap(1.7); for (let i = 0; i < 11; i++) { const a2 = Math.PI * (0.05 + (i / 10) * 0.9); add(new THREE.CapsuleGeometry(r * 0.08, r * 1.5, 4, 6), [Math.cos(a2) * R, -r * 0.6, Math.sin(a2) * R * 0.95]); } break;
    default: cap();
  }
}

function hat(a: Avatar, head: THREE.Object3D, r: number, mesh: Mesh) {
  if (a.hat === "none") return;
  const c = HAT[a.hat] ?? a.topColor, crown = r * 1.02;
  const add = (g: THREE.BufferGeometry, at: [number, number, number], color = c) => { const m = mesh(g, color, at); head.add(m); return m; };
  const dome = (down = 1.35, s = 1.12) => add(new THREE.SphereGeometry(r * s, 24, 12, 0, Math.PI * 2, 0, down), [0, r * 0.05, 0]);
  switch (a.hat) {
    case "cap": dome(1.4); add(new THREE.CylinderGeometry(r * 0.75, r * 0.75, 0.01, 20, 1, false, Math.PI * 0.5, Math.PI).scale(1, 1, 1.2), [0, r * 0.38, -r * 0.65], c); break;
    case "beanie": dome(1.45, 1.14); add(new THREE.SphereGeometry(r * 0.25, 10, 8), [0, r * 1.25, 0], "#f4f5f5"); break;
    case "hardhat": dome(1.4, 1.15); add(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.012, 24), [0, r * 0.32, -r * 0.05]); break;
    case "bucket": add(new THREE.CylinderGeometry(r * 0.85, r * 1.05, r * 0.7, 20), [0, crown * 0.8, 0]); add(new THREE.CylinderGeometry(r * 1.5, r * 1.5, 0.01, 24), [0, crown * 0.45, 0]); break;
    case "tophat": add(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.012, 24), [0, crown * 0.85, 0]); add(new THREE.CylinderGeometry(r * 0.75, r * 0.75, r * 1.5, 24), [0, crown * 1.6, 0]); add(new THREE.CylinderGeometry(r * 0.77, r * 0.77, r * 0.25, 24), [0, crown * 1.0, 0], "#c23a6b"); break;
    case "wizard": add(new THREE.ConeGeometry(r * 0.95, r * 2.6, 20), [0, crown * 2.0, 0]).rotation.z = 0.12; add(new THREE.CylinderGeometry(r * 1.55, r * 1.55, 0.012, 24), [0, crown * 0.75, 0]); add(new THREE.SphereGeometry(r * 0.12, 8, 6), [0, crown * 1.6, -r * 0.6], "#f4d03a"); break;
    case "party": add(new THREE.ConeGeometry(r * 0.5, r * 1.6, 16), [r * 0.15, crown * 1.6, 0]); add(new THREE.SphereGeometry(r * 0.16, 10, 8), [r * 0.15, crown * 2.4, 0], "#f4d03a"); break;
    case "cone": add(new THREE.BoxGeometry(r * 1.9, 0.02, r * 1.9), [0, crown * 0.8, 0]); add(new THREE.ConeGeometry(r * 0.75, r * 1.9, 20), [0, crown * 1.7, 0]); add(new THREE.CylinderGeometry(r * 0.5, r * 0.6, r * 0.3, 20, 1, true), [0, crown * 1.55, 0], "#f4f5f5"); break;
    case "crown": add(new THREE.CylinderGeometry(r * 0.85, r * 0.85, r * 0.35, 20, 1, true), [0, crown * 1.0, 0]); { for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2; add(new THREE.ConeGeometry(r * 0.15, r * 0.35, 8), [Math.cos(a2) * r * 0.85, crown * 1.3, Math.sin(a2) * r * 0.85]); } break; }
    case "halo": add(new THREE.TorusGeometry(r * 0.75, r * 0.07, 8, 28), [0, crown * 1.45, 0]).rotation.x = Math.PI / 2; break;
    case "cat-ears": for (const s of [-1, 1]) { const ear = add(new THREE.ConeGeometry(r * 0.32, r * 0.55, 4), [s * r * 0.62, crown * 0.95, 0], a.hairColor); ear.rotation.z = -s * 0.35; } break;
    case "propeller": dome(1.4); add(new THREE.CylinderGeometry(0.006, 0.006, r * 0.35, 6), [0, crown * 1.25, 0], INK); for (const s of [0, Math.PI / 2]) add(new THREE.BoxGeometry(r * 1.2, 0.006, r * 0.18), [0, crown * 1.42, 0], "#e8590c").rotation.y = s; break;
    case "headphones": { add(new THREE.TorusGeometry(r * 1.1, r * 0.08, 8, 24, Math.PI), [0, r * 0.05, 0]); for (const s of [-1, 1]) add(new THREE.CylinderGeometry(r * 0.32, r * 0.32, r * 0.22, 16), [s * r * 1.08, 0, 0], INK).rotation.z = Math.PI / 2; break; }
    case "rubber-duck": add(new THREE.SphereGeometry(r * 0.5, 14, 10).scale(1.2, 0.8, 1), [0, crown * 1.15, r * 0.1]); add(new THREE.SphereGeometry(r * 0.33, 12, 10), [0, crown * 1.6, -r * 0.2]); add(new THREE.ConeGeometry(r * 0.12, r * 0.3, 8), [0, crown * 1.58, -r * 0.6], "#e8590c").rotation.x = -Math.PI / 2; break;
  }
}
