// The menus' baked art (scripts/menu-art.ts runs this in headless Chrome and writes the images to public/menu/):
// - the glossy black soldier on its base, cheering (a won result) and with its hands up (a lost one).
// Seeded, so a re-render gives the same picture. Never loaded by the game itself: the menus use the images.
import * as THREE from "three";
import { buildFigure, createCrowd, pose, type Pose } from "./figure.ts";

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
  return { "soldier-won.webp": soldier("star"), "soldier-lost.webp": soldier("surrender") };
}
