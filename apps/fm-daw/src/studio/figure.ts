// An eqosys avatar (@rustybuns/util/avatar) in the room: @rustybuns/models' human, the realistic body grown from a build
// (Park Hide & Seek's people), worn from the avatar by fromAvatar, with a name tag over it. It stands and walks on planted
// feet (the body's own gait), sits on the room's seats (0.48 m), plays, and can look at someone and nod to the beat.
// Feet at y 0, facing -z.
//
// The real hands (fingers.ts) reach for keys and drums through a stand-in arm: shoulder, elbow and wrist nodes in the
// old character's frame (facing -z, a "hand" node at each palm), the human's own arm lengths, hung off its chest. Walking,
// the stand-ins follow the body's swinging arms; seated or playing, they're posed here and fingers.ts bends them to
// reach, and the body's arm bones follow them. The body is the human turned half round, so a bone's turn in the stand-in's
// frame is the same turn seen from behind: T q T, with T a half turn about y.
import * as THREE from "three";
import { clamp } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";
import { fromAvatar, human } from "@rustybuns/models/human";
import type { Play } from "@rustybuns/models/character";
import type { Reach, SpotKind } from "./room.ts";
import { hands as wearHands, type Aim, type Hands } from "./fingers.ts";

export interface Figure {
  group: THREE.Group;
  /** Pose it for this frame: walking `speed` m/s, sitting, its hands on `play` (keys or sticks; null: free), `note` while
   *  one sounds, and `t` seconds since the page opened; `look` a point in the room to turn its head to, `beat` the beats
   *  since the groove started, to nod on;
   *  `reach`, seated: where its palms should be (metres ahead of the seat and up off the floor); it shifts on its seat, as
   *  a player sets a stool's height and pulls it in, so its hands land there whatever its build. `sticks`: a drumstick in
   *  each hand (sat at the kit). `aim`: the spot's keys or kit and what sounds there, for its fingers and stick tips to land on
   *  (fingers.ts). */
  pose(o: { speed: number; heading?: number; crouch?: number; seated: boolean; play: Play | null; note: boolean; t: number; look?: THREE.Vector3 | null; beat?: number | null; reach?: Reach | null; sticks?: boolean; aim?: Aim | null }): void;
  /** Where its right palm is in the room after the last pose: what a carried lantern hangs from. */
  handAt(out: THREE.Vector3): THREE.Vector3;
  /** Its real hands (fingers.ts): where each fingertip and stick tip is. */
  hands: Hands;
  /** How solid the head (and its hair and hat) is drawn, 0 to 1: your own, seen up close beside it, so you see past it.
   *  The body is one mesh, so the head is there or not: gone under a half. */
  fade(k: number): void;
  dispose(): void;
}

/**
 * Where a seated figure's hands are at its spot: on the keys whenever it sits at them, so you see your hands over the
 * keys before you press one (the bass seat's mono synth too); the sticks only while a drum sounds (the sticks pose
 * strikes all the time). Anywhere else, the keys pose while a note sounds, and hands free.
 */
export function handsOn(kind: SpotKind | undefined, note: boolean): Play | null {
  if (kind === "keys" || kind === "bass") return "keys";
  if (!note) return null;
  return kind === "drums" ? "sticks" : "keys";
}

/** How far (metres) a figure shifts on its seat, up or down and in or back, to reach. */
export const SHIFT = 0.15;

/** The top of a stool or the desk's chair in the room (room.ts builds them at 0.45, 0.06 thick). */
const SEAT = 0.48;

function nameTag(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 48;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "rgba(21,23,27,0.75)"; g.beginPath(); g.roundRect(0, 4, 256, 40, 12); g.fill();
    g.fillStyle = "#f4f1ea"; g.font = "600 26px 'Barlow Condensed', sans-serif"; g.textAlign = "center"; g.fillText(name.slice(0, 18), 128, 33);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.8, 0.15, 1);
  return s;
}

/** A half turn about y: the stand-in arm's frame (facing -z) to the body's (facing +z), and back. */
const T = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
/** `to` = T q T: a joint's turn seen from the other frame. */
const across = (to: THREE.Quaternion, q: THREE.Quaternion) => to.copy(T).multiply(q).multiply(T);

interface Arm { s: number; shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; bones: [THREE.Bone, THREE.Bone, THREE.Bone] }

/** The stand-in arms' pose while seated or playing (the old character's): rotation x swings an arm forward, z out to its side. */
function armPose(arm: Arm, t: number, play: Play | null) {
  const s = arm.s;
  let sx: number, sz: number, ex: number, wx = 0;
  if (play === "keys") {
    const tap = Math.max(0, Math.sin(t * 11 + (s > 0 ? 0 : 1.9)));
    sx = 0.75; sz = s * 0.12; ex = 1.75 - tap * 0.12; wx = -0.75 + tap * 0.25;
  } else if (play === "sticks") {
    const hit = Math.pow(Math.max(0, Math.sin(t * 9 + (s > 0 ? 0 : Math.PI))), 3);
    sx = 0.9 + (1 - hit) * 0.45; sz = s * 0.3; ex = 0.9 - hit * 0.6; wx = -0.4 + hit * 0.5;
  } else if (play === "strings") {
    if (s < 0) { sx = 0.75; sz = -0.75; ex = 0.55 + Math.sin(t * 2) * 0.05; wx = -0.3; }
    else { const strum = Math.sin(t * 12); sx = 0.55; sz = -0.45; ex = 1.05 + strum * 0.18; wx = strum * 0.25; }
  } else { sx = 0.35; sz = s * 0.12; ex = 0.9; }
  arm.shoulder.rotation.set(sx, 0, sz);
  arm.elbow.rotation.set(ex, 0, 0);
  arm.wrist.rotation.set(wx, 0, 0);
}

/** `name` null: no tag over its head (you, seen over your own shoulder, don't need yours). */
export function figure(a: Avatar, name: string | null): Figure {
  const group = new THREE.Group(), seed = name ? [...name].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7) >>> 0 : 1;
  const { build, outfit, palette } = fromAvatar(a);
  const body = human(build, outfit, palette, seed || 1), bn = body.bones;
  body.root.rotation.y = Math.PI;
  // what shifts on its seat to reach
  const seatShift = new THREE.Group();
  seatShift.add(body.root);
  group.add(seatShift);
  const tag = name === null ? null : nameTag(name || "Someone");
  if (tag) group.add(tag);

  // seated: shins straight down, thighs level, the hip joints a shin and an ankle (9 cm a 1.75 m body) over the floor,
  // the thighs (about 8 cm under the joint) on the seat
  const k = body.height / 1.75, shin = bn.footR.position.length(), seatHip = shin + 0.09 * k, sitOn = seatHip - 0.08 * k;

  // the stand-in arms, in the old character's frame, hung off the chest
  const frame = new THREE.Object3D();
  frame.quaternion.copy(T);
  bn.chest.add(frame);
  const skin = new THREE.MeshStandardMaterial({ color: palette.skin ?? "#c68a5e" }), palmGeo = new THREE.SphereGeometry(0.04, 8, 6);
  const arms: Arm[] = [1, -1].map((s) => {
    const n = s > 0 ? "R" : "L", arm = bn[`arm${n}`], fore = bn[`fore${n}`], hand = bn[`hand${n}`];
    const shoulder = new THREE.Object3D(), elbow = new THREE.Object3D(), wrist = new THREE.Object3D();
    shoulder.position.set(-arm.position.x, arm.position.y, -arm.position.z);
    elbow.position.set(0, -fore.position.length(), 0);
    wrist.position.set(0, -hand.position.length(), 0);
    const palm = new THREE.Mesh(palmGeo, skin);
    palm.name = "hand"; palm.position.set(0, -0.045, 0);
    frame.add(shoulder); shoulder.add(elbow); elbow.add(wrist); wrist.add(palm);
    // the body's own hand gives way to the real one fingers.ts puts on the wrist
    hand.scale.setScalar(0.01);
    return { s, shoulder, elbow, wrist, bones: [arm, fore, hand] };
  });
  const real = wearHands(group, group, body.height);
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const followBody = () => { for (const arm of arms) [arm.shoulder, arm.elbow, arm.wrist].forEach((o, i) => across(o.quaternion, arm.bones[i]!.quaternion)); };
  const leadBody = () => { for (const arm of arms) [arm.shoulder, arm.elbow, arm.wrist].forEach((o, i) => across(arm.bones[i]!.quaternion, o.quaternion)); };

  let last = -1, yaw = 0, pitch = 0;
  const at = new THREE.Vector3(), target = new THREE.Vector3();
  /** The body for this frame, before the real hands: walking or sat, the head turned to `look`, nodding on `beat`. */
  const place = (o: { t: number; speed: number; heading?: number; crouch?: number; seated: boolean; play: Play | null; look?: THREE.Vector3 | null; beat?: number | null }) => {
    const dt = last < 0 ? 0 : clamp(o.t - last, 0, 0.25);
    last = o.t;
    body.pose(o.seated ? { speed: 0 } : { speed: o.speed, heading: o.heading ?? 0, crouch: o.crouch ?? 0 }, dt);
    if (o.seated) {
      bn.hips.position.set(0, seatHip, 0);
      bn.hips.quaternion.identity();
      for (const [n, s] of [["R", -1], ["L", 1]] as const) {
        bn[`thigh${n}`].quaternion.setFromEuler(e.set(-(Math.PI / 2 - 0.05), 0, s * 0.12));
        bn[`shin${n}`].quaternion.setFromEuler(e.set(Math.PI / 2 - 0.05, 0, -s * 0.12));
        bn[`foot${n}`].quaternion.setFromEuler(e.set(0, s * 0.15, 0));
      }
      bn.spine.quaternion.setFromEuler(e.set(o.play ? 0.08 : 0.02, 0, 0));
      bn.chest.quaternion.setFromEuler(e.set(o.play ? 0.06 : 0.02, 0, 0));
      bn.neck.quaternion.identity(); bn.head.quaternion.identity();
    }
    // look: turn the neck toward the point, as far as a neck goes, easing there rather than snapping
    const walk = o.seated ? 0 : Math.min(1, o.speed / 1.4);
    let wantYaw = Math.sin((o.t + seed % 10) * 0.4) * 0.12 * (1 - walk), wantPitch = o.play ? -0.12 : 0;
    if (o.look) {
      // from the head as it sits this frame, in the figure's own frame (facing -z)
      bn.head.getWorldPosition(at);
      group.worldToLocal(at);
      group.worldToLocal(target.copy(o.look)).sub(at);
      wantYaw = clamp(Math.atan2(-target.x, -target.z), -1.1, 1.1);
      wantPitch = clamp(Math.atan2(target.y, Math.hypot(target.x, target.z)), -0.45, 0.4);
    }
    const ease = dt === 0 ? 1 : 1 - Math.exp(-dt * 7);
    yaw += (wantYaw - yaw) * ease; pitch += (wantPitch - pitch) * ease;
    const nod = o.beat == null ? 0 : Math.pow(Math.max(0, Math.sin(o.beat * Math.PI * 2)), 2);
    // in the body's frame (facing +z) a forward nod and a look down are +x, a turn to its left is +y
    bn.neck.quaternion.multiply(q.setFromEuler(e.set(-pitch * 0.4 + nod * 0.1, yaw * 0.35, 0)));
    bn.head.quaternion.multiply(q.setFromEuler(e.set(-pitch * 0.6 + nod * 0.14, yaw * 0.65, 0)));
    if (o.seated || o.play) for (const arm of arms) armPose(arm, o.t, o.play);
    else followBody();
  };

  // where its palms sit in each play pose, from the seat (measured once: a build's arms don't change)
  const palms = new Map<Play, Reach>(), handNodes = arms.map((arm) => arm.wrist.children[0]!);
  const palm = (p: Play, t: number): Reach => {
    let r = palms.get(p);
    if (!r) {
      const was = last;
      seatShift.position.set(0, SEAT - sitOn, 0);
      last = -1;
      place({ t, speed: 0, seated: true, play: p });
      last = was;
      group.updateMatrixWorld(true);
      let ahead = 0, up = 0;
      for (const h of handNodes) { group.worldToLocal(h.getWorldPosition(at)); ahead -= at.z / handNodes.length; up += at.y / handNodes.length; }
      palms.set(p, (r = { ahead, up }));
    }
    return r;
  };
  let faded = false;
  return {
    group,
    hands: real,
    handAt: (out) => handNodes[0]!.getWorldPosition(out),
    pose({ speed, heading, crouch, seated, play, note: _note, t, look = null, beat = null, reach = null, sticks: holding = false, aim = null }) {
      const p = seated && play && reach ? palm(play, t) : null;
      const up = p && reach ? clamp(reach.up - p.up, -SHIFT, SHIFT) : 0, ahead = p && reach ? clamp(reach.ahead - p.ahead, -SHIFT, SHIFT) : 0;
      seatShift.position.set(0, seated ? SEAT - sitOn + up : 0, -ahead);
      place({ t, speed, heading, crouch, seated, play, look, beat });
      group.updateMatrixWorld(true);
      real.pose({ play, aim: seated ? aim : null, sticks: holding, t });
      if (seated || play) leadBody();
      if (tag) { bn.head.getWorldPosition(at); group.worldToLocal(at); tag.position.set(0, at.y + 0.42, 0); }
    },
    fade(k) {
      const gone = k < 0.5;
      if (gone === faded) return;
      faded = gone;
      bn.head.scale.setScalar(gone ? 0.001 : 1);
    },
    dispose() {
      real.dispose();
      body.dispose();
      skin.dispose(); palmGeo.dispose();
      tag?.material.map?.dispose(); tag?.material.dispose();
    },
  };
}
