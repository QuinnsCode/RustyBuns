// The page: draws the level (sim.ts) in first person with three.js, reads the mouse (pointer lock), WASD and a gamepad,
// and holds the menu with the eqosys account chip and the Qollab party. `window.loadIn` is the harness: `state()` says
// where you are, what you hold and where every piece of gear sits, and walkTo / pickUp / putDown play it without
// pointer lock, so an agent (bun run probe load-in) or a test asks the game instead of reading screenshots. The gear is
// @rustybuns/models' models at @rustybuns/gear's sizes; cables (src/cables/) drag behind you and plug into the models' jacks.
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import { gear } from "@rustybuns/gear";
import { gear as model, gearLook } from "@rustybuns/models/gear";
import { EYE, EYE_CROUCH, GARAGE, type Answer, type Level, aimed, dims, heldItem, holdPose, newWorld, partner, pickUp, push, putDown, snapshot, step, turnHeld, type World, wheeled } from "./sim.ts";
import * as cable from "./cables/cables.ts";
import { cableView } from "./cables/draw.ts";
import { connectorName } from "./cables/ends.ts";
import { DIVE_BAR, aim, barState, crowdState, master, raise, rig, settle, standHeight } from "./venues/dive-bar.ts";
import { type BarView, aimHint, barView } from "./venues/dive-bar-view.ts";
import { BIGGER_BAR } from "./venues/bigger-bar.ts";
import { type BiggerBarView, biggerBarView } from "./venues/bigger-bar-view.ts";
import { FIRST_GIG, gigState, runsOf } from "./venues/first-gig.ts";
import { type FirstGigView, firstGigView } from "./venues/first-gig-view.ts";
import { BAND_NIGHT, night } from "./venues/band-night.ts";
import type { Fault } from "@rustybuns/gear";
import { type BandNightView, bandNightView } from "./venues/band-night-view.ts";
import { PARK, parkState, pour } from "./venues/park.ts";
import { type ParkView, parkView } from "./venues/park-view.ts";
import { ARENA, type Leg, arenaState, fly, lower, rack, reserved, send, setHang, setLeg, setSub, unrack, wait as idle } from "./venues/arena.ts";
import { type ArenaView, arenaView } from "./venues/arena-view.ts";
import * as arenaSim from "./venues/small-arena.ts";
import { type ArenaView as SmallArenaView, arenaView as smallArenaView } from "./venues/small-arena-view.ts";
import * as amphi from "./venues/amphitheatre.ts";
import { type AmphitheatreView, amphitheatreView } from "./venues/amphitheatre-view.ts";
import { SHOW } from "./venues/show.ts";
import { type ShowView, showView } from "./venues/show-view.ts";
import { DESERT, bringRig, desertState, wrap } from "./venues/desert.ts";
import { type DesertView, desertView } from "./venues/desert-view.ts";
import * as fest from "./venues/festival.ts";
import { type FestivalView, festivalView } from "./venues/festival-view.ts";
import { DJ_BOOTH, DJ_BOOTH_MEDIA } from "./venues/dj-booth.ts";
import { type DjBoothView, djBoothView } from "./venues/dj-booth-view.ts";
import { hasSwitch, hear, type Switches } from "./audio/hear.ts";
import { soundSystem } from "./audio/play.ts";
import { currentDial, setDial } from "./assists.ts";
import { doors } from "./clock.ts";
import { mountClock, mountDial, mountGlow, savedDial } from "./dial-view.ts";
import { shut, stow, strike, strikeState } from "./strike.ts";
import { mountStrike, truckMesh } from "./strike-view.ts";
import { type Tour, bookedRung, buy, record } from "./tour.ts";
import { ringing } from "./crowd/crowd.ts";
import { fillFromTour, spotOf } from "./crowd/spots.ts";
import { loadTour, mountTour, saveTour } from "./tour-view.ts";
import { accountChip, canSignIn, finishSignIn, login, party, type PartyMember } from "./eqosys.ts";
import { eyeFill, fill, readable, shade, venueLights } from "./look.ts";
import { CABLE_RADIUS, REST } from "@rustybuns/rig/hand";
import { CABLE, leftM, rollKg } from "./cables/roll.ts";
import { handsView, type Hold } from "./hands/view.ts";
import { mountInk } from "./you/ink-view.ts";
import { wireBooth } from "./venues/dj-booth-wire.ts";
import { shoesView, type ShoeColour } from "./you/shoes.ts";
import { dress, faceLook, type Dressed } from "./faces.ts";
import { begun, idlePrompt, nextStep, tapeLabel, towardMark, towardName } from "./next.ts";
import { marksView } from "./marks-view.ts";
import { toward } from "./toward.ts";
import { COLOR } from "./cables/draw.ts";
import { joinCrew, roomCode, type Online } from "./crew/online.ts";
import { crewView } from "./crew/view.ts";
import { touchPlay } from "./touch.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const KEY = "load-in.controls";

const LEVELS: Record<string, Level> = { "first-gig": FIRST_GIG, "band-night": BAND_NIGHT, garage: GARAGE, "dive-bar": DIVE_BAR, "bigger-bar": BIGGER_BAR, park: PARK, arena: ARENA, "small-arena": arenaSim.SMALL_ARENA, show: SHOW, desert: DESERT, "dj-booth": DJ_BOOTH, "dj-booth-media": DJ_BOOTH_MEDIA, amphitheatre: amphi.AMPHITHEATRE, festival: fest.FESTIVAL };
const levelFrom = (name: string | null) => LEVELS[name ?? ""] ?? GARAGE;
/** The tour between nights; a page opened on ?level= plays that level and leaves the tour alone. */
let tour: Tour = loadTour();
const asked = new URLSearchParams(location.search).get("level");
// ?rig= brings another open-air rig to the desert (venues/desert.ts bringRig)
if (new URLSearchParams(location.search).has("rig")) bringRig(new URLSearchParams(location.search).get("rig"));
let world: World = newWorld(asked ? levelFrom(asked) : bookedRung(tour).level);
/** Whether tonight's show at the booked gig has been settled into the tour. */
let settled = false;
/** Whether the doors opened on this level tonight: the show is on, and L can strike it after. */
let doorsOpen = false;
let tourView: ReturnType<typeof mountTour> | null = null;
let cables = cable.newCables(world);
/** A refusal shown under the crosshair for a moment ("a power cable doesn't fit xlr-in"). */
let flash = { text: "", until: 0 };
let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
const keys = new Set<string>();
const switchedOn: Switches = new Set();
const sound = soundSystem($("speakers"));
const crew = { code: "", members: [] as PartyMember[], room: "", seat: -1, note: "" };
/** The crew room the party's Start (or `?room=CODE`) put you in: friends' bodies, gear carried together, and shared cables. */
let online: Online | null = null;
function crewRoom(room: string) {
  online?.close();
  online = joinCrew(room, world.level.name, () => world, () => cables, menu, () => switchedOn, () => dj?.shared ?? null);
}
const pad = loadPad(KEY, [
  { id: "grab", label: "Pick up / put down / plug in", button: 0 },
  { id: "crouch", label: "Crouch", button: 1 },
  { id: "turnLeft", label: "Turn it left", button: 4 },
  { id: "turnRight", label: "Turn it right", button: 5 },
]);
/** Touch: a thumb stick, a drag to look, and buttons that press the same keys (touch.ts). */
const touch = touchPlay(canvas, $("hud"), press);

// The scene: the garage's floor, walls and the venue's own lights (look.ts), the driveway outside, a model per piece
// of gear, the cables, and your hands.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1420);
scene.fog = new THREE.Fog(0x0d1420, 8, 22);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 150);
camera.rotation.order = "YXZ";
scene.add(camera);
const sky = new THREE.HemisphereLight(0xc8d4e6, 0x2a2420, fill(world.level));
scene.add(sky);
eyeFill(camera);
const hands = handsView(scene, camera);
// Hold Y to look at your arms (I is taken: the arena levels check a point with it).
let showArms = false;
window.addEventListener("keydown", (e) => { if (e.code === "KeyY") showArms = true; });
window.addEventListener("keyup", (e) => { if (e.code === "KeyY") showArms = false; });
$("arms").addEventListener("pointerdown", (e) => { e.stopPropagation(); showArms = true; });
for (const up of ["pointerup", "pointercancel", "pointerleave"]) $("arms").addEventListener(up, () => { showArms = false; });
const shoes = shoesView(scene);
const marks = marksView(scene);
const ink = mountInk($("ink-host"), hands, () => tour.nights, shoes);
// Solve the grips the game uses while the menu is up, one a tick, so the first grab doesn't hitch.
[REST, { kind: "flat" } as const, { kind: "roll" } as const, { kind: "plug" } as const, ...[...Object.values(CABLE_RADIUS), ...Object.values(CABLE).map((c) => c.radius)].map((radius) => ({ kind: "cable", radius }) as const)].forEach((w, i) => setTimeout(() => hands.warm([w]), 200 + i * 60));
let lights = venueLights(world.level);
scene.add(lights);
// The marker over what the Next line is about: a small cone pointing down, bobbing.
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x4cc9f0 }));
scene.add(marker);
// Once it is on screen the piece itself stands out: a lit outline round it and a pool of light on the floor under it,
// with a lamp over it so its own faces catch the light. The lamp is always in the scene (dimmed to 0, never hidden), so
// showing it does not rebuild every material.
const goal = new THREE.Group();
const goalLine = new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, depthTest: false });
const goalEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), goalLine);
goalEdges.renderOrder = 2;
const goalPool = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
goal.add(goalEdges, goalPool);
scene.add(goal);
const goalLamp = new THREE.PointLight(0x9fe3ff, 0, 2.6, 1.6);
scene.add(goalLamp);
// Where the piece goes (the free stand for a top): a thin tripod is lost against a dark wall, so it gets a crew's spike
// mark on the floor (a ring of warm tape with a cross), a soft beam down from the ceiling and its own warm lamp. Amber,
// where the piece to lift is blue. The lamp too is always in the scene, dimmed to 0.
const spot = new THREE.Group();
const spotMark = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: spikeTexture(), transparent: true, depthWrite: false }));
const spotGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTexture(0xffb45a), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xffcf8a, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const spotBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 1, 1, 32, 1, true).translate(0, 0.5, 0), beamMat);
spotMark.renderOrder = spotGlow.renderOrder = 1;
spot.add(spotGlow, spotMark, spotBeam);
spot.visible = false;
scene.add(spot);
const spotLamp = new THREE.PointLight(0xffc88a, 0, 2.8, 1.6);
// While the piece has a place to go, both ends speak amber: its outline, pool, cone and lamp take the stand's warm
// colour, and a dashed line of the same tape runs along the floor from your feet to the piece and on to its stand
// (from you, once it is in your hands).
const COOL = 0x4cc9f0, WARM = 0xff8a1e, coolPool = goalPool.material.map, warmPool = poolTexture(WARM);
const trails = [0, 1].map(() => {
  const tex = trailTexture(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.renderOrder = 1;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, tex };
});
/** Lay one length of tape from `a` to `b` on the floor, short of each end by `inset` (or a third of the way, if shorter). */
function layTrail(t: (typeof trails)[number], a: { x: number; z: number } | null | undefined, b: { x: number; z: number } | null | undefined, inset: [number, number]) {
  const dx = b && a ? b.x - a.x : 0, dz = b && a ? b.z - a.z : 0, len = Math.hypot(dx, dz);
  t.mesh.visible = !!a && !!b && len > 0.9;
  if (!a || !b || !t.mesh.visible) return;
  const i0 = Math.min(inset[0], len / 3), i1 = Math.min(inset[1], len / 3), run = len - i0 - i1, mid = i0 + run / 2;
  t.mesh.position.set(a.x + (dx / len) * mid, (world.level.floorAt?.(b.x, b.z) ?? 0) + 0.011, a.z + (dz / len) * mid);
  t.mesh.rotation.y = -Math.atan2(dz, dx);
  t.mesh.scale.set(run, 1, 0.1);
  t.tex.repeat.set(run / 0.3, 1);
  t.tex.offset.x = -performance.now() / 1600;
}
function trailTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(245, 120, 20, 0.95)"; g.fillRect(4, 2, 36, 12);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
/** Empty hands drop out of the way while you look at a piece or the Next one is in view (set a frame late, after the goal). */
let handsLow = false;
scene.add(spotLamp);
function spikeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255, 196, 110, 0.95)"; g.lineWidth = 16;
  g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 14; g.lineCap = "butt";
  g.beginPath(); g.moveTo(128, 70); g.lineTo(128, 186); g.moveTo(70, 128); g.lineTo(186, 128); g.stroke();
  return new THREE.CanvasTexture(c);
}
/** Up the beam: bright at the floor, gone by the ceiling. */
function beamTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 128;
  const g = c.getContext("2d")!, r = g.createLinearGradient(0, 0, 0, 128);
  r.addColorStop(0, "rgba(255,255,255,0)"); r.addColorStop(0.5, "rgba(255,255,255,0.07)"); r.addColorStop(1, "rgba(255,255,255,0.22)");
  g.fillStyle = r; g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}
function poolTexture(color = 0x4cc9f0) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  const rgb = `${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}`;
  r.addColorStop(0, `rgba(${rgb}, 0.85)`); r.addColorStop(0.55, `rgba(${rgb}, 0.4)`); r.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function room(l: World["level"]) {
  const g = new THREE.Group(), r = l.room, b = l.bounds;
  if (l.truck) g.add(truckMesh(l.truck));
  if (l.outdoor) return g; // the venue's view draws the ground and the sky
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  const W = r.x1 - r.x0, D = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, wall = mat(0x6b6f73), t = 0.1;
  box(W, 0.02, D, cx, -0.01, (r.z0 + r.z1) / 2, mat(0x8a8780));
  box(b.x1 - b.x0 + 1, 0.02, b.z1 - r.z1 + 1, cx, -0.012, (r.z1 + b.z1 + 1) / 2, mat(0x3c3d3f));
  box(W, r.height, t, cx, r.height / 2, r.z0 - t / 2, wall);
  box(t, r.height, D, r.x0 - t / 2, r.height / 2, (r.z0 + r.z1) / 2, wall);
  box(t, r.height, D, r.x1 + t / 2, r.height / 2, (r.z0 + r.z1) / 2, wall);
  const side = (W - r.door) / 2, doorTop = 2.1;
  box(side, r.height, t, r.x0 + side / 2, r.height / 2, r.z1 + t / 2, wall);
  box(side, r.height, t, r.x1 - side / 2, r.height / 2, r.z1 + t / 2, wall);
  box(r.door, r.height - doorTop, t, cx, (r.height + doorTop) / 2, r.z1 + t / 2, wall);
  box(W, t, D, cx, r.height + t / 2, (r.z0 + r.z1) / 2, mat(0x55585c));
  for (const o of l.outlets) box(0.08, 0.12, 0.02, o.x, o.y, o.z, mat(0xe8e4d8));
  return g;
}
let roomGroup = room(world.level);
scene.add(roomGroup);

const meshes = new Map<string, THREE.Object3D>(), look = gearLook();
readable(look);
const faces = faceLook(look), dressed = new Map<string, Dressed>();
const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: 0x4cc9f0 }));
scene.add(highlight);
let bar: BarView | ParkView | DesertView | null = null;
let big: BiggerBarView | null = null;
let gig: FirstGigView | null = null;
let band: BandNightView | null = null;
let ar: ArenaView | null = null;
/** The festival's view: two stages, the compound, the licence. */
let festival: FestivalView | null = null;
/** The small arena's view (`ar` is the big arena's). */
let arena: SmallArenaView | null = null;
let foh: ShowView | null = null;
let amp: AmphitheatreView | null = null;
/** The DJ booth's view: the decks, their moving parts and their sound. */
let dj: DjBoothView | null = null;
/** A piece's model (a stand at `height`), or a plain box at its catalog size if @rustybuns/models has none. */
function modelOf(id: string, height?: number, key?: string): THREE.Object3D {
  if (cable.hasModel(id)) {
    const m = model(id, { look, height });
    if (key) dressed.set(key, dress(m, faces, { stencil: key === cables.caseKey ? "CABLES" : undefined, tape: tapeLabel(key, id) }));
    return m;
  }
  const { w, h, d } = gear(id).size, m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), look.paint);
  m.userData.size = [w, h, d];
  return m;
}
function buildItems() {
  for (const m of meshes.values()) scene.remove(m);
  meshes.clear();
  dressed.clear();
  for (const i of world.items) {
    const m = modelOf(i.gear, undefined, i.key);
    meshes.set(i.key, m);
    scene.add(m);
  }
  bar?.dispose();
  // On tour, every floor fills to the tour's share of a full room (the house plus your following); a ?level= page fills it.
  if (!asked) fillFromTour(world, tour);
  bar = world.level === DIVE_BAR ? barView(scene, $("hud"), () => world)
    : world.level === PARK ? parkView(scene, $("hud"), () => world, () => cables)
    : world.level === DESERT ? desertView(scene, $("hud"), () => world, () => cables) : null;
  big?.dispose();
  big = world.level === BIGGER_BAR ? biggerBarView(scene, $("hud"), () => world, () => cables) : null;
  gig?.dispose();
  gig = world.level === FIRST_GIG ? firstGigView(scene, $("hud"), () => world, () => cables, () => switchedOn) : null;
  band?.dispose();
  // Band night seeds its faults by the nights played: a new stage each time you come back, the same one on a reload.
  if (world.level === BAND_NIGHT) night(world, tour.nights.length + 1);
  band = world.level === BAND_NIGHT ? bandNightView(scene, $("hud"), () => world, () => cables, () => switchedOn) : null;
  ar?.dispose();
  ar = world.level === ARENA ? arenaView(scene, $("hud"), () => world) : null;
  arena?.dispose();
  arena = world.level === arenaSim.SMALL_ARENA ? smallArenaView(scene, $("hud"), () => world) : null;
  festival?.dispose();
  festival = world.level === fest.FESTIVAL ? festivalView(scene, $("hud"), () => world) : null;
  amp?.dispose();
  amp = world.level === amphi.AMPHITHEATRE ? amphitheatreView(scene, $("hud"), () => world) : null;
  // The amphitheatre is 110 m deep under 90 m of rock: the camera sees that far there.
  camera.far = amp ? 900 : 150;
  camera.updateProjectionMatrix();
  foh?.dispose();
  foh = world.level === SHOW ? showView(scene, $("hud"), () => world) : null;
  dj?.dispose();
  dj = world.level === DJ_BOOTH || world.level === DJ_BOOTH_MEDIA ? djBoothView(scene, $("hud"), () => world, () => cables, (k) => meshes.get(k), say) : null;
  sound.feed(dj ? dj.audio : null);
  touch.venue(world.level.name);
}
buildItems();
marks.build(world);
const ropes = cableView(scene);
const mates = crewView(scene);

/** A new level, or the same one as it began: the room, the gear and the case of cables. */
const glow = mountGlow(scene);
let clock: ReturnType<typeof mountClock> | null = null;
let loadOut: ReturnType<typeof mountStrike> | null = null;

function load(level: Level) {
  world = newWorld(level);
  settled = false;
  doorsOpen = false;
  cables = cable.newCables(world);
  ropes.clear();
  scene.remove(roomGroup); roomGroup = room(world.level); scene.add(roomGroup);
  scene.remove(lights); lights = venueLights(world.level); scene.add(lights);
  marks.build(world);
  sky.intensity = fill(world.level);
  buildItems();
  // A crew is a room on one level: another level is another room with the same code.
  if (online) crewRoom(online.room);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

function draw() {
  const you = world.you, at = aimed(world), held = heldItem(world), hp = holdPose(world);
  camera.position.set(you.x, (you.crouch ? EYE_CROUCH : EYE) + (world.level.floorAt?.(you.x, you.z) ?? 0), you.z);
  camera.rotation.set(you.pitch, you.yaw, 0);
  for (const i of world.items) {
    // A piece that came in after the level was built (a crew's load, crewLoad in sim.ts) gets its model now.
    if (!meshes.has(i.key)) { const n = modelOf(i.gear, undefined, i.key); meshes.set(i.key, n); scene.add(n); }
    const tall = i.gear === "stand-tripod" ? standHeight(world, i.key) : 0;
    // A stand raised or lowered is a new model: its pole grows.
    if (tall && meshes.get(i.key)!.userData.size[1] !== tall) { scene.remove(meshes.get(i.key)!); const n = modelOf(i.gear, tall); meshes.set(i.key, n); scene.add(n); }
    const m = meshes.get(i.key)!, p = i === held && hp ? hp : i;
    m.position.set(p.x, p.y, p.z);
    // A speaker tilted (or a line array box at its splay) leans forward or back as it faces.
    m.rotation.set(i === held ? 0 : -(rig(world).tilt[i.key] ?? 0), p.rot, 0, "YXZ");
  }
  const end = cable.inHand(cables), jack = cable.aimedJack(world);
  // The jack panel you look at (or aim a cable at) lights up, the socket you'd plug into ringed in amber.
  for (const [key, d] of dressed) d.lit(key === jack?.owner || (!held && key === at?.key), key === jack?.owner ? jack.jack : undefined);
  highlight.visible = !!at && !held && !end && !jack;
  if (highlight.visible && at) { const [w, h, d] = dims(at); highlight.position.set(at.x, at.y, at.z); highlight.rotation.y = at.rot; highlight.scale.set(w + 0.04, h + 0.04, d + 0.04); }
  bar?.update();
  ar?.update();
  arena?.update();
  festival?.update();
  amp?.update();
  mates.update(world.crew);
  glow.update(cable.glowing(world, cables), world.t);
  clock?.update(world.level.name, world.t, strikeState(world, cables)?.since ?? null);
  loadOut?.update(world, cables);
  shoes.update(you.x, world.level.floorAt?.(you.x, you.z) ?? 0, you.z, you.yaw, stepSpeed(), 1 / 60);
  const next = phase === "play" && !festival ? nextStep(world, cables, switchedOn) : null, tgt = next?.key ? world.items.find((i) => i.key === next.key) : null;
  // An empty right hand reaches for the piece that's next, at its middle.
  const reach: [number, number, number] | undefined = tgt && tgt !== held ? [tgt.x, tgt.y + dims(tgt)[1] / 2, tgt.z] : undefined;
  hands.update({ ...holding(), show: showArms, reach, low: handsLow }, world.t, stepSpeed());
  ropes.update(cables, { at: hands.gripAt(), yaw: world.you.yaw });
  // With nothing to lift, a tape mark to carry a stand to is what the marker and the arrow point at.
  const mark = !tgt && next?.at ? next.at : null, bob = Math.sin(performance.now() / 260) * 0.05;
  marker.visible = !!tgt || !!mark;
  if (tgt) marker.position.set(tgt.x, tgt.y + dims(tgt)[1] + 0.25 + bob, tgt.z);
  else if (mark) marker.position.set(mark.x, (world.level.floorAt?.(mark.x, mark.z) ?? 0) + 1.95 + bob, mark.z);
  // Out of view, an arrow on the screen edge says which way to turn for it.
  const away = marker.visible ? camera.worldToLocal(marker.position.clone()) : null, ndc = marker.visible ? marker.position.clone().project(camera) : null;
  const arrow = away && ndc ? toward(ndc, away.z > 0) : null;
  $("toward").hidden = !arrow;
  $("toward").classList.toggle("warm", !!next?.to || !!next?.at);
  if (arrow) { $("toward").style.setProperty("--x", `${arrow.x * 100}%`); $("toward").style.setProperty("--y", `${arrow.y * 100}%`); $("toward").style.setProperty("--deg", `${arrow.deg}deg`); $("toward-what").textContent = tgt ? towardName(world, cables, tgt.key) : mark ? towardMark(world, mark) : ""; }
  // In view, the outline and the pool, breathing slowly.
  const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 380), seen = !!tgt && !arrow && tgt !== held;
  goal.visible = seen;
  handsLow = !held && !end && !jack && (!!at || seen);
  goalLamp.intensity = seen ? 3 * pulse : 0;
  if (seen && tgt) {
    const [w, h, d] = dims(tgt);
    goalEdges.position.set(tgt.x, tgt.y, tgt.z); goalEdges.rotation.y = tgt.rot; goalEdges.scale.set(w + 0.08, h + 0.08, d + 0.08);
    goalLine.opacity = pulse;
    goalPool.position.set(tgt.x, (world.level.floorAt?.(tgt.x, tgt.z) ?? 0) + 0.012, tgt.z); goalPool.scale.setScalar(Math.max(w, d) * 1.1 + 0.35);
    goalLamp.position.set(tgt.x, tgt.y + h + 0.6, tgt.z + 0.3);
  }
  // Where it goes, lit whether or not it is on screen, so you see the stand as you turn to it.
  const to = next?.to ? world.items.find((i) => i.key === next.to) ?? null : next?.at ?? null;
  const warm = !!to;
  marks.update(world, pulse);
  marker.material.color.setHex(warm ? WARM : COOL);
  goalLine.color.setHex(warm ? WARM : COOL);
  goalLamp.color.setHex(warm ? 0xffc88a : 0x9fe3ff);
  if (goalPool.material.map !== (warm ? warmPool : coolPool)) { goalPool.material.map = warm ? warmPool : coolPool; goalPool.material.needsUpdate = true; }
  // The tape starts where you stand: to the piece while your hands are empty, then on from it to the stand.
  const piece = tgt && tgt !== held ? tgt : null;
  layTrail(trails[0], to ? { x: you.x, z: you.z } : null, to ? piece ?? to : null, [0.35, 0.45]);
  layTrail(trails[1], to ? piece : null, to, [0.45, 0.45]);
  spot.visible = !!to;
  spotLamp.intensity = to ? 2.4 + 0.5 * pulse : 0;
  if (to) {
    const floor = world.level.floorAt?.(to.x, to.z) ?? 0, top = world.level.outdoor ? floor + 3 : world.level.room.height;
    spot.position.set(to.x, floor, to.z);
    spotMark.position.y = 0.014; spotMark.scale.setScalar(0.55);
    spotGlow.position.y = 0.013; spotGlow.scale.setScalar(0.85 + 0.05 * pulse);
    spotBeam.scale.set(0.42, top - floor, 0.42);
    spotLamp.position.set(to.x, floor + 1.9, to.z + 0.2);
  }
  // Until you start (a piece moved, a cable out), only the Next line: no score card, no speakers tab.
  document.body.classList.toggle("fresh", !!next && !begun(world, cables));
  $("next").textContent = next ? next.text : "";
  $("next").hidden = !next;
  const g = held ? gear(held.gear) : null, roll = cable.carried(cables)?.roll;
  if (phase === "play") touch.relabel(ar?.pad() ?? {});
  // A box in your hands fills the middle of the view, its tape label too: the key hint moves down, over the carry line.
  document.body.classList.toggle("carrying", !!held);
  $("hint").textContent = phase !== "play" ? "" : performance.now() < flash.until ? flash.text : (foh?.hint() ?? dj?.hint() ?? arena?.hint() ?? amp?.hint() ?? big?.hint() ?? gig?.hint() ?? band?.hint() ?? ar?.hint() ?? hint(at, jack));
  // In a crew room, the mess everyone sees: cables left loose and gear left in the walkways.
  const left = phase === "play" && online?.status === "in" ? cable.mess(world, cables) : [];
  $("mess").hidden = !left.length;
  $("mess").textContent = left.length ? `Mess: ${left.map((m) => `${m.what} ${m.where}`).join(", ")}` : "";
  const team = world.held?.team ? partner(world) : null;
  $("carry").textContent = phase !== "play" ? "" : g && world.held?.team ? (team ? `${g.what} with ${team.name}, ${you.speed.toFixed(1)} m/s` : `One end of the ${g.what}: someone take the other`)
    : g ? `${g.what}, ${g.kg} kg, ${you.speed.toFixed(1)} m/s`
    : roll ? `${CABLE[roll.kind].what} roll, ${rollKg(roll).toFixed(1)} kg, ${leftM(roll).toFixed(0)} m left, ${you.speed.toFixed(1)} m/s${windup ? `, bowl ${Math.round(windup.power * 100)}%` : ""}`
    : end ? `${end.run.lengthM} m ${end.run.kind} cable, ${connectorName(cable.endInHand(cables)!)} end${(world.cableKg ?? 0) > 0.3 ? `, pulling ${world.cableKg!.toFixed(1)} kg` : ""}, ${you.speed.toFixed(1)} m/s` : "";
  renderer.render(scene, camera);
}

const whd = ([w, h, d]: [number, number, number]) => ({ w, h, d });

/** What your hands are doing: palms flat on a carried box's sides, a roll hooked over the right hand's fingers, a plug
 * ready at a jack, a fist round each cable you drag (the wrist dropping with what it pulls), or nothing. */
function holding(): Hold {
  const held = heldItem(world), hp = holdPose(world), end = cable.inHand(cables), roll = cable.carried(cables)?.roll;
  if (held && hp) return { right: { kind: "flat" }, left: { kind: "flat" }, kg: gear(held.gear).kg / (world.held?.team ? 2 : 1), carry: { ...hp, ...whd(dims(held)) } };
  const ends = cable.held(cables), left = ends.find((h) => h.side === "left"), right = ends.find((h) => h.side === "right");
  const fist = (h: cable.Held | undefined): Hold["left"] => (h ? { kind: "cable", radius: h.run.roll ? CABLE[h.run.roll.kind].radius : CABLE_RADIUS[h.run.kind] ?? 0.004 } : REST);
  if (roll) return { right: { kind: "roll" }, left: left ? fist(left) : roll.tailIn ? REST : { kind: "cable", radius: CABLE[roll.kind].radius }, kg: world.cableKg ?? 0 };
  if (!end) return { right: REST, left: REST, kg: 0 };
  // The plug ready at a lit jack is the hand F would plug with; the lead is drawn from the right fist.
  const jack = cable.aimedJack(world), ready = jack && end.side === "right";
  const at = cable.handAt(world), lead = right ? { lead: { at: [at.x, at.y, at.z] as [number, number, number], color: COLOR[right.run.kind] ?? 0x222222, end: cable.connectorOf(right) } } : {};
  return { right: right ? (ready ? { kind: "plug" } : fist(right)) : REST, left: left ? (jack && end.side === "left" ? { kind: "plug" } : fist(left)) : REST, kg: world.cableKg ?? 0, ...lead };
}
/** How fast you're actually moving (m/s), for the bob of your steps. */
let lastStep = { x: 0, z: 0, t: -1, v: 0 };
function stepSpeed(): number {
  const { x, z } = world.you, dt = world.t - lastStep.t;
  if (dt > 0) lastStep = { x, z, t: world.t, v: lastStep.t < 0 || dt > 0.5 ? 0 : lastStep.v * 0.8 + (Math.hypot(x - lastStep.x, z - lastStep.z) / dt) * 0.2 };
  return lastStep.v;
}

/** What F (or a click) would do now. */
function hint(at: ReturnType<typeof aimed>, jack: ReturnType<typeof cable.aimedJack>): string {
  const end = cable.inHand(cables), coil = cable.coiling(cables);
  if (coil?.coiling) return `Q over, E under (${coil.coiling.ways.length} of ${cable.loopsFor(coil)})`;
  const roll = cable.carried(cables)?.roll;
  const conn = cable.endInHand(cables), named = conn ? connectorName(conn) : "";
  if (roll && jack) return `F plug the ${named} into ${jack.owner} ${jack.jack}`;
  if (roll) return roll.tailIn ? "Carry it to where the run starts, F plug the end, or Space bowl it holding the end" : "Hold Space to wind up, let go to bowl. F set it down";
  if (end) {
    const two = cable.held(cables).length > 1;
    return jack ? `F plug the ${named} into ${jack.owner} ${jack.jack}` : at?.key === cables.caseKey ? "F coil it back" : two ? `${named.replace(/^./, (ch) => ch.toUpperCase())} end in each hand. F or G let go of the last` : `${named.replace(/^./, (ch) => ch.toUpperCase())} end in hand. F drop it (or grab another with your free hand), G drop it`;
  }
  if (world.held) return "F put down, Q / E turn";
  const plugged = jack && cables.runs.some((r) => [r.a, r.b].some((e) => "plug" in e && e.plug[0] === jack.owner && e.plug[1] === jack.jack));
  if (plugged) return `F unplug ${jack.owner} ${jack.jack}`;
  if (at?.key === cables.caseKey && cables.runs.some((r) => !r.rope || "case" in r.b)) return "F take a roll of cable";
  const sw = at && hasSwitch(at.gear, !!big || !!foh || !!gig || !!band) ? `, P switch it ${switchedOn.has(at.key) ? "off" : "on"}` : "";
  if (at && wheeled(at.gear)) return `F push the ${gear(at.gear).what} (${gear(at.gear).kg} kg)`;
  // Under the F line, the venue's own keys for this piece of gear (turn, tilt, stand, fader).
  const own = bar ? aimHint(world) : "";
  if (at) return `F pick up ${gear(at.gear).what} (${gear(at.gear).kg} kg)${sw}${own && `\n${own}`}`;
  const room = bar && "look" in bar ? bar.look() : "";
  if (room) return room;
  return idlePrompt(world, cables, switchedOn, { doors: !!(bar || big || gig || band || arena || ar), open: doorsOpen });
}

// Input: pointer lock for the mouse, keys while playing, the pad every frame.
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
canvas.addEventListener("mousedown", () => { if (phase !== "play") return; if (!locked()) lock(); else grab(); });
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const k = 0.0022;
  world.you.yaw -= e.movementX * k * ctl.lookX;
  world.you.pitch = clamp(world.you.pitch - e.movementY * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.3, 1.2);
});
document.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (phase !== "play" || e.repeat) return;
  press(e.code);
});
/** A key while playing, from the keyboard or a touch button: the venue's view first, then the hands. */
function press(code: string) {
  if (code === "Enter" && (bar || big)) return void openDoors();
  if (!world.held && !cable.inHand(cables) && bar?.key(code)) {
    // The dive bar's fader has no line on the card: say where it went.
    if (code.startsWith("Bracket") && "look" in bar) flash = { text: `Fader ${rig(world).master} dB`, until: performance.now() + 1800 };
    return;
  }
  if (!cable.inHand(cables) && arena?.key(code, (why) => { flash = { text: why, until: performance.now() + 1800 }; })) return;
  if (!world.held && !cable.inHand(cables) && amp?.key(code, (why) => { flash = { text: why, until: performance.now() + 1800 }; })) return;
  if (!world.held && !cable.inHand(cables) && ar?.key(code)) return;
  if (!world.held && !cable.inHand(cables) && festival?.key(code)) { if (festival.said) flash = { text: festival.said, until: performance.now() + 1800 }; return; }
  if (big?.key(code)) return;
  if (gig?.key(code)) return;
  if (band?.key(code)) return;
  if (foh?.key(code)) return;
  if (!world.held && !cable.inHand(cables) && dj?.key(code)) return;
  if (code === "KeyG" && cable.inHand(cables)) return void say(cable.dropEnd(cables));
  if (code === "KeyF") grab();
  if (code === "Space") { if (windup) letGo(); else if (cable.carried(cables)) windup = { power: 0 }; }
  if ((code === "KeyQ" || code === "KeyE") && cable.coiling(cables)) return void say(cable.loop(world, cables, code === "KeyQ" ? "over" : "under"));
  if (code === "KeyQ") turnHeld(world, -1);
  if (code === "KeyE") turnHeld(world, 1);
  if (code === "KeyL") say(strike(world));
  if (code === "KeyT") say(shut(world, cables));
  if (code === "KeyP") flip();
  if (code === "KeyM") sound.toggle();
}
document.addEventListener("keyup", (e) => { keys.delete(e.code); if (e.code === "Space" && windup) letGo(); });
/** Winding up to bowl the roll you carry (Space): the power builds slower the heavier the roll. */
let windup: { power: number } | null = null;
function letGo() {
  if (!windup) return;
  say(cable.bowl(world, cables, windup.power));
  windup = null;
}
addEventListener("blur", () => keys.clear());

/** F: the cable job if there is one (plug, unplug, take one, coil), a jerry can poured into the generator you face,
 * else put down or pick up the gear. */
function grab(): Answer {
  const at = aimed(world), can = heldItem(world);
  if (ar && at && !world.held && !cable.inHand(cables) && reserved(world, at.key)) return (flash = { text: "the crew has that one", until: performance.now() + 1800 }), { ok: false, why: "the crew has that one" };
  const r = cable.use(world, cables, at) ?? (can && at && gear(at.gear).generator && gear(can.gear).can ? pour(world, at.key) : world.held ? place() : at ? (wheeled(at.gear) ? push : pickUp)(world, at.key) : { ok: false as const, why: "nothing in reach" });
  if (r.ok && ar && world.held) unrack(world, world.held.key);
  return say(r);
}

/** A refusal, shown under the crosshair for a moment. */
function say<A extends { ok: boolean; why?: string }>(r: A): A {
  if (!r.ok && r.why) flash = { text: r.why, until: performance.now() + 1800 };
  return r;
}

/** Pick up (or push, if it rolls) what you look at; in the arena, not what the crew is carrying, and off a fly bar's stack. */
function lift(key: string): Answer {
  const item = world.items.find((i) => i.key === key);
  if (ar && reserved(world, key)) return { ok: false, why: "the crew has that one" };
  const r = (item && wheeled(item.gear) ? push : pickUp)(world, key);
  if (r.ok && ar) unrack(world, key);
  return r;
}

/** Put down, then let a top set on a stand find its pole, a box by a fly bar join its stack, and a ramp line up end to end with one beside it. */
function place(): Answer {
  const key = world.held?.key, a = putDown(world);
  settle(world);
  if (a.ok && key && ar) rack(world, key);
  if (a.ok && key) { cable.linkRamp(world, key); stow(world, key); }
  return a;
}

/** P: switch what you look at on or off, if it has a switch. */
function flip() {
  const at = aimed(world);
  if (!at || !hasSwitch(at.gear, !!big || !!foh || !!gig || !!band)) return;
  if (!switchedOn.delete(at.key)) switchedOn.add(at.key);
}

/** What you hear now: in the dive bar, through its tilts and master fader. */
/** What you hear: a speaker plays when it's switched on and, once a cable goes into it, when the patch feeds it. */
const heard = () => hear(world, switchedOn, arena ? arena.fed : ar ? ar.fed() : big ? big.fed() : gig ? gig.fed() : cable.fedBy(world, cables), undefined, dj ? dj.rig() : bar || arena ? rig(world) : (ar ?? big ?? gig)?.rig());

function play() {
  // On tour, Play goes to the booked gig: a fresh load once last night is settled.
  if (!asked && (settled || world.level !== bookedRung(tour).level)) load(bookedRung(tour).level);
  phase = "play"; menu(); lock();
}

/** Enter: doors on the venue's own score; at the booked gig the night is settled (pay less rent, the next booking) and home base shows how it went. */
function openDoors() {
  const s = bar?.doors() ?? big?.doors() ?? gig?.doors() ?? band?.doors() ?? arena?.doors() ?? ar?.doors() ?? null;
  if (s) doorsOpen = true;
  if (!s || settled || asked || world.level !== bookedRung(tour).level) return s;
  settled = true;
  tour = record(tour, world.level, s).tour;
  saveTour(tour);
  tourView?.update();
  ink.refresh();
  setTimeout(() => { if (settled && phase === "play") { phase = "menu"; document.exitPointerLock?.(); menu(); } }, 2500);
  return s;
}

function menu() {
  $("menu").hidden = phase === "play";
  touch.show(phase === "play");
  $("crew").textContent = crew.members.map((m) => `${m.name}${m.host ? " (host)" : ""}`).join(", ");
  $("code").textContent = crew.code ? `Party ${crew.code}${crew.room ? `, seat ${crew.seat + 1}` : ""}` : "";
  $("note").textContent = online?.note || crew.note;
  // Only the host's Start counts: the party answers anyone else's with a refusal, shown in the note.
  $("start").hidden = !crew.code || !!crew.room;
}

let last = performance.now(), shadeTick = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    // The look finger turns you as the mouse does, a pixel the same as a mouse count.
    const finger = touch.look(), walk = touch.move(), m = 0.0022 * 1.6;
    world.you.yaw -= finger.dx * m * ctl.lookX;
    world.you.pitch = clamp(world.you.pitch - (gp.right.y * k + finger.dy * m) * ctl.lookY * (ctl.invertY ? -1 : 1), -1.3, 1.2);
    if (gp.pressed.has("grab")) grab();
    const turn = (dir: -1 | 1) => (cable.coiling(cables) ? say(cable.loop(world, cables, dir < 0 ? "over" : "under")) : turnHeld(world, dir));
    if (gp.pressed.has("turnLeft")) turn(-1);
    if (gp.pressed.has("turnRight")) turn(1);
    const on = (c: string) => (keys.has(c) ? 1 : 0);
    step(world, dt, {
      forward: on("KeyW") - on("KeyS") || -gp.left.y || walk.y,
      right: on("KeyD") - on("KeyA") || gp.left.x || walk.x,
      turn: -gp.right.x * k * ctl.lookX,
      crouch: keys.has("KeyC") || keys.has("ControlLeft") || gp.held.has("crouch") || touch.crouch,
    });
    cable.stepCables(world, cables, dt);
    const roll = cable.carried(cables)?.roll;
    if (windup) windup = roll ? { power: Math.min(1, windup.power + dt / (0.45 + rollKg(roll) / 22)) } : null;
    foh?.tick(dt);
  }
  online?.tick(world, now);
  big?.tick();
  gig?.tick();
  band?.tick();
  ar?.tick();
  dj?.tick(dt);
  // New meshes (gear, cables, the crowd) pick up shadows within a few frames of turning up.
  if (++shadeTick % 20 === 0) shade(scene);
  draw();
  sound.update(heard());
  // The room rings on the speakers: long when it is empty, tighter as the crowd comes in; out of doors, not at all.
  const spot = spotOf(world.level.name);
  sound.room(spot ? ringing(world, spot) : null);
  requestAnimationFrame(frame);
}

// The party: make one (its code to hand out) or join one by code; the host's Start seats everyone.
function wireParty() {
  const p = party();
  p.onMembers((m) => { crew.members = m; menu(); });
  p.onStart((s) => { crew.room = s.room; crew.seat = s.seat; crewRoom(s.room); play(); });
  p.onGone((why) => { crew.note = why; crew.code = ""; crew.members = []; menu(); });
  p.onRefused((why) => { crew.note = why; menu(); });
  $("make").addEventListener("click", async () => {
    const code = await p.make();
    if (!code) { crew.note = login() ? "eqosys didn't make a party just now." : "Sign in to make a party."; return menu(); }
    crew.code = code; p.join(code); menu();
  });
  $<HTMLFormElement>("join").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $<HTMLInputElement>("joincode").value.trim().toUpperCase();
    if (code) { crew.code = code; p.join(code); menu(); }
  });
  $("start").addEventListener("click", () => p.start());
}

async function boot() {
  const back = await finishSignIn();
  if (back?.error) crew.note = back.error;
  accountChip($("account"), { onSignIn: () => menu(), onSignOut: () => menu() });
  savedDial();
  mountDial($("dial-host"));
  if (!asked) tourView = mountTour($("tour-host"), () => tour, (t) => { tour = t; saveTour(t); }, $("home-host"));
  clock = mountClock($("hud"));
  loadOut = mountStrike($("hud"));
  $("party").hidden = !canSignIn();
  mountControls({
    key: KEY, pad, parent: $("controls-host"), title: "Controls", skin: "house",
    keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["F / click", "Pick up, put down, plug in, unplug"], ["Q / E", "Turn what you hold; coiling, over and under"], ["L", "Strike and load out"], ["T", "Shut the truck"], ["C", "Crouch"], ["Esc", "Let go of the mouse"], ["Touch: left thumb / right drag", "Walk / look; the buttons press the keys"]],
    onChange: (s) => { ctl = s; },
    onToggle: (open) => { if (open) document.exitPointerLock?.(); },
  });
  wireParty();
  const room = roomCode(location.search);
  if (room) crewRoom(room);
  $("play").addEventListener("click", play);
  menu();
  resize();
  requestAnimationFrame(frame);
}

declare global { interface Window { loadIn: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): the level as data, and the moves a test or an agent makes without pointer lock. */
const harness = {
  state: () => ({ phase, tour: { cash: tour.cash, truck: tour.truck, following: tour.following, booked: tour.booked, nights: tour.nights.length, settled }, next: nextStep(world, cables, switchedOn), prompt: $("hint").textContent, dial: currentDial(), doors: doors(world.level.name, world.t), ...snapshot(world), ...cable.cableState(world, cables), sound: { up: sound.up, on: [...switchedOn], reverb: sound.reverb, ...heard() }, ...(big ? { biggerBar: big.state() } : {}), ...(gig ? { firstGig: gigState(world, runsOf(world, cables), switchedOn) } : {}), ...(band ? { bandNight: band.state() } : {}), ...(ar ? { arena: { ...arenaState(world), heat: ar.heatOn } } : {}), ...(arena ? { smallArena: { ...arenaSim.arenaState(world), heat: arena.heatOn } } : {}), ...(foh ? { show: foh.state() } : {}), ...(festival ? { festival: { ...fest.festivalState(world), heat: festival.heatOn } } : {}), ...(amp ? { amphitheatre: { ...amphi.amphitheatreState(world), heat: amp.heatOn } } : {}), ...(dj ? { decks: dj.state() } : {}), strike: strikeState(world, cables), hands: hands.state(), ...(world.level === DIVE_BAR ? { crowd: crowdState(world) } : {}), ...(bar ? { bar: { ...(world.level === PARK ? parkState(world, cables) : world.level === DESERT ? desertState(world, cables) : barState(world)), heat: bar.heatOn, ...("band" in bar ? { band: bar.band } : {}) } } : {}), signedIn: !!login(), party: crew.code ? { code: crew.code, members: crew.members.length, room: crew.room || null, seat: crew.seat >= 0 ? crew.seat : null } : null, crewRoom: online ? { room: online.room, status: online.status, note: online.note } : null }),
  /** Join a crew room by code (what the party's Start does), on this level. */
  crew: (room: string) => crewRoom(room.toUpperCase()),
  /** Turn the cozy-to-sim dial: "cozy", "crew" or "sim". */
  dial: (d: string) => setDial(d),
  /** Into the level, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** In a DJ booth level: lay and plug every cable and switch it all on, as a player would; returns what failed. */
  wireBooth: (): string[] => wireBooth(harness),
  /** Walk to (x, z) at your carrying pace, cables dragging; the seconds it took. */
  walkTo: (x: number, z: number) => cable.walkWith(world, cables, x, z),
  /** Park and desert: take the handle of gear on wheels (the generator, the sand cart) and push it, with what rides on it (let go with putDown). */
  push: (key: string): Answer => (cable.inHand(cables) ? { ok: false, why: "your hands are full" } : push(world, key)),
  /** Park and desert: holding a jerry can, pour it into the generator. */
  pour: (key: string): Answer => pour(world, key),
  /** Desert: tape a plugged joint against the dust (or untape it); state().bar.dusty lists the joints the dust gets into. */
  wrap: (owner: string, jack: string, on = true) => wrap(cables, owner, jack, on),
  pickUp: (key: string): Answer => (cable.inHand(cables) ? { ok: false, why: "your hands are full" } : lift(key)),
  putDown: () => place(),
  /** A cable out of the case (power, speaker, xlr, instrument), its `a` end in your hand and its roll left on the case. */
  takeCable: (kind?: cable.Run["kind"]) => cable.takeCable(world, cables, kind),
  /** A roll out of the case into your arms, its end wound on: plug(...) puts the end in a jack and you keep the roll. */
  takeRoll: (kind?: cable.Run["kind"]) => cable.takeRoll(world, cables, kind),
  /** Bowl the roll you carry along where you face at `power` (0 to 1), then let it run `seconds` until it stops. */
  /** Your own tattoo: a picture as a data URL (null takes it off) and where it sits; `arms()` says what is on them. */
  ink: (url: string | null, where?: { arm?: "left" | "right"; at?: number; size?: number }) => { ink.ink(url, where); return ink.state(); },
  /** Lace up another colour of high-tops: black, red, navy, cream, green or yellow. */
  shoes: (colour: ShoeColour) => { ink.shoes(colour); return ink.state(); },
  arms: (show?: boolean) => { if (show !== undefined) showArms = show; return { ...ink.state(), shown: showArms }; },
  bowl: (power: number, seconds = 6) => { const a = cable.bowl(world, cables, power); if (a.ok) cable.settle(world, cables, seconds); return a; },
  plug: (owner: string, jack: string) => cable.plug(world, cables, owner, jack),
  unplug: (owner: string, jack: string) => cable.unplug(world, cables, owner, jack),
  grabEnd: (key: string, end: "a" | "b") => cable.grabEnd(world, cables, key, end),
  dropEnd: (side?: cable.Side) => cable.dropEnd(cables, side),
  /** Start coiling a cable at the case (neither end plugged in); then `loop` it, or `coilAll` in one call. */
  coil: (key: string) => cable.coil(world, cables, key),
  /** One loop onto the coil being made: "over" (Q) or "under" (E). */
  loop: (way: cable.Way) => cable.loop(world, cables, way),
  /** Coil `key` all the way, a loop at a time with a steady hand between: `ways` as "ou" letters, over-under by default. */
  coilAll: (key: string, ways?: string): Answer => {
    const r = cable.coil(world, cables, key);
    if (!r.ok) return r;
    const run = cables.runs.find((x) => x.key === key)!;
    for (let k = 0; run.coiling; k++) {
      cable.settle(world, cables, cable.LOOP_S);
      const ch = ways?.[k] ?? (k % 2 ? "u" : "o"), a = cable.loop(world, cables, ch === "u" ? "under" : "over");
      if (!a.ok) return a;
    }
    return { ok: true };
  },
  /** The show is over: start the load-out and the curfew clock (L). */
  strike: () => strike(world),
  /** Pull the truck's door down (T): every piece in, every cable coiled; the tally. */
  shut: () => shut(world, cables),
  /** Stand still for `seconds` while the cables settle. */
  wait: (seconds = 2) => cable.settle(world, cables, seconds),
  /** Arena: let `seconds` go by on the clock while the crew works. */
  crewWait: (seconds: number) => idle(world, seconds),
  /** Arena: send the crew to carry `key` to a rigging point's fly bar (its key) or to (x, z). */
  send: (key: string, to: string | number, z?: number) => send(world, key, typeof to === "string" ? to : { x: to, z: z ?? 0 }),
  /** Arena: fly a hang to trim, or lower it, at its motor controller. */
  fly: (point: string) => fly(world, point),
  lower: (point: string) => lower(world, point),
  /** Arena: a hang's angle (degrees, down is negative; at its controller) and delay (ms). */
  hang: (point: string, angle?: number, delay?: number) => setHang(world, point, { angle, delay }),
  /** Arena: a sub's delay (ms) and polarity, standing by it. */
  sub: (key: string, delay?: number, invert?: boolean) => setSub(world, key, { delay, invert }),
  /** Arena: put a feed (a rigging point's key, or "subs") on a leg of the company switch, or null; at the switch. */
  leg: (feed: string, leg: Leg | null) => setLeg(world, feed, leg),
  /** Dive bar: turn a placed speaker by degrees (positive toward +x) and tilt it (degrees up). */
  aim: (key: string, turn: number, tilt = 0) => aim(world, key, { turn: (turn * Math.PI) / 180, tilt: (tilt * Math.PI) / 180 }),
  /** Dive bar: a stand (and the top on it) to `height` metres. */
  raise: (key: string, height: number) => raise(world, key, height),
  /** Dive bar: the master fader, dB. */
  master: (db: number) => master(world, db),
  heat: (on: boolean, band?: "high" | "low") => (bar && "band" in bar ? bar.setHeat(on, band) : (bar ?? arena)?.setHeat(on)),
  /** Arena: the heat map on or off. */
  arenaHeat: (on: boolean) => ar?.setHeat(on),
  /** Dive bar, bigger bar or park: open the doors; the final score (at the booked gig, the night is settled into the tour). */
  doors: () => openDoors(),
  /** Arena: show time; the final score. */
  arenaDoors: () => ar?.doors() ?? null,
  /** The tour: cash, gear owned, truck, the booked gig and the nights so far. */
  tour: () => tour,
  /** Buy a piece of gear (by gear id) or a truck ("van", "box-truck") at home base. */
  buy: (id: string): Answer => { const r = buy(tour, id); if (r.ok) { tour = r.tour; saveTour(tour); tourView?.update(); } return r.ok ? { ok: true } : { ok: false, why: r.why }; },
  /** Small arena, under a point: pin the box you hold under its hang, or take the bottom box off. */
  hangBox: (point: string) => arenaSim.hang(world, point),
  unhangBox: (point: string) => arenaSim.unhang(world, point),
  /** Small arena: the splay calculator for a point flown at `trim` metres (its planned trim if left out). */
  calc: (point: string, trim?: number) => arenaSim.calc(world, point, trim),
  /** Small arena, under a point on the deck: the top box's angle and the pins, degrees. */
  pin: (point: string, tilt: number, splays: number[]) => arenaSim.pin(world, point, tilt, splays),
  /** Small arena, under a point: the rigger's check, its load against the steel's limit. */
  check: (point: string) => arenaSim.check(world, point),
  /** Small arena, standing clear: run a point's motor to `trim` metres, or land it on the deck. */
  flyTo: (point: string, trim: number) => arenaSim.fly(world, point, trim),
  land: (point: string) => arenaSim.land(world, point),
  /** Amphitheatre: the crew pins `n` boxes on a point (at its controller), the pins and top angle (degrees), the
   * calculator, the rigger's check, the motor to trim or down, toe-in (degrees in) and horn, the long-throw shelf (dB;
   * point or "towers"), the delay towers up or down (at row 36), their delay (ms), the subs, the show's air, doors. */
  amphitheatre: {
    hang: (point: string, n: number) => amphi.hang(world, point, n),
    pin: (point: string, tilt: number, splays: number[]) => amphi.pin(world, point, tilt, splays),
    calc: (point: string, trim?: number) => amphi.calc(world, point, trim),
    check: (point: string) => amphi.check(world, point),
    flyTo: (point: string, trim?: number) => amphi.fly(world, point, trim),
    land: (point: string) => amphi.land(world, point),
    aim: (point: string, toe: number, horn?: amphi.Horn) => amphi.aim(world, point, toe, horn),
    shade: (point: string, db: number) => amphi.shade(world, point, db),
    towers: (up: boolean) => amphi.towers(world, up),
    delay: (ms: number) => amphi.delay(world, ms),
    subs: (mode: amphi.SubMode) => amphi.subs(world, mode),
    air: (a: Partial<amphi.Air>) => amphi.setAir(world, a),
    heat: (on: boolean) => amp?.setHeat(on),
    doors: () => amp?.doors() ?? null,
  },
  /** First gig, at any distance: switch the desk's 48 V phantom. */
  phantom: (on: boolean) => (gig ? (gig.phantom(on), true) : band ? (band.phantom(on), true) : false),
  /** Band night, at any distance: the player on `channel` (1 to 6, or the next not checked) plays alone; what came up. */
  lineCheck: (channel?: number) => band?.check(channel) ?? null,
  /** Band night, at any distance: press (or release) the bass DI's ground lift. */
  groundLift: (on = true) => (band ? (band.lift(on), true) : false),
  /** Band night: set tonight's seeded faults (a list of { kind: "dead" | "crackle", cable } | { kind: "crossed", a, b } | { kind: "hum", di }). */
  faults: (list: Fault[]) => (band ? ((night(world).faults = list), true) : false),
  /** Festival: turn a stage ("tent" | "open") to face `deg` (0 north, 90 east), standing on it. */
  festFace: (stage: fest.StageKey, deg: number) => fest.face(world, stage, deg),
  /** Festival: build a stage's subs "omni" or "cardioid", standing by it. */
  festSubs: (stage: fest.StageKey, mode: "omni" | "cardioid") => fest.subs(world, stage, mode),
  /** Festival: lift a stage's tops over the crowd (true) or bring them down, standing by it. */
  festLift: (stage: fest.StageKey, on = true) => fest.lift(world, stage, on),
  /** Festival: a stage's master fader in dB, at its desk. */
  festFader: (stage: fest.StageKey, db: number) => fest.master(world, stage, db),
  /** Festival: put a load (tent-rack, open-lights, traders-2, ...) on "L1" | "L2" | "L3" or null, at the compound. */
  festLeg: (feed: string, leg: fest.Leg | null) => fest.phase(world, feed, leg),
  /** Festival: a stage's feeder size in AWG (10, 6, 2, -1 for 2/0), at the compound. */
  festFeeder: (stage: fest.StageKey, awg: number) => fest.feeder(world, stage, awg),
  /** Festival: run a stage's snake from its desk to its rack, standing at the desk. */
  festSnake: (stage: fest.StageKey) => fest.snake(world, stage),
  /** Festival: run the show `seconds` on (the 15-minute LAeq at each desk and the curfew are logged). */
  festRun: (seconds: number) => fest.run(world, seconds),
  /** Festival: the heat map on or off, mids and highs ("high") or 63 Hz ("low"). */
  festHeat: (on: boolean, band: "high" | "low" = "high") => festival?.setHeat(on, band),
  /** Load a level by name (first-gig, band-night, garage, dive-bar, bigger-bar, park, desert, arena, small-arena, show, dj-booth, dj-booth-media, amphitheatre, festival). */
  level: (name: string) => load(levelFrom(name)),
  /** Turn what you hold a 15 degree step: -1 left, 1 right. */
  turn: (dir: number) => turnHeld(world, dir),
  /** Look to `yaw` degrees (0 is into the garage) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { world.you.yaw = (yaw * Math.PI) / 180; world.you.pitch = (pitch * Math.PI) / 180; },
  /** Switch a piece of gear on or off (P while looking at it); false if it has no switch. */
  power: (key: string, state = !switchedOn.has(key)) => {
    const item = world.items.find((i) => i.key === key);
    if (!item || !hasSwitch(item.gear, !!big || !!foh || !!gig || !!band)) return false;
    if (state) switchedOn.add(key); else switchedOn.delete(key);
    return true;
  },
  /** Bring the speakers up or down (the card, or M). Browsers start sound only after a click, so a probe reads state instead. */
  speakers: (up: boolean) => sound.setUp(up),
  /** The level as it began. */
  /** In the bigger bar, at the panel: reset a tripped breaker (or all of them). */
  resetBreaker: (circuit?: string) => big?.reset(circuit) ?? { ok: false, why: "no breaker panel here" },
  reset: () => { switchedOn.clear(); load(world.level); },
  /** The show: the desk and the stage, without the keys (desk.nudge(channel, { fader, send, trim }), desk.notch(channel, hz), desk.start(), desk.fix(kind), desk.amp(knob, by) at the guitar amp before doors, desk.run(seconds)). */
  get desk() { return foh?.desk ?? null; },
  /** The DJ booth's decks: play(deck, on?), fader(channel, 0..1), cross(-1..1), pitch(deck, per cent); state().decks reads them. */
  get decks() { return dj?.decks ?? null; },
};
window.loadIn = harness;
// `?level=dj-booth&wired=1`: the booth opens wired and switched on (venues/dj-booth-wire.ts), the first time you press Play.
let wiredOnce = new URLSearchParams(location.search).has("wired") && world.level.name.startsWith("dj-booth");
$("play").addEventListener("click", () => { if (wiredOnce) { wiredOnce = false; wireBooth(harness); } });

void boot();
