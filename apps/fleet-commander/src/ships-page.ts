// The hull sheets on a turntable: `ships.html?ship=destroyer` (the whole hull), `destroyer~exploded` (its pieces
// pulled apart upward, in the order they go on), `destroyer~<piece>` (one piece alone, where it sits) or
// `destroyer~far` (the far level the Theater's board draws), seen from `&view=three|top|side|front|below|stern`.
// `window.fleetShips` is the harness (scripts/probe.ts HANDLES): state() says what is shown, show(id, view) changes it.
import * as THREE from "three";
import { SHEETS, type SheetKind } from "./view/sheets.ts";
import { hasSheet, sheetModel, shipPieces } from "./view/ships.ts";

type View = "three" | "top" | "side" | "front" | "below" | "stern";
const VIEWS: Record<View, [number, number, number]> = {
  three: [0.75, 0.55, 0.85], top: [0, 1, 0.0001], side: [0, 0.08, 1], front: [1, 0.12, 0], below: [0.4, -0.8, 0.5], stern: [-1, 0.35, 0.45],
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const caption = document.getElementById("caption")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1410, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(600, 900, 400); scene.add(sun);
const rimLight = new THREE.DirectionalLight(0x9fd8ff, 0.8); rimLight.position.set(-800, 200, -600); scene.add(rimLight);
const camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);

let shown: THREE.Object3D | null = null, now = { id: "destroyer", view: "three" as View };

function build(id: string): THREE.Object3D {
  const [kind, which] = id.split("~") as [string, string | undefined];
  if (!hasSheet(kind)) throw new Error(`no sheet for ${kind}: ${Object.keys(SHEETS).join(", ")}`);
  if (!which) return sheetModel(kind);
  if (which === "far") { const g = sheetModel(kind); const lod = g.children[0] as THREE.LOD; lod.autoUpdate = false; lod.levels.forEach((l, i) => (l.object.visible = i === 1)); return g; }
  const g = new THREE.Group(), sheet = SHEETS[kind];
  const ps = shipPieces(kind).filter((p) => which === "exploded" || p.name === which);
  if (!ps.length) throw new Error(`${kind} has no piece ${which}: ${shipPieces(kind).map((p) => p.name).join(", ")}`);
  ps.forEach((p, i) => { if (which === "exploded") p.group.position.y = i * sheet.height * 0.55; g.add(p.group); });
  g.scale.setScalar(sheet.gameLength / sheet.length);
  return g;
}

function show(id = now.id, view: View = now.view) {
  if (shown) scene.remove(shown);
  now = { id, view };
  shown = build(id);
  scene.add(shown);
  const box = new THREE.Box3().setFromObject(shown), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const r = size.length() / 2, d = VIEWS[view] ?? VIEWS.three, dir = new THREE.Vector3(...d).normalize();
  camera.position.copy(mid).addScaledVector(dir, (r / Math.sin((camera.fov * Math.PI) / 360)) * 0.78);
  camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
  camera.lookAt(mid);
  const kind = id.split("~")[0] as SheetKind, s = SHEETS[kind];
  caption.textContent = `${s.title} · ${s.length} × ${s.beam} × ${s.height} m · ${id.split("~")[1] ?? "whole"} · ${view}`;
  return state();
}

function state() {
  let meshes = 0, triangles = 0;
  shown?.traverseVisible((o) => { if (o instanceof THREE.Mesh) { meshes++; triangles += o.geometry.getAttribute("position").count / 3; } });
  const kind = now.id.split("~")[0] as SheetKind;
  return { ...now, sheets: Object.keys(SHEETS), pieces: hasSheet(kind) ? shipPieces(kind).map((p) => p.name) : [], meshes, triangles: Math.round(triangles) };
}

function frame() {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const harness = { state, show };
declare global { interface Window { fleetShips: typeof harness } }
window.fleetShips = harness;

const q = new URLSearchParams(location.search);
renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
show(q.get("ship") ?? "destroyer", (q.get("view") as View) ?? "three");
frame();
