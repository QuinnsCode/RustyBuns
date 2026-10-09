// 🧙 Each worker's blob becomes one of the races of Druids Curse.
//
// rustybunsify.ts adds one line to the office's worker constructor, `(globalThis.__rbWorkers ??= []).push(this)`.
// Everything else is read from the worker's own public fields (status, action, walking, ...), so the office's
// logic is untouched. Until a model loads, or if it fails to, the blob stays as it was.
import {
  AnimationMixer, LoopOnce, LoopRepeat, Mesh, Object3D, type AnimationAction, type AnimationClip,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CAST, bareClip, clipName, raceFor, roleFor, type Pose, type Race } from "./cast.ts";
import { heightOf, rigged } from "./loader.ts";

/** Twice the office's own workers, to stand at the Druid Panels; the bulb, name tag and bubble go up by the
 *  difference. */
const HEIGHT = 2.2;
const LIFT = HEIGHT - 1.1;
const FADE = 0.25;

/** The bits of the office's worker (a minified class) this reads. */
interface Worker extends Pose {
  label: string;
  root: Object3D;
  body: Object3D;
  bulbMesh: Object3D;
  nameTag: Object3D | null;
  bubble: Object3D | null;
  papers: { group: Object3D };
  globe: { group: Object3D };
  outfit: Object3D[];
  garb: { body: Object3D; cap: Object3D } | null;
  whiskers: { group: Object3D } | null;
  dirt: { part: Object3D }[];
  crosses: Object3D[];
  skeleton: Object3D | null;
  update(dt: number, t: number): void;
  dispose(): void;
}

/** Every skinned worker, for casting and for poking at from the console (`__rbDruids`). */
const skinned: { worker: Worker; avatar?: Object3D; race: Race; clip: () => string }[] = [];
(globalThis as { __rbDruids?: typeof skinned }).__rbDruids = skinned;

function attach(w: Worker) {
  const update = w.update;
  let mixer: AnimationMixer | null = null;
  let clips = new Map<string, AnimationClip>();
  let current: AnimationAction | null = null;
  let avatar: Object3D | null = null;
  let blob: Object3D[] = [];
  const race = raceFor(w.label, skinned.map((s) => s.race));
  const entry: (typeof skinned)[number] = { worker: w, race, clip: () => (current ? bareClip(current.getClip().name) : "") };
  skinned.push(entry);

  w.update = function (dt, t) {
    update.call(this, dt, t);
    if (!avatar || !mixer) return;
    for (const o of [...blob, ...w.outfit, ...w.crosses, ...w.dirt.map((d) => d.part)]) o.visible = false;
    if (w.garb) w.garb.body.visible = w.garb.cap.visible = false;
    if (w.whiskers) w.whiskers.group.visible = false;
    if (w.skeleton) w.skeleton.visible = false;

    const [role, loop] = roleFor(w);
    const clip = clips.get(clipName(race, role)) ?? clips.get(clipName(race, "idle"));
    const next = clip && mixer.clipAction(clip);
    if (next && next !== current) {
      next.reset().setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      current ? next.crossFadeFrom(current, FADE, false).play() : next.play();
      current = next;
    }
    avatar.rotation.y = w.body.rotation.y;
    // the office has just placed these for its own 1.1 m worker
    if (w.nameTag) w.nameTag.position.y += LIFT;
    if (w.bubble) w.bubble.position.y += LIFT;
    mixer.update(dt);
  };
  const dispose = w.dispose;
  w.dispose = function () {
    skinned.splice(skinned.indexOf(entry), 1);
    dispose.call(this);
  };

  rigged(CAST[race].file).then((m) => {
    const a = clone(m.scene);
    a.scale.setScalar(HEIGHT / heightOf(a));
    a.traverse((o) => {
      o.userData.rbForest = "skip";
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    mixer = new AnimationMixer(a);
    clips = m.clips;
    // the blob as built: everything but the status bulb and the read/web props
    const keep = new Set<Object3D>([w.bulbMesh]);
    for (const g of [w.papers.group, w.globe.group]) g.traverse((o) => keep.add(o));
    blob = [];
    w.body.traverse((o) => { if ((o as Mesh).isMesh && !keep.has(o)) blob.push(o); });
    w.root.add(a);
    w.bulbMesh.position.y += LIFT;
    avatar = entry.avatar = a;
  }).catch((e) => console.warn(`[druids] ${race} failed to load; keeping the blob`, e));
}

const g = globalThis as { __rbWorkers?: { push(w: Worker): number } & Iterable<Worker> };
for (const w of g.__rbWorkers ?? []) attach(w);
g.__rbWorkers = { push: (w: Worker) => (attach(w), 0), *[Symbol.iterator]() {} };
