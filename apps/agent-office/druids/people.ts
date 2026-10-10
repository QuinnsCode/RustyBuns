// 🗡️ Everyone walking around the office (you, the people you work with, the bartender) is Qoa.
//
// rustybunsify.ts adds `(globalThis.__rbPeople ??= []).push(this)` to the office's person constructor. Qoa hangs
// off the person's root. Yours is different in first person: firstPerson() moves him into the scene under the
// camera with his head folded away, so you look down at Qoa's own body, and the office's floating hands go.
import { AnimationMixer, LoopRepeat, Mesh, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CAST, PLAYER, clipName, personRole } from "./cast.ts";
import { heightOf, rigged } from "./loader.ts";

const HEIGHT = 1.75;

interface Person {
  root: Object3D;
  body: Object3D;
  /** What the office's person holds out in front: an issue card, a book. These stay in sight on Qoa. */
  cardHolder?: Object3D;
  bookHolder?: Object3D;
  update(dt: number, t: number, moving: boolean, airborne: boolean, speed?: number): void;
}

/** Everyone who's Qoa, for poking at from the console (`__rbQoa`). */
const qoas: { person: Person; avatar?: Object3D; head?: Object3D; scale?: number; failed?: boolean; clip: () => string }[] = [];
(globalThis as { __rbQoa?: typeof qoas }).__rbQoa = qoas;

/** Hide the office's person, all but what they're holding out (a carried issue card, a book). */
function hideBody(p: Person) {
  const keep = [p.cardHolder, p.bookHolder];
  for (const part of p.body.children) {
    if (keep.includes(part)) continue;
    part.traverse((o) => { if ((o as Mesh).isMesh) o.visible = false; });
  }
}

function attach(p: Person) {
  const update = p.update;
  let mixer: AnimationMixer | null = null, avatar: Object3D | null = null, current: AnimationAction | null = null;
  let clips = new Map<string, AnimationClip>();
  let failed = false;
  const entry: (typeof qoas)[number] = { person: p, clip: () => current?.getClip().name ?? "" };
  qoas.push(entry);

  p.update = function (dt, t, moving, airborne, speed = 1) {
    update.call(this, dt, t, moving, airborne, speed);
    // the office's person, kept in step but out of sight from the start: Qoa stands in for it once he's loaded
    if (!failed) hideBody(p);
    if (!avatar || !mixer) return;
    const clip = clips.get(clipName(PLAYER, personRole(moving, airborne, speed)));
    const next = clip && mixer.clipAction(clip);
    if (next && next !== current) {
      next.reset().setLoop(LoopRepeat, Infinity);
      current ? next.crossFadeFrom(current, 0.2, false).play() : next.play();
      current = next;
    }
    if (avatar.parent === p.root) avatar.position.y = p.body.position.y; // sitting lowers him into the chair
    mixer.update(dt);
  };

  rigged(CAST[PLAYER].file).then((m) => {
    const a = clone(m.scene);
    a.scale.setScalar(HEIGHT / heightOf(a));
    a.traverse((o) => {
      o.userData.rbForest = "skip";
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    mixer = new AnimationMixer(a);
    clips = m.clips;
    p.root.add(a);
    avatar = entry.avatar = a;
    entry.head = a.getObjectByName("Head");
    entry.scale = a.scale.x;
  }).catch((e) => {
    failed = entry.failed = true;
    p.body.traverse((o) => { if ((o as Mesh).isMesh) o.visible = true; });
    console.warn("[druids] Qoa failed to load; keeping the office's person", e);
  });
}

const g = globalThis as { __rbPeople?: { push(p: Person): number } & Iterable<Person> };
for (const p of g.__rbPeople ?? []) attach(p);
g.__rbPeople = { push: (p: Person) => (attach(p), 0), *[Symbol.iterator]() {} };

export interface Viewer {
  me: Person;
  player: { view: string };
  camera: Object3D;
  /** The office's first-person view: two arms, plus the issue card, book and ball held out in front. */
  hands?: { scene?: Object3D; right?: { group: Object3D }; left?: { group: Object3D } };
}
const at = new Vector3(), facing = new Quaternion(), ahead = new Vector3();
/** In first person your Qoa is sized so his eyes are the camera (the office's eye is lower than his), feet on the
 *  floor, and stands this far behind it so looking down shows his chest, arms and feet, not his collar. */
const BEHIND = 0.14, EYES = 0.92;

/** Every frame, after the office has moved you and before it draws: in first person your Qoa stands just behind
 *  the camera, facing where you face, head folded away, so looking down shows his body; in third person he's back
 *  on your person, head and all. */
export function firstPerson(app: Viewer, scene: Object3D) {
  const mine = qoas.find((q) => q.person === app.me);
  const first = app.player.view === "first" && app.me.root.visible;
  // the office's floating arms go from the start (they come back only if Qoa can't load), but not what they
  // carry: an issue card on its way from the issues board to the queue, a book, the ball
  const arms = !first || !!mine?.failed;
  for (const arm of [app.hands?.right, app.hands?.left]) if (arm) arm.group.visible = arms;
  if (!mine?.avatar) return;
  const a = mine.avatar;
  if (first) {
    if (a.parent !== scene) scene.add(a);
    app.me.root.getWorldQuaternion(facing);
    a.quaternion.copy(facing);
    app.camera.getWorldPosition(at);
    ahead.set(0, 0, 1).applyQuaternion(facing).setY(0).normalize();
    const floor = app.me.root.getWorldPosition(new Vector3()).y;
    a.scale.setScalar(mine.scale! * Math.min(1, (at.y - floor) / (HEIGHT * EYES)));
    a.position.set(at.x - ahead.x * BEHIND, floor, at.z - ahead.z * BEHIND);
    mine.head?.scale.setScalar(0.001);
  } else if (a.parent !== app.me.root) {
    app.me.root.add(a);
    a.scale.setScalar(mine.scale!);
    a.position.set(0, 0, 0);
    a.quaternion.identity();
    mine.head?.scale.setScalar(1);
  }
}
