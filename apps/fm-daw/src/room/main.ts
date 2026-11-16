// Q Studio, the live room (/studio.html): you stand in it in first person, the same controls as Load In (mouse or
// right stick to look, WASD or left stick to walk). Click a box to pick it up and click again to set it down; click
// a jack to pull a cable out of it, walk the cable to another jack and click there; look at a knob and drag. The
// room's patch is the sesh's Studio (../studio.ts), kept in this browser for now. What you hear is the walk back
// from the cab (room.ts `listen`): that amp and its pedal run their circuits in Q Amp's audio thread, and nothing
// else does. `window.qstudio` is the harness (scripts/probe.ts HANDLES).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./studio.css";
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import workletUrl from "../amp/worklet.ts?worker&url";
import type { FromAmp, ToAmp } from "../amp/messages.ts";
import { riff } from "../circuit/riff.ts";
import { sanitizePatch } from "../studio.ts";
import { type Aim, type Answer, EYE, HALF_D, HALF_W, type Heard, type Room, WALL_H, aimed, drop, gearOf, hand, handAt, heldId, jackAt, knobValue, lead, listen, lookAt, newRoom, pickUp, placedNow, plug, putDown, sag, setKnob, snapshot, startPatch, step, turnHeld, unplug, use, walkTo } from "./room.ts";
import { type GearModel, gearModel, rackModel, turnKnob } from "./models.ts";

const KEY = "q-studio", CONTROLS = "q-studio.controls";
const $ = (id: string) => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };

function loadPatch() {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? sanitizePatch(JSON.parse(raw)) : null;
    if (p?.placed.length) return p;
  } catch { /* private window or bad JSON: the room as it starts */ }
  return startPatch();
}
let room: Room = newRoom(loadPatch());
let savedPatch = room.studio.patch;
const save = () => {
  if (room.studio.patch === savedPatch) return;
  savedPatch = room.studio.patch;
  try { localStorage.setItem(KEY, JSON.stringify(savedPatch)); } catch { /* not kept, fine */ }
};

let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
let flash = { text: "", until: 0 };
let dragging: { id: string; knob: string } | null = null;
const keys = new Set<string>();
const pad = loadPad(CONTROLS, [
  { id: "grab", label: "Pick up / put down / plug in", button: 0 },
  { id: "drop", label: "Let go of a cable", button: 1 },
  { id: "turnLeft", label: "Turn it left", button: 4 },
  { id: "turnRight", label: "Turn it right", button: 5 },
]);

// ---- the scene ----
const canvas = $("stage");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#stage is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171b);
const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 40);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xe6e2da, 0x2a2420, 0.9));
const lamp = new THREE.PointLight(0xffe6c4, 14, 10, 1.4);
lamp.position.set(0, WALL_H - 0.2, 0);
scene.add(lamp);
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2), new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  const wall = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.95, side: THREE.BackSide });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, WALL_H, HALF_D * 2), wall);
  walls.position.y = WALL_H / 2 - 0.02; // its floor face just under the floor, so they never fight
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), new THREE.MeshStandardMaterial({ color: 0x5a2a2e, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.2, 0.003, 0.2);
  scene.add(floor, walls, rug, rackModel());
}

const models = new Map<string, GearModel>();
function syncModels() {
  const ids = new Set(room.studio.patch.placed.map((p) => p.id));
  for (const [id, m] of models) if (!ids.has(id)) { scene.remove(m.group); models.delete(id); }
  for (const p of room.studio.patch.placed) {
    const g = gearOf(p);
    if (!g) continue;
    let m = models.get(p.id);
    if (!m) { m = gearModel(g); models.set(p.id, m); scene.add(m.group); }
    const now = placedNow(room, p);
    m.group.position.set(now.at[0], now.at[1], now.at[2]);
    m.group.rotation.y = now.turn;
    for (const k of g.knobs) { const km = m.knobs.get(k.name); if (km) turnKnob(km, knobValue(room.studio.patch, p.id, k)); }
  }
}

// Cables: a tube along the sagging curve, rebuilt only when an end moves.
const cableMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 });
const cables = new Map<string, { mesh: THREE.Mesh; ends: string }>();
function drawCable(key: string, a: number[] | null, b: number[] | null, seen: Set<string>) {
  if (!a || !b) return;
  seen.add(key);
  const ends = [...a, ...b].map((v) => v.toFixed(3)).join(",");
  const had = cables.get(key);
  if (had?.ends === ends) return;
  if (had) { scene.remove(had.mesh); had.mesh.geometry.dispose(); }
  const pts = sag([a[0], a[1], a[2]], [b[0], b[1], b[2]]).map((p) => new THREE.Vector3(...p));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0045, 6), cableMat);
  scene.add(mesh);
  cables.set(key, { mesh, ends });
}
function syncCables() {
  const seen = new Set<string>();
  for (const c of room.studio.patch.cables) drawCable(c.from.join(":") + ">" + c.to.join(":"), jackAt(room, c.from), jackAt(room, c.to), seen);
  const h = hand(room);
  if (h && "lead" in h) drawCable("hand", jackAt(room, h.lead), handAt(room), seen);
  for (const [k, c] of cables) if (!seen.has(k)) { scene.remove(c.mesh); c.mesh.geometry.dispose(); cables.delete(k); }
}

let lit: THREE.Mesh | null = null;
function highlight(a: Aim | null) {
  if (lit) { const m = lit.material; if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity = 0; lit = null; }
  if (a?.t !== "jack") return;
  const ring = models.get(a.end[0])?.jacks.get(a.end[1]);
  if (ring && ring.material instanceof THREE.MeshStandardMaterial) { ring.material.emissiveIntensity = 1.4; lit = ring; }
}

// ---- sound: Q Amp's audio thread, fed only when the chain is whole ----
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let riffNode: AudioBufferSourceNode | null = null;
let panner: PannerNode | null = null;
let meter: FromAmp = { t: "meter", levels: [], out: 0, load: 0, misses: 0 };
let heardKey = "";
let speakersUp = false;

async function speakers(up: boolean) {
  speakersUp = up;
  $("speakers").textContent = up ? "Speakers up. M brings them down." : "Speakers are down. Click, or press M, to bring them up.";
  if (!up) { await ctx?.suspend(); return; }
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, "q-amp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
    node.port.onmessage = (e: MessageEvent<FromAmp>) => { meter = e.data; };
    panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, rolloffFactor: 0.8 });
    node.connect(panner).connect(new GainNode(ctx, { gain: 0.5 })).connect(ctx.destination);
    const data = riff(ctx.sampleRate), buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    riffNode = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    riffNode.start();
    heardKey = "";
  }
  await ctx.resume();
}

/** The worklet runs the rig only for a whole chain; otherwise the riff is unplugged and it passes silence through. */
function sound(h: Heard) {
  const key = JSON.stringify(h.settings);
  if (!node || !riffNode || key === heardKey) return;
  heardKey = key;
  try { riffNode.disconnect(); } catch { /* wasn't connected */ }
  if (h.settings) riffNode.connect(node);
  const m: ToAmp = { t: "set", settings: h.settings ?? { amp: "lead", pedal: null, drive: 0, knobs: { gain: 0, bass: 5, mid: 5, treble: 5, master: 0, noise: 0 }, bypass: true, oversample: 2 } };
  node.port.postMessage(m);
}

// ---- input ----
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
const say = (a: Answer) => { if (!a.ok) flash = { text: a.why, until: performance.now() + 1800 }; return a; };
canvas.addEventListener("mousedown", (e) => {
  if (phase !== "play") return;
  if (!locked()) return lock();
  if (e.button === 2) return void say(drop(room));
  const a = aimed(room);
  if (a?.t === "knob" && !hand(room)) dragging = { id: a.id, knob: a.knob };
  else say(use(room, a));
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mouseup", () => { dragging = null; });
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  if (dragging) {
    const p = room.studio.patch.placed.find((x) => x.id === dragging?.id), k = p && gearOf(p)?.knobs.find((x) => x.name === dragging?.knob);
    if (p && k) setKnob(room, p.id, k.name, knobValue(room.studio.patch, p.id, k) - e.movementY * 0.004);
    return;
  }
  const s = 0.0022;
  room.you.yaw -= e.movementX * s * ctl.lookX;
  room.you.pitch = clamp(room.you.pitch - e.movementY * s * ctl.lookY * (ctl.invertY ? -1 : 1), -1.35, 1.25);
});
document.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyM") void speakers(!speakersUp);
  if (phase !== "play") return;
  if (e.code === "KeyF") say(use(room));
  if (e.code === "KeyG") say(drop(room));
  if (e.code === "KeyQ") turnHeld(room, -1);
  if (e.code === "KeyE") turnHeld(room, 1);
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); dragging = null; });
document.addEventListener("pointerlockchange", () => { if (!locked() && phase === "play") { phase = "menu"; menu(); } });

function hint(a: Aim | null): string {
  const h = hand(room);
  const name = (id: string) => { const p = room.studio.patch.placed.find((x) => x.id === id); return (p && gearOf(p)?.name) ?? id; };
  if (h && "item" in h) return `Click to set ${name(h.item)} down, Q / E to turn it`;
  if (a?.t === "jack") return h ? `Plug into ${name(a.end[0])}'s ${a.end[1]}` : room.studio.patch.cables.some((c) => c.from.join() === a.end.join() || c.to.join() === a.end.join()) ? `Pull the cable out of ${name(a.end[0])}'s ${a.end[1]}` : `Take a cable from ${name(a.end[0])}'s ${a.end[1]}`;
  if (a?.t === "knob") { const p = room.studio.patch.placed.find((x) => x.id === a.id), k = p && gearOf(p)?.knobs.find((x) => x.name === a.knob); return k && p ? `${name(a.id)} ${k.label} ${(knobValue(room.studio.patch, p.id, k) * 10).toFixed(1)}: drag to turn` : ""; }
  if (a?.t === "item") return h ? "Plug the cable into a jack" : `Pick up ${name(a.id)}`;
  return h ? "Right-click or G lets go of the cable" : "";
}

function menu() { $("menu").hidden = phase === "play"; }
function play() { phase = "play"; menu(); lock(); }

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

// ---- every frame ----
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    room.you.pitch = clamp(room.you.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.35, 1.25);
    if (gp.pressed.has("grab")) say(use(room));
    if (gp.pressed.has("drop")) say(drop(room));
    if (gp.pressed.has("turnLeft")) turnHeld(room, -1);
    if (gp.pressed.has("turnRight")) turnHeld(room, 1);
    const on = (c: string) => (keys.has(c) ? 1 : 0);
    step(room, dt, { forward: on("KeyW") - on("KeyS") || -gp.left.y, right: on("KeyD") - on("KeyA") || gp.left.x, turn: -gp.right.x * k * ctl.lookX });
  }
  save();
  syncModels();
  syncCables();
  const a = aimed(room);
  highlight(a);
  const heard = listen(room.studio.patch);
  sound(heard);
  glow(heard);
  camera.position.set(room.you.x, EYE, room.you.z);
  camera.rotation.set(room.you.pitch, room.you.yaw, 0);
  if (ctx && panner) {
    const cab = heard.chain.length ? room.studio.patch.placed.find((p) => p.id === heard.chain[heard.chain.length - 1]) : undefined;
    if (cab) { panner.positionX.value = cab.at[0]; panner.positionY.value = cab.at[1] + 0.3; panner.positionZ.value = cab.at[2]; }
    const l = ctx.listener, f = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    l.positionX.value = room.you.x; l.positionY.value = EYE; l.positionZ.value = room.you.z;
    l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
  }
  $("hint").textContent = now < flash.until ? flash.text : hint(a);
  $("heard").textContent = heard.playing ? `Playing: ${heard.chain.map((id) => { const p = room.studio.patch.placed.find((x) => x.id === id); return (p && gearOf(p)?.name) ?? id; }).join(" > ")}${heard.problems.length ? `. ${heard.problems[0]}` : ""}` : `Silent: ${heard.problems[0] ?? ""}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/** The running amp's tubes glow with what each stage swings; the cab's cones push with the output. */
function glow(h: Heard) {
  const ampId = h.running[h.running.length - 1], offset = h.settings?.pedal ? 1 : 0;
  const stages = speakersUp ? meter.levels.length - offset - 1 : 0;
  for (const [id, m] of models) {
    m.tubes.forEach((t, i) => {
      const v = clamp(Math.log10(1 + (meter.levels[offset + i] ?? 0)) / 2, 0, 1);
      if (t.material instanceof THREE.MeshStandardMaterial) t.material.emissiveIntensity = id === ampId && i < stages ? 0.3 + v * 2.5 : 0;
    });
    const push = h.chain.includes(id) && speakersUp ? meter.out * 0.02 : 0;
    m.cones.forEach((c) => { c.scale.y = 1 + push * 20; });
  }
}

declare global { interface Window { qstudio: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): the room as data, and a player's moves without pointer lock. */
const harness = {
  state: () => ({ phase, speakers: speakersUp, ...snapshot(room), meter: { out: meter.out, load: meter.load } }),
  /** Into the room, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** Walk to (x, z); the seconds it took. The rack is the back wall (z = -3), the door end is z = 3. */
  walkTo: (x: number, z: number) => walkTo(room, x, z),
  /** Look to `yaw` degrees (0 is at the rack) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { room.you.yaw = (yaw * Math.PI) / 180; room.you.pitch = (pitch * Math.PI) / 180; },
  /** Look straight at a box, or one of its jacks or knobs by name. */
  lookAt: (id: string, part?: string) => lookAt(room, id, part),
  /** A click on what you look at (set down, plug, unplug, take a cable, pick up). */
  click: () => use(room),
  pickUp: (id: string) => pickUp(room, id),
  putDown: () => putDown(room),
  turn: (dir: number) => turnHeld(room, dir),
  /** A cable out of a free jack, its far end in your hand; plug(id, jack) puts it in; unplug(id, jack) pulls one out. */
  lead: (id: string, jack: string) => lead(room, [id, jack]),
  plug: (id: string, jack: string) => plug(room, [id, jack]),
  unplug: (id: string, jack: string) => unplug(room, [id, jack]),
  drop: () => drop(room),
  /** A knob to `v`, 0 to 10 as the panel reads. */
  knob: (id: string, knob: string, v: number) => setKnob(room, id, knob, v / 10),
  held: () => heldId(room),
  /** Bring the speakers up or down. Browsers start sound only after a click, so a probe reads state instead. */
  speakers: (up: boolean) => speakers(up),
  /** The room as it starts. */
  reset: () => { room = newRoom(startPatch()); },
};
window.qstudio = harness;

mountControls({
  key: CONTROLS, pad, parent: $("controls-host"), title: "Controls", skin: "house",
  keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["Click / F", "Pick up, set down, take or plug a cable"], ["Drag on a knob", "Turn it"], ["Q / E", "Turn what you hold"], ["Right-click / G", "Let go of a cable"], ["M", "Speakers up or down"], ["Esc", "Let go of the mouse"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); },
});
$("play").addEventListener("click", play);
$("speakers").addEventListener("click", () => void speakers(!speakersUp));
menu();
resize();
requestAnimationFrame(frame);
