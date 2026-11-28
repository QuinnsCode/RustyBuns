import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PackedSplats, SparkRenderer, SplatMesh, writeSpz } from "@sparkjsdev/spark";
import {
  Aperture, Box, Camera, CloudUpload, Code, createElement, Images, RefreshCw, Rotate3d, RotateCcw, Scissors, SunMoon, Upload,
} from "lucide";
import { eqosys } from "@rustybuns/util/eqosys";
import { check } from "@rustybuns/util/guard";
import { APP, EQOSYS, Hosted, MAX_BYTES, Problem, SITE, iframeFor } from "./api.ts";
import { clean } from "./clean.ts";
import { demoCarton } from "./demo.ts";
import { nextShot, plan, readiness, type PlanId, type Shot } from "./shots.ts";
import "./menu.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ICONS = { box: Box, camera: Camera, aperture: Aperture, images: Images, "rotate-ccw": RotateCcw, "rotate-3d": Rotate3d, upload: Upload, "refresh-cw": RefreshCw, "sun-moon": SunMoon, code: Code, scissors: Scissors, "cloud-upload": CloudUpload };
for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const Icon = ICONS[el.dataset.icon as keyof typeof ICONS];
  if (Icon) el.replaceWith(createElement(Icon));
}

// ?embed=1 is the product-page mode: only the spinning splat, no capture panel.
const params = new URLSearchParams(location.search);
if (params.get("embed") === "1") document.body.classList.add("embedded");

// ---- Capture ---------------------------------------------------------------------------------

let planId: PlanId = "orbit";
let shots: Shot[] = plan(planId);
const taken = new Map<number, string>(); // shot index -> object URL of its photo

const RING_RADIUS = { side: 80, low: 95, mid: 72, high: 49, under: 26 } as const;

function where(s: Shot): [number, number] {
  if (s.ring === "side") {
    // Six views: four round the edge, top and bottom stacked in the middle.
    if (s.elevation === 90) return [0, -22];
    if (s.elevation === -90) return [0, 22];
  }
  const a = ((s.azimuth - 90) * Math.PI) / 180;
  const r = RING_RADIUS[s.ring];
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function drawDial() {
  const dial = $("dial");
  const next = nextShot(shots, new Set(taken.keys()));
  dial.replaceChildren(...shots.map((s) => {
    const [x, y] = where(s);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", planId === "six" ? "11" : "5");
    dot.setAttribute("class", taken.has(s.i) ? "done" : s === next ? "next" : "todo");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = s.say;
    dot.append(title);
    return dot;
  }));
  $("say").textContent = next ? `Next: ${next.say}` : "Every shot is in.";
  const r = readiness(shots, new Set(taken.keys()));
  if (r.taken === 0) { $("status").textContent = `0 of ${r.total}.`; $("status").classList.remove("ok"); }
  else {
  const gaps = r.thin.length ? `Thin: ${r.thin.join(", ")}.` : "";
  const hole = r.widestGap > 45 ? ` Widest gap ${Math.round(r.widestGap)}°.` : "";
  $("status").textContent = `${r.taken} of ${r.total}. ${r.ready ? "Ready to build." : gaps + hole}`;
  $("status").classList.toggle("ok", r.ready);
  }
  $("thumbs").replaceChildren(...[...taken.values()].map((src) => Object.assign(document.createElement("img"), { src, alt: "" })));
}

function choosePlan(id: PlanId) {
  planId = id;
  shots = plan(id);
  clearShots();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-plan]")) b.setAttribute("aria-checked", String(b.dataset.plan === id));
}

function clearShots() {
  for (const url of taken.values()) URL.revokeObjectURL(url);
  taken.clear();
  drawDial();
}

function addPhotos(files: FileList | null) {
  for (const f of files ?? []) {
    const s = nextShot(shots, new Set(taken.keys()));
    if (!s) break;
    taken.set(s.i, URL.createObjectURL(f));
  }
  drawDial();
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-plan]")) {
  b.addEventListener("click", () => { if (b.dataset.plan === "six" || b.dataset.plan === "orbit") choosePlan(b.dataset.plan); });
}
for (const id of ["shoot", "batch"]) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener("change", () => { addPhotos(input.files); input.value = ""; });
}
$("reset").addEventListener("click", clearShots);
drawDial();

// ---- Viewer ----------------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const STUDIO = new THREE.Color(0xf4f4f2), DARK = new THREE.Color(0x16181c);
scene.background = STUDIO;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
camera.position.set(0, 0.4, 2.2);
scene.add(new SparkRenderer({ renderer }));
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 2;
let mesh: SplatMesh | null = null;
/** What the last clean-up cut, and where the product went online: for the probe and the page. */
let cleaned: { before: number; after: number; table: boolean } | null = null;
let hosted: Hosted | null = null;

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement!;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement!);

type Source = { url: string } | { fileBytes: ArrayBuffer; fileName: string } | { packedSplats: PackedSplats; fileName: string };

async function show(opts: Source) {
  $("drop").hidden = true;
  $("info").textContent = "Loading…";
  if (mesh) { scene.remove(mesh); mesh.dispose(); }
  const m = new SplatMesh(opts);
  mesh = m;
  try {
    await m.initialized;
  } catch (e) {
    $("info").textContent = `Could not read that file: ${e instanceof Error ? e.message : String(e)}`;
    $("drop").hidden = false;
    return;
  }
  // Most capture tools write y-down; turn it upright so the turntable spins round the product's own axis.
  m.quaternion.set(1, 0, 0, 0);
  scene.add(m);
  frame(m);
  $("info").textContent = `${m.packedSplats?.numSplats?.toLocaleString() ?? "?"} points`;
  const src = "url" in opts ? new URL(opts.url, location.href).href : `https://your-store-cdn.example/${opts.fileName}`;
  $<HTMLTextAreaElement>("snippet").value = iframeFor(`${location.origin}${location.pathname}?embed=1&src=${encodeURIComponent(src)}`);
  hosted = null;
  $("page").hidden = true;
  $<HTMLButtonElement>("clean").disabled = $<HTMLButtonElement>("online").disabled = false;
}

/** Point the camera at the product's middle from far enough back that all of it fits. */
function frame(m: SplatMesh) {
  m.updateMatrixWorld();
  const box = m.getBoundingBox(true).applyMatrix4(m.matrixWorld);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Fit to the narrower of the two view angles, so a tall phone embed doesn't crop the sides.
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const fit = sphere.radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * camera.aspect)));
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(new THREE.Vector3(0, 0.35, 1).normalize().multiplyScalar(fit * 1.1));
  camera.near = fit / 100;
  camera.far = fit * 20;
  camera.updateProjectionMatrix();
}

const src = params.get("src");
if (src) void show({ url: src });
const example = () => show({ fileBytes: demoCarton(), fileName: "demo-carton.splat" });
if (!src && params.get("demo") === "1") void example();
$("example").addEventListener("click", () => void example());

async function openFile(f: File | undefined) {
  if (f) await show({ fileBytes: await f.arrayBuffer(), fileName: f.name });
}
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const input = e.currentTarget;
  if (input instanceof HTMLInputElement) void openFile(input.files?.[0]);
});
const stage = $("stage");
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("over"); });
stage.addEventListener("dragleave", () => stage.classList.remove("over"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("over");
  void openFile(e.dataTransfer?.files[0]);
});
$("spin").addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  $("spin").setAttribute("aria-pressed", String(controls.autoRotate));
});
$("bg").addEventListener("click", () => { scene.background = scene.background === STUDIO ? DARK : STUDIO; });
controls.addEventListener("start", () => { controls.autoRotate = false; $("spin").setAttribute("aria-pressed", "false"); });

// ---- Clean and put online --------------------------------------------------------------------

/** Cut the table and the floaters out of what is showing (clean.ts), and show what is left. */
async function cleanUp() {
  const ps = mesh?.packedSplats;
  if (!ps) return;
  const n = ps.numSplats;
  const pos = new Float32Array(n * 3), opacity = new Float32Array(n), size = new Float32Array(n);
  ps.forEachSplat((i, c, s, _q, o) => { pos.set([c.x, c.y, c.z], i * 3); opacity[i] = o; size[i] = Math.max(s.x, s.y, s.z); });
  const r = clean({ pos, opacity, size });
  if (r.kept === 0) { $("info").textContent = "Nothing looked like a product to keep."; return; }
  const out = new PackedSplats({ maxSplats: r.kept });
  ps.forEachSplat((i, c, s, q, o, col) => { if (r.keep[i]) out.pushSplat(c, s, q, o, col); });
  await show({ packedSplats: out, fileName: "product.spz" });
  cleaned = { before: n, after: r.kept, table: r.table !== null };
  $("info").textContent = `${r.kept.toLocaleString()} of ${n.toLocaleString()} points kept${r.table !== null ? ", table cut away" : ""}.`;
}

const eq = eqosys({ app: APP, url: EQOSYS, from: [SITE], prefix: APP });
const signedIn = () => { const l = eq.login(); return l && eq.fresh(l, 30_000) ? l : null; };

/** Send what is showing to the Worker as an .spz; it answers with the product's one URL. Signs in first if need be. */
async function putOnline() {
  const ps = mesh?.packedSplats;
  if (!ps) return;
  // Straight from the click, or the browser blocks eqosys's sign-in window.
  const login = signedIn() ?? (await eq.signInHere("online")).login;
  if (!login) { $("info").textContent = "Sign in with eqosys to put it online."; return; }
  const { fileBytes } = writeSpz(ps);
  if (fileBytes.byteLength > MAX_BYTES) { $("info").textContent = "Too big to put online: clean it up first."; return; }
  $("info").textContent = "Putting it online…";
  const res = await fetch("/api/splats", { method: "POST", headers: { authorization: `Bearer ${login.token}` }, body: new Blob([new Uint8Array(fileBytes)]) }).catch(() => null);
  const body: unknown = res ? await res.json().catch(() => null) : null;
  const got = res?.ok ? check(Hosted, body) : null;
  if (!got) {
    const why = check(Problem, body)?.error ?? "the server didn't answer";
    $("info").textContent = `Couldn't put it online: ${why}.`;
    return;
  }
  hosted = got;
  $<HTMLTextAreaElement>("snippet").value = iframeFor(got.page);
  Object.assign($<HTMLAnchorElement>("page"), { href: got.page, textContent: got.page, hidden: false });
  $("info").textContent = "Online. The code below puts it on a product page.";
  $<HTMLDetailsElement>("embed").open = true;
}

$("clean").addEventListener("click", () => void cleanUp());
$("online").addEventListener("click", () => void putOnline());
// Back from a full-page trip to eqosys (where a sign-in window was blocked): the login is kept, so one more click sends it.
void eq.finishSignIn();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// For agents and the probe tool: what the page holds, without a screenshot.
Object.assign(window, {
  shareSplat: {
    state: () => ({ plan: planId, ...readiness(shots, new Set(taken.keys())), splats: mesh?.packedSplats?.numSplats ?? 0, src: src ?? null, cleaned, hosted }),
    /** The Clean up button, for a probe: cuts what is showing and answers the new state. */
    clean: async () => { await cleanUp(); return cleaned; },
  },
});
