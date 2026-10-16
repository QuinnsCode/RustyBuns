// The page: draws the sim, turns keys into its input, and keeps the chase camera behind the rider.
import { Car, createElement, Info, RectangleHorizontal, RotateCcw } from "lucide";
import * as THREE from "three";
import { mountPartsPicker } from "./parts-picker.ts";
import { fingerboard, roadster, type Thruster } from "./models.ts";
import { levelMeshes } from "./render/pieces.ts";
import { Plumes } from "./render/plumes.ts";
import { Chase } from "./render/chase.ts";
import { Scenery, scatter } from "./render/scenery.ts";
import { followCamera, HAZE, sky } from "./render/sky.ts";
import { Skins } from "./render/skins.ts";
import { lieOnGround, manualPose, TiltEase } from "./render/tilt.ts";
import { DT, FLICK_TIME, IDLE, type Input, type Mode, start, step, type State } from "./sim.ts";
import { HALF } from "./levels/plaza.ts";
import type { ParkLevel } from "./levels/park.ts";
import { Gestures } from "./gesture.ts";
import { level, mountLevelUi, park, spawn } from "./levels/picker.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(HAZE);
scene.fog = new THREE.Fog(HAZE, 60, 140);
const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 2000);
const air = sky();
scene.add(air);

// Golden hour: a low warm sun and a cool sky fill.
scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x8a6a50, 0.9));
const sun = new THREE.DirectionalLight(0xffd2a0, 2.4);
sun.position.set(-60, 22, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun, sun.target);
const ui = mountLevelUi(scene);
const scenery = park ? new Scenery(scatter(level, (level as ParkLevel).ground)) : null; // small pines and rocks, for scale
if (scenery) scene.add(scenery.group);
// The plaza's own floor, wall and towers; a park draws its ground instead.
const decor = new THREE.Group();
decor.visible = !park;
scene.add(decor);

// Concrete, drawn on a canvas: slabs with expansion joints.
function concrete() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b9b3aa";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = "rgba(60,50,40,0.35)";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const slab = concrete();
slab.repeat.set(20, 20);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ map: slab, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
decor.add(floor);

// Every piece and rail, meshed by sampling its own height: two draw calls for the level.
scene.add(levelMeshes(level, park ? (level as ParkLevel).ground.height : undefined));
// A low wall round the plaza, and a few blocks of city past it.
const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d7f72, roughness: 0.9 });
for (const [w, d, x, z] of [[HALF * 2, 1, 0, HALF + 0.5], [HALF * 2, 1, 0, -HALF - 0.5], [1, HALF * 2, HALF + 0.5, 0], [1, HALF * 2, -HALF - 0.5, 0]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), wallMat);
  m.position.set(x, 0.6, z);
  m.receiveShadow = true;
  decor.add(m);
}
const towerMat = [0x6f6a75, 0x84766a, 0x5d6670, 0x9b8a7a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
for (let i = 0; i < 28; i++) {
  const a = (i / 28) * Math.PI * 2, d = HALF + 14 + (i % 3) * 7, h = 12 + ((i * 37) % 23);
  const m = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), towerMat[i % 4]);
  m.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
  decor.add(m);
}

const car = roadster();
const showroom = new URLSearchParams(location.search).has("showroom");
const PIVOT_Y = { fingerboard: 0.45, roadster: 0.6 }; // what a flip turns about
const board = fingerboard();
const skins = new Skins({ fingerboard: board, roadster: car }, showroom ? "roadster" : "fingerboard", PIVOT_Y);
mountPartsPicker(board.userData.paint);
const plumes = new Plumes();
scene.add(skins.root, plumes.puffs.points);
const thrusters = car.userData.thrusters as Thruster[];
const plate = car.userData.plate as THREE.Group;

let mode: Mode = showroom ? "car" : "skate"; // the board is the game; the roadster is the skin you swap to
const begin = () => { const p = spawn(level); return start(p.x, p.z, p.yaw, level); };
let sim: State = begin();
const reset = () => {
  sim = showroom ? start(0, -20, 0, level) : begin();
  chase.snap(sim, skins.current);
  ui.reset();
};

// Keys → input. Space is the ollie on the board and the lift thrusters in the car.
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); swap(); return; }
  if (e.code === "KeyR") reset();
  keys.add(e.code);
  if (e.code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());
// The mouse and the right stick: a drag up is an ollie, across or down is a flick trick (see gesture.ts).
const gestures = new Gestures();
canvas.addEventListener("pointerdown", (e) => gestures.down(e.clientX, e.clientY, performance.now() / 1000));
window.addEventListener("pointermove", (e) => gestures.move(e.clientX, e.clientY));
window.addEventListener("pointerup", (e) => gestures.up(e.clientX, e.clientY));
const input = (): Input => ({
  ...IDLE,
  throttle: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
  steer: (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0),
  jump: keys.has("Space"),
  boost: keys.has("ShiftLeft") || keys.has("ShiftRight"),
  flip: keys.has("KeyF"),
  flick: keys.has("KeyG") ? "heelflip" : keys.has("KeyV") ? "shove-it" : null,
  fan: keys.has("KeyE"),
  manual: keys.has("KeyQ") ? 1 : keys.has("KeyZ") ? -1 : gestures.manual(performance.now() / 1000),
});

// The HUD: lucide icons with their words as tooltips.
const $ = (id: string) => document.getElementById(id)!;
const icon = (node: Parameters<typeof createElement>[0]) => createElement(node, { width: 18, height: 18 });
const swapBtn = $("swap") as HTMLButtonElement;
$("reset").append(icon(RotateCcw));
$("reset").addEventListener("click", () => { reset(); (document.activeElement as HTMLElement)?.blur(); });
swapBtn.addEventListener("click", () => { swap(); swapBtn.blur(); });
function swap() {
  mode = mode === "car" ? "skate" : "car"; // a skin: the ride carries on as it was
  hud();
}
const ESSENTIALS = () => {
  const k = (t: string) => Object.assign(document.createElement("kbd"), { textContent: t });
  const w = (t: string) => document.createTextNode(` ${t} `);
  return [k("W"), k("S"), w("push"), k("A"), k("D"), w("steer"), k("Space"), w("ollie"), k("F"), k("G"), k("V"), w("flips"), k("Q"), k("Z"), w("manuals")];
};
const help = document.createElement("button");
help.id = "help";
help.title = "All the controls";
help.append(icon(Info));
const tip = $("tip");
tip.innerHTML = "<p><kbd>W</kbd><kbd>S</kbd> push, <kbd>A</kbd><kbd>D</kbd> steer, and spin in the air</p><p><kbd>Space</kbd> ollie, <kbd>F</kbd> kickflip, <kbd>G</kbd> heelflip, <kbd>V</kbd> shove-it</p><p>Or drag the mouse or push the right stick: up ollies, across and down flick</p><p><kbd>Shift</kbd> rear jets and pump a transition, <kbd>E</kbd> suction fan</p><p><kbd>Q</kbd> hold a manual, <kbd>Z</kbd> a nose manual: <kbd>W</kbd> and <kbd>S</kbd> hold the balance, or hold the mouse still (nudged down for the nose), or use the pad's right and left triggers</p><p><kbd>Tab</kbd> swap board and roadster, <kbd>R</kbd> reset</p>";
help.addEventListener("click", () => { tip.hidden = !tip.hidden; help.blur(); });
function hud() {
  swapBtn.replaceChildren(icon(mode === "car" ? RectangleHorizontal : Car));
  swapBtn.title = mode === "car" ? "Fingerboard (Tab)" : "Roadster (Tab)";
  if (skins.show(mode === "car" ? "roadster" : "fingerboard")) plumes.landed(sim.x, sim.y, sim.z, 4); // the swap pops in a ring of puffs
  $("keys").replaceChildren(...ESSENTIALS(), help); // the rest sits behind the info button
}
hud();

const chase = new Chase(camera);
const manualEase = new TiltEase();
const slope = { x: 0, z: 0 }; // the ground's tilt under the board, eased
reset();
let lastFrame = performance.now(), landVy = 0, acc = 0, then = performance.now(), shownTrick: State["last"] = null, trickAt = 0;

function frame(now: number) {
  acc = Math.min(acc + (now - then) / 1000, 0.25);
  then = now;
  const inp = input();
  landVy = 0;
  const pad = navigator.getGamepads?.().find((g) => g);
  if (pad) { gestures.stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0); gestures.shoulders(pad.buttons[6]?.value ?? 0, pad.buttons[7]?.value ?? 0); }
  while (acc >= DT) {
    const was = sim.air, vy = sim.vy;
    step(sim, { ...inp, ...gestures.take() }, level); // a gesture is one step's press
 ui.update(sim); acc -= DT;
    if (was && !sim.air) landVy = vy;
  }

  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  skins.update(dt);
  // Both skins ride the same pose; a flip or a grind turns whichever one is showing.
  const rider = skins.root, pivot = skins.pivot();
  rider.position.set(sim.x, sim.y, sim.z);
  const grounded = !sim.air && sim.bail <= 0 && sim.grind < 0, k = 1 - Math.exp(-12 * dt);
  const lie = lieOnGround(grounded ? sim.pitch : 0, grounded ? sim.roll : 0); // along the ground, level again in the air
  slope.x += (lie.x - slope.x) * k;
  slope.z += (lie.z - slope.z) * k;
  rider.rotation.set(slope.x, sim.yaw + (sim.grind >= 0 ? sim.grindOff : 0), slope.z, "YXZ");
  if (sim.bail > 0) rider.rotation.z = mode === "car" ? Math.sin(sim.bail * 30) * 0.08 : 1.3;
  const turn = sim.flipT > 0 ? (1 - sim.flipT / FLICK_TIME) * Math.PI * 2 : 0;
  pivot.rotation.set(0, sim.flipKind === "shove-it" ? turn / 2 : 0, sim.flipKind === "heelflip" ? -turn : sim.flipKind === "kickflip" ? turn : 0);
  pivot.position.y = PIVOT_Y[skins.current] + (sim.flipT > 0 ? 0.25 : 0);
  // A manual: nose (or tail) up on two wheels, shaking as the balance runs out.
  const tilt = manualPose(manualEase.last, sim.balance, skins.current, PIVOT_Y[skins.current], sim.manualTime, manualEase.update(sim.manual, dt));
  pivot.rotation.x = tilt.pitch;
  pivot.rotation.z += tilt.roll;
  pivot.position.y += tilt.lift;
  {
    const f = sim.firing;
    plumes.update(dt, thrusters, thrusters.map((t) => (mode === "car" && (t.group === "rear" ? f.rear : t.group === "lift" ? f.lift : t.group === "spinL" ? f.spin === 1 : f.spin === -1))), sim.vx, sim.vy, sim.vz);
    if (landVy) plumes.landed(sim.x, sim.y, sim.z, Math.abs(landVy));
    plate.rotation.x = THREE.MathUtils.lerp(plate.rotation.x, sim.plateDown ? -Math.PI * 0.95 : 0, 0.3);
  }

  chase.update(sim, skins.current, dt);
  if (showroom) { // ?showroom: the car parked, the camera circling it
    const a = now / 4000;
    chase.pos.set(sim.x + Math.sin(a) * 9, sim.y + 2, sim.z + Math.cos(a) * 9);
    chase.look.set(sim.x, sim.y + 0.6, sim.z);
  }
  chase.apply(level.bounds, level.height); // stay inside the walls
  followCamera(air, camera);
  scenery?.update([sim, camera.position]);
  sun.position.set(sim.x - 60, sim.y + 22, sim.z - 30); // a low sun, so the board throws a long shadow; the shadow box follows the rider
  sun.target.position.set(sim.x, sim.y, sim.z);

  $("score").textContent = String(sim.score);
  $("speed").textContent = `${Math.round(Math.abs(sim.air ? Math.hypot(sim.vx, sim.vz) : sim.speed) * 3.6)} km/h`;
  if (sim.last !== shownTrick) { shownTrick = sim.last; trickAt = now; }
  const trick = $("trick");
  trick.textContent = shownTrick ? (shownTrick.points ? `${shownTrick.name}  +${shownTrick.points}` : shownTrick.name) : "";
  if (sim.grind >= 0) trick.textContent = `${sim.grindKind}  balance ${"<".repeat(Math.max(0, Math.round(-sim.balance * 4)))}|${">".repeat(Math.max(0, Math.round(sim.balance * 4)))}`, trickAt = now;
  trick.classList.toggle("bail", !!shownTrick && !shownTrick.points);
  trick.style.opacity = (shownTrick || sim.grind >= 0) && (sim.grind >= 0 || now - trickAt < 2200) ? "1" : "0";

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
