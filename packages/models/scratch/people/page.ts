// Five character() figures side by side. `window.__people`: state(), turn(deg) (0 faces the camera), close(true | false)
// (frame the heads), pose(p) (a Pose for every figure: { seated: true, play: "keys" } and so on).
import * as THREE from "three";
import { defaultAvatar, type Avatar } from "@rustybuns/util/avatar";
import { character, type Character, type Pose } from "../../src/character.ts";

const PEOPLE: Partial<Avatar>[] = [
  { skin: "#a8693f", hair: "buzz", hairColor: "#16191c", hat: "cap", top: "tee", topColor: "#f4f5f5", bottomColor: "#2e4a6b", build: "average", face: "square", beard: "stubble", eyes: "dot", mouth: "flat", glasses: "none", brows: "thick", nose: "wide" },
  { skin: "#f7d6b8", hair: "bob", hairColor: "#8a5a3c", hat: "none", top: "hoodie", topColor: "#c23a6b", bottomColor: "#2e3439", build: "slim", face: "oval", beard: "none", eyes: "dot", mouth: "smile", glasses: "round", brows: "arched", nose: "button", cheeks: "freckles" },
  { skin: "#4e2e1b", hair: "locs", hairColor: "#16191c", hat: "none", top: "suit", topColor: "#2e3439", bottomColor: "#2e3439", build: "tall", face: "long", beard: "goatee", eyes: "dot", mouth: "smile", glasses: "none", brows: "soft", nose: "pointy" },
  { skin: "#ecbf96", hair: "short", hairColor: "#d8b04a", hat: "beanie", top: "overalls", topColor: "#e8590c", bottomColor: "#3a6bd8", build: "round", face: "round", beard: "full", eyes: "happy", mouth: "grin", glasses: "none", brows: "flat", nose: "round" },
  { skin: "#d49a6a", hair: "ponytail", hairColor: "#4a2f1d", hat: "none", top: "dress", topColor: "#3a6bd8", bottomColor: "#2e3439", build: "short", face: "heart", beard: "none", eyes: "wide", mouth: "smile", glasses: "none", brows: "soft", nose: "button", cheeks: "blush" },
];

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
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3, bottom: -1, near: 0.5, far: 15 });
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ color: "#cfc8bc", roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

let turn = 0, close = false, pose: Pose = { t: 1 };
const figures: Character[] = PEOPLE.map((p, i) => {
  const c = character({ ...defaultAvatar(`p${i}`), ...p }, { seed: i + 1 });
  c.group.position.x = (i - (PEOPLE.length - 1) / 2) * 0.75;
  c.group.traverse((m) => { if (m instanceof THREE.Mesh) m.castShadow = true; });
  scene.add(c.group);
  return c;
});
function aim() {
  for (const f of figures) { f.group.rotation.y = Math.PI + THREE.MathUtils.degToRad(turn); f.pose(pose); }
  if (close) { camera.position.set(0, 1.62, 3.6); camera.lookAt(0, 1.52, 0); }
  else { camera.position.set(0, 1.0, 9.2); camera.lookAt(0, 0.9, 0); }
  camera.updateMatrixWorld();
}
function size() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); aim(); }
addEventListener("resize", size); size();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

declare global { interface Window { __people: unknown } }
window.__people = {
  state: () => ({ heights: figures.map((f) => Math.round(f.height * 100) / 100), turn, close, pose }),
  turn(deg: number) { turn = deg; aim(); return deg; },
  close(on: boolean) { close = on; aim(); return on; },
  pose(p: Partial<Pose>) { pose = { t: 1, ...p }; aim(); return pose; },
};
