// One human() of each build, side by side. See serve.ts for `window.__humans`.
import * as THREE from "three";
import { BUILD_NAMES, human, type Build, type BuildName, type Human, type Move, type Outfit, type Palette } from "../../src/human.ts";

const SKINS = ["#f2d0b5", "#e0b089", "#c68a5e", "#8d5a3b", "#5b3a27"];
const TOPS = ["#d9482b", "#2f7d32", "#2b6cb0", "#e0a526", "#8e44ad", "#e86fa1", "#1aa39a", "#f2efe6"];
const HAIR = ["#2a1b12", "#4f3220", "#7b4f28", "#b98a4a", "#171717", "#8f3a1c"];
const HAIRS = ["short", "long", "curly", "short", "long", "curly", "bald", "long", "short", "curly"] as const;
const HATS = ["none", "none", "cap", "none", "beanie", "none", "bucket", "none", "none", "none"] as const;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#d9d4cb");
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
scene.add(new THREE.HemisphereLight("#fff6ea", "#6b5e50", 1.1));
const key = new THREE.DirectionalLight("#fff1dc", 2.6);
key.position.set(2.5, 4, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 3, bottom: -1, near: 0.5, far: 15 });
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 48), new THREE.MeshStandardMaterial({ color: "#cfc8bc", roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

type View = "row" | "close" | "one" | "side";
let turn = 0, view: View = "row", move: Move = { speed: 0 }, frozen: number | null = null, names: (BuildName | Build)[] = BUILD_NAMES, plain = false, paint: Palette = {};
let extra: Partial<Outfit> = {};
let figures: Human[] = [];

function palette(i: number): Palette {
  if (plain) return Object.fromEntries(["skin", "top", "topDark", "bottom", "bottomDark", "boot", "bootDark", "sole", "hair", "lips", "brow"].map((s) => [s, "#b9b2a8"]));
  const top = TOPS[i % TOPS.length]!, dark = (c: string, f: number) => `#${new THREE.Color(c).multiplyScalar(f).getHexString()}`;
  const skin = SKINS[(i * 2 + 1) % SKINS.length]!, hair = HAIR[(i * 5 + 1) % HAIR.length]!;
  return { skin, lips: `#${new THREE.Color(skin).lerp(new THREE.Color("#a03a3a"), 0.35).multiplyScalar(0.9).getHexString()}`, top, topDark: dark(top, 0.7), hair, brow: dark(hair, 0.8),
    hat: TOPS[(i + 5) % TOPS.length]!, hatDark: dark(TOPS[(i + 5) % TOPS.length]!, 0.7), pack: TOPS[(i + 3) % TOPS.length]!, packDark: dark(TOPS[(i + 3) % TOPS.length]!, 0.6) };
}
function build() {
  for (const f of figures) { scene.remove(f.root); f.dispose(); }
  figures = names.map((n, j) => {
    const i = typeof n === "string" ? BUILD_NAMES.indexOf(n) : j;
    const f = human(n, { top: "puffer", hair: HAIRS[i]!, hat: HATS[i]!, pack: i % 3 === 0, ...extra }, { ...palette(i), ...paint }, i + 1);
    f.root.position.x = (j - (names.length - 1) / 2) * 0.72;
    scene.add(f.root);
    return f;
  });
  aim();
}
function aim() {
  for (const f of figures) f.root.rotation.y = THREE.MathUtils.degToRad(turn);
  const n = figures.length;
  if (view === "close") { camera.position.set(0, 1.62, 1.0 + n * 0.62); camera.lookAt(0, 1.55, 0); }
  else if (view === "one") { camera.position.set(0, 1.0, 5.2); camera.lookAt(0, 0.92, 0); }
  else if (view === "side") { camera.position.set(9, 1.0, 0); camera.lookAt(0, 0.9, 0); }
  else { camera.position.set(0, 1.0, 2.4 + n * 1.05); camera.lookAt(0, 0.92, 0); }
}
function size() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", size); size(); build();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const f of figures) f.pose(move, frozen === null ? dt : 0);
  renderer.render(scene, camera);
});

declare global { interface Window { __humans: unknown } }
window.__humans = {
  state: () => ({ names, heights: figures.map((f) => f.height), triangles: figures.map((f) => f.mesh.geometry.index!.count / 3), turn, view, move }),
  turn(deg: number) { turn = deg; aim(); return deg; },
  view(v: View) { view = v; aim(); return v; },
  only(list: (BuildName | Build)[] | null) { names = list ?? BUILD_NAMES; build(); return names.length; },
  paint(p: Palette) { paint = p; build(); return p; },
  move(m: Partial<Move>) { move = { speed: 0, ...m }; return move; },
  /** Hold every figure at one point of the stride: walk them there in small steps, then stop the clock. */
  freeze(phase: number | number[] | null) {
    frozen = phase === null ? null : 0;
    if (phase !== null) figures.forEach((f, j) => { for (let i = 0; i < 400; i++) f.pose(move, 1 / 120); f.stride(typeof phase === "number" ? phase : phase[j % phase.length]!); f.pose(move, 1e-6); });
    return phase;
  },
  outfit(o: Partial<Outfit>) { extra = o; build(); return extra; },
  plain(on: boolean) { plain = on; build(); return on; },
};
