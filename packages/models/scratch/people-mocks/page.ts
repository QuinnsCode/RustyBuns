// The three mock figures side by side on a plain floor, lit like a photo studio. `window.__mocks`: state(), turn(deg)
// (every figure, 0 faces the camera), close(true | false) (frame the heads), skin(i) (rotate the skins between the
// figures: only the colour moves, never a shape).
import * as THREE from "three";
import { MOCKS, figure, type Figure } from "./mocks.ts";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#d9d4cb");
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
scene.add(new THREE.HemisphereLight("#fff6ea", "#6b5e50", 1.1));
const key = new THREE.DirectionalLight("#fff1dc", 2.6);
key.position.set(2.5, 4, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -1, near: 0.5, far: 15 });
scene.add(key);
const rim = new THREE.DirectionalLight("#bcd2ff", 1.4); rim.position.set(-3, 2.5, -3); scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: "#cfc8bc", roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

let skinTurn = 0, turn = 0, close = false;
let figures: Figure[] = [];
function build() {
  for (const f of figures) { scene.remove(f.group); f.dispose(); }
  figures = MOCKS.map((m, i) => {
    const f = figure({ ...m, skin: MOCKS[(i + skinTurn) % MOCKS.length]!.skin }, i + 1);
    f.group.position.x = (i - 1) * 1.25; scene.add(f.group); return f;
  });
  document.getElementById("labels")!.innerHTML = MOCKS.map((m) => `<div><b>${m.name}</b>${m.push}</div>`).join("");
  aim();
}
function aim() {
  for (const f of figures) f.group.rotation.y = THREE.MathUtils.degToRad(turn);
  document.getElementById("labels")!.style.display = close ? "none" : "";
  if (close) { camera.position.set(0, 1.74, 4.3); camera.lookAt(0, 1.62, 0); }
  else { camera.position.set(0, 1.1, 6.4); camera.lookAt(0, 0.95, 0); }
  camera.updateMatrixWorld();
  // each label under its own figure
  const labels = document.getElementById("labels")!.children;
  figures.forEach((f, i) => { const p = f.group.position.clone().project(camera), el = labels[i]; if (el instanceof HTMLElement) el.style.left = `${(p.x + 1) / 2 * innerWidth}px`; });
}
function size() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); aim(); }
addEventListener("resize", size); size(); build();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

declare global { interface Window { __mocks: unknown } }
window.__mocks = {
  state: () => ({ figures: MOCKS.map((m, i) => ({ name: m.name, push: m.push, height: m.height, skin: MOCKS[(i + skinTurn) % MOCKS.length]!.skin })), turn, close }),
  turn(deg: number) { turn = deg; aim(); return deg; },
  close(on: boolean) { close = on; aim(); return on; },
  skin(i: number) { skinTurn = i; build(); return i; },
};
