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
import { fromAvatar, human, playArm, seatOf, sit } from "@rustybuns/models/human";
import type { Play } from "@rustybuns/models/character";
import type { Reach, SpotKind } from "./room.ts";
import { gear, gearLook, type GearLook } from "@rustybuns/models/gear";
import { hands as wearHands, type Aim, type Hands, type Strum } from "./fingers.ts";

export interface Figure {
  group: THREE.Group;
  /** Pose it for this frame: walking `speed` m/s, sitting, its hands on `play` (keys or sticks; null: free), `note` while
   *  one sounds, and `t` seconds since the page opened; `look` a point in the room to turn its head to, `beat` the beats
   *  since the groove started, to nod on;
   *  `reach`, seated: where its palms should be (metres ahead of the seat and up off the floor); it shifts on its seat, as
   *  a player sets a stool's height and pulls it in, so its hands land there whatever its build. `sticks`: a drumstick in
   *  each hand (sat at the kit). `aim`: the spot's keys or kit and what sounds there, for its fingers and stick tips to land on
   *  (fingers.ts). `guitar`: a guitar plugged in, how loud it plays now (0 to 1): it hangs on the figure, the fretting
   *  hand on the neck and the picking hand strumming while it sounds (null: no guitar). */
  pose(o: { speed: number; heading?: number; crouch?: number; seated: boolean; play: Play | null; note: boolean; t: number; look?: THREE.Vector3 | null; beat?: number | null; reach?: Reach | null; sticks?: boolean; aim?: Aim | null; guitar?: number | null }): void;
  /** The guitar it holds while one is plugged in (null before it first holds one): `pick` where the pick is across the strings, -1 to 1. */
  strum(): Strum | null;
  /** Where its right palm is in the room after the last pose: what a carried lantern hangs from. */
  handAt(out: THREE.Vector3): THREE.Vector3;
  /** Its real hands (fingers.ts): where each fingertip and stick tip is. */
  hands: Hands;
  /** Where the ball of each foot is (world space), right then left, and each heel: on the kick and hat pedals at the kit. */
  feet(): { balls: [THREE.Vector3, THREE.Vector3]; heels: [THREE.Vector3, THREE.Vector3] };
  /** How solid the head (and its hair and hat) is drawn, 0 to 1: your own, seen up close beside it, so you see past it.
   *  The body is one mesh, so the head is there or not: gone under a half. */
  fade(k: number): void;
  dispose(): void;
}

/**
 * Where a seated figure's hands are at its spot: on the keys whenever it sits at them, so you see your hands over the
 * keys before you press one (the bass seat's mono synth too), and on the decks at the DJ table; the sticks only while a
 * drum sounds (the sticks pose strikes all the time). A guitar plugged in is played anywhere but those. Anywhere else,
 * the keys pose while a note sounds, and hands free.
 */
export function handsOn(kind: SpotKind | undefined, note: boolean, guitar = false): Play | null {
  if (kind === "keys" || kind === "bass" || kind === "dj") return "keys";
  if (guitar && kind !== "drums") return "strings";
  if (!note) return null;
  return kind === "drums" ? "sticks" : "keys";
}

/** The fret a guitar's fretting hand holds a chord at (a plugged-in guitar sends sound, not notes). */
const CHORD_FRET = 3;
/** How fast a strum swings across the strings while the guitar sounds (down and up strokes a second), and how loud
 *  (0 to 1) it must be to strum at all. */
const STRUMS = 2.2, HEARD = 0.02;
/** Every held guitar's look, made once (gear's geometry is shared too, so a figure going leaves both be). */
let guitarLook: GearLook | null = null;

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
  const { sx, sz, ex, wx } = playArm(arm.s, t, play);
  arm.shoulder.rotation.set(sx, 0, sz);
  arm.elbow.rotation.set(ex, 0, 0);
  arm.wrist.rotation.set(wx, 0, 0);
}

/** How far the heel comes up off a pedal as what it plays sounds (radians the foot tips about its ball). */
const HEEL_UP = 0.35;
const X = new THREE.Vector3(1, 0, 0);

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

  // seated: the thighs on the seat
  const sitOn = seatOf(body).seat;

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
    if (o.seated) sit(body, !!o.play);
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
  // ---- the feet on the kit's pedals: the ball of the right foot on the kick's footboard, the left's on the hat's; the
  // heel comes up as either sounds, the ball staying put. A two-bone reach from the hip, the knee up and ahead.
  const k = body.height / 1.75, ball = new THREE.Vector3(0, -0.075 * k, 0.13 * k), heel = new THREE.Vector3(0, -0.075 * k, -0.05 * k);
  const fq = new THREE.Quaternion(), pq = new THREE.Quaternion(), wq = new THREE.Quaternion(), dq = new THREE.Quaternion();
  const hip = new THREE.Vector3(), knee = new THREE.Vector3(), kneeAt = new THREE.Vector3(), ankle = new THREE.Vector3(), goal = new THREE.Vector3(), dir = new THREE.Vector3(), pole = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3();
  /** Turn `bone` (world space) so its child at `from` swings to `to`, about the bone's own joint at `at`. */
  const swing = (bone: THREE.Bone, at: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3) => {
    dq.setFromUnitVectors(a1.copy(from).sub(at).normalize(), a2.copy(to).sub(at).normalize());
    bone.getWorldQuaternion(wq).premultiply(dq);
    bone.parent!.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(wq));
    bone.updateMatrixWorld(true);
  };
  function plant(n: "R" | "L", pedal: THREE.Vector3, press: number) {
    const thigh = bn[`thigh${n}`], shin = bn[`shin${n}`], foot = bn[`foot${n}`];
    // the foot as it sat, tipped up at the heel by the press: where its ankle must be for its ball to be on the pedal
    foot.getWorldQuaternion(fq).multiply(dq.setFromAxisAngle(X, press * HEEL_UP));
    goal.copy(pedal).sub(dir.copy(ball).applyQuaternion(fq));
    thigh.getWorldPosition(hip); shin.getWorldPosition(knee); foot.getWorldPosition(ankle);
    const U = hip.distanceTo(knee), F = knee.distanceTo(ankle);
    dir.copy(goal).sub(hip);
    const len = clamp(dir.length(), Math.abs(U - F) + 0.01, (U + F) * 0.999);
    dir.normalize();
    const along = (U * U - F * F + len * len) / (2 * len), out = Math.sqrt(Math.max(0, U * U - along * along));
    // the knee toward where it already points (up and ahead, sat), off the hip-to-ankle line
    pole.copy(knee).sub(hip); pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    kneeAt.copy(hip).addScaledVector(dir, along).addScaledVector(pole, out);
    goal.copy(hip).addScaledVector(dir, len);
    swing(thigh, hip, knee, kneeAt);
    shin.getWorldPosition(knee); foot.getWorldPosition(ankle);
    swing(shin, knee, ankle, goal);
    shin.getWorldQuaternion(pq);
    foot.quaternion.copy(pq.invert().multiply(fq));
    foot.updateMatrixWorld(true);
  }
  const at2 = () => [new THREE.Vector3(), new THREE.Vector3()] as [THREE.Vector3, THREE.Vector3];

  // ---- a guitar, hung on the figure while one is plugged in: its body at the belly, the neck up to its left
  let held: Strum | null = null, phase = 0, lastStrum = -1;
  const along = new THREE.Matrix4().makeBasis(new THREE.Vector3(-0.5, -0.866, 0), new THREE.Vector3(-0.866, 0.5, 0), new THREE.Vector3(0, 0, -1));
  const hipAt = new THREE.Vector3();
  function hang(level: number, t: number) {
    if (!held) {
      const g = gear("guitar", { look: (guitarLook ??= gearLook()) });
      group.add(g);
      held = { guitar: g, fret: CHORD_FRET, pick: 0 };
    }
    const g = held.guitar;
    g.visible = true;
    g.quaternion.setFromRotationMatrix(along);
    bn.hips.getWorldPosition(hipAt); group.worldToLocal(hipAt);
    // the body's middle (0.25 up it) in front of the belly, a touch to the figure's right
    g.position.set(0.05, hipAt.y + 0.06, hipAt.z - 0.17).sub(a1.set(0.02, 0.25, 0).applyMatrix4(along));
    const dt = lastStrum < 0 ? 0 : clamp(t - lastStrum, 0, 0.25);
    lastStrum = t;
    if (level > HEARD) phase += dt * Math.PI * 2 * STRUMS;
    held.pick = Math.sin(phase);
  }

  let faded = false;
  return {
    group,
    hands: real,
    handAt: (out) => handNodes[0]!.getWorldPosition(out),
    feet() {
      group.updateMatrixWorld(true);
      const balls = at2(), heels = at2();
      (["R", "L"] as const).forEach((n, i) => { const m = bn[`foot${n}`].matrixWorld; balls[i].copy(ball).applyMatrix4(m); heels[i].copy(heel).applyMatrix4(m); });
      return { balls, heels };
    },
    strum: () => held,
    pose({ speed, heading, crouch, seated, play, note: _note, t, look = null, beat = null, reach = null, sticks: holding = false, aim = null, guitar = null }) {
      const p = seated && play && reach ? palm(play, t) : null;
      const up = p && reach ? clamp(reach.up - p.up, -SHIFT, SHIFT) : 0, ahead = p && reach ? clamp(reach.ahead - p.ahead, -SHIFT, SHIFT) : 0;
      seatShift.position.set(0, seated ? SEAT - sitOn + up : 0, -ahead);
      place({ t, speed, heading, crouch, seated, play, look, beat });
      group.updateMatrixWorld(true);
      if (seated && holding && aim?.kit) {
        const kick = aim.kit.pedal("kick", at), hat = kick && aim.kit.pedal("hat", target);
        if (kick && hat) { plant("R", kick.at, Math.min(1, kick.k * 1.6)); plant("L", hat.at, Math.min(1, hat.k * 1.6)); }
      }
      const playing = guitar !== null && play === "strings";
      if (playing) hang(guitar, t); else if (held) held.guitar.visible = false;
      group.updateMatrixWorld(true);
      real.pose({ play, aim: seated ? aim : null, sticks: holding, t, strum: playing ? held : null });
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
