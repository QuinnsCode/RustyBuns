// Qollab Studio, the jam room (/jam.html, or /jam.html?room=<sesh> to jam in that sesh): you walk in as your avatar
// with the camera over your shoulder, walk up to a spot and sit (Space), and the camera goes first person: your
// keys (computer keyboard or MIDI) now play that spot's FM DAW track, sent on the sesh's live line so everyone
// hears it. Space again stands you up; V swaps the camera anywhere. Everyone else in the sesh walks and sits where
// their bodies say. The room is a definition (./rooms), the state is ./jam.ts. `window.qjam` is the harness
// (scripts/probe.ts HANDLES).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "../room/studio.css";
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import { defaultAvatar, type Avatar } from "@rustybuns/util/avatar";
import { AudioOut, loadMsg } from "../ui/audio.ts";
import { connect, roomName, type NetStatus } from "../ui/net.ts";
import { localMe, myKey } from "../ui/me.ts";
import { startMidi } from "../ui/input.ts";
import { apply, lettingGo, type Live, type Project } from "../project.ts";
import { demoProject } from "../presets.ts";
import { type Answer, camera as cameraPose, gone, midiNote, nearSpot, newJam, onLive, press, release, shiftOctave, sit, snapshot, spotOf, stand, step, toggleView, walkTo } from "./jam.ts";
import { LIVE_ROOM } from "./rooms/live.ts";
import { figure, type Figure } from "./figure.ts";
import { roomModel, seatRing } from "./models.ts";

const CONTROLS = "qollab-studio.controls";
const $ = (id: string) => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };

const me = localMe();
const avatar: Avatar = defaultAvatar(me.name || `guest ${myKey().slice(0, 6)}`);
const jam = newJam(LIVE_ROOM, avatar);
let project: Project = demoProject();
const syncRoots = () => { jam.roots = project.tracks.map((t) => t.root); };
syncRoots();

let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
let flash = { text: "", until: 0 };
let status: NetStatus = { state: "connecting", peers: 0 };
const keys = new Set<string>();
const pad = loadPad(CONTROLS, [{ id: "sit", label: "Sit / stand", button: 0 }, { id: "view", label: "Camera", button: 3 }]);

// ---- sound: FM DAW's engine, the sesh's project in it; your notes and everyone else's ----
let audio: AudioOut | null = null;
/** The notes each other player holds, so a player who leaves stops sounding. */
const theirs = new Map<number, Set<string>>();
async function startAudio() {
  if (audio) return;
  try {
    audio = await AudioOut.start(() => {});
    audio.send(loadMsg(project));
  } catch { audio = null; /* no sound here (headless, or the browser said no): the room still works */ }
}
const noteOut = (track: number, midi: number, vel: number) => audio?.send({ t: "on", track, midi, vel });
const noteStop = (track: number, midi: number) => audio?.send({ t: "off", track, midi });

// ---- the sesh ----
let floorHeld = false;
const net = connect({
  onSnapshot(p) { project = p ?? demoProject(); syncRoots(); audio?.send(loadMsg(project)); },
  onOp(op) { project = apply(project, op); syncRoots(); audio?.send(loadMsg(project)); },
  onLive(from, e) {
    onLive(jam, from, e);
    const mine = theirs.get(from) ?? new Set<string>();
    theirs.set(from, mine);
    if (e.t === "on") { noteOut(e.track, e.midi, e.vel); mine.add(`${e.track}:${e.midi}`); }
    else if (e.t === "off") { noteStop(e.track, e.midi); mine.delete(`${e.track}:${e.midi}`); }
  },
  onGone(from) {
    gone(jam, from);
    for (const k of theirs.get(from) ?? []) { const [t, m] = k.split(":").map(Number); noteStop(t, m); }
    theirs.delete(from);
  },
  onStatus(s) { status = s; floorHeld = s.floor?.state === "held" && !s.floor.host; },
  onChat() {},
  onTakeBytes() {},
  hello: () => ({ key: myKey(), name: me.name }),
});
/** What the jam has to say goes out; while the maker holds the floor, only letting go does (as in the DAW). */
function flush() {
  for (const e of jam.out.splice(0)) if (!floorHeld || lettingGo(e)) net.live(e);
}

// ---- the scene ----
const canvas = $("stage");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#stage is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171b);
const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 40);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xe6e2da, 0x2a2420, 0.85));
for (const [x, z, c, i] of [[-1.5, 1, 0xffe0b8, 16], [1.8, 1.2, 0xffd0a0, 12], [0, -2.6, 0x9fc6ff, 7]] as const) {
  const l = new THREE.PointLight(c, i, 9, 1.4);
  l.position.set(x, LIVE_ROOM.height - 0.25, z);
  l.castShadow = x < 0 && z > 0;
  scene.add(l);
}
scene.add(roomModel(LIVE_ROOM));
const ring = seatRing();
scene.add(ring);

// figures: yours, and one per other player (remade when their avatar changes)
const mine = figure(avatar);
scene.add(mine.root);
const others = new Map<number, { fig: Figure; avatar: string; was: [number, number]; walking: number }>();
function syncOthers(dt: number) {
  for (const [peer, o] of jam.others) {
    const key = JSON.stringify(o.avatar);
    let f = others.get(peer);
    if (f && f.avatar !== key) { scene.remove(f.fig.root); f.fig.dispose(); f = undefined; }
    if (!f) { f = { fig: figure(o.avatar), avatar: key, was: [o.x, o.z], walking: 0 }; others.set(peer, f); scene.add(f.fig.root); }
    const moved = Math.hypot(o.x - f.was[0], o.z - f.was[1]);
    f.walking = clamp(f.walking + (moved > 0.002 ? dt * 6 : -dt * 4), 0, 1);
    f.was = [o.x, o.z];
    place(f.fig, o.x, o.z, o.yaw, o.spot, f.walking, o.playingUntil > jam.now);
  }
  for (const [peer, f] of others) if (!jam.others.has(peer)) { scene.remove(f.fig.root); f.fig.dispose(); others.delete(peer); }
}
function place(f: Figure, x: number, z: number, yaw: number, spot: string | null, walking: number, playing: boolean) {
  const s = spotOf(jam, spot);
  f.root.position.set(s ? s.at[0] : x, 0, s ? s.at[1] : z);
  f.root.rotation.y = s ? s.yaw : yaw;
  f.pose({ sitting: !!s, walking, playing: !!s && playing, t: jam.now });
}

// ---- input ----
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
const say = (a: Answer) => { if (!a.ok) flash = { text: a.why, until: performance.now() + 1800 }; return a; };
const sitOrStand = () => say(jam.me.spot ? stand(jam) : sit(jam));
let myPlaying = 0;
function down(code: string, vel = 0.8, n?: { track: number; midi: number } | null) {
  const got = n === undefined ? press(jam, code, vel) : press(jam, code, vel, n);
  if (got) { noteOut(got.track, got.midi, vel); myPlaying = jam.now + 0.5; }
}
function up(code: string) { const n = release(jam, code); if (n) noteStop(n.track, n.midi); }

canvas.addEventListener("mousedown", () => { if (phase === "play" && !locked()) lock(); });
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const s = 0.0022;
  jam.me.yaw -= e.movementX * s * ctl.lookX;
  jam.me.pitch = clamp(jam.me.pitch - e.movementY * s * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.0);
});
document.addEventListener("keydown", (e) => {
  if (phase !== "play") return;
  if (e.code === "Space") e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "KeyV") return toggleView(jam);
  if (e.code === "Space") return void sitOrStand();
  if (jam.me.spot) {
    if (e.code === "KeyZ") return shiftOctave(jam, -1);
    if (e.code === "KeyX") return shiftOctave(jam, 1);
    down(e.code);
  }
});
document.addEventListener("keyup", (e) => { keys.delete(e.code); up(e.code); });
addEventListener("blur", () => { keys.clear(); for (const c of [...jam.held.keys()]) up(c); });
document.addEventListener("pointerlockchange", () => { if (!locked() && phase === "play") { phase = "menu"; menu(); } });
void startMidi({
  on: (n, v) => down(`midi:${n}`, v, midiNote(jam, n)),
  off: (n) => up(`midi:${n}`),
  panic: () => { for (const c of [...jam.held.keys()]) up(c); },
  bend: () => {}, cc: () => {}, devices: () => {},
});

function hint(): string {
  const s = spotOf(jam, jam.me.spot);
  if (s) {
    const plays = s.kit ? "A S D F G hit the kit" : s.track !== undefined ? `your keys play ${project.tracks[s.track]?.name ?? "it"}${jam.octave ? `, octave ${jam.octave > 0 ? "+" : ""}${jam.octave}` : ""} (Z / X)` : s.kind === "desk" ? "the desk is the DAW: open it from the menu" : "take a load off";
    return `At the ${s.name.toLowerCase()}: ${plays}. Space stands up`;
  }
  const n = nearSpot(jam);
  return n ? `Space: sit at the ${n.name.toLowerCase()}` : "";
}

function menu() {
  $("menu").hidden = phase === "play";
  const room = roomName();
  const desk = $("desk");
  if (desk instanceof HTMLAnchorElement) desk.href = room ? `/sesh/${room}` : "/";
}
async function play() { phase = "play"; menu(); lock(); await startAudio(); }

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

// ---- every frame ----
let last = performance.now(), myWalk = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const gp = pad.poll();
  const on = (c: string) => (keys.has(c) && !jam.me.spot ? 1 : 0);
  if (phase === "play") {
    const k = 2.4 * dt;
    jam.me.pitch = clamp(jam.me.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.0);
    if (gp.pressed.has("sit")) sitOrStand();
    if (gp.pressed.has("view")) toggleView(jam);
  }
  const before = [jam.me.x, jam.me.z];
  step(jam, dt, phase === "play" ? { forward: on("KeyW") - on("KeyS") || -gp.left.y, right: on("KeyD") - on("KeyA") || gp.left.x, turn: -gp.right.x * 2.4 * dt * ctl.lookX } : { forward: 0, right: 0, turn: 0 });
  myWalk = clamp(myWalk + (Math.hypot(jam.me.x - before[0], jam.me.z - before[1]) > 0.002 ? dt * 6 : -dt * 4), 0, 1);
  flush();
  place(mine, jam.me.x, jam.me.z, jam.me.yaw, jam.me.spot, myWalk, myPlaying > jam.now || jam.held.size > 0);
  mine.root.visible = jam.view === "third";
  syncOthers(dt);
  const near = jam.me.spot ? undefined : nearSpot(jam);
  ring.visible = !!near;
  if (near) ring.position.set(near.at[0], 0.01, near.at[1]);
  const c = cameraPose(jam);
  camera.position.set(...c.at);
  camera.rotation.set(c.pitch, c.yaw, 0);
  $("hint").textContent = now < flash.until ? flash.text : hint();
  const who = jam.others.size ? `${jam.others.size} other${jam.others.size > 1 ? "s" : ""} in the room` : "nobody else here yet";
  $("heard").textContent = `${status.state === "online" ? `In the sesh, ${who}` : status.state === "connecting" ? "Finding the sesh" : "Offline: you jam alone"}. ${jam.view === "first" ? "First person" : "Over the shoulder"} (V).`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

declare global { interface Window { qjam: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): the room as data, and a player's moves without pointer lock. */
const harness = {
  state: () => ({ phase, net: status.state, peers: status.peers, sound: !!audio, ...snapshot(jam) }),
  /** Into the room, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** Walk to (x, z); the seconds it took. The door is at z = 3, the control-room glass at z = -1.6. */
  walkTo: (x: number, z: number) => walkTo(jam, x, z),
  /** Look to `yaw` degrees (0 faces the control room) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { jam.me.yaw = (yaw * Math.PI) / 180; jam.me.pitch = (pitch * Math.PI) / 180; },
  /** Sit at the nearest free spot, or the one named (if you're close enough); stand up again. */
  sit: (id?: string) => sit(jam, id),
  stand: () => stand(jam),
  view: () => { toggleView(jam); return jam.view; },
  /** A key down and up at your spot, as the keyboard sends it (KeyA, KeyW, ...). */
  press: (code: string) => { down(code); return [...jam.held.values()].at(-1) ?? null; },
  release: (code: string) => up(code),
};
window.qjam = harness;

mountControls({
  key: CONTROLS, pad, parent: $("controls-host"), title: "Controls", skin: "house",
  keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["Space", "Sit at a spot, stand up"], ["Keys (A to ' ) / MIDI", "Play, when you sit"], ["Z / X", "Octave down / up"], ["V", "First person or over the shoulder"], ["Esc", "Let go of the mouse"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); },
});
$("play").addEventListener("click", () => void play());
menu();
resize();
requestAnimationFrame(frame);
