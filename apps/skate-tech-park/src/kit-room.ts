// The kit room (kit.html on the dev server): every piece the Blender kit dresses, in a row on a flat floor
// beside the board, under a slowly circling camera. For judging a model by eye after `bun run models`.
// ?kit=hi|mid|low picks the budget, ?kit=built shows the sampled meshes; ?board= works as in the game.
import * as THREE from "three";
import { makeLevel } from "./level.ts";
import { bowl, box, fallenLog, funbox, gap, join, kicker, ledge, outcrop, quarterPipe, rockFace, spine, stairSet, tabletop, type Part } from "./levels/pieces.ts";
import { BOARD_BUDGETS, type BoardBudget, dressBoard, fingerboard } from "./models.ts";
import { KIT_BUDGETS, type KitBudget, loadKit } from "./render/kit.ts";
import { levelMeshes } from "./render/pieces.ts";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9c3bb);
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x8a7f72, 1.2));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 1 }));
floor.receiveShadow = true;
scene.add(floor);

// One of everything, left to right along x, each ridden along +z.
const row: ((x: number) => Part)[] = [
  (x) => kicker({ x, z: 0 }, { curve: 2 }),
  (x) => quarterPipe({ x, z: 0 }),
  (x) => stairSet({ x, z: 0 }),
  (x) => funbox({ x, z: 0 }),
  (x) => spine({ x, z: 0 }),
  (x) => ledge({ x, z: 0 }),
  (x) => box({ x, z: 0 }),
  (x) => tabletop({ x, z: 0 }),
  (x) => gap({ x, z: -12 }, { name: "gap", span: 8 }).landing,
];
// The landscape row, behind: a granite boulder, a rock face that turns to vertical, a fallen log and a pool.
const land: ((x: number) => Part)[] = [
  (x) => outcrop({ x, z: 70 }),
  (x) => rockFace({ x, z: 70 }),
  (x) => fallenLog({ x, z: 70 }),
  (x) => bowl({ x, z: 70 }, { w: 24, d: 18 }),
];
const part = join(...row.map((f, i) => f((i - (row.length - 1) / 2) * 16)), ...land.map((f, i) => f((i - (land.length - 1) / 2) * 40)));
const level = makeLevel({ name: "kit room", pieces: part.pieces, rails: part.rails, spawns: [], bounds: { minX: -150, maxX: 150, minZ: -150, maxZ: 150 } });
let meshes = levelMeshes(level);
scene.add(meshes);
const kit = q.get("kit") ?? "mid";
if (KIT_BUDGETS.includes(kit as KitBudget)) {
  loadKit(kit as KitBudget, async (f) => new URL(f, document.baseURI).href).then((k) => {
    scene.remove(meshes);
    meshes = levelMeshes(level, undefined, k);
    scene.add(meshes);
  });
}

const board = fingerboard();
board.position.set(-8, 0, -14);
scene.add(board);
const budget = q.get("board") ?? "mid";
if (BOARD_BUDGETS.includes(budget as BoardBudget)) dressBoard(board, new URL(`models/fingerboard-${budget}.glb`, document.baseURI).href);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener("resize", resize);
resize();
// ?at=<index> frames one piece close up; otherwise the camera circles the whole row.
const at = q.has("at") ? (Number(q.get("at")) - (row.length - 1) / 2) * 16 : null;
// ?land=<index> frames one landscape piece the same way.
const landAt = q.has("land") ? (Number(q.get("land")) - (land.length - 1) / 2) * 40 : null;
renderer.setAnimationLoop((ms) => {
  const a = ms / 9000;
  if (landAt !== null) { camera.position.set(landAt + Math.cos(a) * 34, 12, 70 + Math.sin(a) * 34); camera.lookAt(landAt, 2, 70); renderer.render(scene, camera); return; }
  if (at === null) camera.position.set(Math.cos(a) * 70, 28, Math.sin(a) * 50 - 10);
  else camera.position.set(at + Math.cos(a) * 16, 7, Math.sin(a) * 16);
  camera.lookAt(at ?? 0, 1.5, 0);
  renderer.render(scene, camera);
});
