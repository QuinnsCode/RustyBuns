// The page: draws the level (sim.ts) in first person with three.js, reads the mouse (pointer lock), WASD and a gamepad,
// and holds the menu with the eqosys account chip and the Qollab party. `window.loadIn` is the harness: `state()` says
// where you are, what you hold and where every piece of gear sits, and walkTo / pickUp / putDown play it without
// pointer lock, so an agent (bun run probe load-in) or a test asks the game instead of reading screenshots.
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import { GEAR } from "./gear.ts";
import { EYE, EYE_CROUCH, aimed, heldItem, holdPose, newWorld, pickUp, putDown, snapshot, step, turnHeld, walkTo, type World } from "./sim.ts";
import { accountChip, canSignIn, finishSignIn, login, party, type PartyMember } from "./eqosys.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const KEY = "load-in.controls";

let world: World = newWorld();
let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
const keys = new Set<string>();
const crew = { code: "", members: [] as PartyMember[], room: "", seat: -1, note: "" };
const pad = loadPad(KEY, [
  { id: "grab", label: "Pick up / put down", button: 0 },
  { id: "crouch", label: "Crouch", button: 1 },
  { id: "turnLeft", label: "Turn it left", button: 4 },
  { id: "turnRight", label: "Turn it right", button: 5 },
]);

// The scene: the garage's floor, walls and ceiling bulb, the driveway outside, and a box per piece of gear.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1420);
scene.fog = new THREE.Fog(0x0d1420, 8, 22);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xc8d4e6, 0x2a2420, 0.7));
const bulb = new THREE.PointLight(0xffe2b0, 18, 12, 1.6);
bulb.position.set(0, 2.45, 3.5);
scene.add(bulb);

function room(l: World["level"]) {
  const g = new THREE.Group(), r = l.room, b = l.bounds;
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

const meshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
function buildItems() {
  for (const m of meshes.values()) scene.remove(m);
  meshes.clear();
  for (const i of world.items) {
    const [w, h, d] = GEAR[i.gear].size;
    const geo = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: GEAR[i.gear].color, roughness: 0.7 }));
    meshes.set(i.key, m);
    scene.add(m);
  }
}
buildItems();

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
    const m = meshes.get(i.key)!, p = i === held && hp ? hp : i;
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.rot;
    m.material.emissive.setHex(i === at && !held ? 0x2a4a5a : 0);
  }
  const g = held ? GEAR[held.gear] : null;
  $("hint").textContent = phase !== "play" ? "" : held ? "F put down, Q / E turn" : at ? `F pick up ${GEAR[at.gear].name} (${GEAR[at.gear].kg} kg)` : "";
  $("carry").textContent = phase !== "play" ? "" : g ? `${g.name}, ${g.kg} kg, ${you.speed.toFixed(1)} m/s` : `Hands free, ${you.speed.toFixed(1)} m/s`;
  renderer.render(scene, camera);
}

// Input: pointer lock for the mouse, keys while playing, the pad every frame.
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
canvas.addEventListener("click", () => phase === "play" && !locked() && lock());
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const k = 0.0022;
  world.you.yaw -= e.movementX * k * ctl.lookX;
  world.you.pitch = clamp(world.you.pitch - e.movementY * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.3, 1.2);
});
document.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (phase !== "play" || e.repeat) return;
  if (e.code === "KeyF") grab();
  if (e.code === "KeyQ") turnHeld(world, -1);
  if (e.code === "KeyE") turnHeld(world, 1);
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

function grab() {
  if (world.held) return putDown(world);
  const at = aimed(world);
  return at ? pickUp(world, at.key) : { ok: false as const, why: "nothing in reach" };
}

function play() { phase = "play"; menu(); lock(); }

function menu() {
  $("menu").hidden = phase === "play";
  $("crew").textContent = crew.members.map((m) => `${m.name}${m.host ? " (host)" : ""}`).join(", ");
  $("code").textContent = crew.code ? `Party ${crew.code}${crew.room ? `, seat ${crew.seat + 1}` : ""}` : "";
  $("note").textContent = crew.note;
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
    if (gp.pressed.has("turnLeft")) turnHeld(world, -1);
    if (gp.pressed.has("turnRight")) turnHeld(world, 1);
    const on = (c: string) => (keys.has(c) ? 1 : 0);
    step(world, dt, {
      forward: on("KeyW") - on("KeyS") || -gp.left.y,
      right: on("KeyD") - on("KeyA") || gp.left.x,
      turn: -gp.right.x * k * ctl.lookX,
      crouch: keys.has("KeyC") || keys.has("ControlLeft") || gp.held.has("crouch"),
    });
  }
  draw();
  requestAnimationFrame(frame);
}

// The party: make one (its code to hand out) or join one by code; the host's Start seats everyone.
function wireParty() {
  const p = party();
  p.onMembers((m) => { crew.members = m; menu(); });
  p.onStart((s) => { crew.room = s.room; crew.seat = s.seat; play(); });
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
  $("party").hidden = !canSignIn();
  mountControls({
    key: KEY, pad, parent: $("controls-host"), title: "Controls", skin: "house",
    keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["F", "Pick up / put down"], ["Q / E", "Turn what you hold"], ["C", "Crouch"], ["Esc", "Let go of the mouse"]],
    onChange: (s) => { ctl = s; },
    onToggle: (open) => { if (open) document.exitPointerLock?.(); },
  });
  wireParty();
  $("play").addEventListener("click", play);
  menu();
  resize();
  requestAnimationFrame(frame);
}

declare global { interface Window { loadIn: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): the level as data, and the moves a test or an agent makes without pointer lock. */
const harness = {
  state: () => ({ phase, ...snapshot(world), signedIn: !!login(), party: crew.code ? { code: crew.code, members: crew.members.length, room: crew.room || null, seat: crew.seat >= 0 ? crew.seat : null } : null }),
  /** Into the level, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** Walk to (x, z) at your carrying pace; the seconds it took. */
  walkTo: (x: number, z: number) => walkTo(world, x, z),
  pickUp: (key: string) => pickUp(world, key),
  putDown: () => putDown(world),
  /** Turn what you hold a 15 degree step: -1 left, 1 right. */
  turn: (dir: number) => turnHeld(world, dir),
  /** Look to `yaw` degrees (0 is into the garage) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { world.you.yaw = (yaw * Math.PI) / 180; world.you.pitch = (pitch * Math.PI) / 180; },
  /** The level as it began. */
  reset: () => { world = newWorld(); scene.remove(roomGroup); roomGroup = room(world.level); scene.add(roomGroup); buildItems(); },
};
window.loadIn = harness;

void boot();
