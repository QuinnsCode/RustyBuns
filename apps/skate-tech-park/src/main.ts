// The page: draws the sim, turns keys into its input, and keeps the chase camera behind the rider.
import { Car, createElement, Info, RectangleHorizontal, RotateCcw, Shield, ShieldOff, Users } from "lucide";
import * as THREE from "three";
import { mountPartsPicker } from "./parts-picker.ts";
import { BOARD_BUDGETS, type BoardBudget, dressBoard, dressRoadster, fingerboard, ROADSTER_BUDGETS, type RoadsterBudget, roadster, type Thruster } from "./models.ts";
import { levelMeshes } from "./render/pieces.ts";
import { KIT_BUDGETS, type KitBudget, loadKit } from "./render/kit.ts";
import { Plumes } from "./render/plumes.ts";
import { Chase } from "./render/chase.ts";
import { between, poseOf } from "./render/interp.ts";
import { Critters } from "./render/critters.ts";
import { type Chaser, chase as runAfter, chaseOf, gap, release } from "./chaser.ts";
import { ChaserView } from "./render/chaser.ts";
import { Barrier } from "./render/barrier.ts";
import { Scenery, scatter } from "./render/scenery.ts";
import { followCamera, sky, skyMood, skyTime } from "./render/sky.ts";
import { comboLine } from "./render/combo.ts";
import { Skins } from "./render/skins.ts";
import { Taps } from "./render/feet.ts";
import { lieOnGround, manualPose, rideableRise, popPose, TiltEase } from "./render/tilt.ts";
import { DT, type Flick, flickTime, IDLE, type Input, type Mode, noseUp, start, step, type State, tumble } from "./sim.ts";
import { HALF } from "./levels/plaza.ts";
import type { ParkLevel } from "./levels/park.ts";
import { TRICKS } from "./tricks.ts";
import { Gestures } from "./gesture.ts";
import { level, levelId, mood, mountLevelUi, park, spawn } from "./levels/picker.ts";
import { newRoomCode, Online, roomCode, pveMode } from "./net/client.ts";
import { bump } from "./net/bump.ts";
import { MAX_RIDERS } from "./net/room.ts";
import { Ghosts } from "./render/ghosts.ts";
import { Lightning, Precip } from "./render/weather.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(mood.haze);
scene.fog = new THREE.Fog(mood.haze, 60, 140);
renderer.toneMappingExposure = mood.exposure;
const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 2000);
const air = sky();
scene.add(air);

// The mood's light (golden hour unless the park says otherwise): a low sun and a sky fill.
const fill = new THREE.HemisphereLight(mood.skyFill, mood.groundFill, mood.fill);
scene.add(fill);
const sun = new THREE.DirectionalLight(mood.sunColor, mood.sunPower);
const sunAt = new THREE.Vector3(...mood.sun);
sun.position.copy(sunAt);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun, sun.target);
skyMood(air, mood);
const ui = mountLevelUi(scene);
if (scene.fog instanceof THREE.Fog) { scene.fog.near *= mood.fog[0]; scene.fog.far *= mood.fog[1]; } // rain and mist close the view in
const precip = new Precip(); // rain, snow, dust or drifting motes round the camera
precip.begin(mood);
scene.add(precip.object);
const lightning = mood.lightning ? new Lightning() : null;
const scenery = park ? new Scenery(scatter(level, (level as ParkLevel).ground)) : null; // small pines and rocks, for scale
if (scenery) scene.add(scenery.group);
const barrier = park ? new Barrier(level.bounds, level.height) : null; // the edge of the park, where the sim stops the board
if (barrier) scene.add(barrier.group);
const critters = park ? new Critters((level as ParkLevel).ground, level.spawns[0]) : null; // birds and small animals that bolt from the rider
if (critters) scene.add(critters.group);
// ?chase=moose|bear|bigfoot: an animal runs the rider down; a bail while it is close ends the run.
const species = chaseOf(location.search);
const beast = species ? new ChaserView(species) : null;
if (beast) scene.add(beast.group);
let hunter: Chaser | null = null;
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

// Every piece and rail, meshed by sampling its own height: two draw calls for the level. Then the Blender kit
// dresses the ramps, stairs and blocks (?kit=hi|mid|low, or ?kit=built to keep the sampled ones).
const groundOf = park ? (level as ParkLevel).ground.height : undefined;
let pieceMeshes = levelMeshes(level, groundOf);
scene.add(pieceMeshes);
const kitBudget = new URLSearchParams(location.search).get("kit") ?? "mid";
if (KIT_BUDGETS.includes(kitBudget as KitBudget)) {
  loadKit(kitBudget as KitBudget, async (f) => new URL(f, document.baseURI).href).then((kit) => {
    scene.remove(pieceMeshes);
    pieceMeshes.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    pieceMeshes = levelMeshes(level, groundOf, kit);
    scene.add(pieceMeshes);
  }).catch((e) => console.warn("kit models", e));
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

const car = roadster();
// The Blender roadster at a polygon budget (?car=hi|mid|low, or ?car=built for the shared one).
const carBudget = new URLSearchParams(location.search).get("car") ?? "mid";
if (ROADSTER_BUDGETS.includes(carBudget as RoadsterBudget)) {
  dressRoadster(car, new URL(`models/roadster-${carBudget}.glb`, document.baseURI).href).catch((e) => console.warn("roadster model", e));
}
const showroom = new URLSearchParams(location.search).has("showroom");
const PIVOT_Y = { fingerboard: 0.45, roadster: 0.6 }; // what a flip turns about
const board = fingerboard();
// The Blender model at a polygon budget (?board=hi|mid|low, or ?board=built for the three.js one alone).
const budget = new URLSearchParams(location.search).get("board") ?? "mid";
if (BOARD_BUDGETS.includes(budget as BoardBudget)) {
  dressBoard(board, new URL(`models/fingerboard-${budget}.glb`, document.baseURI).href).catch((e) => console.warn("board model", e));
}
const skins = new Skins({ fingerboard: board, roadster: car }, showroom ? "roadster" : "fingerboard", PIVOT_Y);
mountPartsPicker(board.userData.paint);
const plumes = new Plumes();
scene.add(skins.root, plumes.puffs.points);
const thrusters = car.userData.thrusters as Thruster[];
const plate = car.userData.plate as THREE.Group;

let mode: Mode = showroom ? "car" : "skate"; // the board is the game; the roadster is the skin you swap to
const begin = () => { const p = spawn(level); return start(p.x, p.z, p.yaw, level); };
let sim: State = begin();
let before = poseOf(sim); // where the board was one step ago, so a frame can draw between the two
const reset = () => {
  sim = showroom ? start(0, -20, 0, level) : begin();
  before = poseOf(sim);
  chase.snap(sim, skins.current);
  ui.reset();
  if (species) hunter = release(species, sim, level.height, level.bounds);
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
// G and V are the plain flicks beside F's kickflip; the compound tricks sit on the row above (see tricks.ts).
const FLICK_KEYS: [string, Flick][] = [["KeyG", "heelflip"], ["KeyV", "shove-it"], ["KeyR", "varial"], ["KeyT", "tre flip"], ["KeyY", "laser flip"], ["KeyU", "hardflip"], ["KeyI", "inward heel"], ["KeyO", "varial heel"]];
const input = (): Input => ({
  ...IDLE,
  throttle: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
  steer: (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0),
  jump: keys.has("Space"),
  boost: keys.has("ShiftLeft") || keys.has("ShiftRight"),
  flip: keys.has("KeyF"),
  flick: FLICK_KEYS.find(([code]) => keys.has(code))?.[1] ?? null,
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
tip.innerHTML = "<p><kbd>W</kbd><kbd>S</kbd> push, <kbd>A</kbd><kbd>D</kbd> steer, and spin in the air</p><p><kbd>Space</kbd> ollie, <kbd>F</kbd> kickflip, <kbd>G</kbd> heelflip, <kbd>V</kbd> shove-it</p><p><kbd>R</kbd> varial, <kbd>O</kbd> varial heel, <kbd>U</kbd> hardflip, <kbd>I</kbd> inward heel, <kbd>T</kbd> tre flip, <kbd>Y</kbd> laser flip</p><p>Or drag the mouse or push the right stick: up ollies, across and down flick, diagonals are the compound tricks, a long one down a double turn</p><p><kbd>Shift</kbd> rear jets and pump a transition, <kbd>E</kbd> suction fan</p><p><kbd>Q</kbd> hold a manual, <kbd>Z</kbd> a nose manual: <kbd>W</kbd> and <kbd>S</kbd> hold the balance, or hold the mouse still (nudged down for the nose), or use the pad's right and left triggers</p><p><kbd>Tab</kbd> swap board and roadster, <kbd>R</kbd> reset</p>";
help.addEventListener("click", () => { tip.hidden = !tip.hidden; help.blur(); });
function hud() {
  swapBtn.replaceChildren(icon(mode === "car" ? RectangleHorizontal : Car));
  swapBtn.title = mode === "car" ? "Fingerboard (Tab)" : "Roadster (Tab)";
  if (skins.show(mode === "car" ? "roadster" : "fingerboard")) plumes.landed(sim.x, sim.y, sim.z, 4); // the swap pops in a ring of puffs
  $("keys").replaceChildren(...ESSENTIALS(), help); // the rest sits behind the info button
  const n = (online?.riders.length ?? 0) + 1;
  $("room").textContent = !online ? "" : online.status === "in" ? `Room ${online.room}: ${n} of ${MAX_RIDERS}` : online.status === "full" ? `Room ${online.room} is full or offline` : online.status === "off" ? `Room ${online.room} is open in another tab` : `Joining ${online.room}...`;
  togetherBtn.title = online ? "Copy the room link" : "Ride with friends";
}

// Playing together: `?room=ABCD` joins a room of up to four riders; the button makes one and copies its link.
const ghosts = new Ghosts(scene);
const code = roomCode(location.search);
const pve = pveMode(location.search); // PvE: boards pass through each other
const online = code ? new Online(code, levelId, pve, () => { ghosts.set(online!.riders); hud(); }) : null;
const togetherBtn = $("together") as HTMLButtonElement;
togetherBtn.append(icon(Users));
togetherBtn.addEventListener("click", () => {
  if (!code) { location.search = `?${new URLSearchParams({ level: levelId, room: newRoomCode() })}`; return; }
  navigator.clipboard?.writeText(location.href).catch(() => {});
  togetherBtn.title = "Link copied";
  togetherBtn.blur();
});
hud();
const pveBtn = $("pve") as HTMLButtonElement;
pveBtn.hidden = !online;
pveBtn.append(icon(pve ? ShieldOff : Shield));
pveBtn.title = pve ? "PvE: boards pass through each other (click for collisions)" : "Collisions on (click for PvE)";
pveBtn.addEventListener("click", () => { const q = new URLSearchParams(location.search); if (pve) q.delete("pve"); else q.set("pve", "1"); location.search = `?${q}`; }); // a room is one mode, so this moves you to the other room
const chase = new Chase(camera);
const manualEase = new TiltEase();
const taps = new Taps($("taps")); // rings where the feet pop, drag and flick
const groundRise = (x: number, z: number): [number, number] => { const e = 0.25; return rideableRise((level.height(x + e, z) - level.height(x - e, z)) / (2 * e), (level.height(x, z + e) - level.height(x, z - e)) / (2 * e)); };
const slope = { x: 0, z: 0 }; // the ground's tilt under the board, eased
reset();
let caughtAt = -Infinity, critterAt = performance.now(), lastFrame = performance.now(), landVy = 0, acc = 0, then = performance.now(), shownTrick: State["last"] = null, trickAt = 0;

function frame(now: number) {
  acc = Math.min(acc + (now - then) / 1000, 0.25);
  then = now;
  const inp = input();
  landVy = 0;
  const pad = navigator.getGamepads?.().find((g) => g);
  if (pad) { gestures.stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0); gestures.shoulders(pad.buttons[6]?.value ?? 0, pad.buttons[7]?.value ?? 0); }
  while (acc >= DT) {
    const was = sim.air, vy = sim.vy;
    before = poseOf(sim);
    step(sim, { ...inp, ...gestures.take() }, level); // a gesture is one step's press
    if (online && !pve) bump(sim, online.riders);
    ui.update(sim); acc -= DT;
    if (hunter) { runAfter(hunter, sim, level.height, level.bounds, DT); if (hunter.caught) { caughtAt = now; reset(); } }
    for (const f of sim.feet) taps.add(f);
    if (was && !sim.air) landVy = vy;
  }

  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  const shown = { ...sim, ...between(before, sim, acc / DT) }; // the pose on screen: between the last two steps
  skins.update(dt);
  // Both skins ride the same pose; a flip or a grind turns whichever one is showing.
  const rider = skins.root, pivot = skins.pivot();
  rider.position.set(shown.x, shown.y, shown.z);
  const grounded = !sim.air && sim.bail <= 0 && sim.grind < 0, k = 1 - Math.exp(-40 * dt);
  const lie = grounded ? lieOnGround(...groundRise(shown.x, shown.z), shown.yaw) : sim.lip ? lieOnGround(Math.tan(sim.lip) * Math.sin(shown.yaw), Math.tan(sim.lip) * Math.cos(shown.yaw), shown.yaw) : { x: 0, z: 0 }; // along the ground, level again in the air (nose up the wall it just left)
  slope.x += (lie.x - slope.x) * k;
  slope.z += (lie.z - slope.z) * k;
  rider.rotation.set(slope.x, shown.yaw + (sim.grind >= 0 ? sim.grindOff : 0), slope.z, "YXZ");
  if (sim.bail > 0) { // a fall rolls on, hops and settles, then the rider stands up
    const fall = tumble(sim);
    rider.rotation.z = fall.roll;
    rider.position.y += fall.hop;
  }
  const done = sim.flipT > 0 ? 1 - sim.flipT / flickTime(sim.flipKind) : 0, { board, flip } = TRICKS[sim.flipKind];
  pivot.rotation.set(0, (board * Math.PI / 180) * done, flip * Math.PI * 2 * done);
  pivot.position.y = PIVOT_Y[skins.current] + (sim.flipT > 0 ? 0.25 : 0);
  // A manual: nose (or tail) up on two wheels, shaking as the balance runs out.
  const tilt = manualPose(manualEase.last, sim.balance, skins.current, PIVOT_Y[skins.current], sim.manualTime, manualEase.update(sim.manual, dt));
  pivot.rotation.x = tilt.pitch;
  pivot.rotation.z += tilt.roll;
  pivot.position.y += tilt.lift;
  // An ollie: the tail snaps, the nose kicks up, and the board levels itself out in the air.
  const popped = popPose(noseUp(sim), skins.current, PIVOT_Y[skins.current]);
  pivot.rotation.x += popped.pitch;
  pivot.position.y += popped.lift;
  {
    const f = sim.firing;
    plumes.update(dt, thrusters, thrusters.map((t) => (mode === "car" && (t.group === "rear" ? f.rear : t.group === "lift" ? f.lift : t.group === "spinL" ? f.spin === 1 : f.spin === -1))), sim.vx, sim.vy, sim.vz);
    if (landVy) plumes.landed(sim.x, sim.y, sim.z, Math.abs(landVy));
    plate.rotation.x = THREE.MathUtils.lerp(plate.rotation.x, sim.plateDown ? -Math.PI * 0.95 : 0, 0.3);
  }

  online?.send({ skin: skins.current, n: [rider.position.x, rider.position.y, rider.position.z, rider.rotation.x, rider.rotation.y, rider.rotation.z, pivot.rotation.x, pivot.rotation.y, pivot.rotation.z, pivot.position.y] }, now);
  chase.update(shown, skins.current, dt);
  if (showroom) { // ?showroom: the car parked, the camera circling it
    const a = now / 4000;
    chase.pos.set(sim.x + Math.sin(a) * 9, sim.y + 2, sim.z + Math.cos(a) * 9);
    chase.look.set(sim.x, sim.y + 0.6, sim.z);
  }
  chase.apply(level.bounds, level.height); // stay inside the walls
  followCamera(air, camera);
  precip.update(dt, camera.position);
  const flash = lightning?.update(dt) ?? 0;
  fill.intensity = mood.fill + flash * 3;
  skyTime(air, now / 1000, flash);
  barrier?.update(sim.x, sim.z);
  scenery?.update([sim, camera.position]);
  critters?.update(Math.min((now - critterAt) / 1000, 0.1), [sim, camera.position]);
  critterAt = now;
  sun.position.set(sim.x + sunAt.x, sim.y + sunAt.y, sim.z + sunAt.z); // a low sun, so the board throws a long shadow; the shadow box follows the rider
  sun.target.position.set(sim.x, sim.y, sim.z);

  if (hunter && beast) {
    beast.update(hunter);
    const note = now - caughtAt < 2500 ? `Caught by the ${species}` : `${species} ${Math.round(gap(hunter, sim))} m back`;
    if ($("chase").textContent !== note) $("chase").textContent = note;
  }
  $("score").textContent = String(sim.score);
  $("combo").textContent = comboLine(sim.combo, sim.comboScore);
  $("speed").textContent = `${Math.round(Math.abs(sim.air ? Math.hypot(sim.vx, sim.vz) : sim.speed) * 3.6)} km/h`;
  if (sim.last !== shownTrick) { shownTrick = sim.last; trickAt = now; }
  const trick = $("trick");
  trick.textContent = shownTrick ? (shownTrick.points ? `${shownTrick.name}  +${shownTrick.points}` : shownTrick.name) : "";
  if (sim.grind >= 0) trick.textContent = `${sim.grindKind}  balance ${"<".repeat(Math.max(0, Math.round(-sim.balance * 4)))}|${">".repeat(Math.max(0, Math.round(sim.balance * 4)))}`, trickAt = now;
  trick.classList.toggle("bail", !!shownTrick && !shownTrick.points);
  trick.style.opacity = (shownTrick || sim.grind >= 0) && (sim.grind >= 0 || now - trickAt < 2200) ? "1" : "0";

  camera.updateMatrixWorld();
  ghosts.update(dt, camera);
  taps.update(dt, pivot, skins.current, camera);
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
