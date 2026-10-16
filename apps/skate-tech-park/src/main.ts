// The page: draws the sim, turns keys into its input, and keeps the chase camera behind the rider.
import { Car, createElement, PersonStanding, RotateCcw, Wind } from "lucide";
import * as THREE from "three";
import { roadster, skater, type Thruster } from "./models.ts";
import { Plumes } from "./render/plumes.ts";
import { railY } from "./level.ts";
import { DT, IDLE, type Input, type Mode, start, step, type State } from "./sim.ts";
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
scene.background = new THREE.Color(0xf2c49a);
scene.fog = new THREE.Fog(0xf2c49a, 60, 140);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

// Golden hour: a low warm sun and a cool sky fill.
scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x8a6a50, 0.9));
const sun = new THREE.DirectionalLight(0xffd2a0, 2.4);
sun.position.set(-40, 30, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, far: 150 });
scene.add(sun, sun.target);
const ui = mountLevelUi(scene);
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

// Each piece meshed by sampling its own height, in its own frame: the box's top follows it.
const rampMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.85 });
// The mesh hangs from its pad's floor (the lowest ground under its footprint), not from y=0.
const floorUnder = (p: (typeof level.pieces)[number]) => {
  if (!park) return 0;
  const g = (level as ParkLevel).ground, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  let low = Infinity;
  for (const [lx, lz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = (lx * p.w) / 2, z = (lz * p.d) / 2;
    low = Math.min(low, g.height(p.x + x * c + z * s, p.z - x * s + z * c));
  }
  return low;
};
for (const p of level.pieces) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const pos = geo.attributes.position;
  const base = floorUnder(p);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) * p.w, lz = pos.getZ(i) * p.d;
    pos.setXYZ(i, lx, pos.getY(i) > 0 ? Math.max(base, p.height(lx, lz)) : base, lz);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, rampMat);
  m.position.set(p.x, 0, p.z);
  m.rotation.y = p.yaw;
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.25, metalness: 0.9 });
for (const r of level.rails) {
  const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
  const rail = new THREE.Group();
  rail.position.set((r.a.x + r.b.x) / 2, 0, (r.a.z + r.b.z) / 2);
  rail.rotation.y = Math.atan2(r.b.x - r.a.x, r.b.z - r.a.z);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 12), steel);
  bar.rotation.x = Math.PI / 2 - Math.atan2((r.y2 ?? r.y) - r.y, len); // tilt to the slope
  bar.position.y = (r.y + (r.y2 ?? r.y)) / 2;
  bar.castShadow = true;
  rail.add(bar);
  for (let z = -len / 2 + 0.5; z < len / 2; z += 4) {
    const top = railY(r, (z + len / 2) / len);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, top, 8), steel);
    post.position.set(0, top / 2, z);
    rail.add(post);
  }
  scene.add(rail);
}
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

const car = roadster(), board = skater();
const plumes = new Plumes();
scene.add(car, board, plumes.puffs.points);
const thrusters = car.userData.thrusters as Thruster[];
const plate = car.userData.plate as THREE.Group;

const showroom = new URLSearchParams(location.search).has("showroom");
let mode: Mode = "car";
const begin = (m: Mode) => { const p = spawn(level, m); return start(m, p.x, p.z, p.yaw, level); };
let sim: State = begin(mode);
const reset = () => {
  sim = showroom ? start(mode, 0, -20, 0, level) : begin(mode);
  camPos.set(sim.x - Math.sin(sim.yaw) * 9, sim.y + 4, Math.max(sim.z - Math.cos(sim.yaw) * 9, level.bounds.minZ + 1));
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
canvas.addEventListener("pointerdown", (e) => gestures.down(e.clientX, e.clientY));
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
});

// The HUD: lucide icons with their words as tooltips.
const $ = (id: string) => document.getElementById(id)!;
const icon = (node: Parameters<typeof createElement>[0]) => createElement(node, { width: 18, height: 18 });
const swapBtn = $("swap") as HTMLButtonElement;
$("reset").append(icon(RotateCcw));
$("reset").addEventListener("click", () => { reset(); (document.activeElement as HTMLElement)?.blur(); });
$("tank-icon").append(icon(Wind));
swapBtn.addEventListener("click", () => { swap(); swapBtn.blur(); });
function swap() {
  mode = mode === "car" ? "skate" : "car";
  reset();
  hud();
}
function hud() {
  swapBtn.replaceChildren(icon(mode === "car" ? PersonStanding : Car));
  swapBtn.title = mode === "car" ? "Skate (Tab)" : "Roadster (Tab)";
  $("tank").hidden = mode !== "car";
  $("keys").innerHTML = mode === "car"
    ? "<kbd>W</kbd><kbd>S</kbd> drive <kbd>A</kbd><kbd>D</kbd> steer, spin in the air <kbd>Shift</kbd> rear thrusters <kbd>Space</kbd> lift thrusters <kbd>E</kbd> suction fan"
    : "<kbd>W</kbd><kbd>S</kbd> push <kbd>A</kbd><kbd>D</kbd> steer, spin in the air <kbd>Space</kbd> ollie <kbd>F</kbd> kickflip <kbd>G</kbd> heelflip <kbd>V</kbd> shove-it (or drag the mouse or push the right stick: up ollies, across and down flick) <kbd>Shift</kbd> pump a transition";
}
hud();

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
reset();
let lastFrame = performance.now(), landVy = 0, acc = 0, then = performance.now(), shownTrick: State["last"] = null, trickAt = 0;

function frame(now: number) {
  acc = Math.min(acc + (now - then) / 1000, 0.25);
  then = now;
  const inp = input();
  landVy = 0;
  const pad = navigator.getGamepads?.().find((g) => g);
  if (pad) gestures.stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  while (acc >= DT) {
    const was = sim.air, vy = sim.vy;
    step(sim, { ...inp, ...gestures.take() }, level); // a gesture is one step's press
 ui.update(sim); acc -= DT;
    if (was && !sim.air) landVy = vy;
  }

  const rider = mode === "car" ? car : board;
  car.visible = mode === "car";
  board.visible = mode === "skate";
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  rider.position.set(sim.x, sim.y, sim.z);
  rider.rotation.set(0, sim.yaw, 0);
  if (sim.bail > 0) rider.rotation.z = mode === "car" ? Math.sin(sim.bail * 30) * 0.08 : 1.3;
  if (mode === "skate") {
    const b = board.userData.board as THREE.Group, body = board.userData.body as THREE.Group;
    const turn = sim.flipT > 0 ? (1 - sim.flipT / 0.45) * Math.PI * 2 : 0;
    b.rotation.set(0, sim.flipKind === "shove-it" ? turn / 2 : 0, sim.flipKind === "heelflip" ? -turn : sim.flipKind === "kickflip" ? turn : 0);
    board.rotation.y += sim.grind >= 0 ? sim.grindOff : 0;
    b.position.y = sim.flipT > 0 ? 0.25 : 0;
    body.position.y = sim.air ? 0.15 : 0;
    body.scale.y = sim.air || sim.grind >= 0 ? 0.85 : 1;
  } else {
    const f = sim.firing;
    plumes.update(dt, thrusters, thrusters.map((t) => (t.group === "rear" ? f.rear : t.group === "lift" ? f.lift : t.group === "spinL" ? f.spin === 1 : f.spin === -1)), sim.vx, sim.vy, sim.vz);
    if (landVy) plumes.landed(sim.x, sim.y, sim.z, Math.abs(landVy));
    plate.rotation.x = THREE.MathUtils.lerp(plate.rotation.x, sim.plateDown ? -Math.PI * 0.95 : 0, 0.3);
  }

  // Chase from behind and above; in the air, hold back so the spin reads.
  const back = mode === "car" ? 9 : 5, up = mode === "car" ? 3.5 : 2.4;
  const dir = Math.hypot(sim.vx, sim.vz) > 3 && sim.air ? Math.atan2(sim.vx, sim.vz) : sim.yaw + (sim.speed < -0.5 ? Math.PI : 0);
  camPos.lerp(new THREE.Vector3(sim.x - Math.sin(dir) * back, sim.y + up, sim.z - Math.cos(dir) * back), 0.08);
  camLook.lerp(new THREE.Vector3(sim.x, sim.y + 1, sim.z), 0.2);
  if (showroom) { // ?showroom: the car parked, the camera circling it
    const a = now / 4000;
    camPos.set(sim.x + Math.sin(a) * 7, sim.y + 1.6, sim.z + Math.cos(a) * 7);
    camLook.set(sim.x, sim.y + 0.6, sim.z);
  }
  camPos.x = THREE.MathUtils.clamp(camPos.x, level.bounds.minX + 1, level.bounds.maxX - 1); // stay inside the walls
  camPos.z = THREE.MathUtils.clamp(camPos.z, level.bounds.minZ + 1, level.bounds.maxZ - 1);
  sun.position.set(sim.x - 40, sim.y + 30, sim.z - 25); // the shadow box follows the rider
  sun.target.position.set(sim.x, sim.y, sim.z);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  $("score").textContent = String(sim.score);
  $("speed").textContent = `${Math.round(Math.abs(sim.air ? Math.hypot(sim.vx, sim.vz) : sim.speed) * 3.6)} km/h`;
  ($("tank-fill") as HTMLElement).style.width = `${sim.tank * 100}%`;
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
