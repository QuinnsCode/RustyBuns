// A person's character in 3D (#4987, #5009): a cute, chunky toy of a person. A bean of a body, stubby limbs with chunky
// hands, and a big round head (about two fifths of its height) so a face reads from across the room. It wears every part
// of @rustybuns/util/avatar: skin, hair, hat, glasses, clothes and build, and the face maker's face shape, eyes, brows,
// nose, mouth, cheeks and facial hair, each moved and sized by its sliders. It stands, walks, sits and plays (hands on
// keys, sticks or strings) from one `pose` call a frame, and it is alive while it does: it blinks, turns its head to look
// at whoever you point it at, nods to the beat, and beams while you play a note.
// Hands have a thumb and four stubby fingers that curl as they play, glasses have arms back to the ears, and a hat
// tucks a tall style (spikes, a crest, a bun) under it. Feet at y 0, facing -z (as a three.js camera does), about 1.25 m tall. The seed only shifts the idle sway and the blinks,
// so two people in the same clothes don't move as one. No DOM: the face is geometry, so it builds anywhere (a test, a
// Worker writing a GLB).
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
  /** A point in the world to look at (whoever is talking or playing); the head turns to it, as far as a neck goes. */
  look?: { x: number; y: number; z: number } | null;
  /** Beats since the song started: the head nods on each one. Null or left out: no song, no nod. */
  beat?: number | null;
  /** A note is sounding under this person's hands: a happy face that fades a moment after it stops. */
  note?: boolean;
}
export interface Character {
  group: THREE.Group;
  /** The head, for a name tag or a camera to follow; its world position moves as the figure sits and walks. */
  head: THREE.Object3D;
  /** Standing height to the top of the head, metres (hair and hats not counted). */
  height: number;
  /** How high a seat is for this figure: seated, it sits on it with its feet on the floor. */
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
/** A slider's step (-3..3) as a multiplier: `per` more or less for each step. */
const step = (v: number, per: number) => 1 + v * per;
const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;

/** The head's shape: a direction from its centre to the point on its surface (in head radii). */
type Shape = (d: THREE.Vector3) => THREE.Vector3;
function shapeOf(face: string): Shape {
  const scale = face === "oval" ? [0.93, 1.05, 0.96] : face === "long" ? [0.87, 1.14, 0.94] : face === "square" ? [1.0, 0.96, 0.97] : face === "heart" ? [1.06, 1.0, 0.98] : [1.05, 0.96, 1.0];
  return (d) => {
    const p = d.clone().normalize();
    if (face === "square") { const n = 3.4; p.divideScalar(Math.pow(Math.abs(p.x) ** n + Math.abs(p.y) ** n + Math.abs(p.z) ** n, 1 / n)); }
    // a heart: full at the brow, tucked in to a small chin
    if (face === "heart") p.x *= 0.8 + 0.2 * Math.min(1, (p.y + 1) / 1.3);
    // every face has cheeks: a little fullness low on the front
    const cheek = Math.max(0, -p.z) * Math.max(0, 0.6 - Math.abs(p.y + 0.25)) * 0.12;
    return p.set(p.x * scale[0]! * (1 + cheek), p.y * scale[1]!, p.z * scale[2]! * (1 + cheek * 0.5));
  };
}

export function character(a: Avatar, o: { seed?: number; material?: (color: string) => THREE.Material } = {}): Character {
  const rand = mulberry32(o.seed ?? 1), phase = rand() * 10, blinkEvery = 2.5 + rand() * 2.5;
  const mats = new Map<string, THREE.Material>();
  const mat = (c: string) => { let m = mats.get(c); if (!m) mats.set(c, m = o.material?.(c) ?? new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })); return m; };
  const mesh: Mesh = (g, c, at) => { const m = new THREE.Mesh(g, mat(c)); if (at) m.position.set(...at); return m; };
  const node = (parent: THREE.Object3D, at: [number, number, number], name = "") => { const n = new THREE.Object3D(); n.position.set(...at); n.name = name; parent.add(n); return n; };
  /** A capsule hanging down from its top, `len` long between the caps' centres. */
  const limb = (r: number, len: number, c: string) => { const g = new THREE.CapsuleGeometry(r, len, 6, 14); g.translate(0, -len / 2, 0); return mesh(g, c); };

  // `height` stretches the legs and the body, never the head: a tall person is still a toy, with the same big face
  const tall = (a.build === "tall" ? 1.12 : a.build === "short" ? 0.86 : 1) * step(a.height ?? 0, 0.05);
  const wide = a.build === "round" ? 1.28 : a.build === "slim" ? 0.86 : 1;
  const skin = a.skin, top = a.top === "suit" ? "#2e3439" : a.top === "labcoat" ? "#f4f5f5" : a.topColor, bottom = a.top === "overalls" ? "#3a6bd8" : a.bottomColor;
  const longSleeves = ["hoodie", "suit", "labcoat"].includes(a.top);

  // lengths (metres): stubby legs, a bean of a body, and a big head on no neck to speak of
  const thighL = 0.13 * tall, shinL = 0.12 * tall, ankleH = 0.07, hipY = thighL + shinL + ankleH;
  const bodyL = 0.44 * tall, headR = 0.25;
  const shape = shapeOf(a.face ?? "round"), crown = shape(new THREE.Vector3(0, 1, 0)).y, chin = -shape(new THREE.Vector3(0, -1, 0)).y;
  const headY = bodyL + headR * chin * 0.82;
  const height = hipY + headY + headR * crown;
  const shoulderX = 0.2 * wide + 0.035, hipX = 0.1 * wide;

  const group = new THREE.Group();
  const hips = node(group, [0, hipY, 0]);
  // the bean: trousers below the waist, the top over them with a hem; its outline, as radius at height (metres, before `wide`)
  const outline: [number, number][] = [[0, -0.085], [0.11, -0.075], [0.18, -0.04], [0.21, 0.02], [0.215, 0.1], [0.21, 0.2], [0.195, 0.29], [0.165, 0.36], [0.12, 0.41], [0.06, 0.44], [0, 0.45]];
  const lathe = (from: number, to: number, grow: number, c: string, depth = 0.84) => {
    const pts = outline.filter(([, y]) => y >= from && y <= to).map(([r, y]) => new THREE.Vector2(r * wide * grow, y * tall));
    return mesh(new THREE.LatheGeometry(pts, 32).scale(1, 1, depth), c);
  };
  /** A point on the front of the body at (x, y), in metres off the hips, `out` past the surface: for a badge or a button. */
  const front = (x: number, y: number, out = 0.005): [number, number, number] => {
    const k = y / tall, i = Math.max(1, outline.findIndex(([, oy]) => oy >= k)), [r0, y0] = outline[i - 1]!, [r1, y1] = outline[i]!;
    const r = (r0 + (r1 - r0) * ((k - y0) / Math.max(1e-6, y1 - y0))) * wide * 1.02;
    return [x, y, -Math.sqrt(Math.max(0, r * r - x * x)) * 0.84 - out];
  };
  const spine = node(hips, [0, 0, 0], "spine");
  const seatOut = lathe(-1, 0.1, 1, bottom);
  spine.add(seatOut);
  const shirt = lathe(0.02, 1, 1.02, top);
  spine.add(shirt);
  if (a.top === "overalls") {
    shirt.add(mesh(new THREE.BoxGeometry(0.2 * wide, 0.14 * tall, 0.02), "#3a6bd8", front(0, 0.16 * tall)));
    for (const s of [-1, 1]) shirt.add(mesh(new THREE.BoxGeometry(0.035, 0.16 * tall, 0.015), "#3a6bd8", front(s * 0.075 * wide, 0.3 * tall)));
    for (const s of [-1, 1]) shirt.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), "#f4d03a", front(s * 0.075 * wide, 0.22 * tall, 0.015)));
  }
  if (a.top === "suit") {
    shirt.add(mesh(new THREE.BoxGeometry(0.09, 0.2 * tall, 0.02), "#f4f5f5", front(0, 0.3 * tall)));
    shirt.add(mesh(new THREE.BoxGeometry(0.035, 0.16 * tall, 0.015), "#e8590c", front(0, 0.29 * tall, 0.015)));
  }
  if (a.top === "lanyard") {
    for (const s of [-1, 1]) { const cord = mesh(new THREE.BoxGeometry(0.014, 0.16 * tall, 0.01), "#e8590c", front(s * 0.04, 0.32 * tall)); cord.rotation.z = s * 0.25; shirt.add(cord); }
    shirt.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.01), "#f4f5f5", front(0, 0.21 * tall, 0.01)));
  }
  if (a.top === "hawaiian") for (const [x, y] of [[-0.09, 0.3], [0.06, 0.34], [-0.03, 0.18], [0.1, 0.2], [-0.12, 0.12], [0.02, 0.08]])
    shirt.add(mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(1, 1, 0.3), "#f4f5f5", front(x! * wide, y! * tall)));
  if (a.top === "hoodie") {
    const hood = mesh(new THREE.TorusGeometry(0.11 * wide, 0.045, 8, 20), a.topColor, [0, bodyL - 0.03, 0.06]); hood.rotation.x = Math.PI / 2 - 0.5; spine.add(hood);
    shirt.add(mesh(new THREE.BoxGeometry(0.2 * wide, 0.07, 0.02), mix(a.topColor, INK, 0.15), front(0, 0.1 * tall)));
  }
  if (a.top === "dress") spine.add(mesh(new THREE.CylinderGeometry(0.205 * wide, 0.27 * wide, 0.2 * tall, 28, 1, true).scale(1, 1, 0.88), a.topColor, [0, -0.04 * tall, 0]));
  if (a.top === "labcoat") spine.add(mesh(new THREE.CylinderGeometry(0.215 * wide, 0.235 * wide, 0.16 * tall, 28, 1, true).scale(1, 1, 0.86), "#f4f5f5", [0, -0.01 * tall, 0.005]));

  // the head, on a neck node that turns it to look and nods it to the beat
  const neck = node(spine, [0, bodyL - 0.02, 0], "neck");
  const head = node(neck, [0, headY - bodyL + 0.02, 0], "head");
  const skull = new THREE.SphereGeometry(headR, 44, 30), sp = skull.attributes.position!, v = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) { v.fromBufferAttribute(sp, i); const p = shape(v).multiplyScalar(headR); sp.setXYZ(i, p.x, p.y, p.z); }
  skull.computeVertexNormals();
  head.add(mesh(skull, skin));
  for (const s of [-1, 1]) { const ear = shape(new THREE.Vector3(s, 0.02, 0.05)).multiplyScalar(headR * 0.97); head.add(mesh(new THREE.SphereGeometry(headR * 0.17, 12, 10).scale(0.5, 0.85, 0.75), skin, [ear.x, ear.y, ear.z])); }
  const f = face(a, head, headR, shape, mesh);

  const dressed = new THREE.Group();
  head.add(dressed);
  hair(a, dressed, headR, mesh);
  hat(a, dressed, headR, mesh);
  // hair caps and hat domes take the head's shape; the rest (buns, brims, crowns) just move with it
  const base = shape(new THREE.Vector3(1, 0, 0)).x, up = crown, deep = -shape(new THREE.Vector3(0, 0, -1)).z;
  dressed.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    if (m.userData.fit) {
      const g = m.geometry, gp = g.attributes.position!, w = new THREE.Vector3();
      for (let i = 0; i < gp.count; i++) {
        w.fromBufferAttribute(gp, i).add(m.position);
        const len = w.length(), p = shape(w).multiplyScalar(len).sub(m.position);
        gp.setXYZ(i, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
    } else if (m.parent === dressed) m.position.set(m.position.x * base, m.position.y * (m.position.y > 0 ? up : 1), m.position.z * deep);
  });

  // arms: shoulder, elbow, wrist, and a round mitten hand; sleeves to the elbow on a tee, to the wrist on the long ones
  const upperL = 0.15 * tall, foreL = 0.13 * tall;
  const arms = [-1, 1].map((s) => {
    const shoulder = node(spine, [s * shoulderX, bodyL * 0.78, 0]);
    shoulder.add(mesh(new THREE.SphereGeometry(0.068 * Math.sqrt(wide), 14, 10), top));
    shoulder.add(limb(0.062 * Math.sqrt(wide), upperL, top));
    const elbow = node(shoulder, [0, -upperL, 0]);
    elbow.add(limb(0.055, foreL, longSleeves ? top : skin));
    if (!longSleeves) elbow.add(mesh(new THREE.CylinderGeometry(0.066 * Math.sqrt(wide), 0.064, 0.05, 14), top, [0, 0.035, 0]));
    // a chunky toy hand: a round palm, a thumb, and four stubby fingers that each curl from a knuckle
    const wrist = node(elbow, [0, -foreL, 0]);
    const hand = mesh(new THREE.SphereGeometry(0.056, 14, 10).scale(0.78, 0.92, 0.95), skin, [0, -0.045, 0]); hand.name = "hand";
    wrist.add(hand);
    const thumb = node(wrist, [s * -0.03, -0.035, -0.035]);
    thumb.add(limb(0.017, 0.022, skin)).rotation.set(-0.5, 0, s * 0.35);
    const fingers = [-0.03, -0.01, 0.01, 0.03].map((z, i) => {
      const knuckle = node(wrist, [s * 0.004, -0.083 + Math.abs(z) * 0.25, z], "finger");
      knuckle.add(limb(0.0145, 0.024 - (i === 3 ? 0.006 : 0), skin));
      return knuckle;
    });
    return { shoulder, elbow, wrist, fingers, s };
  });

  // legs: hip, knee, ankle, and a round shoe pointing forward
  const legs = [-1, 1].map((s) => {
    const hip = node(hips, [s * hipX, 0, 0]);
    hip.add(limb(0.08 * Math.sqrt(wide), thighL, bottom));
    const knee = node(hip, [0, -thighL, 0]);
    knee.add(limb(0.072, shinL, bottom));
    const ankle = node(knee, [0, -shinL, 0]);
    const shoe = mesh(new THREE.SphereGeometry(0.085, 16, 12).scale(0.95, 0.6, 1.4), INK, [0, -ankleH + 0.05, -0.04]); shoe.name = "foot";
    ankle.add(shoe);
    return { hip, knee, ankle, s };
  });

  // the seated height: thighs level, shins straight down to the floor, the bottom of the bean on the seat
  const seatY = shinL + ankleH;
  let last = -1, yaw = 0, pitch = 0, joy = 0;
  const target = new THREE.Vector3();
  return {
    group, head, height, seat: seatY - 0.085,
    pose({ t, speed = 0, seated = false, play = null, look = null, beat = null, note = false }) {
      const dt = last < 0 ? 1 : Math.min(0.25, Math.max(0, t - last)); last = t;
      const walk = seated ? 0 : Math.min(1, speed / 1.4), stride = t * (6 + speed * 3), swing = Math.sin(stride) * 0.6 * walk;
      const idle = Math.sin((t + phase) * 1.3);
      const nod = beat == null ? 0 : Math.pow(Math.max(0, Math.sin(beat * Math.PI * 2)), 2);
      hips.position.y = (seated ? seatY : hipY - Math.abs(Math.cos(stride)) * 0.03 * walk + idle * 0.004 * (1 - walk)) - nod * 0.012;
      spine.rotation.x = seated ? -0.04 : 0.05 * walk + (play ? -0.05 : 0);
      spine.rotation.z = Math.sin(stride) * 0.05 * walk;
      shirt.scale.set(1, 1, 1 + idle * 0.012);
      // look: turn the neck toward the point, as far as a neck goes, easing there rather than snapping
      let wantYaw = Math.sin((t + phase) * 0.4) * 0.12 * (1 - walk), wantPitch = play ? -0.12 : 0;
      if (look) {
        group.updateWorldMatrix(true, false);
        group.worldToLocal(target.set(look.x, look.y, look.z)).sub(new THREE.Vector3(0, hips.position.y + headY, 0));
        wantYaw = THREE.MathUtils.clamp(Math.atan2(-target.x, -target.z), -1.1, 1.1);
        wantPitch = THREE.MathUtils.clamp(Math.atan2(target.y, Math.hypot(target.x, target.z)), -0.45, 0.4);
      }
      const ease = 1 - Math.exp(-dt * 7);
      yaw += (wantYaw - yaw) * ease; pitch += (wantPitch - pitch) * ease;
      neck.rotation.set(-pitch * 0.4 - nod * 0.1, yaw * 0.35, 0);
      head.rotation.set(-pitch * 0.6 - nod * 0.14, yaw * 0.65, Math.sin((t + phase) * 0.7) * 0.04);
      for (const l of legs) {
        const k = l.s > 0 ? swing : -swing;
        l.hip.rotation.set(seated ? Math.PI / 2 - 0.05 : k, 0, seated ? l.s * 0.12 : 0);
        l.knee.rotation.x = seated ? -(Math.PI / 2 - 0.05) : -Math.max(0, Math.sin(stride + (l.s > 0 ? Math.PI : 0) + 1)) * 0.8 * walk;
        l.ankle.rotation.x = seated ? 0 : -l.hip.rotation.x - l.knee.rotation.x;
      }
      for (const arm of arms) armPose(arm, { t, walk, swing, seated, play, idle });
      // a happy face while a note sounds, fading out a moment after; a blink every few seconds (never mid-smile)
      joy = note ? Math.min(1, joy + dt * 14) : Math.max(0, joy - dt * 2.2);
      f.joy(joy > 0.3);
      f.blink(joy <= 0.3 && ((t + phase) % blinkEvery) < 0.11);
      f.glance(THREE.MathUtils.clamp((wantYaw - yaw) * 0.5 + (look ? wantYaw * 0.15 : 0), -0.4, 0.4));
    },
    dispose() {
      group.traverse((m) => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
      if (!o.material) for (const m of mats.values()) m.dispose();
    },
  };
}

type Arm = { shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; fingers: THREE.Object3D[]; s: number };
/**
 * Where the arms go. Rotation x swings an arm forward, z out to its own side (`s`: -1 left, 1 right, as the figure stands).
 * The arms are short and the belly is round, so a resting arm hangs out at an angle and a playing one reaches well forward.
 * Keys: forearms level, hands over the keys, tapping in turn. Sticks: both hands up, striking down one after the other.
 * Strings: the left hand out on the neck, the right across the body strumming.
 */
function armPose({ shoulder, elbow, wrist, fingers, s }: Arm, p: { t: number; walk: number; swing: number; seated: boolean; play: Play | null; idle: number }) {
  const { t, play } = p;
  let sx: number, sz: number, ex: number, wx = 0;
  if (play === "keys") {
    const tap = Math.max(0, Math.sin(t * 11 + (s > 0 ? 0 : 1.9)));
    sx = 0.95; sz = s * 0.1; ex = 0.75 - tap * 0.15; wx = -0.3 + tap * 0.3;
  } else if (play === "sticks") {
    const hit = Math.pow(Math.max(0, Math.sin(t * 9 + (s > 0 ? 0 : Math.PI))), 3);
    sx = 0.9 + (1 - hit) * 0.45; sz = s * 0.3; ex = 0.9 - hit * 0.6; wx = -0.4 + hit * 0.5;
  } else if (play === "strings") {
    if (s < 0) { sx = 0.75; sz = -0.75; ex = 0.55 + Math.sin(t * 2) * 0.05; wx = -0.3; }
    else { const strum = Math.sin(t * 12); sx = 0.55; sz = -0.45; ex = 1.05 + strum * 0.18; wx = strum * 0.25; }
  } else if (p.seated) { sx = 0.7; sz = s * 0.22; ex = 0.5; }
  else { sx = s > 0 ? -p.swing : p.swing; sz = s * (0.3 + p.idle * 0.015); ex = 0.2 + p.walk * 0.3; }
  shoulder.rotation.set(sx, 0, sz);
  elbow.rotation.x = ex;
  wrist.rotation.x = wx;
  // fingers: a little curl at rest, one after another on keys, a fist round sticks, and the fretting and strumming hands
  fingers.forEach((f, i) => {
    const curl = play === "keys" ? 0.25 + Math.max(0, Math.sin(t * 13 + i * 1.4 + (s > 0 ? 0 : 2.1))) * 0.8
      : play === "sticks" ? 1.5 : play === "strings" ? (s < 0 ? 0.9 + (i % 2) * 0.3 : 1.2) : 0.3 + i * 0.05;
    f.rotation.z = -s * curl;
  });
}

type Mesh = (g: THREE.BufferGeometry, c: string, at?: [number, number, number]) => THREE.Mesh;

/** A holder on the face at (x, y) (the direction's sideways and upward parts, in head radii), facing out of the head. */
function onFace(head: THREE.Object3D, r: number, shape: Shape, x: number, y: number, out = 0.004) {
  const dir = (dx: number, dy: number) => new THREE.Vector3(dx, dy, -Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy)));
  const p = shape(dir(x, y)), e = 0.01;
  const n = shape(dir(x + e, y)).sub(p).cross(shape(dir(x, y + e)).sub(p)).normalize();
  if (n.z > 0) n.negate();
  const spot = new THREE.Object3D();
  spot.position.copy(p.multiplyScalar(r).addScaledVector(n, out));
  spot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), n);
  head.add(spot);
  return spot;
}

/**
 * The face as geometry on the head: eyes, brows, nose, mouth, cheeks, facial hair and glasses, each placed and sized by its
 * sliders. Two sets of eyes and mouth: the chosen ones, and a beaming pair for while a note sounds.
 */
function face(a: Avatar, head: THREE.Object3D, r: number, shape: Shape, mesh: Mesh) {
  const u = r / 0.125; // the first figure's face was drawn on a 0.125 m head: its sizes, times this
  const tune = (k: "eyeSize" | "eyeGap" | "eyeHeight" | "browHeight" | "noseSize" | "mouthSize" | "mouthHeight") => a[k] ?? 0;
  const eyeK = step(tune("eyeSize"), 0.13), eyeX = 0.33 + tune("eyeGap") * 0.04, eyeY = -0.01 + tune("eyeHeight") * 0.045;
  const mouthY = -0.37 + tune("mouthHeight") * 0.045, mouthK = step(tune("mouthSize"), 0.14), noseY = (eyeY + mouthY) / 2 - 0.03;
  const at = (x: number, y: number, out?: number) => onFace(head, r, shape, x, y, out);
  const arc = (rad: number, tube: number, c: string, up: boolean, len = Math.PI) => {
    const m = mesh(new THREE.TorusGeometry(rad, tube, 8, 20, len), c);
    m.rotation.z = up ? (Math.PI - len) / 2 : Math.PI + (Math.PI - len) / 2;
    return m;
  };
  const line = (w: number, c = INK, thick = 0.005 * u) => { const m = mesh(new THREE.CapsuleGeometry(thick, w, 4, 8), c); m.rotation.z = Math.PI / 2; return m; };
  const shine = (rad: number) => mesh(new THREE.SphereGeometry(rad, 8, 6), "#ffffff", [rad * 1.2, rad * 1.6, -rad * 1.4]);

  // eyes: big and glossy by default, each with a pupil that glances; the happy pair is closed in a smile
  const eyes: THREE.Object3D[] = [], pupils: THREE.Object3D[] = [], joyEyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const spot = at(s * eyeX, eyeY), eye = new THREE.Object3D(), joyEye = new THREE.Object3D();
    eye.name = "eye"; eye.scale.setScalar(eyeK); joyEye.scale.setScalar(eyeK);
    spot.add(eye, joyEye); eyes.push(eye); joyEyes.push(joyEye);
    joyEye.add(arc(0.016 * u, 0.0055 * u, INK, true)).position.y = -0.004 * u;
    const kind = a.eyes === "wink" ? (s < 0 ? "dot" : "happy") : a.eyes;
    const pupil = new THREE.Object3D(); eye.add(pupil); pupils.push(pupil);
    if (kind === "dot" || kind === "angry") { pupil.add(mesh(new THREE.SphereGeometry(0.019 * u, 16, 12).scale(0.85, 1.12, 0.5), INK)); pupil.add(shine(0.0055 * u)); }
    else if (kind === "wide") {
      eye.add(mesh(new THREE.SphereGeometry(0.027 * u, 16, 12).scale(1, 1.12, 0.45), "#f8f8f6"));
      pupil.add(mesh(new THREE.SphereGeometry(0.016 * u, 14, 10).scale(1, 1.05, 0.5), INK, [0, 0, -0.008 * u])); pupil.add(shine(0.005 * u)).position.z -= 0.008 * u;
    } else if (kind === "sleepy") {
      eye.add(arc(0.016 * u, 0.0055 * u, INK, false)).position.y = 0.006 * u;
      const lash = eye.add(line(0.008 * u, INK, 0.004 * u)).children.at(-1)!; lash.position.set(s * 0.019 * u, 0.008 * u, 0); lash.rotation.z = Math.PI / 2 + s * 0.9;
    } else eye.add(arc(0.016 * u, 0.0055 * u, INK, true)); // happy
    // brows: their own holder, so the slider lifts them off the eye; angry eyes always bring them down in the middle
    const browY = eyeY + (0.22 + tune("browHeight") * 0.035) * eyeK;
    const brows = a.eyes === "angry" ? "angry" : a.brows ?? "soft";
    if (brows === "none") continue;
    const bspot = at(s * (eyeX + 0.01), browY), bc = mix(a.hairColor, INK, 0.35);
    const b = brows === "arched" ? arc(0.02 * u, 0.005 * u, bc, true, Math.PI * 0.6)
      : brows === "thick" ? line(0.022 * u, bc, 0.0085 * u) : brows === "flat" ? line(0.026 * u, bc, 0.0055 * u) : line(0.024 * u, bc, 0.0055 * u);
    if (brows === "arched") b.position.y = -0.012 * u;
    if (brows === "soft") b.rotation.z = Math.PI / 2 + s * 0.08;
    if (brows === "worried") b.rotation.z = Math.PI / 2 - s * 0.32;
    if (brows === "angry") b.rotation.z = Math.PI / 2 + s * 0.4;
    bspot.add(b);
  }

  // the nose
  const noseK = step(tune("noseSize"), 0.15), nose = mix(a.skin, "#c0604a", 0.12);
  if (a.nose !== "none") {
    const n = at(0, noseY, 0), k = noseK * u;
    if (a.nose === "pointy") n.add(mesh(new THREE.ConeGeometry(0.011 * k, 0.03 * k, 12).rotateX(-Math.PI / 2), nose, [0, 0, -0.008 * k]));
    else if (a.nose === "wide") n.add(mesh(new THREE.SphereGeometry(0.013 * k, 12, 10).scale(1.5, 0.85, 0.8), nose));
    else if (a.nose === "round") n.add(mesh(new THREE.SphereGeometry(0.016 * k, 14, 10).scale(1, 0.95, 0.85), nose));
    else n.add(mesh(new THREE.SphereGeometry(0.011 * k, 12, 10).scale(1.1, 0.9, 0.8), nose)); // button
  }

  // the mouth: the chosen one, and a wide open smile for a note
  const mouth = at(0, mouthY), joyMouth = at(0, mouthY);
  mouth.scale.setScalar(mouthK); joyMouth.scale.setScalar(mouthK);
  const open = (w: number) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CircleGeometry(w, 20, Math.PI, Math.PI).rotateY(Math.PI), "#5a1f1f", [0, 0.004 * u, 0.001]));
    g.add(mesh(new THREE.CircleGeometry(w * 0.5, 14, Math.PI, Math.PI).scale(1, 0.6, 1).rotateY(Math.PI), "#e86a6a", [0, -w * 0.45, -0.0005]));
    g.add(arc(w, 0.0045 * u, INK, false));
    return g;
  };
  joyMouth.add(open(0.028 * u));
  if (a.mouth === "smile" || a.mouth === "tongue") mouth.add(arc(0.024 * u, 0.0055 * u, INK, false, Math.PI * 0.72));
  if (a.mouth === "tongue") mouth.add(mesh(new THREE.SphereGeometry(0.011 * u, 10, 8).scale(1, 1, 0.5), "#e86a6a", [0.007 * u, -0.026 * u, 0]));
  if (a.mouth === "grin") mouth.add(open(0.024 * u));
  if (a.mouth === "flat") mouth.add(line(0.024 * u));
  if (a.mouth === "o") mouth.add(mesh(new THREE.TorusGeometry(0.01 * u, 0.005 * u, 8, 16), INK));
  if (a.mouth === "frown") mouth.add(arc(0.021 * u, 0.0055 * u, INK, true, Math.PI * 0.7)).position.y = -0.016 * u;

  // cheeks
  if (a.cheeks === "blush") for (const s of [-1, 1]) at(s * (eyeX + 0.12), eyeY - 0.26, 0.001).add(mesh(new THREE.CircleGeometry(0.02 * u, 20).rotateY(Math.PI), mix(a.skin, "#f06a7a", 0.45)));
  if (a.cheeks === "freckles") for (const s of [-1, 1]) for (const [dx, dy] of [[0, 0], [0.07, 0.03], [0.06, -0.05], [-0.05, -0.03]] as const)
    at(s * (eyeX + 0.05 + dx), eyeY - 0.22 + dy, 0.001).add(mesh(new THREE.CircleGeometry(0.0032 * u, 8).rotateY(Math.PI), mix(a.skin, "#5a3420", 0.55)));

  // facial hair, in the hair's colour (stubble is a shadow of it): patches of a shell that takes the head's shape
  if (a.beard && a.beard !== "none") {
    const c = a.beard === "stubble" ? mix(a.skin, a.hairColor, 0.38) : a.hairColor, lift = a.beard === "stubble" ? 1.008 : 1.03;
    const patch = (phi: number, w: number, from: number, to: number) => {
      const g = new THREE.SphereGeometry(r * lift, 20, 10, phi - w / 2, w, from, to - from), gp = g.attributes.position!, p = new THREE.Vector3();
      for (let i = 0; i < gp.count; i++) { p.fromBufferAttribute(gp, i); const q = shape(p).multiplyScalar(r * lift); gp.setXYZ(i, q.x, q.y, q.z); }
      g.computeVertexNormals();
      head.add(mesh(g, c));
    };
    const FRONT = Math.PI * 1.5, below = Math.acos(THREE.MathUtils.clamp(mouthY - 0.1 * mouthK, -1, 1));
    if (a.beard === "full") { patch(FRONT, 2.6, below, Math.PI - 0.35); for (const s of [-1, 1]) patch(FRONT + s * 1.2, 0.5, 1.5, below + 0.05); }
    // stubble is a shadow on the chin and jaw only: up the cheeks its hard edges read as a block
    if (a.beard === "stubble") patch(FRONT, 1.9, below + 0.08, Math.PI - 0.45);
    if (a.beard === "goatee") patch(FRONT, 0.8, below, Math.PI - 0.6);
    if (a.beard === "sideburns") for (const s of [-1, 1]) patch(FRONT + s * 1.15, 0.38, 1.4, 2.05);
    if (a.beard === "mustache" || a.beard === "full" || a.beard === "goatee") for (const s of [-1, 1]) {
      const m = at(s * 0.075, noseY - 0.07 * noseK, 0.005).add(mesh(new THREE.CapsuleGeometry(0.0058 * u, 0.02 * u, 4, 8).rotateZ(Math.PI / 2), c));
      m.children[0]!.rotation.z = -s * 0.3;
    }
  }

  if (a.glasses !== "none") {
    const frame = a.glasses === "shades" ? INK : "#2e3439", k = u * Math.max(1, eyeK * 0.95);
    const lens = (s: number) => { const l = at(s * eyeX, eyeY, 0.016 * u); return l; };
    const bridge = () => at(0, eyeY + 0.03, 0.016 * u).add(line(0.026 * u, frame));
    if (a.glasses === "round") { for (const s of [-1, 1]) lens(s).add(mesh(new THREE.TorusGeometry(0.031 * k, 0.0042 * u, 8, 24), frame)); bridge(); }
    if (a.glasses === "square") {
      for (const s of [-1, 1]) {
        const l = lens(s);
        for (const [x, y, w, h] of [[0, 0.026, 0.068, 0.0065], [0, -0.026, 0.068, 0.0065], [-0.031, 0, 0.0065, 0.052], [0.031, 0, 0.0065, 0.052]]) l.add(mesh(new THREE.BoxGeometry(w! * k, h! * k, 0.006 * u), frame, [x! * k, y! * k, 0]));
      }
      bridge();
    }
    if (a.glasses === "shades") { for (const s of [-1, 1]) lens(s).add(mesh(new THREE.BoxGeometry(0.068 * k, 0.044 * k, 0.008 * u), INK)); bridge(); }
    if (a.glasses === "monocle") { const l = lens(1); l.add(mesh(new THREE.TorusGeometry(0.031 * k, 0.004 * u, 8, 24), "#c9a227")); const chain = mesh(new THREE.CapsuleGeometry(0.0025 * u, 0.07 * u, 4, 6), "#c9a227", [0.02 * u, -0.055 * u, 0]); chain.rotation.z = 0.3; l.add(chain); }
    if (a.glasses === "vr") { const strap = mesh(new THREE.TorusGeometry(r * 1.02, 0.007 * u, 6, 32), "#2e3439"); strap.rotation.x = Math.PI / 2; strap.position.y = eyeY * r; strap.scale.set(shape(new THREE.Vector3(1, 0, 0)).x, 1, -shape(new THREE.Vector3(0, 0, -1)).z); head.add(strap); const g = at(0, eyeY, 0.02 * u); g.add(mesh(new THREE.BoxGeometry(0.165 * u, 0.064 * u, 0.045 * u), "#2e3439")); g.add(mesh(new THREE.BoxGeometry(0.14 * u, 0.012 * u, 0.01 * u), "#8a5cff", [0, 0, -0.023 * u])); }
    if (["round", "square", "shades", "pixel"].includes(a.glasses)) for (const s of [-1, 1]) {
      const spot = lens(s), edge = new THREE.Vector3(s * 0.034 * k, 0.004 * u, 0).applyQuaternion(spot.quaternion).add(spot.position);
      const ear = shape(new THREE.Vector3(s, 0, 0.3)).multiplyScalar(r * 1.0); // just behind the ear, where an arm tucks in
      ear.y = edge.y;
      const len = edge.distanceTo(ear), arm = mesh(new THREE.CapsuleGeometry(0.0032 * u, len, 4, 6), frame);
      arm.position.copy(edge).add(ear).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ear.clone().sub(edge).normalize());
      arm.name = "temple";
      head.add(arm);
    }
    if (a.glasses === "pixel") for (const s of [-1, 1]) { const l = lens(s); for (const [x, y, w] of [[0, 0.012, 0.06], [-0.006, 0, 0.048], [-0.01, -0.012, 0.036]]) l.add(mesh(new THREE.BoxGeometry(w! * u, 0.012 * u, 0.008 * u), INK, [x! * u, y! * u, 0])); }
  }

  const show = (xs: THREE.Object3D[], on: boolean) => { for (const x of xs) x.visible = on; };
  show(joyEyes, false); joyMouth.visible = false;
  for (const e of joyEyes) e.name = "joy";
  joyMouth.name = "joy";
  return {
    joy(on: boolean) { show(joyEyes, on); joyMouth.visible = on; show(eyes, !on); mouth.visible = !on; },
    blink(shut: boolean) { for (const e of eyes) e.scale.y = eyeK * (shut ? 0.12 : 1); },
    glance(x: number) { for (const p of pupils) p.position.x = -x * 0.012 * u; },
  };
}

/** A shell over the top and back of the head, open at the face: `down` is how far it comes (radians from the crown). */
const shell = (r: number, down: number, open = Math.PI * 0.62) =>
  new THREE.SphereGeometry(r, 28, 16, Math.PI * 1.5 + open / 2, Math.PI * 2 - open, 0, down);

/** Hats that cover the crown: a style that stands up off it (spikes, a crest, a flat top, a bun) tucks under one. */
const COVERS = new Set(["cap", "beanie", "hardhat", "propeller", "bucket", "tophat", "wizard", "cone"]);
const TALL = new Set(["spiky", "mohawk", "flat-top", "pompadour", "topknot", "bun"]);

function hair(a: Avatar, head: THREE.Object3D, r: number, mesh: Mesh) {
  if (a.hair === "none") return;
  const c = a.hairColor, R = r * 1.05, style = COVERS.has(a.hat) && TALL.has(a.hair) ? (a.hair === "mohawk" ? "buzz" : "short") : a.hair;
  const add = (g: THREE.BufferGeometry, at: [number, number, number], rot?: [number, number, number], fit = false) => { const m = mesh(g, c, at); if (rot) m.rotation.set(...rot); m.userData.fit = fit; head.add(m); return m; };
  const ball = (rad: number, at: [number, number, number]) => add(new THREE.SphereGeometry(rad, 14, 10), at);
  // the cap every style starts from: a fringe over the brow at the front, down to the nape at the back
  const cap = (down = 1.55, fringe = 1.08) => { add(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, fringe), [0, 0.005, 0], undefined, true); add(shell(R, down), [0, 0.005, 0], undefined, true); };
  switch (style) {
    case "buzz": add(new THREE.SphereGeometry(r * 1.015, 32, 16, 0, Math.PI * 2, 0, 1.25), [0, 0, 0.005], undefined, true); break;
    case "short": cap(); break;
    case "bob": cap(2.05); break;
    case "long": cap(2.1); add(new THREE.CapsuleGeometry(r * 0.75, r * 1.2, 6, 14).scale(1.15, 1, 0.45), [0, -r * 1.0, r * 0.62]); break;
    case "mullet": cap(1.7); add(new THREE.CapsuleGeometry(r * 0.6, r * 0.7, 6, 14).scale(1.2, 1, 0.45), [0, -r * 0.95, r * 0.72]); break;
    case "spiky": cap(1.4); for (let i = 0; i < 7; i++) { const a2 = (i / 7) * Math.PI * 2; add(new THREE.ConeGeometry(r * 0.2, r * 0.5, 8), [Math.cos(a2) * r * 0.55, r * 0.95, Math.sin(a2) * r * 0.55 + r * 0.1], [Math.sin(a2) * 0.6, 0, -Math.cos(a2) * 0.6]); } break;
    // a big round ring of hair around the face, open at the front, with a crown over the top: never over the eyes
    case "afro": for (const [k, flip] of [[1.4, 1], [1.27, -1]] as const) { // the outside, then the inside turned to face in (x mirrored flips the winding)
      add(new THREE.SphereGeometry(r * k, 28, 8, 0, Math.PI * 2, 0, 0.95).scale(flip, 1, 1), [0, r * 0.25, r * 0.2]);
      add(shell(r * k, 2.2, Math.PI * 0.72).scale(flip, 1, 1), [0, r * 0.25, r * 0.2]);
    } break;
    case "curly": cap(1.6); for (let i = 0; i < 12; i++) { const a2 = (i / 12) * Math.PI * 2; ball(r * 0.27, [Math.cos(a2) * R * 0.95, r * 0.4 + Math.sin(a2 * 3) * r * 0.08, Math.sin(a2) * R * 0.95 + r * 0.1]); } break;
    case "mohawk": add(new THREE.SphereGeometry(r * 1.015, 32, 16, 0, Math.PI * 2, 0, 1.2), [0, 0, 0], undefined, true);
      for (let i = 0; i < 7; i++) { const t = -0.75 + i * 0.3, tuft = add(new THREE.SphereGeometry(r * 0.2, 14, 10).scale(0.62, 1.5, 1.05), [0, Math.cos(t) * r * 1.08, Math.sin(t) * r * 1.08]); tuft.rotation.x = t; } break;
    case "flat-top": {
      cap(1.35);
      // a lathed block with soft shoulders: straight sides, a flat top, every edge rounded
      const w = r * 0.86, hgt = r * 0.42, b = r * 0.14, pts = [new THREE.Vector2(0, hgt / 2)];
      for (let i = 0; i <= 6; i++) { const q = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(w - b + Math.sin(q) * b, hgt / 2 - b + Math.cos(q) * b)); }
      pts.push(new THREE.Vector2(w, -hgt / 2), new THREE.Vector2(w * 0.9, -hgt / 2), new THREE.Vector2(0, -hgt / 2));
      add(new THREE.LatheGeometry(pts.reverse(), 32), [0, r * 0.9, r * 0.05]); break; // bottom to top, so it faces out
    }
    case "pompadour": cap(1.45); add(new THREE.SphereGeometry(r * 0.7, 18, 12).scale(1.2, 0.7, 1.1), [0, r * 0.92, -r * 0.3]); break;
    case "bun": cap(); ball(r * 0.38, [0, r * 1.0, r * 0.45]); break;
    case "topknot": cap(); add(new THREE.CylinderGeometry(r * 0.14, r * 0.18, r * 0.3, 12), [0, r * 1.1, 0]); ball(r * 0.27, [0, r * 1.35, 0]); break;
    case "space-buns": cap(); for (const s of [-1, 1]) ball(r * 0.36, [s * r * 0.68, r * 0.9, r * 0.1]); break;
    case "ponytail": cap(); { const tail = add(new THREE.CapsuleGeometry(r * 0.2, r * 1.0, 6, 12), [0, -r * 0.3, r * 1.2]); tail.rotation.x = -0.45; } break;
    case "pigtails": cap(); for (const s of [-1, 1]) { const tail = add(new THREE.CapsuleGeometry(r * 0.19, r * 0.8, 6, 12), [s * r * 1.12, -r * 0.45, r * 0.2]); tail.rotation.z = s * 0.3; } break;
    case "braids": cap(1.9); for (const s of [-1, 1]) for (let j = 0; j < 5; j++) ball(r * 0.16, [s * r * 0.92, -r * (0.35 + j * 0.25), r * 0.3]); break;
    // locs hang from the sides and back only, parted round the face, the side ones behind the ears
    case "locs": cap(1.7); for (let i = 0; i < 11; i++) { const a2 = Math.PI * (0.12 + (i / 10) * 0.76), len = r * (0.8 + Math.sin(a2) * 0.4); add(new THREE.CapsuleGeometry(r * 0.08, len, 4, 6), [Math.cos(a2) * R * 1.02, -len * 0.5 + r * 0.05, Math.sin(a2) * R + r * 0.06]); } break;
    default: cap();
  }
}

function hat(a: Avatar, head: THREE.Object3D, r: number, mesh: Mesh) {
  if (a.hat === "none") return;
  const c = HAT[a.hat] ?? a.topColor;
  const add = (g: THREE.BufferGeometry, at: [number, number, number], color = c, fit = false) => { const m = mesh(g, color, at); m.userData.fit = fit; head.add(m); return m; };
  // positions are in head radii over a round head; character() lifts them onto a longer one
  const y = (k: number) => r * k;
  const dome = (down = 1.35, s = 1.1) => add(new THREE.SphereGeometry(r * s, 32, 14, 0, Math.PI * 2, 0, down), [0, r * 0.04, 0], c, true);
  switch (a.hat) {
    case "cap": dome(1.4); add(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.012, 24, 1, false, Math.PI * 0.5, Math.PI).scale(1, 1, 1.15), [0, y(0.36), -r * 0.62]); break;
    case "beanie": dome(1.45, 1.12); add(new THREE.SphereGeometry(r * 0.22, 12, 10), [0, y(1.18), 0], "#f4f5f5"); break;
    case "hardhat": dome(1.4, 1.13); add(new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.014, 28), [0, y(0.3), -r * 0.05]); break;
    case "bucket": add(new THREE.CylinderGeometry(r * 0.82, r * 1.0, r * 0.6, 24), [0, y(0.82), 0]); add(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.012, 28), [0, y(0.5), 0]); break;
    case "tophat": add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.014, 28), [0, y(0.86), 0]); add(new THREE.CylinderGeometry(r * 0.7, r * 0.7, r * 1.2, 28), [0, y(1.45), 0]); add(new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 0.22, 28), [0, y(0.98), 0], "#c23a6b"); break;
    case "wizard": add(new THREE.ConeGeometry(r * 0.9, r * 2.0, 24), [0, y(1.8), 0]).rotation.z = 0.12; add(new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.014, 28), [0, y(0.78), 0]); add(new THREE.SphereGeometry(r * 0.11, 8, 6), [0, y(1.5), -r * 0.55], "#f4d03a"); break;
    case "party": add(new THREE.ConeGeometry(r * 0.45, r * 1.3, 18), [r * 0.15, y(1.5), 0]); add(new THREE.SphereGeometry(r * 0.15, 10, 8), [r * 0.15, y(2.15), 0], "#f4d03a"); break;
    case "cone": add(new THREE.BoxGeometry(r * 1.8, 0.02, r * 1.8), [0, y(0.82), 0]); add(new THREE.ConeGeometry(r * 0.7, r * 1.5, 24), [0, y(1.55), 0]); add(new THREE.CylinderGeometry(r * 0.46, r * 0.55, r * 0.26, 24, 1, true), [0, y(1.42), 0], "#f4f5f5"); break;
    case "crown": add(new THREE.CylinderGeometry(r * 0.8, r * 0.8, r * 0.32, 24, 1, true), [0, y(1.0), 0]); for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2; add(new THREE.ConeGeometry(r * 0.14, r * 0.3, 8), [Math.cos(a2) * r * 0.8, y(1.28), Math.sin(a2) * r * 0.8]); } break;
    case "halo": add(new THREE.TorusGeometry(r * 0.7, r * 0.065, 10, 32), [0, y(1.4), 0]).rotation.x = Math.PI / 2; break;
    case "cat-ears": for (const s of [-1, 1]) { const ear = add(new THREE.ConeGeometry(r * 0.3, r * 0.5, 4), [s * r * 0.6, y(0.95), 0], a.hairColor); ear.rotation.z = -s * 0.35; } break;
    case "propeller": dome(1.4); add(new THREE.CylinderGeometry(0.008, 0.008, r * 0.3, 6), [0, y(1.22), 0], INK); for (const s of [0, Math.PI / 2]) add(new THREE.BoxGeometry(r * 1.1, 0.008, r * 0.17), [0, y(1.37), 0], "#e8590c").rotation.y = s; break;
    case "headphones": { add(new THREE.TorusGeometry(r * 1.1, r * 0.075, 10, 28, Math.PI), [0, r * 0.05, 0]); for (const s of [-1, 1]) add(new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 0.2, 18), [s * r * 1.08, 0, 0], INK).rotation.z = Math.PI / 2; break; }
    case "rubber-duck": add(new THREE.SphereGeometry(r * 0.45, 16, 12).scale(1.2, 0.8, 1), [0, y(1.12), r * 0.1]); add(new THREE.SphereGeometry(r * 0.3, 14, 10), [0, y(1.5), -r * 0.18]); add(new THREE.ConeGeometry(r * 0.11, r * 0.26, 8), [0, y(1.48), -r * 0.54], "#e8590c").rotation.x = -Math.PI / 2; break;
  }
}
