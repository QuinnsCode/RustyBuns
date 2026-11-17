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
import { EYE, EYE_CROUCH, GARAGE, type Answer, type Level, aimed, dims, heldItem, holdPose, newWorld, partner, pickUp, putDown, snapshot, step, turnHeld, type World, wheeled } from "./sim.ts";
import * as cable from "./cables/cables.ts";
import { cableView } from "./cables/draw.ts";
import { DIVE_BAR, aim, barState, master, raise, rig, settle, standHeight } from "./venues/dive-bar.ts";
import { type BarView, barView } from "./venues/dive-bar-view.ts";
import { BIGGER_BAR } from "./venues/bigger-bar.ts";
import { type BiggerBarView, biggerBarView } from "./venues/bigger-bar-view.ts";
import { PARK, parkState, pour, push } from "./venues/park.ts";
import { type ParkView, parkView } from "./venues/park-view.ts";
import { ARENA, type Leg, arenaState, fly, lower, rack, reserved, send, setHang, setLeg, setSub, unrack, wait as idle } from "./venues/arena.ts";
import { type ArenaView, arenaView } from "./venues/arena-view.ts";
import * as arenaSim from "./venues/small-arena.ts";
import { type ArenaView as SmallArenaView, arenaView as smallArenaView } from "./venues/small-arena-view.ts";
import { hasSwitch, hear, type Switches } from "./audio/hear.ts";
import { soundSystem } from "./audio/play.ts";
import { currentDial, setDial } from "./assists.ts";
import { doors } from "./clock.ts";
import { mountClock, mountDial, mountGlow, savedDial } from "./dial-view.ts";
import { shut, stow, strike, strikeState, striking } from "./strike.ts";
import { mountStrike, truckMesh } from "./strike-view.ts";
import { type Tour, bookedRung, buy, record } from "./tour.ts";
import { loadTour, mountTour, saveTour } from "./tour-view.ts";
import { accountChip, canSignIn, finishSignIn, login, party, type PartyMember } from "./eqosys.ts";
import { eyeFill, handsView, readable, venueLights, type Grip } from "./look.ts";
import { nextStep } from "./next.ts";
import { COLOR } from "./cables/draw.ts";
import { joinCrew, roomCode, type Online } from "./crew/online.ts";
import { crewView } from "./crew/view.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const KEY = "load-in.controls";

const LEVELS: Record<string, Level> = { garage: GARAGE, "dive-bar": DIVE_BAR, "bigger-bar": BIGGER_BAR, park: PARK, arena: ARENA, "small-arena": arenaSim.SMALL_ARENA };
const levelFrom = (name: string | null) => LEVELS[name ?? ""] ?? GARAGE;
/** The tour between nights; a page opened on ?level= plays that level and leaves the tour alone. */
let tour: Tour = loadTour();
const asked = new URLSearchParams(location.search).get("level");
let world: World = newWorld(asked ? levelFrom(asked) : bookedRung(tour).level);
/** Whether tonight's show at the booked gig has been settled into the tour. */
let settled = false;
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
/** The crew room the party's Start (or `?room=CODE`) put you in: friends' bodies, and gear carried together. */
let online: Online | null = null;
function crewRoom(room: string) {
  online?.close();
  online = joinCrew(room, world.level.name, () => world, menu);
}
const pad = loadPad(KEY, [
  { id: "grab", label: "Pick up / put down / plug in", button: 0 },
  { id: "crouch", label: "Crouch", button: 1 },
  { id: "turnLeft", label: "Turn it left", button: 4 },
  { id: "turnRight", label: "Turn it right", button: 5 },
]);

// The scene: the garage's floor, walls and the venue's own lights (look.ts), the driveway outside, a model per piece
// of gear, the cables, and your hands.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1420);
scene.fog = new THREE.Fog(0x0d1420, 8, 22);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 150);
camera.rotation.order = "YXZ";
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xc8d4e6, 0x2a2420, 0.85));
eyeFill(camera);
const hands = handsView(scene, camera);
let lights = venueLights(world.level);
scene.add(lights);
// The marker over what the Next line is about: a small cone pointing down, bobbing.
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x4cc9f0 }));
scene.add(marker);

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
const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: 0x4cc9f0 }));
scene.add(highlight);
let bar: BarView | ParkView | null = null;
let big: BiggerBarView | null = null;
let ar: ArenaView | null = null;
/** The small arena's view (`ar` is the big arena's). */
let arena: SmallArenaView | null = null;
/** A piece's model (a stand at `height`), or a plain box at its catalog size if @rustybuns/models has none. */
function modelOf(id: string, height?: number): THREE.Object3D {
  if (cable.hasModel(id)) return model(id, { look, height });
  const { w, h, d } = gear(id).size, m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), look.paint);
  m.userData.size = [w, h, d];
  return m;
}
function buildItems() {
  for (const m of meshes.values()) scene.remove(m);
  meshes.clear();
  for (const i of world.items) {
    const m = modelOf(i.gear);
    meshes.set(i.key, m);
    scene.add(m);
  }
  bar?.dispose();
  bar = world.level === DIVE_BAR ? barView(scene, $("hud"), () => world) : world.level === PARK ? parkView(scene, $("hud"), () => world, () => cables) : null;
  big?.dispose();
  big = world.level === BIGGER_BAR ? biggerBarView(scene, $("hud"), () => world, () => cables) : null;
  ar?.dispose();
  ar = world.level === ARENA ? arenaView(scene, $("hud"), () => world) : null;
  arena?.dispose();
  arena = world.level === arenaSim.SMALL_ARENA ? smallArenaView(scene, $("hud"), () => world) : null;
}
buildItems();
const ropes = cableView(scene);
const mates = crewView(scene);

/** A new level, or the same one as it began: the room, the gear and the case of cables. */
const glow = mountGlow(scene);
let clock: ReturnType<typeof mountClock> | null = null;
let loadOut: ReturnType<typeof mountStrike> | null = null;

function load(level: Level) {
  world = newWorld(level);
  settled = false;
  cables = cable.newCables(world);
  ropes.clear();
  scene.remove(roomGroup); roomGroup = room(world.level); scene.add(roomGroup);
  scene.remove(lights); lights = venueLights(world.level); scene.add(lights);
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
  camera.position.set(you.x, you.crouch ? EYE_CROUCH : EYE, you.z);
  camera.rotation.set(you.pitch, you.yaw, 0);
  for (const i of world.items) {
    const tall = i.gear === "stand-tripod" ? standHeight(world, i.key) : 0;
    // A stand raised or lowered is a new model: its pole grows.
    if (tall && meshes.get(i.key)!.userData.size[1] !== tall) { scene.remove(meshes.get(i.key)!); const n = modelOf(i.gear, tall); meshes.set(i.key, n); scene.add(n); }
    const m = meshes.get(i.key)!, p = i === held && hp ? hp : i;
    m.position.set(p.x, p.y, p.z);
    // A speaker tilted (or a line array box at its splay) leans forward or back as it faces.
    m.rotation.set(i === held ? 0 : -(rig(world).tilt[i.key] ?? 0), p.rot, 0, "YXZ");
  }
  const end = cable.inHand(cables), jack = cable.aimedJack(world);
  highlight.visible = !!at && !held && !end && !jack;
  if (highlight.visible && at) { const [w, h, d] = dims(at); highlight.position.set(at.x, at.y, at.z); highlight.rotation.y = at.rot; highlight.scale.set(w + 0.04, h + 0.04, d + 0.04); }
  bar?.update();
  ar?.update();
  arena?.update();
  ropes.update(cables);
  mates.update(world.crew);
  glow.update(cable.glowing(world, cables), world.t);
  clock?.update(world.level.name, world.t, strikeState(world, cables)?.since ?? null);
  loadOut?.update(world, cables);
  const grip: Grip = held && hp ? { kind: "gear", ...hp, ...whd(dims(held)) }
    : end ? { kind: "cable", at: cable.handAt(world), color: COLOR[end.run.kind] ?? 0x222222 } : { kind: "free" };
  hands.update(grip, world.t);
  const next = phase === "play" ? nextStep(world, cables, switchedOn) : null, tgt = next?.key ? world.items.find((i) => i.key === next.key) : null;
  marker.visible = !!tgt;
  if (tgt) marker.position.set(tgt.x, tgt.y + dims(tgt)[1] + 0.25 + Math.sin(performance.now() / 260) * 0.05, tgt.z);
  $("next").textContent = next ? next.text : "";
  $("next").hidden = !next;
  const g = held ? gear(held.gear) : null;
  $("hint").textContent = phase !== "play" ? "" : performance.now() < flash.until ? flash.text : (arena?.hint() ?? big?.hint() ?? ar?.hint() ?? hint(at, jack));
  const team = world.held?.team ? partner(world) : null;
  $("carry").textContent = phase !== "play" ? "" : g && world.held?.team ? (team ? `${g.what} with ${team.name}, ${you.speed.toFixed(1)} m/s` : `One end of the ${g.what}: someone take the other`)
    : g ? `${g.what}, ${g.kg} kg, ${you.speed.toFixed(1)} m/s`
    : end ? `${end.run.lengthM} m ${end.run.kind} cable, ${you.speed.toFixed(1)} m/s` : `Hands free, ${you.speed.toFixed(1)} m/s`;
  renderer.render(scene, camera);
}

const whd = ([w, h, d]: [number, number, number]) => ({ w, h, d });

/** What F (or a click) would do now. */
function hint(at: ReturnType<typeof aimed>, jack: ReturnType<typeof cable.aimedJack>): string {
  const end = cable.inHand(cables), coil = cable.coiling(cables);
  if (coil?.coiling) return `Q over, E under (${coil.coiling.ways.length} of ${cable.loopsFor(coil)})`;
  if (end) return jack ? `F plug into ${jack.owner} ${jack.jack}` : at?.key === cables.caseKey ? "F coil it back" : "F drop the cable";
  if (world.held) return "F put down, Q / E turn";
  const plugged = jack && cables.runs.some((r) => [r.a, r.b].some((e) => "plug" in e && e.plug[0] === jack.owner && e.plug[1] === jack.jack));
  if (plugged) return `F unplug ${jack.owner} ${jack.jack}`;
  if (at?.key === cables.caseKey && cables.runs.some((r) => !r.rope || "case" in r.b)) return "F take a cable";
  const sw = at && hasSwitch(at.gear, !!big) ? `, P switch it ${switchedOn.has(at.key) ? "off" : "on"}` : "";
  if (at && wheeled(at.gear)) return `F push the ${gear(at.gear).what} (${gear(at.gear).kg} kg)`;
  if (at) return `F pick up ${gear(at.gear).what} (${gear(at.gear).kg} kg)${sw}`;
  if (!world.level.truck) return "";
  return !striking(world) ? "L strike and load out" : strikeState(world, cables)?.tally ? "" : "T shut the truck";
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
  if (e.code === "Enter" && (bar || big)) return void openDoors();
  if (!world.held && !cable.inHand(cables) && bar?.key(e.code)) return;
  if (!cable.inHand(cables) && arena?.key(e.code, (why) => { flash = { text: why, until: performance.now() + 1800 }; })) return;
  if (!world.held && !cable.inHand(cables) && ar?.key(e.code)) return;
  if (big?.key(e.code)) return;
  if (e.code === "KeyF") grab();
  if ((e.code === "KeyQ" || e.code === "KeyE") && cable.coiling(cables)) return void say(cable.loop(world, cables, e.code === "KeyQ" ? "over" : "under"));
  if (e.code === "KeyQ") turnHeld(world, -1);
  if (e.code === "KeyE") turnHeld(world, 1);
  if (e.code === "KeyL") say(strike(world));
  if (e.code === "KeyT") say(shut(world, cables));
  if (e.code === "KeyP") flip();
  if (e.code === "KeyM") sound.toggle();
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

/** F: the cable job if there is one (plug, unplug, take one, coil), a jerry can poured into the generator you face,
 * else put down or pick up the gear. */
function grab(): Answer {
  const at = aimed(world), can = heldItem(world);
  if (ar && at && !world.held && !cable.inHand(cables) && reserved(world, at.key)) return (flash = { text: "the crew has that one", until: performance.now() + 1800 }), { ok: false, why: "the crew has that one" };
  const r = cable.use(world, cables, at) ?? (can && at && wheeled(at.gear) && gear(can.gear).can ? pour(world, at.key) : world.held ? place() : at ? (wheeled(at.gear) ? push : pickUp)(world, at.key) : { ok: false as const, why: "nothing in reach" });
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
  if (!at || !hasSwitch(at.gear, !!big)) return;
  if (!switchedOn.delete(at.key)) switchedOn.add(at.key);
}

/** What you hear now: in the dive bar, through its tilts and master fader. */
/** What you hear: a speaker plays when it's switched on and, once a cable goes into it, when the patch feeds it. */
const heard = () => hear(world, switchedOn, arena ? arena.fed : ar ? ar.fed() : big ? big.fed() : cable.fedBy(world, cables), undefined, bar || arena ? rig(world) : (ar ?? big)?.rig());

function play() {
  // On tour, Play goes to the booked gig: a fresh load once last night is settled.
  if (!asked && (settled || world.level !== bookedRung(tour).level)) load(bookedRung(tour).level);
  phase = "play"; menu(); lock();
}

/** Enter: doors on the venue's own score; at the booked gig the night is settled (pay less rent, the next booking) and home base shows how it went. */
function openDoors() {
  const s = bar?.doors() ?? big?.doors() ?? arena?.doors() ?? null;
  if (!s || settled || asked || world.level !== bookedRung(tour).level) return s;
  settled = true;
  tour = record(tour, world.level, s).tour;
  saveTour(tour);
  tourView?.update();
  setTimeout(() => { if (settled && phase === "play") { phase = "menu"; document.exitPointerLock?.(); menu(); } }, 2500);
  return s;
}

function menu() {
  $("menu").hidden = phase === "play";
  $("crew").textContent = crew.members.map((m) => `${m.name}${m.host ? " (host)" : ""}`).join(", ");
  $("code").textContent = crew.code ? `Party ${crew.code}${crew.room ? `, seat ${crew.seat + 1}` : ""}` : "";
  $("note").textContent = online?.note || crew.note;
  // Only the host's Start counts: the party answers anyone else's with a refusal, shown in the note.
  $("start").hidden = !crew.code || !!crew.room;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    world.you.pitch = clamp(world.you.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.3, 1.2);
    if (gp.pressed.has("grab")) grab();
    const turn = (dir: -1 | 1) => (cable.coiling(cables) ? say(cable.loop(world, cables, dir < 0 ? "over" : "under")) : turnHeld(world, dir));
    if (gp.pressed.has("turnLeft")) turn(-1);
    if (gp.pressed.has("turnRight")) turn(1);
    const on = (c: string) => (keys.has(c) ? 1 : 0);
    step(world, dt, {
      forward: on("KeyW") - on("KeyS") || -gp.left.y,
      right: on("KeyD") - on("KeyA") || gp.left.x,
      turn: -gp.right.x * k * ctl.lookX,
      crouch: keys.has("KeyC") || keys.has("ControlLeft") || gp.held.has("crouch"),
    });
    cable.stepCables(world, cables, dt);
  }
  online?.tick(world, now);
  big?.tick();
  ar?.tick();
  draw();
  sound.update(heard());
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
  if (!asked) tourView = mountTour($("tour-host"), () => tour, (t) => { tour = t; saveTour(t); });
  clock = mountClock($("hud"));
  loadOut = mountStrike($("hud"));
  $("party").hidden = !canSignIn();
  mountControls({
    key: KEY, pad, parent: $("controls-host"), title: "Controls", skin: "house",
    keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["F / click", "Pick up, put down, plug in, unplug"], ["Q / E", "Turn what you hold; coiling, over and under"], ["L", "Strike and load out"], ["T", "Shut the truck"], ["C", "Crouch"], ["Esc", "Let go of the mouse"]],
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
  state: () => ({ phase, tour: { cash: tour.cash, truck: tour.truck, booked: tour.booked, nights: tour.nights.length, settled }, next: nextStep(world, cables, switchedOn), dial: currentDial(), doors: doors(world.level.name, world.t), ...snapshot(world), ...cable.cableState(world, cables), sound: { up: sound.up, on: [...switchedOn], ...heard() }, ...(big ? { biggerBar: big.state() } : {}), ...(ar ? { arena: { ...arenaState(world), heat: ar.heatOn } } : {}), ...(arena ? { smallArena: { ...arenaSim.arenaState(world), heat: arena.heatOn } } : {}), strike: strikeState(world, cables), ...(bar ? { bar: { ...(world.level === PARK ? parkState(world, cables) : barState(world)), heat: bar.heatOn, ...("band" in bar ? { band: bar.band } : {}) } } : {}), signedIn: !!login(), party: crew.code ? { code: crew.code, members: crew.members.length, room: crew.room || null, seat: crew.seat >= 0 ? crew.seat : null } : null, crewRoom: online ? { room: online.room, status: online.status, note: online.note } : null }),
  /** Join a crew room by code (what the party's Start does), on this level. */
  crew: (room: string) => crewRoom(room.toUpperCase()),
  /** Turn the cozy-to-sim dial: "cozy", "crew" or "sim". */
  dial: (d: string) => setDial(d),
  /** Into the level, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** Walk to (x, z) at your carrying pace, cables dragging; the seconds it took. */
  walkTo: (x: number, z: number) => cable.walkWith(world, cables, x, z),
  /** Park: take the generator's handle and push it on its wheels (put it down with putDown). */
  push: (key: string): Answer => (cable.inHand(cables) ? { ok: false, why: "your hands are full" } : push(world, key)),
  /** Park: holding a jerry can, pour it into the generator. */
  pour: (key: string): Answer => pour(world, key),
  pickUp: (key: string): Answer => (cable.inHand(cables) ? { ok: false, why: "your hands are full" } : lift(key)),
  putDown: () => place(),
  /** A cable out of the case (power, speaker, xlr, instrument), its `a` end in your hand. */
  takeCable: (kind?: cable.Run["kind"]) => cable.takeCable(world, cables, kind),
  plug: (owner: string, jack: string) => cable.plug(world, cables, owner, jack),
  unplug: (owner: string, jack: string) => cable.unplug(world, cables, owner, jack),
  grabEnd: (key: string, end: "a" | "b") => cable.grabEnd(world, cables, key, end),
  dropEnd: () => cable.dropEnd(cables),
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
  /** Load a level by name (garage, dive-bar, bigger-bar, park, arena, small-arena). */
  level: (name: string) => load(levelFrom(name)),
  /** Turn what you hold a 15 degree step: -1 left, 1 right. */
  turn: (dir: number) => turnHeld(world, dir),
  /** Look to `yaw` degrees (0 is into the garage) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { world.you.yaw = (yaw * Math.PI) / 180; world.you.pitch = (pitch * Math.PI) / 180; },
  /** Switch a piece of gear on or off (P while looking at it); false if it has no switch. */
  power: (key: string, state = !switchedOn.has(key)) => {
    const item = world.items.find((i) => i.key === key);
    if (!item || !hasSwitch(item.gear, !!big)) return false;
    if (state) switchedOn.add(key); else switchedOn.delete(key);
    return true;
  },
  /** Bring the speakers up or down (the card, or M). Browsers start sound only after a click, so a probe reads state instead. */
  speakers: (up: boolean) => sound.setUp(up),
  /** The level as it began. */
  /** In the bigger bar, at the panel: reset a tripped breaker (or all of them). */
  resetBreaker: (circuit?: string) => big?.reset(circuit) ?? { ok: false, why: "no breaker panel here" },
  reset: () => { switchedOn.clear(); load(world.level); },
};
window.loadIn = harness;

void boot();
