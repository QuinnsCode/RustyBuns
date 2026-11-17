// Qollab Studio's jam room (/jam.html): walk in as your avatar, sit at an instrument and play the sesh's FM DAW track
// for it with your computer keys or a MIDI keyboard, so everyone in the sesh hears it. Over the shoulder while you
// walk, first person when you sit, V either way. Your body, seat and notes go on the sesh's live line; the room
// (src/studio/rooms/) is data. ?room=<sesh> (or /jam.html opened from a sesh) is the sesh you jam in.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "../room/studio.css";
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp, lerp } from "@rustybuns/util";
import { cleanAvatar, defaultAvatar, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { apply, type Live, type Project } from "../project.ts";
import { demoProject } from "../presets.ts";
import { AudioOut, START_DB, dbToGain } from "../ui/audio.ts";
import { startMidi } from "../ui/input.ts";
import { loadMsg } from "../ui/load.ts";
import { connect, type Net, type NetStatus } from "../ui/net.ts";
import { localMe, myKey } from "../ui/me.ts";
import { type Answer, BODY_HZ, DRUM_KEYS, body, cameraPose, gone, hear, keyNote, nearSpot, newJam, sit, snapshot, spotOf, stand, step, toggleCam, walkTo } from "./jam.ts";
import { figure, type Figure } from "./figure.ts";
import { thingBox, wallPieces, type Spot } from "./room.ts";
import { ROOMS, LIVE_ROOM } from "./rooms/live.ts";

const CONTROLS = "qollab-studio:controls";
const LOOK = "qollab-studio:avatar";
const $ = (id: string) => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} is missing`); return e; };

const def = ROOMS[new URLSearchParams(location.search).get("studio") ?? ""] ?? LIVE_ROOM;
const jam = newJam(def);
const name = localMe().name || "Someone";
function myLook(): Avatar {
  try { const a = cleanAvatar(JSON.parse(localStorage.getItem(LOOK) ?? "null")); if (a) return a; } catch { /* none saved */ }
  return defaultAvatar(name);
}
let look = myLook();

let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
let flash = { text: "", until: 0 };
let octave = 0;
let status: NetStatus = { state: "connecting", peers: 0 };
let project: Project = demoProject();
const keys = new Set<string>();
const pad = loadPad(CONTROLS, [{ id: "sit", label: "Sit / stand up", button: 0 }, { id: "cam", label: "Camera", button: 3 }]);

// ---- the scene ----
const canvas = $("stage");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#stage is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171b);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xe6e2da, 0x2a2420, 1.1));
for (const [x, z] of [[-2.5, 1.5], [2.5, 1.5], [0, -3]]) {
  const l = new THREE.PointLight(0xffe2bc, 10, 9, 1.4);
  l.position.set(x, def.size.h - 0.3, z);
  scene.add(l);
}
const std = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
function buildRoom() {
  const { w, d, h } = def.size;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(def.colors.floor));
  floor.rotation.x = -Math.PI / 2;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(def.colors.ceiling));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = h;
  scene.add(floor, ceil);
  const outside = [{ from: [-w / 2, -d / 2], to: [w / 2, -d / 2] }, { from: [w / 2, -d / 2], to: [w / 2, d / 2] }, { from: [w / 2, d / 2], to: [-w / 2, d / 2] }, { from: [-w / 2, d / 2], to: [-w / 2, -d / 2] }] as const;
  const wallMat = std(def.colors.walls), glass = std("#9fc6d8", { transparent: true, opacity: 0.18, roughness: 0.1 }), trim = std(def.colors.trim);
  for (const wall of [...outside.map((x) => ({ from: [...x.from] as [number, number], to: [...x.to] as [number, number] })), ...def.walls]) {
    for (const p of wallPieces(wall, 0.12)) {
      const isGlass = "glass" in wall && wall.glass;
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.hw * 2, isGlass ? h - 1.1 : h, p.hd * 2), isGlass ? glass : wallMat);
      m.position.set(p.cx, isGlass ? 0.9 + (h - 1.1) / 2 : h / 2, p.cz);
      m.rotation.y = p.turn;
      scene.add(m);
      if (isGlass) {
        // a solid wall under the window, a trim along its sill
        const sill = new THREE.Mesh(new THREE.BoxGeometry(p.hw * 2, 0.9, p.hd * 2 + 0.02), wallMat);
        sill.position.set(p.cx, 0.45, p.cz); sill.rotation.y = p.turn;
        const t = new THREE.Mesh(new THREE.BoxGeometry(p.hw * 2, 0.04, p.hd * 2 + 0.08), trim);
        t.position.set(p.cx, 0.9, p.cz); t.rotation.y = p.turn;
        scene.add(sill, t);
      }
    }
  }
  for (const s of def.spots) scene.add(thing(s));
}
/** A spot's instrument or furniture, and its seat. */
function thing(s: Spot): THREE.Group {
  const g = new THREE.Group(), b = thingBox(s), t = s.thing, m = std(t.color);
  const at = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); g.add(o); return o; };
  const inFront = new THREE.Group();
  inFront.position.set(b.cx, 0, b.cz); inFront.rotation.y = b.turn;
  g.add(inFront);
  const put = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); inFront.add(o); return o; };
  if (s.kind === "drums") {
    const shell = std(t.color, { roughness: 0.4 }), head = std("#ece6d8");
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 20), shell), 0, 0.3, 0.1).rotation.x = Math.PI / 2;
    for (const [x, y, r] of [[-0.45, 0.55, 0.17], [0.45, 0.6, 0.15], [-0.15, 0.72, 0.12], [0.18, 0.72, 0.12]]) put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.16, 18), head), x, y, 0.15);
    for (const x of [-0.75, 0.75]) put(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 20), std("#d8b04a", { metalness: 0.7, roughness: 0.3 })), x, 1.0, -0.1);
  } else if (s.kind === "keys") {
    put(new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.12, t.d), m), 0, t.h - 0.06, 0);
    put(new THREE.Mesh(new THREE.BoxGeometry(t.w - 0.1, 0.03, t.d * 0.5), std("#f4f1ea")), 0, t.h + 0.01, t.d * 0.18);
    for (const x of [-t.w / 2 + 0.08, t.w / 2 - 0.08]) put(new THREE.Mesh(new THREE.BoxGeometry(0.05, t.h - 0.12, 0.05), m), x, (t.h - 0.12) / 2, 0);
  } else if (s.kind === "booth") {
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, t.h, 8), m), 0, t.h / 2, 0);
    put(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 6, 12), std("#16191c")), 0, t.h + 0.05, 0);
  } else {
    put(new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), m), 0, t.h / 2, 0);
    if (s.kind === "desk") for (let i = 0; i < 12; i++) put(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), std("#c8a46a")), -t.w / 2 + 0.3 + i * 0.16, t.h + 0.015, 0.1);
    if (s.kind === "bass") put(new THREE.Mesh(new THREE.CircleGeometry(t.w * 0.32, 20), std("#16191c")), 0, t.h * 0.45, -t.d / 2 - 0.001).rotation.y = Math.PI;
    if (s.kind === "couch") put(new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.5, 0.2), m), 0, t.h + 0.25, t.d / 2 - 0.1);
  }
  if (s.kind !== "couch" && s.kind !== "booth") {
    // the seat: a stool, or the desk's chair
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.06, 16), std("#2e3439")), s.at[0], 0.45, s.at[1]);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), std("#8a8f94", { metalness: 0.6 })), s.at[0], 0.225, s.at[1]);
  }
  return g;
}
buildRoom();

// ---- people: you, and everyone the live line says is here ----
interface Drawn { fig: Figure; key: string; x: number; z: number; yaw: number; speed: number }
const drawn = new Map<number | "me", Drawn>();
function drawPerson(id: number | "me", a: Avatar, label: string, x: number, z: number, yaw: number, seated: boolean, playing: boolean, dt: number, t: number, snap: boolean) {
  const key = JSON.stringify([a, label]);
  let d = drawn.get(id);
  if (d && d.key !== key) { scene.remove(d.fig.group); d.fig.dispose(); d = undefined; }
  if (!d) { d = { fig: figure(a, label), key, x, z, yaw, speed: 0 }; scene.add(d.fig.group); drawn.set(id, d); }
  // others glide to where their last body said, 10 a second; you are where you are
  const k = snap ? 1 : 1 - Math.exp(-dt * 12);
  const nx = lerp(d.x, x, k), nz = lerp(d.z, z, k);
  d.speed = lerp(d.speed, dt > 0 ? Math.hypot(nx - d.x, nz - d.z) / dt : 0, 0.3);
  d.x = nx; d.z = nz;
  d.yaw += Math.atan2(Math.sin(yaw - d.yaw), Math.cos(yaw - d.yaw)) * k;
  d.fig.group.position.set(d.x, 0, d.z);
  d.fig.group.rotation.y = d.yaw;
  d.fig.pose({ speed: d.speed, seated, playing, t });
}
function dropPerson(id: number | "me") {
  const d = drawn.get(id);
  if (d) { scene.remove(d.fig.group); d.fig.dispose(); drawn.delete(id); }
}

// ---- sound: the FM DAW audio thread, mirroring the sesh's groove ----
let out: AudioOut | null = null;
async function startAudio() {
  if (out) return;
  try {
    out = await AudioOut.start(() => {});
    out.send(loadMsg(project));
    out.send({ t: "master", gain: dbToGain(START_DB) });
  } catch (e) { flash = { text: `No sound: ${(e as Error).message}`, until: performance.now() + 4000 }; }
}
/** Notes you hold now, by what holds them (a key, a MIDI note), so letting go turns off the right one. */
const holding = new Map<string, { track: number; midi: number }>();
function noteOn(by: string, n: { track: number; midi: number }, vel: number) {
  if (holding.has(by)) return;
  holding.set(by, n);
  out?.send({ t: "on", ...n, vel });
  live({ t: "on", ...n, vel });
}
function noteOff(by: string) {
  const n = holding.get(by);
  if (!n) return;
  holding.delete(by);
  out?.send({ t: "off", ...n });
  live({ t: "off", ...n });
}
function releaseAll() { for (const by of [...holding.keys()]) noteOff(by); }

// ---- the sesh ----
let net: Net | null = null;
const live = (e: Live) => net?.live(e);
function wear() { live({ t: "wear", avatar: look, name }); live(body(jam)); }
function onLive(from: number, e: Live) {
  hear(jam, from, e);
  if (e.t === "on") out?.send({ t: "on", track: e.track, midi: e.midi, vel: e.vel });
  else if (e.t === "off") out?.send({ t: "off", track: e.track, midi: e.midi });
}
function onGone(from: number) {
  for (const k of jam.others.get(from)?.held ?? []) { const [track, midi] = k.split(":").map(Number); out?.send({ t: "off", track, midi }); }
  gone(jam, from);
  dropPerson(from);
}
net = connect({
  onSnapshot(p) {
    if (!p) { net?.init(project); return; }
    project = p;
    out?.send(loadMsg(p));
  },
  onOp(op) { project = apply(project, op); out?.send(loadMsg(project)); },
  onLive,
  onGone,
  onStatus(s) {
    // someone new came in: say who you are again, so they see you before you next move
    if (s.state === "online" && s.peers > status.peers) wear();
    status = s;
  },
  onChat() {},
  onTakeBytes() {},
  hello: () => ({ key: myKey(), name }),
});

// ---- input ----
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
const say = (a: Answer) => { if (!a.ok) flash = { text: a.why, until: performance.now() + 1800 }; return a; };
function sitOrStand() {
  if (jam.me.seat) { releaseAll(); stand(jam); live(body(jam)); return; }
  const s = nearSpot(jam);
  if (!s) return void say({ ok: false, why: "Walk up to an instrument or a seat" });
  if (say(sit(jam, s.id)).ok) live(body(jam));
}
canvas.addEventListener("mousedown", () => {
  if (phase !== "play") return;
  if (!locked()) return lock();
  sitOrStand();
});
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const s = 0.0022;
  jam.me.yaw -= e.movementX * s * ctl.lookX;
  jam.me.pitch = clamp(jam.me.pitch - e.movementY * s * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.1);
});
function keyDown(code: string, shift = false) {
  if (code === "KeyM") return void startAudio();
  if (phase !== "play") return;
  if (code === "KeyV") return toggleCam(jam);
  if (code === "Space") return sitOrStand();
  if (jam.me.seat) {
    if (code === "KeyZ") { releaseAll(); octave = Math.max(-3, octave - 1); return; }
    if (code === "KeyX") { releaseAll(); octave = Math.min(3, octave + 1); return; }
    const n = keyNote(jam, project, code, octave);
    if (n) noteOn(`kb:${code}`, n, shift ? 1 : 0.75);
  }
}
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Tab") e.preventDefault();
  keys.add(e.code);
  if (!e.repeat) keyDown(e.code, e.shiftKey);
});
document.addEventListener("keyup", (e) => { keys.delete(e.code); noteOff(`kb:${e.code}`); });
addEventListener("blur", () => { keys.clear(); releaseAll(); });
document.addEventListener("pointerlockchange", () => { if (!locked() && phase === "play") { phase = "menu"; releaseAll(); menu(); } });
// a MIDI keyboard plays wherever you sit, note for note (the kit takes its notes as the home row's drums, in order)
void startMidi({
  on(note, vel) {
    const s = spotOf(jam, jam.me.seat);
    if (!s || phase !== "play") return;
    const n = keyNote(jam, project, s.kind === "drums" ? DRUM_KEYS[note % DRUM_KEYS.length] : "KeyA", 0);
    if (n) noteOn(`midi:${note}`, s.kind === "drums" ? n : { track: n.track, midi: note }, vel);
  },
  off(note) { noteOff(`midi:${note}`); },
  panic: releaseAll, bend() {}, cc() {}, devices() {},
});

function menu() { $("menu").hidden = phase === "play"; }
function play() { phase = "play"; menu(); lock(); void startAudio(); }
$("play").addEventListener("click", play);
$("look").addEventListener("click", () => {
  look = randomAvatar(Math.random);
  try { localStorage.setItem(LOOK, JSON.stringify(look)); } catch { /* this visit only */ }
  wear();
});
mountControls({
  key: CONTROLS, pad, parent: $("controls-host"), title: "Controls", skin: "house",
  keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["Space / click", "Sit at a spot, stand up"], ["A to ' (seated)", "Play notes; Shift plays louder"], ["Z / X", "Octave down, up"], ["V", "Over the shoulder or first person"], ["M", "Speakers up"], ["Esc", "Let go of the mouse"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); },
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

function hint(): string {
  const s = spotOf(jam, jam.me.seat);
  if (s) {
    const n = keyNote(jam, project, "KeyA", octave);
    if (s.kind === "drums") return `At ${s.label}: A S D F G H J K L are the drums. Space stands up, V camera`;
    if (n) return `At ${s.label}, playing ${project.tracks[n.track].name}: A to ' are notes, Z / X octave (${octave >= 0 ? "+" : ""}${octave}). Space stands up, V camera`;
    return `At ${s.label}. Space stands up, V camera`;
  }
  const near = nearSpot(jam);
  return near ? `Space or click: sit at ${near.label}` : "";
}

// ---- every frame ----
let last = performance.now(), sentAt = 0, sentBody = "";
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    jam.me.pitch = clamp(jam.me.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.1);
    if (gp.pressed.has("sit")) sitOrStand();
    if (gp.pressed.has("cam")) toggleCam(jam);
    const on = (c: string) => (keys.has(c) && !jam.me.seat ? 1 : 0);
    step(jam, dt, { forward: on("KeyW") - on("KeyS") || -gp.left.y, right: on("KeyD") - on("KeyA") || gp.left.x, turn: -gp.right.x * k * ctl.lookX });
  }
  // your body, about 10 a second while it changes, and once a second regardless so a late arrival sees you
  const b = body(jam), bs = JSON.stringify(b);
  if (now - sentAt > 1000 / BODY_HZ && (bs !== sentBody || now - sentAt > 1000)) { live(b); sentAt = now; sentBody = bs; }
  // you: seen over your shoulder, not from inside your own head
  if (jam.me.cam === "shoulder") drawPerson("me", look, name, jam.me.x, jam.me.z, jam.me.yaw, !!jam.me.seat, holding.size > 0, dt, t, true);
  else dropPerson("me");
  for (const [peer, o] of jam.others) {
    if (!o.avatar && !o.name) continue;
    const seat = spotOf(jam, o.seat);
    drawPerson(peer, o.avatar ?? defaultAvatar(o.name), o.name, o.at[0], o.at[1], seat ? seat.yaw : o.yaw, !!seat, o.held.size > 0, dt, t, false);
  }
  const c = cameraPose(jam);
  camera.position.set(...c.at);
  camera.rotation.set(c.pitch, c.yaw, 0);
  $("cross").hidden = jam.me.cam !== "first";
  $("hint").textContent = now < flash.until ? flash.text : hint();
  const playing = [...jam.others.values()].filter((o) => o.seat).map((o) => `${o.name || "Someone"} at ${spotOf(jam, o.seat)?.label ?? o.seat}`);
  $("heard").textContent = `${status.state === "online" ? `${status.peers} in the sesh` : status.state}${playing.length ? `. ${playing.join(", ")}` : ""}${out ? "" : ". M brings the speakers up"}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
menu();

// ---- the harness (scripts/probe.ts HANDLES): the jam as data, and a player's moves without pointer lock ----
declare global { interface Window { qjam?: typeof harness } }
const harness = {
  state: () => ({ phase, net: status.state, peers: status.peers, octave, audio: !!out, holding: [...holding.values()], ...snapshot(jam, project) }),
  start: () => { phase = "play"; menu(); void startAudio(); return harness.state(); },
  walkTo: (x: number, z: number) => { const s = walkTo(jam, x, z); live(body(jam)); return s; },
  look: (yaw: number, pitch = 0) => { jam.me.yaw = yaw; jam.me.pitch = pitch; },
  sit: (id?: string) => { const a = id ? sit(jam, id) : (sitOrStand(), { ok: !!jam.me.seat }); live(body(jam)); return a; },
  stand: () => { releaseAll(); stand(jam); live(body(jam)); },
  cam: () => { toggleCam(jam); return jam.me.cam; },
  /** Press (down true) or let go of a key: KeyA plays the seat's lowest note. */
  key: (code: string, down = true) => (down ? keyDown(code) : noteOff(`kb:${code}`)),
};
window.qjam = harness;
