// The menus' baked art (scripts/menu-art.ts runs this in headless Chrome and writes the images to public/menu/):
// - backplate: a moulded olive sprue sheet, runners and ball nodes and gates, the parts on it the game's own clay
//   soldiers moulded in olive plastic, each beside a numbered tab, under a studio light with a clearcoat sheen.
// - the glossy black soldier on its base, cheering (a won result) and with its hands up (a lost one).
// Seeded, so a re-render gives the same picture. Never loaded by the game itself: the menus use the images.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { buildFigure, createCrowd, pose, type BuildId, type Pose } from "./figure.ts";

const OLIVE = 0x5d6b35;
const plastic = (color = OLIVE) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35 });

function renderer(w: number, h: number, alpha: boolean) {
  const canvas = document.createElement("canvas");
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

function lights(scene: THREE.Scene, shadow: number) {
  scene.add(new THREE.HemisphereLight(0xfff4d8, 0x2a3018, 1.1));
  const key = new THREE.DirectionalLight(0xfff1d6, 3.2);
  key.position.set(-6, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -shadow, right: shadow, top: shadow, bottom: -shadow, near: 1, far: 40 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd4e4a0, 1.1);
  rim.position.set(8, 5, -6);
  scene.add(rim);
}

/** A part number moulded on a tab: the label is drawn on a canvas and laid on the tab's top face. */
function tab(label: string, mat: THREE.Material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.4), mat);
  body.castShadow = body.receiveShadow = true;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 80;
  const x = c.getContext("2d")!;
  x.fillStyle = "#00000000"; x.fillRect(0, 0, 128, 80);
  x.font = "700 54px 'Arial Narrow', Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = "#2a3216"; x.fillText(label, 64, 44);
  x.fillStyle = "#a9ba72"; x.fillText(label, 63, 42);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.35), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, roughness: 0.5 }));
  face.rotation.x = -Math.PI / 2; face.position.y = 0.041;
  g.add(body, face);
  return g;
}

function runner(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** The sprue sheet, as a data URL. */
export function backplate(w = 1600, h = 1000, quality = 0.8, seed = 7): string {
  const rnd = mulberry32(seed), r = renderer(w, h, false), scene = new THREE.Scene();
  scene.background = new THREE.Color(0x262b17);
  lights(scene, 12);
  const mat = plastic(), W = 16, H = 10;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x2b3119, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; floor.receiveShadow = true;
  scene.add(floor);
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  // Frame and runners: a 4 x 3 grid of bays.
  const xs = [-W / 2, -W / 4, 0, W / 4, W / 2], zs = [-H / 2, -H / 6, H / 6, H / 2];
  for (const z of zs) scene.add(runner(v(-W / 2, z), v(W / 2, z), z === zs[0] || z === zs.at(-1) ? 0.16 : 0.11, mat));
  for (const x of xs) scene.add(runner(v(x, -H / 2), v(x, H / 2), x === xs[0] || x === xs.at(-1) ? 0.16 : 0.11, mat));
  for (const x of xs) for (const z of zs) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), mat);
    n.position.set(x, 0.02, z); n.castShadow = n.receiveShadow = true; scene.add(n);
  }
  // A part in each bay: an olive clay soldier lying in the mould, on gates to the runner above it, with its number.
  const crowd = createCrowd();
  scene.add(crowd.root);
  const builds: BuildId[] = ["thick", "average", "lank"], poses: Pose[] = ["stand", "kneel", "star", "stand", "surrender", "kneel"];
  let k = 0;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++, k++) {
    const cx = (xs[i]! + xs[i + 1]!) / 2, cz = (zs[j]! + zs[j + 1]!) / 2;
    const f = buildFigure(OLIVE, 0.42, builds[Math.floor(rnd() * 3)]!);
    pose(f, { pose: poses[k % poses.length]!, speed: 0, dt: 0, roll: 0, pitch: 0 });
    f.root.rotation.set(-Math.PI / 2, 0, (rnd() - 0.5) * 0.3);
    f.root.scale.setScalar(1.25);
    f.root.position.set(cx, 0.1, cz + 1.05);
    scene.add(f.root); crowd.add(f);
    // gates: two short sprigs from the runner above the part to its head and hand
    const top = zs[j]!;
    scene.add(runner(v(cx - 0.1, top + 0.05), v(cx - 0.1, cz - 0.95), 0.045, mat), runner(v(cx + 0.7, top + 0.05), v(cx + 0.45, cz - 0.2), 0.04, mat));
    const t = tab(`${"ABC"[j]}${i + 1}`, mat);
    t.position.set(xs[i]! + 0.55, 0.02, zs[j]! + 0.45);
    scene.add(t);
  }
  scene.updateMatrixWorld(true);
  crowd.update();
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
  cam.position.set(0, 17.5, 7.5);
  cam.lookAt(0, 0, 0.4);
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/webp", quality);
  r.dispose();
  return url;
}

/** The glossy black soldier on its base, in a pose, on a clear background, as a data URL. */
export function soldier(p: Pose, w = 280, h = 360, quality = 0.85): string {
  const r = renderer(w, h, true), scene = new THREE.Scene();
  lights(scene, 3);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.1, 48), plastic());
  base.position.y = -0.05; base.receiveShadow = base.castShadow = true;
  scene.add(base);
  const crowd = createCrowd();
  scene.add(crowd.root);
  const f = buildFigure(0x1f1f1f, 0.18, "average");
  pose(f, { pose: p, speed: 0, dt: 0, roll: 0, pitch: p === "star" ? 0.6 : 0 });
  f.root.rotation.y = 0.5; // the gun swings in toward the camera, inside the frame
  scene.add(f.root); crowd.add(f);
  scene.updateMatrixWorld(true);
  crowd.update();
  for (const o of crowd.root.children) o.castShadow = true;
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 30);
  cam.position.set(0.5, 1.6, 7.2);
  cam.lookAt(0, 1.05, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/webp", quality);
  r.dispose();
  return url;
}

/** Every image the menus use, by file name. */
export function renderAll(): Record<string, string> {
  return { "backplate.webp": backplate(), "soldier-won.webp": soldier("star"), "soldier-lost.webp": soldier("surrender") };
}
