// Speaker plans: a speaker box built from its build plan, the way Q Amp's pedals are built from their tscircuit boards.
// Pick a plan (packages/gear/src/plans.ts), and the cabinet stands in 3D from its cut list (cabinet in
// @rustybuns/models/speaker), the response is drawn from the box's physics (enclosure.ts), and Listen plays a bass
// loop through that box: in Rust (src/speakers/rust.ts) when this build has the wasm, else in TypeScript. Change
// what the walls are made of, or add braces, and both the curve and the knock (each wall rung on its own) change.
// window.qspeakers drives it (scripts/probe.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./speakers.css";
import * as THREE from "three";
import { BoxFilter, MATERIALS, PLANS, curveOf, cutList, design, encodePlan, logFreqs, lowCut, material, netVolume, type Design, type Plan } from "@rustybuns/gear";
import { cabinet, cabinetParts } from "@rustybuns/models/speaker";
import { h, iconButton } from "../amp/dom.ts";
import { icon } from "../amp/icons.ts";
import { fetchWasm } from "../ui/audio.ts";
import { instantiateFm, type Exports } from "../engine/wasm.ts";
import { RustBox, rustCurve } from "./rust.ts";

const FREQS = logFreqs(10, 2000, 240);
const LO = 10, HI = 2000, TOP = 10, BOTTOM = -30;

let current: Plan = PLANS[0];
let mat = current.material, braces = current.braces, explode = 0;
let rust: Exports | null = null, ctx: AudioContext | null = null, source: AudioBufferSourceNode | null = null;
let playing: "box" | "flat" | "knock" | null = null;

const plan = (): Plan => ({ ...current, material: mat, braces });
const now = (): Design => design(plan());

// --- layout ---
const app = h("main", "sp");
const tabs = h("nav", "sp-tabs");
const view = h("section", "sp-view");
const canvas = h("canvas", "sp-canvas");
const tools = h("div", "sp-tools");
const side = h("section", "sp-side");
const title = h("h1", "sp-title"), what = h("p", "sp-what"), from = h("p", "sp-from");
const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
chart.setAttribute("viewBox", "0 0 640 260");
chart.classList.add("sp-chart");
const facts = h("dl", "sp-facts"), walls = h("table", "sp-walls"), cuts = h("table", "sp-cuts");
const matSel = h("select", "sp-select");
for (const m of MATERIALS) matSel.append(new Option(m.name, m.id));
const braceOut = h("output", "sp-num");
const explodeIn = h("input", "sp-range");
Object.assign(explodeIn, { type: "range", min: "0", max: "1", step: "0.01", value: "0" });
explodeIn.setAttribute("aria-label", "Pull the pieces apart");
const engineChip = h("span", "sp-chip", "TypeScript");
const listenBtn = h("button", "sp-btn", icon("play"), "Listen");
const flatBtn = h("button", "sp-btn ghost", icon("waves"), "No box");
const knockBtn = h("button", "sp-btn ghost", icon("hand"), "Knock");
for (const b of [listenBtn, flatBtn, knockBtn]) b.type = "button";
listenBtn.title = "A bass loop through this box"; flatBtn.title = "The same loop with no box: what the box takes away"; knockBtn.title = "Knock on the walls: each one rings at its own mode";

const label = (text: string, ...kids: Node[]) => h("label", "sp-field", h("span", "", text), ...kids);
tools.append(
  label("Walls", matSel),
  label("Braces", iconButton("arrow-up-down", "One brace fewer", () => setBraces(braces - 1)), braceOut, iconButton("arrow-up", "One more brace", () => setBraces(braces + 1))),
  label("Apart", icon("box", 16), explodeIn),
);
const sound = h("div", "sp-sound", listenBtn, flatBtn, knockBtn, engineChip);
view.append(canvas, tools);
side.append(title, what, sound, chart, facts, h("h2", "", "Walls"), walls, h("h2", "", "Cut list"), cuts, from);
app.append(tabs, view, side);
document.body.append(app);

for (const p of PLANS) {
  const b = h("button", "sp-tab", p.name);
  b.type = "button";
  b.dataset.id = p.id;
  b.addEventListener("click", () => pick(p.id));
  tabs.append(b);
}

// --- 3D ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
scene.add(new THREE.HemisphereLight(0xf2efe8, 0x2a2622, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 3, 2.5);
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
let model: THREE.Group | null = null;
let yaw = 0.6, pitch = 0.25, dragging = false, lastX = 0, lastY = 0, idle = true;

function dispose(o: THREE.Object3D) {
  o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); });
}

function rebuild() {
  if (model) { scene.remove(model); dispose(model); }
  model = cabinet(plan(), { color: material(mat).color, explode });
  scene.add(model);
}

function frame() {
  const w = canvas.clientWidth, hh = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(hh * renderer.getPixelRatio())) {
    renderer.setSize(w, hh, false);
    camera.aspect = w / Math.max(1, hh);
    camera.updateProjectionMatrix();
  }
  if (idle && !dragging) yaw += 0.003;
  const [sw, sh, sd] = current.size, r = Math.max(sw, sh, sd) * (2.6 + explode * 1.2), y = sh / 2;
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * r, y + Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
  camera.lookAt(0, y, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
canvas.addEventListener("pointerdown", (e) => { dragging = true; idle = false; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.01; pitch = Math.max(-0.2, Math.min(1.3, pitch + (e.clientY - lastY) * 0.01));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener("pointerup", () => { dragging = false; });

// --- the numbers ---
const x = (f: number) => (Math.log(f / LO) / Math.log(HI / LO)) * 600 + 30;
const y = (db: number) => ((TOP - Math.max(BOTTOM, Math.min(TOP, db))) / (TOP - BOTTOM)) * 220 + 10;
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const pathOf = (c: Float64Array) => Array.from(c, (v, i) => `${i ? "L" : "M"}${x(FREQS[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");

function curveNow(d: Design): Float64Array {
  return rust ? rustCurve(rust, encodePlan(plan()), FREQS) : curveOf(d, FREQS);
}

function drawChart(d: Design) {
  chart.replaceChildren();
  for (const f of [20, 50, 100, 200, 500, 1000, 2000]) {
    chart.append(svg("line", { x1: x(f), x2: x(f), y1: 10, y2: 230, class: "grid" }));
    const t = svg("text", { x: x(f), y: 250, class: "tick", "text-anchor": "middle" });
    t.textContent = f >= 1000 ? `${f / 1000}k` : String(f);
    chart.append(t);
  }
  for (const db of [10, 0, -10, -20, -30]) {
    chart.append(svg("line", { x1: 30, x2: 630, y1: y(db), y2: y(db), class: db === 0 ? "grid zero" : "grid" }));
    const t = svg("text", { x: 26, y: y(db) + 4, class: "tick", "text-anchor": "end" });
    t.textContent = String(db);
    chart.append(t);
  }
  for (const w of d.walls) chart.append(svg("line", { x1: x(w.hz), x2: x(w.hz), y1: 10, y2: 230, class: "mode" }));
  chart.append(svg("path", { d: pathOf(curveOf({ ...d, walls: [] }, FREQS)), class: "cone" }));
  chart.append(svg("path", { d: pathOf(curveNow(d)), class: "box" }));
}

const fmt = (v: number, digits = 0) => v.toFixed(digits);
function draw() {
  const p = plan(), d = now(), a = p.alignment;
  for (const b of tabs.querySelectorAll<HTMLButtonElement>(".sp-tab")) b.classList.toggle("on", b.dataset.id === current.id);
  title.textContent = current.name;
  what.textContent = current.what;
  from.textContent = `From: ${current.from}.`;
  matSel.value = mat;
  braceOut.textContent = String(braces);
  drawChart(d);
  const rows: [string, string][] = [
    ["Air inside", `${fmt(netVolume(p) * 1000, 1)} L`],
    [a.kind === "sealed" ? "Resonance fc" : a.kind === "vented" ? "Port tuning fb" : "Pipe tuning", `${fmt(d.tune, 1)} Hz`],
    [a.kind === "sealed" ? "Qtc" : "Driver Qts", fmt(d.q, 2)],
    ["Down 3 dB", `${fmt(lowCut(d))} Hz`],
    ["Down 6 dB", `${fmt(lowCut(d, -6))} Hz`],
  ];
  if (a.kind === "vented") rows.push(["Port air at Xmax", `${fmt(d.portSpeed, 1)} m/s${d.portSpeed > 17 ? " (chuffs)" : ""}`]);
  facts.replaceChildren(...rows.map(([k, v]) => h("div", "", h("dt", "", k), h("dd", "", v))));
  const head = h("tr", "", h("th", "", "Wall"), h("th", "", "Rings at"), h("th", "", "Level"), h("th", "", "Rings for"));
  walls.replaceChildren(head, ...d.walls.map((w) => h("tr", "", h("td", "", w.id), h("td", "", `${fmt(w.hz)} Hz`), h("td", "", `${fmt(20 * Math.log10(w.leak), 1)} dB`), h("td", "", `${fmt(w.ring * 1000)} ms`))));
  const mm = (v: number) => `${fmt(v * 1000)} mm`;
  cuts.replaceChildren(h("tr", "", h("th", "", "Part"), h("th", "", "Size"), h("th", "", "Thick"), h("th", "", "Cut")),
    ...cutList(p).map((c) => h("tr", "", h("td", "", c.part), h("td", "", `${mm(c.l)} x ${mm(c.w)}`), h("td", "", mm(c.t)), h("td", "", String(c.n)))));
  rebuild();
}

// --- sound ---
/** Four seconds of a kick and a bass line, plus a hat the box lets through. */
function loop(sr: number): Float32Array {
  const n = sr * 4, out = new Float32Array(n), beat = sr / 2;
  const notes = [41.2, 41.2, 55, 49, 41.2, 61.7, 55, 36.7];
  let seed = 7;
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / beat), t = (i % beat) / sr;
    const kick = Math.sin(2 * Math.PI * (45 * t + (75 / 18) * (1 - Math.exp(-18 * t)))) * Math.exp(-7 * t);
    const note = notes[b % notes.length], bt = (i % (beat / 2)) / sr;
    const bass = 0.45 * Math.sin(2 * Math.PI * note * (i / sr)) * Math.min(1, bt * 60) * Math.exp(-2.5 * bt);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const hat = (b % 2 ? 0.05 : 0) * (seed / 2 ** 32 - 0.5) * Math.exp(-60 * ((i % (beat / 2)) / sr));
    out[i] = 0.5 * kick + bass + hat;
  }
  return out;
}

/** The walls alone, rung by a knock: each band-pass at unit drive, so a dull wall thuds and a ringing one sings. */
function knockOf(d: Design, sr: number): Float32Array {
  const out = new Float32Array(sr * 1.5);
  out[0] = 1;
  const top = Math.max(...d.walls.map((w) => w.leak));
  new BoxFilter({ ...d, series: [], walls: d.walls.map((w) => ({ ...w, leak: -(0.8 * w.leak) / top })) }, sr).process(out);
  out[0] -= 1;
  return out;
}

function render(kind: "box" | "flat" | "knock", sr: number): { audio: Float32Array; engine: "rust" | "ts" | "none" } {
  const d = now();
  if (kind === "knock") return { audio: knockOf(d, sr), engine: "ts" };
  const audio = loop(sr);
  if (kind === "flat") return { audio, engine: "none" };
  if (rust) { const b = new RustBox(rust, encodePlan(plan()), sr); b.process(audio); b.free(); return { audio, engine: "rust" }; }
  new BoxFilter(d, sr).process(audio);
  return { audio, engine: "ts" };
}

const stats = (a: Float32Array) => {
  let peak = 0, sum = 0;
  for (const v of a) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { peak, rms: Math.sqrt(sum / a.length) };
};

async function play(kind: "box" | "flat" | "knock") {
  source?.stop();
  if (playing === kind) { playing = null; paint(); return { stopped: true }; }
  ctx ??= new AudioContext();
  await ctx.resume().catch(() => {});
  const { audio, engine } = render(kind, ctx.sampleRate);
  const { peak, rms } = stats(audio), g = peak > 0.95 ? 0.95 / peak : 1;
  const buf = ctx.createBuffer(1, audio.length, ctx.sampleRate);
  buf.copyToChannel(Float32Array.from(audio, (v) => v * g), 0);
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = kind !== "knock"; s.connect(ctx.destination); s.start();
  s.onended = () => { if (source === s) { playing = null; source = null; paint(); } };
  source = s; playing = kind; paint();
  return { engine, peak, rms, running: ctx.state === "running" };
}

function paint() {
  listenBtn.classList.toggle("on", playing === "box");
  flatBtn.classList.toggle("on", playing === "flat");
  knockBtn.classList.toggle("on", playing === "knock");
  listenBtn.replaceChildren(icon(playing === "box" ? "square" : "play"), playing === "box" ? "Stop" : "Listen");
}

function restart() { if (playing && playing !== "knock") { const k = playing; playing = null; void play(k); } }

listenBtn.addEventListener("click", () => void play("box"));
flatBtn.addEventListener("click", () => void play("flat"));
knockBtn.addEventListener("click", () => void play("knock"));
matSel.addEventListener("change", () => setMaterial(matSel.value));
explodeIn.addEventListener("input", () => setExplode(Number(explodeIn.value)));

// --- actions ---
function pick(id: string) {
  const p = PLANS.find((q) => q.id === id);
  if (!p) return false;
  current = p; mat = p.material; braces = p.braces;
  draw(); restart();
  return true;
}
function setMaterial(id: string) {
  if (!MATERIALS.some((m) => m.id === id)) return false;
  mat = id; draw(); restart();
  return true;
}
function setBraces(n: number) {
  braces = Math.max(0, Math.min(6, Math.round(n))); draw(); restart();
  return braces;
}
function setExplode(v: number) {
  explode = Math.max(0, Math.min(1, v)); explodeIn.value = String(explode); rebuild();
  return explode;
}

function state() {
  const p = plan(), d = now(), c = curveNow(d), at = (f: number) => c[FREQS.findIndex((q) => q >= f)];
  return {
    plan: current.id, plans: PLANS.map((q) => q.id), material: mat, materials: MATERIALS.map((m) => m.id), braces, explode,
    engine: rust ? "rust" : "ts", playing,
    air: netVolume(p) * 1000, tune: d.tune, q: d.q, down3: lowCut(d), down6: lowCut(d, -6), portSpeed: d.portSpeed,
    db: { 30: at(30), 50: at(50), 100: at(100), 1000: at(1000) },
    walls: d.walls.map((w) => ({ id: w.id, hz: w.hz, db: 20 * Math.log10(w.leak), ringMs: w.ring * 1000 })),
    parts: model ? cabinetParts(model) : [], cuts: cutList(p),
    // How far the baffle stands out front (m): further once the pieces are pulled apart.
    frontZ: model?.getObjectByName("front")?.position.z ?? 0,
  };
}

/** The Rust and TypeScript boxes side by side on this plan: the largest gap in the curve (dB) and in a rendered loop. */
function parity() {
  if (!rust) return null;
  const d = now(), e = encodePlan(plan()), ts = curveOf(d, FREQS), rs = rustCurve(rust, e, FREQS);
  const a = loop(48000), b = a.slice();
  new BoxFilter(d, 48000).process(a);
  const r = new RustBox(rust, e, 48000); r.process(b); r.free();
  let curve = 0, audio = 0;
  for (let i = 0; i < ts.length; i++) curve = Math.max(curve, Math.abs(ts[i] - rs[i]));
  for (let i = 0; i < a.length; i++) audio = Math.max(audio, Math.abs(a[i] - b[i]));
  return { curve, audio };
}

const api = {
  state, pick, material: setMaterial, braces: setBraces, explode: setExplode, parity,
  /** Plays (or stops) the loop through the box, with no box, or the knock; what was rendered, and whether the audio runs. */
  listen: (kind: "box" | "flat" | "knock" = "box") => play(kind),
  /** Renders without playing: peak and rms of the loop through the box (or flat, or the knock). */
  render: (kind: "box" | "flat" | "knock" = "box") => { const r = render(kind, 48000); return { engine: r.engine, ...stats(r.audio) }; },
  stop: () => { source?.stop(); source = null; playing = null; paint(); },
};
declare global { interface Window { qspeakers: typeof api } }
window.qspeakers = api;

draw();
requestAnimationFrame(frame);
void fetchWasm().then(async (bytes) => {
  if (!bytes) return;
  rust = await instantiateFm(bytes).catch(() => null);
  // An older wasm has the engine but not the box: stay on TypeScript.
  if (!rust || typeof rust.fm_box_curve !== "function") { rust = null; return; }
  engineChip.textContent = "Rust";
  engineChip.title = "The box runs in Rust (fm_daw.wasm)";
  draw();
});
