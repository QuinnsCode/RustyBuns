// The page: draws the sim, turns keys into its input, and keeps the chase camera behind the rider.
import { Car, createElement, Info, RectangleHorizontal, RotateCcw, Shield, ShieldOff, Users } from "lucide";
import * as THREE from "three";
import { cheese, sweepShot } from "@rustybuns/util";
import { autoQuality, pickQuality, QUALITY } from "@rustybuns/util/quality";
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
import { dressPeak, PEAK_BUDGETS, type PeakBudget } from "./render/peak.ts";
import { SCENERY_BUDGETS, type SceneryBudget, Scenery, dressTrees, loadScenery, scatter } from "./render/scenery.ts";
import { BIOMES, type Biome } from "./levels/park.ts";
import { followCamera, sky, skyMood, skyTime } from "./render/sky.ts";
import { comboLine } from "./render/combo.ts";
import { Skins } from "./render/skins.ts";
import { Taps } from "./render/feet.ts";
import { grabPose, lieOnGround, manualPose, rideableRise, popPose, TiltEase } from "./render/tilt.ts";
import { Driver, mountAgent } from "./agent.ts";
import { DT, type Flick, flickTime, IDLE, type Input, type Mode, noseUp, start, step, type State, tumble } from "./sim.ts";
import { HALF } from "./levels/plaza.ts";
import { grindLift } from "./grinds.ts";
import { BOARD } from "./level.ts";import type { ParkLevel } from "./levels/park.ts";
import { TRICKS } from "./tricks.ts";
import { Gestures } from "./gesture.ts";
import { pickProfile } from "./flick.ts";
import { PROFILES } from "./flick-profiles.ts";
import { mountGrip } from "./griptape.ts";
import { mountTouch } from "./touch.ts";
import { linkOf, scenarioOf, SPOTS, spotFor } from "./scenario.ts";
import { mountPerf } from "./perf.ts";
import { type Controls, loadControls, saveControls, tuned } from "./controls.ts";
import { DEFAULTS as CTL_DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { bind, hint, KEY } from "./bindings.ts";
import { controlsExtras } from "./controls-extras.ts";
import { level, levelId, mood, mountLevelUi, park, spawn } from "./levels/picker.ts";
import { LEVELS, touring as isTouring, wantsReal } from "./levels/index.ts";
import { tourShot, tourStops } from "./render/tour.ts";
import { newRoomCode, Online, roomCode, pveMode } from "./net/client.ts";
import { bump } from "./net/bump.ts";
import { MAX_RIDERS } from "./net/room.ts";
import { Ghosts } from "./render/ghosts.ts";
import { Lightning, Precip } from "./render/weather.ts";
import { finishSignIn, reportButton } from "./eqosys.ts";
import { mountFront } from "./front/front.ts";
import { showFront } from "./front/menu.ts";
import { mountPause } from "./pause.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
// The quality tier (?quality=low|mid|high, else the last one, else a guess from the GPU) sets the canvas's pixel
// ratio, antialias, shadows and the default model budgets; a run that stays slow steps itself down a tier.
const tier = pickQuality().quality;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY[tier].antialias, powerPreference: "high-performance" });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); notice("The graphics card gave out. Reload to ride again, with ?quality=low if it keeps happening."); });
function notice(text: string) {
  const p = Object.assign(document.createElement("p"), { className: "gpu-notice", textContent: text });
  document.body.append(p);
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(mood.haze);
scene.fog = new THREE.Fog(mood.haze, 60, 140);
renderer.toneMappingExposure = mood.exposure;
const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 2000);
const air = sky(undefined, tier === "low");
scene.add(air);

// The mood's light (golden hour unless the park says otherwise): a low sun and a sky fill.
const fill = new THREE.HemisphereLight(mood.skyFill, mood.groundFill, mood.fill);
scene.add(fill);
const sun = new THREE.DirectionalLight(mood.sunColor, mood.sunPower);
const sunAt = new THREE.Vector3(...mood.sun);
sun.position.copy(sunAt);
const auto = autoQuality(renderer, [sun], { quality: tier }); // sets the pixel ratio, shadows and shadow map size, and steps down on slow frames
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun, sun.target);
skyMood(air, mood);
const ui = mountLevelUi(scene);
reportButton();
if (showFront(location.search)) void finishSignIn().then((back) => mountFront(back?.error)); // the title and menu cover the page until a mode is chosen
if (scene.fog instanceof THREE.Fog) { scene.fog.near *= mood.fog[0]; scene.fog.far *= mood.fog[1]; } // rain and mist close the view in
const precip = new Precip(); // rain, snow, dust or drifting motes round the camera
precip.begin(mood);
scene.add(precip.object);
const lightning = mood.lightning ? new Lightning() : null;
const biomeAsked = new URLSearchParams(location.search).get("biome"); // ?biome=desert previews any park's ground cover as another biome's
const spots = park ? scatter(level, (level as ParkLevel).ground, 7, BIOMES.includes(biomeAsked as Biome) ? (biomeAsked as Biome) : undefined) : [];
let scenery = park ? new Scenery(spots) : null; // small pines and rocks, for scale: the built primitives first, the Blender set once it loads
if (scenery) scene.add(scenery.group);
const sceneryBudget = new URLSearchParams(location.search).get("scenery") ?? QUALITY[auto.quality].detail; // ?scenery=hi|mid|low, or ?scenery=built for the primitives
if (scenery && SCENERY_BUDGETS.includes(sceneryBudget as SceneryBudget)) {
  loadScenery(sceneryBudget as SceneryBudget, async (f) => new URL(f, document.baseURI).href).then((models) => {
    scene.remove(scenery!.group);
    scenery = new Scenery(spots, models);
    scene.add(scenery.group);
    dressTrees(scene, models.sequoia);
  }).catch((e) => console.warn("scenery models", e));
}
const peakBudget = new URLSearchParams(location.search).get("peak") ?? QUALITY[auto.quality].detail; // the far mountain a park may have (?peak=hi|mid|low, or ?peak=off)
if (park && PEAK_BUDGETS.includes(peakBudget as PeakBudget)) {
  for (const l of (level as ParkLevel).landmarks) {
    if (l.kind === "peak") dressPeak(l, new URL(`models/landmark-${l.model}-${peakBudget}.glb`, document.baseURI).href, mood.haze).then((g) => scene.add(g)).catch((e) => console.warn("peak model", e));
  }
}
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
const kitBudget = new URLSearchParams(location.search).get("kit") ?? QUALITY[auto.quality].detail;
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
const carBudget = new URLSearchParams(location.search).get("car") ?? QUALITY[auto.quality].detail;
if (ROADSTER_BUDGETS.includes(carBudget as RoadsterBudget)) {
  dressRoadster(car, new URL(`models/roadster-${carBudget}.glb`, document.baseURI).href).catch((e) => console.warn("roadster model", e));
}
const showroom = new URLSearchParams(location.search).has("showroom");
let grindRise = 0; // how far the board is lifted onto the bar's contact, eased
const PIVOT_Y = { fingerboard: 0.45, roadster: 0.6 }; // what a flip turns about
const board = fingerboard();
// The Blender model at a polygon budget (?board=hi|mid|low, or ?board=built for the three.js one alone).
const budget = new URLSearchParams(location.search).get("board") ?? QUALITY[auto.quality].detail;
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
  sim.stance = chosen.stance;
  before = poseOf(sim);
  chase.snap(sim, skins.current);
  ui.reset();
  if (species) hunter = release(species, sim, level.height, level.bounds);
};

// Keys → input. Space is the ollie on the board and the lift thrusters in the car.
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  const code = bind.canon(e.code); // a key you moved arrives as the code the game knows the action by
  if (code === "Tab") { e.preventDefault(); swap(); return; }
  if (code === "KeyR") reset();
  keys.add(code);
  if (code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(bind.canon(e.code)));
window.addEventListener("blur", () => keys.clear());
// The mouse and the right stick: a drag up is an ollie, across or down is a flick trick, as the flick profile lays
// them out (flick.ts, the library in flick-profiles.ts). `?flick=<name>` or `?flick=<profile JSON>` picks one, and
// the footprints button on the pad steps through the library; the last one picked is kept in the browser.
const FLICK_KEY = "skate-flick";
const stored = () => { try { return localStorage.getItem(FLICK_KEY); } catch { return null; } };
let chosen = pickProfile(PROFILES, new URLSearchParams(location.search).get("flick"), stored());
let controls = loadControls();
const gestures = new Gestures(tuned(chosen, controls));
// On a touch screen one thumb drives (touch.ts), so only the profile's half of the screen is the flick pad.
const scenario = scenarioOf(location.search); // ?controls=touch|desktop, ?weak, ?fps (scenario.ts)
const touch = mountTouch(scenario.controls);
const grip = mountGrip(touch.root);
// The cog's look speeds scale the stick (X steer, Y throttle, invert Y; the touch X and Y trims too) and, as touch, how far a flick drag must go.
// The game makes no sound, so the cog has no audio rows.
let look = { ...CTL_DEFAULTS };
let cogOpen = false; // the Controls dialog is open: the ride waits
// Every control setting applies live: the pad's side, size and labels, the stick's dead zone and inversion, the flick reach.
const applyControls = (c: Controls) => {
  controls = c;
  saveControls(c);
  const root = document.documentElement.style;
  root.setProperty("--pad-scale", String(c.size));
  root.setProperty("--pad-op", String(c.opacity));
  document.body.dataset.labels = c.labels;
  Object.assign(touch, { invertX: c.invertX, invertY: look.invertY, dead: c.dead });
  gestures.profile = tuned(chosen, c, look.touch);
  grip.show(gestures.profile);
};
const viewSet = { zoom: 1, tilt: 0 }; // shared with the chase camera, which is built further down
let extra: ReturnType<typeof controlsExtras> | undefined;
let hintsReady = false; // the cog reports its settings on mount, before the HUD below exists
mountControls({
  key: KEY, bindings: bind, parent: document.querySelector<HTMLElement>(".hud .buttons")!,
  keys: [["Left stick (touch)", "Throttle and steer"], ["Drag on the pad", "Flick tricks (touch)"], ["Esc", "Pause"]],
  show: ["touchAxes", "view"],
  onChange: (s) => {
    look = s;
    canvas.style.filter = s.brightness === 1 ? "" : `brightness(${s.brightness})`;
    Object.assign(viewSet, { zoom: s.zoom, tilt: s.tilt });
    applyControls(controls);
    if (hintsReady) { hud(); tipText(); } // the key caps on screen follow a rebind
  },
  onToggle: (open) => { cogOpen = open; keys.clear(); if (open) extra?.sync(); },
  onReset: () => { extra?.reset(); extra?.sync(); },
  extras: (card) => { extra = controlsExtras(card, {
    controls: () => controls, profiles: PROFILES, layout: () => chosen.name, onChange: applyControls,
    onLayout: (name) => {
      chosen = PROFILES.find((p) => p.name === name) ?? chosen;
      sim.stance = chosen.stance; // a goofy layout names the spins the other way round
      try { localStorage.setItem(FLICK_KEY, chosen.name); } catch { /* private window: the pick lasts this visit */ }
      applyControls(controls);
    },
  }); },
});
const scale = (v: number, k: number) => Math.max(-1, Math.min(1, v * k));
const onPad = (x: number) => (gestures.profile.side === "left" ? x < innerWidth / 2 : x >= innerWidth / 2);
let flicking = -1; // the pointer the gesture follows
canvas.addEventListener("pointerdown", (e) => {
  const touching = e.pointerType === "touch" || scenario.controls === "touch"; // ?controls=touch lets a mouse stand in for a thumb
  if (flicking >= 0 || touch.claims(e.pointerId) || (touching && !onPad(e.clientX))) return;
  flicking = e.pointerId;
  gestures.down(e.clientX, e.clientY, performance.now() / 1000, touching ? grip.along(e.clientX, e.clientY) : null);
});
window.addEventListener("pointermove", (e) => { if (e.pointerId === flicking) gestures.move(e.clientX, e.clientY); });
const lift = (e: PointerEvent) => {
  if (e.pointerId !== flicking) return;
  flicking = -1;
  gestures.up(e.clientX, e.clientY, performance.now() / 1000);
  grip.hit(gestures.last?.stroke ?? null);
};
window.addEventListener("pointerup", lift);
window.addEventListener("pointercancel", lift);
// G and V are the plain flicks beside F's kickflip; the compound tricks sit on the row above (see tricks.ts).
const FLICK_KEYS: [string, Flick][] = [["KeyG", "heelflip"], ["KeyV", "shove-it"], ["KeyR", "varial"], ["KeyT", "tre flip"], ["KeyY", "laser flip"], ["KeyU", "hardflip"], ["KeyI", "inward heel"], ["KeyO", "varial heel"], ["KeyB", "frontside shove-it"], ["KeyM", "360 shove-it"], ["KeyK", "double kickflip"], ["KeyL", "double heelflip"], ["KeyP", "frontside 360 shove-it"], ["KeyH", "360 hardflip"], ["KeyJ", "nightmare flip"]];
const input = (): Input => ({
  ...IDLE,
  throttle: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) || scale(touch.throttle, look.lookY * look.touchY),
  steer: (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) || scale(touch.steer, look.lookX * look.touchX),
  jump: keys.has("Space"),
  nollie: keys.has("KeyN"),
  boost: keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.boost,
  flip: keys.has("KeyF"),
  flick: FLICK_KEYS.find(([code]) => keys.has(code))?.[1] ?? null,
  fan: keys.has("KeyE"),
  manual: keys.has("KeyQ") || touch.manual ? 1 : keys.has("KeyZ") ? -1 : gestures.manual(performance.now() / 1000),
});

// The HUD: lucide icons with their words as tooltips.
const $ = (id: string) => document.getElementById(id)!;
const icon = (node: Parameters<typeof createElement>[0]) => createElement(node, { width: 18, height: 18 });
const swapBtn = $("swap") as HTMLButtonElement;
$("reset").append(icon(RotateCcw));
$("reset").addEventListener("click", () => { reset(); (document.activeElement as HTMLElement)?.blur(); });
swapBtn.addEventListener("click", () => { swap(); swapBtn.blur(); });
// An agent in the browser can ride too (WebMCP, agent.ts): its moves go through the same step as the keys.
const driver = new Driver();
const isSpotName = (n: string): n is (typeof SPOTS)[number] => SPOTS.some((k) => k === n);
const perf = mountPerf(scenario.fps && !isTouring(location.search), () => auto.quality, () => renderer.getPixelRatio());
void mountAgent({
  driver, state: () => sim, level, park: { id: levelId, spawns: level.spawns.map((p) => p.name) },
  parks: () => LEVELS.map((l) => ({ id: l.id, name: l.name })),
  go: (id, extra) => { location.search = linkOf({ level: id, ...extra }); },
  start: (name) => {
    const p = isSpotName(name) ? spotFor(level, name) : level.spawns.find((s) => s.name === name);
    if (!p) return false;
    sim = start(p.x, p.z, p.yaw, level); before = poseOf(sim); chase.snap(sim, skins.current); ui.reset();
    return true;
  },
  perf: () => perf.read(),
  spots: [...level.spawns.map((p) => p.name), ...SPOTS.filter((k) => spotFor(level, k))],
  reset, swap: () => { swap(); return mode === "car" ? "roadster" : "fingerboard"; },
  snapshot: () => { // drawn and read in the same task, so the buffer isn't cleared yet; 640 px wide keeps it small enough to hand an agent
    renderer.render(scene, camera);
    const small = Object.assign(document.createElement("canvas"), { width: 640, height: Math.round((640 * canvas.height) / canvas.width) });
    small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
    return small.toDataURL("image/jpeg", 0.8);
  },
});
function swap() {
  mode = mode === "car" ? "skate" : "car"; // a skin: the ride carries on as it was
  hud();
}
const ESSENTIALS = () => {
  const k = (t: string) => Object.assign(document.createElement("kbd"), { textContent: t });
  const w = (t: string) => document.createTextNode(` ${t} `);
  return [k(hint("push")), k(hint("brake")), w("push"), k(hint("left")), k(hint("right")), w("steer"), k(hint("ollie")), w("ollie"), k(hint("kickflip")), k(hint("heelflip")), k(hint("shoveit")), w("flips"), k(hint("manual")), k(hint("noseManual")), w("manuals")];
};
const help = document.createElement("button");
help.id = "help";
help.title = "All the controls";
help.append(icon(Info));
const tip = $("tip");
const tipText = () => {
  tip.innerHTML = "<p><kbd data-a=\"push\"></kbd><kbd data-a=\"brake\"></kbd> push, <kbd data-a=\"left\"></kbd><kbd data-a=\"right\"></kbd> steer, and spin in the air</p><p><kbd data-a=\"ollie\"></kbd> ollie, <kbd data-a=\"nollie\"></kbd> nollie, <kbd data-a=\"kickflip\"></kbd> kickflip, <kbd data-a=\"heelflip\"></kbd> heelflip, <kbd data-a=\"shoveit\"></kbd> shove-it</p><p><kbd data-a=\"varial\"></kbd> varial, <kbd data-a=\"varialHeel\"></kbd> varial heel, <kbd data-a=\"hardflip\"></kbd> hardflip, <kbd data-a=\"inward\"></kbd> inward heel, <kbd data-a=\"tre\"></kbd> tre flip, <kbd data-a=\"laser\"></kbd> laser flip, <kbd data-a=\"fsShoveit\"></kbd> frontside shove-it, <kbd data-a=\"shoveit360\"></kbd> 360 shove-it, <kbd data-a=\"fsShoveit360\"></kbd> frontside 360 shove-it, <kbd data-a=\"hardflip360\"></kbd> 360 hardflip, <kbd data-a=\"nightmare\"></kbd> nightmare flip, <kbd data-a=\"doubleKick\"></kbd> double kickflip, <kbd data-a=\"doubleHeel\"></kbd> double heelflip</p><p>Or drag the mouse or push the right stick: up ollies, across and down flick, diagonals are the compound tricks, a long one down a double turn. On a touch screen the flick pad shows its paths on a board like footprint grip tape; the footprints button picks another of twenty layouts</p><p><kbd data-a=\"boost\"></kbd> rear jets and pump a transition, <kbd data-a=\"fan\"></kbd> suction fan</p><p><kbd data-a=\"manual\"></kbd> hold a manual, <kbd data-a=\"noseManual\"></kbd> a nose manual: <kbd data-a=\"push\"></kbd> and <kbd data-a=\"brake\"></kbd> hold the balance, or hold the mouse still (nudged down for the nose), or use the pad's right and left triggers. Held in the air the same keys grab the tail or the nose, with steer a rail (indy, stalefish, mute, melon); held as the board catches a bar they keep that end high (bluntslide, blunt). Reach the coping slowly to stall on it, pop or brake to drop back in; meet a wall going along it to ride it</p><p><kbd data-a=\"swap\"></kbd> swap board and roadster, <kbd data-a=\"varial\"></kbd> reset</p><p>An agent in the browser can ride it too: WebMCP tools named skate_*</p>";
  for (const el of tip.querySelectorAll<HTMLElement>("kbd[data-a]")) el.textContent = hint(el.dataset.a ?? "");
};
tipText();
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
const online = code ? new Online(code, levelId, pve, wantsReal(location.search), () => { ghosts.set(online!.riders); hud(); }) : null;
const togetherBtn = $("together") as HTMLButtonElement;
togetherBtn.append(icon(Users));
togetherBtn.addEventListener("click", () => {
  if (!code) { location.search = `?${new URLSearchParams({ level: levelId, room: newRoomCode(), ...(wantsReal(location.search) ? { real: "" } : {}) })}`; return; }
  navigator.clipboard?.writeText(location.href).catch(() => {});
  togetherBtn.title = "Link copied";
  togetherBtn.blur();
});
hud();
hintsReady = true;
const pveBtn = $("pve") as HTMLButtonElement;
pveBtn.hidden = !online;
pveBtn.append(icon(pve ? ShieldOff : Shield));
pveBtn.title = pve ? "PvE: boards pass through each other (click for collisions)" : "Collisions on (click for PvE)";
pveBtn.addEventListener("click", () => { const q = new URLSearchParams(location.search); if (pve) q.delete("pve"); else q.set("pve", "1"); location.search = `?${q}`; }); // a room is one mode, so this moves you to the other room
const chase = new Chase(camera);
chase.view = viewSet;
const manualEase = new TiltEase(), grabEase = new TiltEase();
const WALL_LEAN = 2; // the ground's rise the view lays the board on through a wallride: steep, but not flat against the face
const taps = new Taps($("taps")); // rings where the feet pop, drag and flick
const groundRise = (x: number, z: number): [number, number] => { const e = 0.25; return rideableRise((level.height(x + e, z) - level.height(x - e, z)) / (2 * e), (level.height(x, z + e) - level.height(x, z - e)) / (2 * e)); };
const slope = { x: 0, z: 0 }; // the ground's tilt under the board, eased
reset();
let caughtAt = -Infinity, critterAt = performance.now(), lastFrame = performance.now(), landVy = 0, acc = 0, then = performance.now(), shownTrick: State["last"] = null, trickAt = 0;

// The home page: no rider, and the camera flies a slow tour of the park (render/tour.ts) behind the panels.
const touring = isTouring(location.search);
const stops = touring ? tourStops(level) : [];
if (touring) {
  skins.root.visible = false;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, far: 500 });
  sun.shadow.camera.updateProjectionMatrix();
}
const tourAt = Number(new URLSearchParams(location.search).get("at")) || 0; // ?at=40 starts forty seconds in, for a still

// The opening shot: a slow, cheesy sweep round the rider with a narrator's line, then the camera is yours. Any key,
// touch or agent move skips it. Not in a room, on the title screen, or on the home-page tour (?nosweep turns it off).
const SWEEP_SECONDS = 9, sweepAt = new THREE.Vector3(), sweepTo = new THREE.Vector3();
const sweep = { t: 0, on: !touring && !online && !showFront(location.search) && !new URLSearchParams(location.search).has("nosweep") };
const sweepEnd = () => { sweep.on = false; cine.hidden = true; };
const cine = $("cine");
cine.hidden = !sweep.on;
$("cine-line").textContent = cheese("skate", [...levelId].reduce((n, c) => n + c.charCodeAt(0), 0));
window.addEventListener("keydown", () => sweepEnd(), { once: true, capture: true });
window.addEventListener("pointerdown", () => sweepEnd(), { once: true, capture: true });
function tourFrame(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  const shot = tourShot(level, stops, tourAt + now / 1000);
  camera.fov = shot.fov;
  camera.updateProjectionMatrix();
  camera.position.set(...shot.pos);
  camera.lookAt(...shot.look);
  camera.updateMatrixWorld();
  followCamera(air, camera);
  precip.update(dt, camera.position);
  const flash = lightning?.update(dt) ?? 0;
  fill.intensity = mood.fill + flash * 3;
  skyTime(air, now / 1000, flash);
  scenery?.update([camera.position]);
  critters?.update(Math.min((now - critterAt) / 1000, 0.1), [camera.position]);
  critterAt = now;
  const [lx, ly, lz] = shot.look;
  sun.position.set(lx + sunAt.x, ly + sunAt.y, lz + sunAt.z);
  sun.target.position.set(lx, ly, lz);
  renderer.render(scene, camera);
}

// Esc pauses the ride. Not on the title screen or the home-page tour, where there is no ride to stop.
const pause = touring || showFront(location.search) ? null : mountPause(reset, () => { location.search = "?front"; });

function frame(now: number) {
  if (touring) { tourFrame(now); requestAnimationFrame(frame); return; }
  if (pause?.paused() || cogOpen) { then = lastFrame = critterAt = now; keys.clear(); renderer.render(scene, camera); requestAnimationFrame(frame); return; }
  acc = Math.min(acc + (now - then) / 1000, 0.25);
  then = now;
  if (sweep.on && driver.driving) sweepEnd();
  const inp = sweep.on ? IDLE : input();
  landVy = 0;
  const pad = navigator.getGamepads?.().find((g) => g);
  if (pad) { gestures.stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0); gestures.shoulders(pad.buttons[6]?.value ?? 0, pad.buttons[7]?.value ?? 0); }
  while (acc >= DT) {
    const was = sim.air, vy = sim.vy;
    before = poseOf(sim);
    step(sim, { ...inp, ...gestures.take(sim.air), ...driver.next() }, level); // a gesture is one step's press; an agent's move (agent.ts) is held like keys
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
  grindRise += ((sim.grind >= 0 ? grindLift(sim.grindKind, skins.current) : 0) - grindRise) * (1 - Math.exp(-30 * dt)); // the board sits on the bar by its deck or its trucks, not its wheels
  rider.position.y += grindRise;
  if (sim.grind >= 0) { // the bar is under the part of the deck it landed on, not always the middle
    const turn = shown.yaw + sim.grindOff;
    rider.position.x -= Math.sin(turn) * sim.grindAt * BOARD.halfLen; rider.position.z -= Math.cos(turn) * sim.grindAt * BOARD.halfLen;
  }
  const grounded = !sim.air && sim.bail <= 0 && sim.grind < 0, k = 1 - Math.exp(-40 * dt);
  const lie = grounded ? lieOnGround(...groundRise(shown.x, shown.z), shown.yaw) : sim.wall >= 0 ? lieOnGround(-sim.wallN[0] * WALL_LEAN, -sim.wallN[1] * WALL_LEAN, shown.yaw) : sim.lip ? lieOnGround(Math.tan(sim.lip) * Math.sin(shown.yaw), Math.tan(sim.lip) * Math.cos(shown.yaw), shown.yaw) : { x: 0, z: 0 }; // along the ground, on the face of a wallride, level again in the air (nose up the wall it just left)
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
  // A manual: nose (or tail) up on two wheels, shaking as the balance runs out. On a bar or the coping the same pose holds an end high (a bluntslide, a blunt).
  const nose = sim.grind >= 0 ? sim.grindNose : sim.manual;
  const tilt = manualPose(manualEase.last, sim.grind >= 0 ? 0 : sim.balance, skins.current, PIVOT_Y[skins.current], sim.manualTime, manualEase.update(nose, dt));
  pivot.rotation.x = tilt.pitch;
  pivot.rotation.z += tilt.roll;
  pivot.position.y += tilt.lift;
  // A grab: the hand pulls the held end up and tucks the board under the rider.
  const grab = grabPose(sim.grab, grabEase.update(sim.grab, dt), sim.grabRail);
  pivot.rotation.x += grab.pitch;
  pivot.rotation.z += grab.roll;
  pivot.position.y += grab.lift;
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
  if (sweep.on) { // the opening shot over the chase camera, handing the view back as it ends
    sweep.t += dt;
    const shot = sweepShot(sweep.t, { x: sim.x, y: sim.y, z: sim.z }, { seconds: SWEEP_SECONDS, radius: 14, height: 6 });
    chase.pos.lerp(sweepAt.set(shot.from.x, shot.from.y, shot.from.z), shot.mix);
    chase.look.lerp(sweepTo.set(shot.at.x, shot.at.y, shot.at.z), shot.mix);
    cine.style.setProperty("--bars", shot.mix.toFixed(3));
    if (sweep.t >= SWEEP_SECONDS) sweepEnd();
  }
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
  if (sim.grind >= 0) trick.textContent = sim.stall ? "stall" : sim.grindKind, trickAt = now;
  const leaning = sim.grind >= 0 || sim.manual !== 0, meter = $("balance");
  meter.classList.toggle("on", leaning);
  if (leaning) meter.style.setProperty("--lean", String(Math.max(-1, Math.min(1, sim.balance))));

  trick.classList.toggle("bail", !!shownTrick && !shownTrick.points);
  trick.style.opacity = (shownTrick || sim.grind >= 0) && (sim.grind >= 0 || now - trickAt < 2200) ? "1" : "0";

  camera.updateMatrixWorld();
  ghosts.update(dt, camera);
  taps.update(dt, pivot, skins.current, camera);
  renderer.render(scene, camera);
  if (scenario.weak) for (const end = performance.now() + scenario.weak; performance.now() < end;); // a slow machine, on demand
  perf.frame(now);
  auto.tick(now);
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
