// The cable feel test (feel.html): one room, a sound board, an amp rack, a wedge and a mic on a riser, wall power, and
// four rolls of cable at their real weight. Pick a roll up, plug its end, bowl it, carry the rest, plug it in. It is
// the place to tune how cable feels before the game takes it (#5029). `window.feel` plays it without a mouse. The gear
// is @rustybuns/models' (jacks where the models put them), and the hands are the game's (src/hands).
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { GEAR_SIZES, gear, gearJacks, type GearId } from "@rustybuns/models/gear";
import { bundleR, coilGeometry, strapOn } from "../cables/draw.ts";
import { REST } from "../hands/grip.ts";
import { handsView, type Hold } from "../hands/view.ts";
import { mountInk } from "../you/ink-view.ts";
import { shoesView } from "../you/shoes.ts";
import { FLASH } from "../you/ink.ts";
import { CABLE, ROLL_R, bowl, leftM, newRoll, rollKg, stepRoll, throwSpeed, type CableKind, type Roll } from "../cables/roll.ts";
import type { Solid, Vec } from "../cables/rope.ts";

const DT = 1 / 60, EYE = 1.65, REACH = 1.5, WALK = 3.2;
const $ = (id: string) => document.getElementById(id)!;
const canvas = $("stage") as HTMLCanvasElement;

// ---- the room -------------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141c);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x3a3128, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
sun.position.set(4, 9, 6);
scene.add(sun);
for (const x of [-2.5, 2.5]) { const l = new THREE.PointLight(0xffc98a, 30, 12); l.position.set(x, 3.4, -5); scene.add(l); }

const solids: Solid[] = [];
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, solid = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(x, y + h / 2, z);
  scene.add(m);
  if (solid) solids.push({ x, z, y, rot: 0, w, h, d });
  return m;
}
function label(text: string, x: number, y: number, z: number) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 34px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(12,16,24,.78)"; g.roundRect(4, 6, 248, 52, 14); g.fill();
  g.fillStyle = "#f2ede4"; g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1, 0.25, 1); s.position.set(x, y, z);
  scene.add(s);
}

const RISER = { x: 0, z: -6, w: 8, d: 4, h: 0.4 };
box(16, 0.1, 17, 0x8d8a84, 0, -0.1, -0.5, false);                     // concrete floor
box(RISER.w, RISER.h, RISER.d, 0x4a3a2c, RISER.x, 0, RISER.z);        // the stage riser
box(16, 4, 0.2, 0x2a2f3a, 0, 0, -9.1, false); box(0.2, 4, 17, 0x252a34, 8.1, 0, -0.5, false); box(0.2, 4, 17, 0x252a34, -8.1, 0, -0.5, false);
box(1.6, 0.78, 0.8, 0x3b3f47, 0, 0, 3.2);                             // the desk's table
/** A model of real gear set down at (x, y, z) turned `rot`; solid unless it is thin (a stand). */
function model(id: GearId, x: number, y: number, z: number, rot: number, solid = true) {
  const g = gear(id);
  g.position.set(x, y, z); g.rotation.y = rot;
  scene.add(g);
  g.updateMatrixWorld(true);
  const [w, h, d] = GEAR_SIZES[id];
  if (solid) solids.push({ x, z, y, rot, w, h, d });
  return g;
}
/** Where a model's jack is in the room: a touch out from its panel, as the game's cables.ts reads it. */
function jackOf(g: THREE.Object3D, name: string): Vec {
  const o = gearJacks(g).get(name);
  if (!o) throw new Error(`no ${name} on ${g.name}`);
  const p = o.getWorldPosition(new THREE.Vector3()), out = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return { x: p.x + out.x * 0.03, y: p.y + out.y * 0.03, z: p.z + out.z * 0.03 };
}
// The board faces you at the desk, its jacks to the stage; the rack and the wedge turn their jack panels to the room.
const board = model("mixer-small", 0, 0.78, 3.2, 0, false);
const rack = model("amp-rack-4u", 5.2, 0, -3.0, Math.PI);
const wedge = model("wedge-12", -1.2, RISER.h, -5.0, Math.PI);
model("mic-stand", 0.8, RISER.h, -5.2, 0, false);
box(0.05, 0.05, 0.18, 0x2b2d31, 0.8, RISER.h + 1.45, -5.2, false);    // the mic
box(0.25, 0.5, 0.4, 0xb5482f, 7.85, 0.3, 2, false);                   // the wall distro
box(1.3, 0.5, 0.6, 0x23262c, -3.4, 0, 6.4);                           // the cable case
label("SOUND BOARD", 0, 1.35, 3.2); label("AMP RACK", 5.2, 0.9, -3.0); label("WEDGE", -1.2, 1.15, -5.0);
label("MIC", 0.8, 2.2, -5.2); label("POWER", 7.6, 1.2, 2); label("CABLES", -3.4, 0.9, 6.4);

type Jack = { id: string; kind: CableKind; at: Vec; mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> };
const JACK_COLOR: Record<CableKind, number> = { power: 0xff8a3c, cord: 0xff8a3c, xlr: 0x6fd3ff, instrument: 0x6fd3ff, speaker: 0x8fe38a };
function jack(id: string, kind: CableKind, at: Vec): Jack {
  const { x, y, z } = at;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: JACK_COLOR[kind], emissive: JACK_COLOR[kind], emissiveIntensity: 0.5 }));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return { id, kind, at: { x, y, z }, mesh };
}
const jacks = [
  jack("power.out", "power", { x: 7.7, y: 0.55, z: 2 }), jack("rack.power", "power", jackOf(rack, "power-in")),
  jack("desk.out", "xlr", jackOf(board, "xlr-out-1")), jack("rack.in", "xlr", jackOf(rack, "xlr-in-1")),
  // The wedge here is passive, fed from the rack: its speaker input sits where the powered model has its signal in.
  jack("rack.out", "speaker", jackOf(rack, "speaker-out-1")), jack("wedge.in", "speaker", jackOf(wedge, "xlr-in")),
  jack("mic.out", "xlr", { x: 0.8, y: RISER.h + 1.45, z: -5.08 }), jack("desk.in", "xlr", jackOf(board, "xlr-in-1")),
];
/** What has to be joined, in the order a sound crew does it: power first, then signal toward the speaker. */
const LINKS: { a: string; b: string; text: string }[] = [
  { a: "power.out", b: "rack.power", text: "Power: wall to amp rack" },
  { a: "mic.out", b: "desk.in", text: "Mic to sound board" },
  { a: "desk.out", b: "rack.in", text: "Sound board to amp" },
  { a: "rack.out", b: "wedge.in", text: "Amp to wedge on stage" },
];

// ---- the cables -----------------------------------------------------------------------------------------------
type End = "coil" | "hand" | "loose" | Jack;
type Run = { key: string; roll: Roll; a: End; b: End; tube: THREE.Mesh; coil: THREE.Mesh; plugA: THREE.Mesh; plugB: THREE.Mesh; sum: number; mat: THREE.MeshStandardMaterial };
const CABLE_COLOR: Record<CableKind, number> = { power: 0x26262a, cord: 0x161616, speaker: 0x1d2f6e, xlr: 0x7a1f24, instrument: 0x7a1f24 };
const rnd = mulberry32(11);
function run(key: string, kind: CableKind, lengthM: number, x: number, z: number): Run {
  const mat = new THREE.MeshStandardMaterial({ color: CABLE_COLOR[kind], roughness: 0.55, emissive: 0x2bd96b, emissiveIntensity: 0 });
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(ROLL_R - 0.03, 0.035, 10, 28), mat);
  coil.rotation.order = "YXZ";
  const plug = () => new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.7, roughness: 0.35 }));
  const plugA = plug(), plugB = plug();
  scene.add(tube, coil, plugA, plugB);
  return { key, roll: newRoll(kind, lengthM, { x, z }), a: "coil", b: "coil", tube, coil, plugA, plugB, sum: NaN, mat };
}
let runs: Run[] = [];
function layOut() {
  for (const r of runs) scene.remove(r.tube, r.coil, r.plugA, r.plugB);
  runs = [run("feeder", "power", 15, -4.4, 5.3), run("mic-cable", "xlr", 20, -3.7, 5.3), run("desk-cable", "xlr", 20, -3.0, 5.3), run("speaker-cable", "speaker", 15, -2.3, 5.3)];
}

// ---- you ------------------------------------------------------------------------------------------------------
const you = { x: -3.2, z: 3.6, yaw: 0.2, pitch: -0.35 };
let hold: { run: Run; part: "roll" | "a" | "b" } | null = null;
let charge = 0, charging = false, live = false, phantom = false, done = false;
const keys = new Set<string>(), stick = { x: 0, z: 0 };

const floorY = (x: number, z: number) => (Math.abs(x - RISER.x) < RISER.w / 2 && Math.abs(z - RISER.z) < RISER.d / 2 ? RISER.h : 0);
const fwd = () => ({ x: -Math.sin(you.yaw), z: -Math.cos(you.yaw) });
function hand(): Vec {
  const f = fwd();
  return { x: you.x + f.x * 0.45 - f.z * 0.2, y: floorY(you.x, you.z) + EYE - 0.6, z: you.z + f.z * 0.45 + f.x * 0.2 };
}
const dist = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
const flat = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
const taken = (j: Jack) => runs.some((r) => r.a === j || r.b === j);
function jackNear(kind: CableKind): Jack | null {
  const h = hand();
  return jacks.filter((j) => j.kind === kind && !taken(j) && dist(h, j.at) < REACH).sort((p, q) => dist(h, p.at) - dist(h, q.at))[0] ?? null;
}
const carryKg = () => (hold?.part === "roll" ? rollKg(hold.run.roll) : 0);
const pullKg = () => hold?.run.roll.pullKg ?? 0;

// ---- sound: a thump as heavy as what landed, a click for a plug ------------------------------------------------
let audio: AudioContext | null = null;
function tone(hz: number, to: number, gain: number, s: number, type: OscillatorType = "sine", at = 0) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(hz, t); o.frequency.exponentialRampToValueAtTime(to, t + s);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + s);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + s);
}
const thump = (kg: number) => tone(120 - Math.min(60, kg * 3), 38, Math.min(0.9, 0.15 + kg / 22), 0.18 + kg / 60);
const click = () => tone(1900, 900, 0.2, 0.04, "square");

// ---- what F does ----------------------------------------------------------------------------------------------
let said = "";
const say = (t: string) => { said = t; };
const endPt = (r: Run, part: "a" | "b") => (part === "a" ? r.roll.rope.pts[0]! : r.roll.rope.pts.at(-1)!);

function use() {
  const h = hand();
  if (hold) {
    const r = hold.run, roll = r.roll, j = jackNear(roll.kind);
    if (hold.part === "roll") {
      if (j && roll.tailIn) { roll.tailIn = false; r.a = j; Object.assign(roll.rope.pts[0]!, j.at); click(); say(`End plugged into ${j.id}. Now bowl the roll: hold the mouse or Space, let go`); }
      else if (j) { r.b = j; roll.state = "tied"; { const d = Math.hypot(you.x - j.at.x, you.z - j.at.z) || 1; roll.x = j.at.x + ((you.x - j.at.x) / d) * 0.3; roll.z = j.at.z + ((you.z - j.at.z) / d) * 0.3; } roll.y = floorY(roll.x, roll.z) + CABLE[roll.kind].radius; hold = null; click(); thump(rollKg(roll) / 2); say(`Plugged into ${j.id}. The spare stays coiled under it`); }
      else { roll.state = "down"; roll.x = h.x; roll.z = h.z; roll.y = floorY(h.x, h.z) + CABLE[roll.kind].radius; hold = null; thump(rollKg(roll)); }
    } else {
      r[hold.part] = j ?? "loose";
      if (j) { click(); say(`Plugged into ${j.id}`); }
      hold = null;
    }
    return;
  }
  const aim = { x: you.x + fwd().x, z: you.z + fwd().z }, picks: { d: number; go: () => void }[] = [];
  for (const r of runs) {
    const roll = r.roll;
    if (roll.state === "down" && flat(you, roll) < 1.9) picks.push({ d: flat(aim, roll), go: () => { roll.state = "held"; hold = { run: r, part: "roll" }; } });
    for (const part of ["a", "b"] as const) {
      const e = r[part], p = endPt(r, part);
      if (e === "loose" && flat(you, p) < 1.9) picks.push({ d: flat(aim, p), go: () => { r[part] = "hand"; hold = { run: r, part }; } });
      if (typeof e === "object" && dist(h, e.at) < REACH) picks.push({ d: flat(aim, e.at) + 0.5, go: () => {
        r[part] = "hand"; hold = { run: r, part };
        if (part === "b" && roll.state === "tied") { roll.state = "out"; roll.paid = roll.rope.pts.length - 1; }
        click();
      } });
    }
  }
  picks.sort((p, q) => p.d - q.d)[0]?.go();
}

function release(power: number) {
  if (hold?.part !== "roll") return;
  const r = hold.run, kg = rollKg(r.roll), loose = r.roll.tailIn;
  r.roll.y = floorY(you.x, you.z) + ROLL_R;
  Object.assign(r.roll, { x: hand().x, z: hand().z });
  bowl(r.roll, you.yaw + Math.PI, Math.max(0.15, power));
  // An end that was not plugged in stays in your hand: hold the end, send the coil.
  if (loose) { r.a = "hand"; hold = { run: r, part: "a" }; } else hold = null;
  say(`${kg.toFixed(1)} kg left your hand at ${throwSpeed(kg, Math.max(0.15, power)).toFixed(1)} m/s`);
}

// ---- one tick -------------------------------------------------------------------------------------------------
function tick() {
  let mx = stick.x + (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0), mz = stick.z + (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (charging && hold?.part === "roll") charge = Math.min(1, charge + DT / (0.45 + carryKg() / 22)); else charge = 0;
  const speed = WALK / (1 + carryKg() / 18) / (1 + pullKg() / 6) * (charging ? 0.4 : 1), f = fwd();
  let nx = you.x + (f.x * mz - f.z * mx) * speed * DT, nz = you.z + (f.z * mz + f.x * mx) * speed * DT;
  // Tall gear stops you, one axis at a time, so you slide along it.
  const blocked = (x: number, z: number) => solids.some((s) => s.h > 0.45 && Math.abs(x - s.x) < s.w / 2 + 0.3 && Math.abs(z - s.z) < s.d / 2 + 0.3);
  if (blocked(nx, you.z)) nx = you.x;
  if (blocked(nx, nz)) nz = you.z;
  you.x = Math.max(-7.6, Math.min(7.6, nx)); you.z = Math.max(-8.6, Math.min(7.6, nz));
  const h = hand();
  for (const r of runs) {
    const roll = r.roll, pin = (e: End) => (e === "hand" ? h : typeof e === "object" ? e.at : undefined);
    if (roll.state === "held") Object.assign(roll, h);
    if (roll.state === "rolling") roll.y = floorY(roll.x, roll.z) + ROLL_R;
    const mine = hold?.run === r ? (hold.part === "a" ? "a" : "b") : undefined;
    for (const e of stepRoll(roll, DT, { a: pin(r.a), b: pin(r.b) }, solids, rnd, mine)) {
      if (e === "out") {
        if (hold?.run === r && hold.part === "roll") { hold = { run: r, part: "b" }; r.b = "hand"; say("That is all of it: the end is in your hand"); }
        else if (r.b === "coil") r.b = "loose";
      } else thump(rollKg(roll));
    }
    // A cable only reaches as far as it is long: at its end it stops you.
    if (hold?.run === r && hold.part !== "roll") {
      const p = hold.part === "a" ? roll.rope.pts[1]! : roll.rope.pts.at(-2)!, d = dist(h, p), slack = (roll.rope.lengthM / (roll.rope.pts.length - 1)) * 1.6;
      if (d > slack) { you.x -= ((h.x - p.x) / d) * (d - slack); you.z -= ((h.z - p.z) / d) * (d - slack); }
    }
  }
  const was = done;
  done = phantom && links().every((l) => l.ok);
  if (done && !was) { [392, 494, 587].forEach((hz, i) => tone(hz, hz, 0.25, 0.5, "triangle", i * 0.16)); say("Check, one, two. The wedge is live."); }
}

const joined = (a: string, b: string) => runs.some((r) => typeof r.a === "object" && typeof r.b === "object" && ((r.a.id === a && r.b.id === b) || (r.a.id === b && r.b.id === a)));
const links = () => LINKS.map((l) => ({ text: l.text, ok: joined(l.a, l.b) }));

// ---- drawing --------------------------------------------------------------------------------------------------
scene.add(camera);
const hands = handsView(scene, camera);
// The feel room shows a finished tour's arms: every rung's tattoo, and your own if you pick one.
// Hold Y to look at your arms (I is taken: the arena levels check a point with it).
let showArms = false;
window.addEventListener("keydown", (e) => { if (e.code === "KeyY") showArms = true; });
window.addEventListener("keyup", (e) => { if (e.code === "KeyY") showArms = false; });
const shoes = shoesView(scene);
const ink = mountInk($("ink-host"), hands, () => Object.keys(FLASH).map((level) => ({ level, pass: 1 as const })), shoes);
/** What the hands hold: a roll hooked on the right hand's fingers (the left on its end once that is out), a plug
 * ready at a lit jack, a fist round a cable you walk, or nothing. The wrist drops with what the cable weighs on it. */
function holding(): Hold {
  const r = hold?.run, roll = r?.roll, kg = carryKg() + pullKg();
  if (!roll) return { right: REST, left: REST, kg: 0 };
  if (hold?.part === "roll") return { right: { kind: "roll" }, left: roll.tailIn ? REST : { kind: "cable", radius: CABLE[roll.kind].radius }, kg };
  const h = hand();
  return { right: jackNear(roll.kind) ? { kind: "plug" } : { kind: "cable", radius: CABLE[roll.kind].radius }, left: REST, kg, lead: { at: [h.x, h.y, h.z], color: CABLE_COLOR[roll.kind] } };
}
let seen = { x: you.x, z: you.z, t: 0, v: 0 };
function draw() {
  const y = floorY(you.x, you.z) + EYE - carryKg() * 0.004 - charge * 0.12;
  camera.position.set(you.x, y, you.z);
  camera.rotation.set(you.pitch, you.yaw, 0);
  const now = performance.now() / 1000, dt = now - seen.t;
  if (dt > 0) seen = { x: you.x, z: you.z, t: now, v: dt > 0.5 ? 0 : seen.v * 0.8 + (Math.hypot(you.x - seen.x, you.z - seen.z) / dt) * 0.2 };
  hands.update({ ...holding(), show: showArms }, now, seen.v);
  shoes.update(you.x, floorY(you.x, you.z), you.z, you.yaw, seen.v, Math.max(0, Math.min(0.05, dt)));
  const grip = hold?.part === "roll" ? hands.gripAt() : null;
  const held = hold?.run.roll.kind;
  for (const j of jacks) { const fits = held === j.kind && !taken(j); j.mesh.material.emissiveIntensity = fits ? 2.2 : taken(j) ? 0.1 : 0.5; j.mesh.scale.setScalar(fits ? 1.5 : 1); }
  for (const r of runs) {
    const roll = r.roll, pts = roll.rope.pts, c = CABLE[roll.kind];
    const keep: THREE.Vector3[] = [];
    let sum = 0;
    const inHand = grip && hold?.run === r, mouth = pts.at(-1)!, bottom = inHand ? { x: grip.x, y: grip.y - 2 * (ROLL_R - 0.03), z: grip.z } : null;
    for (const p0 of pts) {
      const p = bottom && roll.state !== "out" && Math.hypot(p0.x - mouth.x, p0.y - mouth.y, p0.z - mouth.z) < 1e-3 ? bottom : p0, last = keep.at(-1);
      if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.03) { keep.push(new THREE.Vector3(p.x, p.y, p.z)); sum += p.x * 3 + p.y * 5 + p.z * 7; }
    }
    r.tube.visible = keep.length > 1;
    if (keep.length > 1 && sum !== r.sum) {
      r.sum = sum;
      r.tube.geometry.dispose();
      r.tube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(keep), keep.length * 2, c.radius, 6, false);
    }
    const left = leftM(roll), up = roll.state === "rolling" || roll.state === "held";
    r.coil.visible = left > 0.3;
    // In your hand the coil hangs off the fingers, swung out to the side; rolling, it leans off its edge as it slows.
    if (inHand) r.coil.position.set(grip.x, grip.y - (ROLL_R - 0.03), grip.z);
    else r.coil.position.set(roll.x, roll.state === "held" ? roll.y - 0.1 : roll.y, roll.z);
    const lean = roll.state === "rolling" ? (Math.sign(roll.lean) || 1) * Math.min(0.6, 0.18 + 0.35 / (1 + roll.v) + Math.abs(roll.lean)) : 0;
    r.coil.rotation.set(up ? lean : Math.PI / 2, up ? (roll.state === "held" ? you.yaw + 0.6 : roll.dir + Math.PI / 2) : 0, up && roll.state !== "held" ? -roll.spin : 0);
    // As thick as the cable left on it makes the bundle; a new torus every few metres paid out.
    const tube = bundleR(left, c.radius);
    if (Math.abs(tube - (r.coil.userData.tube ?? 0)) > tube * 0.08) {
      r.coil.geometry.dispose();
      r.coil.geometry = coilGeometry(tube, c.radius);
      strapOn(r.coil, tube);
      r.coil.userData.tube = tube;
    }
    r.plugA.position.copy(pts[0]!); r.plugB.position.copy(pts.at(-1)!);
    r.plugA.visible = !roll.tailIn; r.plugB.visible = roll.state === "out" || roll.state === "tied";
    r.mat.emissiveIntensity = done ? 0.25 + 0.2 * Math.sin(performance.now() / 180) : 0;
  }
  renderer.render(scene, camera);
  hud();
}

let listWas = "";
function hud() {
  const list = links().map((l) => `<li class="${l.ok ? "ok" : ""}">${l.text}</li>`).join("") + `<li class="${phantom ? "ok" : ""}">48 V phantom on at the board (P)</li>`;
  if (list !== listWas) $("list").innerHTML = listWas = list;
  const r = hold?.run, roll = r?.roll;
  let hint = "";
  if (roll && hold?.part === "roll") {
    const j = jackNear(roll.kind);
    hint = j ? `F plug ${roll.tailIn ? "the end" : "it"} into ${j.id}` : roll.tailIn ? "Carry it to a lit jack: F plugs the end in" : "Hold to wind up, let go to bowl. F puts it down";
  } else if (roll) hint = jackNear(roll.kind) ? `F plug into ${jackNear(roll.kind)!.id}` : "Walk the end to a lit jack. F lets go";
  else hint = runs.some((q) => q.roll.state === "down" && flat(you, q.roll) < 1.9) ? "F pick up the roll" : flat(you, { x: 0, z: 3.2 }) < 2 ? "P switches 48 V phantom" : "";
  $("hint").textContent = hint;
  $("said").textContent = said;
  $("weight").textContent = roll ? `${CABLE[roll.kind].what}${hold?.part === "roll" ? ` roll ${rollKg(roll).toFixed(1)} kg, ${leftM(roll).toFixed(0)} m left` : " end"}${pullKg() > 0.3 ? `  ·  pull ${pullKg().toFixed(1)} kg` : ""}` : "Hands free";
  ($("power") as HTMLElement).style.setProperty("--p", String(charge));
  $("power").hidden = charge === 0;
  $("done").hidden = !done;
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 85 : 70;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

let lastT = 0, acc = 0;
function frame(t: number) {
  acc = Math.min(0.1, acc + (t - lastT) / 1000); lastT = t;
  while (acc >= DT) { if (live) tick(); acc -= DT; }
  draw();
  requestAnimationFrame(frame);
}

// ---- input ----------------------------------------------------------------------------------------------------
function start() {
  if (!audio) try { audio = new AudioContext(); } catch { audio = null; }
  live = true; $("menu").hidden = true;
}
function reset() { layOut(); hold = null; phantom = false; done = false; Object.assign(you, { x: -3.2, z: 3.6, yaw: 0.2, pitch: -0.35 }); say(""); }
const togglePhantom = () => { if (flat(you, { x: 0, z: 3.2 }) < 2) { phantom = !phantom; click(); say(`48 V phantom ${phantom ? "on: the condenser mic has power" : "off"}`); } };

window.addEventListener("keydown", (e) => {
  if (e.repeat || !live) return;
  keys.add(e.code);
  if (e.code === "KeyF") use();
  if (e.code === "KeyP") togglePhantom();
  if (e.code === "KeyR") reset();
  if (e.code === "Space") { charging = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); if (e.code === "Space" && charging) { charging = false; release(charge); } });
const look = (dx: number, dy: number, k: number) => { you.yaw -= dx * k; you.pitch = Math.max(-1.4, Math.min(1.2, you.pitch - dy * k)); };
let walkId = -1, lookId = -1, walk0 = { x: 0, y: 0 };
canvas.addEventListener("pointerdown", (e) => {
  if (!live) return;
  if (e.pointerType === "touch") {
    if (e.clientX < innerWidth / 2 && walkId < 0) { walkId = e.pointerId; walk0 = { x: e.clientX, y: e.clientY }; } else lookId = e.pointerId;
    return;
  }
  canvas.requestPointerLock?.()?.catch?.(() => {});
  if (hold?.part === "roll") charging = true;
});
window.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") {
    if (e.pointerId === walkId) { stick.x = Math.max(-1, Math.min(1, (e.clientX - walk0.x) / 50)); stick.z = Math.max(-1, Math.min(1, (walk0.y - e.clientY) / 50)); }
    else if (e.pointerId === lookId) look(e.movementX, e.movementY, 0.006);
  } else if (document.pointerLockElement === canvas || e.buttons) look(e.movementX, e.movementY, 0.0025);
});
window.addEventListener("pointerup", (e) => {
  if (e.pointerId === walkId) { walkId = -1; stick.x = stick.z = 0; }
  if (e.pointerId === lookId) lookId = -1;
  if (e.pointerType !== "touch" && charging) { charging = false; release(charge); }
});
$("play").addEventListener("click", start);
$("t-use").addEventListener("click", () => { if (live) use(); });
$("t-48").addEventListener("click", () => { if (live) togglePhantom(); });
$("t-reset").addEventListener("click", reset);
// Arms: held, like the Y key.
$("t-arms").addEventListener("pointerdown", (e) => { e.stopPropagation(); showArms = true; });
for (const up of ["pointerup", "pointercancel", "pointerleave"]) $("t-arms").addEventListener(up, () => { showArms = false; });
$("t-bowl").addEventListener("pointerdown", (e) => { e.stopPropagation(); if (live && hold?.part === "roll") charging = true; });
$("t-bowl").addEventListener("pointerup", (e) => { e.stopPropagation(); if (charging) { charging = false; release(charge); } });

// ---- the harness: play it without a mouse ------------------------------------------------------------------------
const run_ = (s: number) => { for (let i = 0; i < s * 60; i++) tick(); };
const feel = {
  state: () => ({
    live, done, phantom, you: { ...you }, holding: hold ? { cable: hold.run.key, part: hold.part, kg: carryKg(), pullKg: pullKg() } : null, said,
    links: links(),
    cables: runs.map((r) => ({ key: r.key, kind: r.roll.kind, state: r.roll.state, leftM: leftM(r.roll), kg: rollKg(r.roll), x: r.roll.x, z: r.roll.z, a: typeof r.a === "object" ? r.a.id : r.a, b: typeof r.b === "object" ? r.b.id : r.b })),
  }),
  start, reset, use,
  /** Raise your forearms into view (or lower them): what holding I does. */
  arms: (show: boolean) => { showArms = show; }, run: run_,
  look: (yaw: number, pitch = -0.3) => { you.yaw = yaw; you.pitch = pitch; },
  /** Walk to (x, z) at the pace your load allows, facing the way you go; the seconds it took. */
  walkTo(x: number, z: number) {
    let t = 0;
    while (flat(you, { x, z }) > 0.08 && t < 60) { you.yaw = Math.atan2(-(x - you.x), -(z - you.z)); stick.z = 1; tick(); t += DT; }
    stick.z = 0;
    return t;
  },
  /** Wind up to `power` (0 to 1) and let go, then wait for the roll to stop. */
  bowl(power: number) { charge = power; release(power); run_(8); },
  phantom: togglePhantom,
};
Object.assign(window, { feel });

layOut();
resize();
requestAnimationFrame(frame);
