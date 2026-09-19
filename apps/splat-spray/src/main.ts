import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { scan, spray } from "./spray.ts";
import { RevealField } from "./reveal.ts";
import { DEFAULT_GUN, due, pull, spreadOf, type Trigger } from "./gun.ts";
import { buildRoom, roomSlots } from "./levels/room.ts";
import { fillPackedSplats, placeObjects, shuffled, type SpyObject, type SpyScene } from "./levels/scene.ts";
import { rng } from "./levels/kit.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
const spark = new SparkRenderer({ renderer });
scene.add(spark);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
// left button is the trigger, so looking around is right-drag or the arrow keys
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } as any;
controls.listenToKeyEvents(window);

const GUN = { ...DEFAULT_GUN };
const HOME = { eye: new THREE.Vector3(0, 1.7, 6.4), target: new THREE.Vector3(0, 1.2, -0.6) };
const PICK_SPREAD_DEG = 1.1;
const WRONG_PICK_COST = 5;
const DOTS_PER_SHOT = 260;      // a shot lights this many points, scanner-style
const SHOT_SPREAD_DEG = 7;      // how wide the scan fans out

let shots = 0;            // this round
let totalShots = 0;
let wrong = 0;
let startedAt = 0;        // first shot of the round
let roundMs = 0;
let totalMs = 0;
let best: { shots: number; ms: number; name: string } | null = null;
const rand = rng(90210);
let slots = roomSlots(rand);
let target: SpyObject | null = null;
const found = new Set<number>();
let picking = false;
let trigger: Trigger | null = null;
let flight: { fromEye: THREE.Vector3; fromTarget: THREE.Vector3; eye: THREE.Vector3; look: THREE.Vector3; start: number; ms: number } | null = null;

const setText = (id: string, text: string) => { $(id).textContent = text; };
const say = (text: string) => setText("hint", text);
const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
function setShots(n: number) { shots = n; setText("rounds", String(n)); }
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
function setScore() {
  const bestText = best ? ` · best ${best.shots} shots in ${secs(best.ms)} (${best.name})` : "";
  setText("score", `${found.size} / ${room.objects.length} found · ${totalShots} shots · ${secs(totalMs)}${wrong ? ` · ${wrong} wrong` : ""}${bestText}`);
}
function tickTimer() {
  if (!target || !startedAt) return;
  setText("timer", secs(performance.now() - startedAt));
}

// ---------- the round ----------

function shuffleRoom() {
  slots = shuffled(roomSlots(rand), rand);
  placeObjects(room, slots);
  fillPackedSplats(room, mesh.packedSplats as any);
  (mesh.packedSplats as any).needsUpdate = true;
  mesh.updateVersion();
}

function nextTarget() {
  const left = room.objects.filter((o) => !found.has(o.id));
  if (!left.length) {
    target = null;
    field.focus(-1);
    setText("prompt", "Nothing left to find.");
    say(`All ${room.objects.length} found: ${totalShots} shots in ${secs(totalMs)}. "Start over" begins again.`);
    return;
  }
  target = left[Math.floor(rand() * left.length)]!;
  // a fresh dark room every round, with everything moved
  shuffleRoom();
  field.reset();
  field.focus(-1);
  setShots(0);
  startedAt = 0;
  setText("timer", "0.0s");
  setText("prompt", `I spy… ${article(target.name)} ${target.name}`);
  say("Hold the left button to scan. Right-drag to look. Hold Shift and click it when you see it. Fewest shots wins, time breaks ties.");
}

function flyTo(o: SpyObject | null) {
  const dist = o ? Math.max(0.5, o.radius * 4.5) : 0;
  const eye = o ? o.center.clone().add(new THREE.Vector3(dist * 0.45, dist * 0.5, dist)) : HOME.eye.clone();
  const look = o ? o.center.clone() : HOME.target.clone();
  flight = { fromEye: camera.position.clone(), fromTarget: controls.target.clone(), eye, look, start: performance.now(), ms: 900 };
}

function stepFlight() {
  if (!flight) return;
  const t = Math.min(1, (performance.now() - flight.start) / flight.ms);
  const e = t * t * (3 - 2 * t);   // ease in and out
  camera.position.lerpVectors(flight.fromEye, flight.eye, e);
  controls.target.lerpVectors(flight.fromTarget, flight.look, e);
  if (t >= 1) flight = null;
}

// ---------- firing and picking ----------

function rayFrom(x: number, y: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const inv = mesh.matrixWorld.clone().invert();
  const origin = ray.ray.origin.clone().applyMatrix4(inv);
  const dir = ray.ray.direction.clone().transformDirection(inv);
  return {
    centers: room.centers, opacities, radii,
    origin: [origin.x, origin.y, origin.z] as [number, number, number],
    dir: [dir.x, dir.y, dir.z] as [number, number, number],
    thickness: 0.06,
  };
}

/** A scan shot: scattered dots on whatever the rays hit first. */
const shootDots = (x: number, y: number, spreadDeg: number) =>
  scan({ ...rayFrom(x, y), halfAngleDeg: spreadDeg, dots: DOTS_PER_SHOT, rand });

/** Picking wants solid coverage of one object, not dots. */
const shootSolid = (x: number, y: number) =>
  spray({ ...rayFrom(x, y), halfAngleDeg: PICK_SPREAD_DEG });

function fireAt(x: number, y: number, spreadDeg: number) {
  if (!startedAt) startedAt = performance.now();
  const t0 = performance.now();
  const dots = shootDots(x, y, spreadDeg);
  const ms = performance.now() - t0;
  field.paint(dots);
  setShots(shots + 1);
  totalShots++;
  say(`${dots.length} dots (${ms.toFixed(1)} ms). ${((field.painted / field.count) * 100).toFixed(1)}% of the room lit.`);
  puff(x, y, "paint");
}

/** What did the player point at? The object with the most hits in the cone. */
function pickAt(x: number, y: number): SpyObject | null {
  const votes = new Map<number, number>();
  for (const i of shootSolid(x, y)) {
    const id = room.itemOf[i]!;
    if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
  }
  let best = -1, bestVotes = 0;
  for (const [id, n] of votes) if (n > bestVotes) { best = id; bestVotes = n; }
  return best >= 0 ? room.objects[best]! : null;
}

function tryPick(x: number, y: number) {
  if (!target) return;
  const picked = pickAt(x, y);
  puff(x, y, picked && picked.id === target.id ? "hit" : "miss");
  if (!picked) { say("Nothing there. Paint around to see what's nearby."); return; }
  if (picked.id !== target.id) {
    wrong++;
    setShots(shots + WRONG_PICK_COST);
    totalShots += WRONG_PICK_COST;
    setScore();
    say(`That's ${article(picked.name)} ${picked.name}, not ${article(target.name)} ${target.name}. Wrong picks cost ${WRONG_PICK_COST} rounds.`);
    return;
  }
  found.add(target.id);
  roundMs = startedAt ? performance.now() - startedAt : 0;
  totalMs += roundMs;
  if (!best || shots < best.shots || (shots === best.shots && roundMs < best.ms)) best = { shots, ms: roundMs, name: target.name };
  setScore();
  field.paintObject(target.first, target.count);
  field.focus(target.id);
  flyTo(target);
  setText("prompt", `Found the ${target.name}.`);
  say(`${shots} shot${shots === 1 ? "" : "s"} in ${secs(roundMs)}. Press Space or "Next" for another.`);
  $("next").hidden = false;
  target = null;
}

function advance() {
  $("next").hidden = true;
  flyTo(null);
  nextTarget();
}

// ---------- input ----------

function setPicking(on: boolean) {
  picking = on;
  document.body.classList.toggle("picking", on);
  $("pick").setAttribute("aria-pressed", String(on));
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (picking || e.shiftKey) { tryPick(e.clientX, e.clientY); return; }
  trigger = pull(GUN, e.clientX, e.clientY, performance.now());
  fireAt(e.clientX, e.clientY, GUN.spreadDeg);
});
canvas.addEventListener("pointermove", (e) => { if (trigger) { trigger.x = e.clientX; trigger.y = e.clientY; } });
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(ev, () => { trigger = null; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Shift") setPicking(true);
  if (e.code === "Space" && !$("next").hidden) { e.preventDefault(); advance(); }
});
addEventListener("keyup", (e: KeyboardEvent) => { if (e.key === "Shift") setPicking(false); });

$("pick").addEventListener("click", () => setPicking(!picking));
$("next").addEventListener("click", advance);
$("reveal").addEventListener("click", () => { field.revealAll(); field.focus(-1); });
$("reset").addEventListener("click", () => {
  found.clear();
  wrong = 0;
  totalShots = 0;
  totalMs = 0;
  best = null;
  setScore();
  advance();
});
$<HTMLInputElement>("rate").addEventListener("input", (e) => { GUN.ratePerSecond = Number((e.target as HTMLInputElement).value); });

function puff(x: number, y: number, kind: "paint" | "hit" | "miss") {
  const el = document.createElement("div");
  el.className = `puff ${kind}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- boot ----------

say("Building the room…");
const room: SpyScene = buildRoom();
const opacities = new Float32Array(room.count).fill(0.95);
const radii = new Float32Array(room.count);
for (let i = 0; i < room.count; i++) radii[i] = 2 * room.sizes[i]!;

const field = new RevealField(room.count, room.itemOf);
const mesh = new SplatMesh({
  maxSplats: room.count,
  constructSplats: (splats) => fillPackedSplats(room, splats as any),
  lod: false,
  // Spark's per-frame hook, just before splats regenerate: age the paint.
  onFrame: ({ mesh }) => {
    field.tick();
    mesh.updateVersion();
  },
});
await mesh.initialized;
mesh.worldModifier = field.modifier;
mesh.updateGenerator();
scene.add(mesh);
camera.position.copy(HOME.eye);
controls.target.copy(HOME.target);
controls.update();
setShots(0);
setScore();
nextTarget();

renderer.setAnimationLoop(() => {
  if (trigger) {
    const t = performance.now();
    for (let i = due(GUN, trigger, t); i > 0; i--) fireAt(trigger.x, trigger.y, spreadOf(GUN, trigger, t));
  }
  stepFlight();
  tickTimer();
  controls.update();
  renderer.render(scene, camera);
});

Object.assign(globalThis, {
  __spy: {
    fireAt, tryPick, pickAt, advance, shuffleRoom, GUN, room, field, camera,
    get shots() { return shots; },
    get totalShots() { return totalShots; },
    /** where an object sits on screen, for tests and for aiming help */
    screenOf(o: SpyObject) {
      const p = o.center.clone().project(camera);
      return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, visible: p.z < 1 };
    },
    get target() { return target; },
    get found() { return [...found]; },
  },
});
