// The turntable's page (see turntable.ts): one piece of gear on a neutral floor under a soft studio light, framed
// to fill the picture. `window.turntable.show(id, angle)` sets it up and resolves once its textures have loaded.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GEAR_IDS, type GearId, gear, gearLook } from "../src/gear.ts";
import { gearSurfaces } from "../src/surfaces.ts";

const ANGLES = { front: [35, 16], side: [90, 10], back: [215, 18] } as const;
type Angle = keyof typeof ANGLES;

const size = Number(new URLSearchParams(location.search).get("size") ?? 768);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9bcc0);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
scene.add(key, key.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x8c8e91, roughness: 0.92 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);

let look = gearLook(), ready: Promise<unknown> = Promise.resolve();
let shown: THREE.Object3D | null = null;

/** Swaps in another look (the material kit) for the pieces shown from now on; `done` resolves once its textures are in. */
function setLook(l: typeof look, done: Promise<unknown>) { look = l; ready = done; }

async function show(id: GearId, angle: Angle) {
  if (shown) scene.remove(shown);
  shown = gear(id, { look, height: 1.6 });
  scene.add(shown);
  shown.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(shown), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const [az, el] = ANGLES[angle].map((d) => (d * Math.PI) / 180);
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  camera.position.set(c.x + Math.sin(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(c);
  camera.updateProjectionMatrix();
  // the key light sits up and to the camera's left, so faces read and the shadow falls behind and right
  key.position.set(c.x + Math.sin(az + 0.7) * r * 6, c.y + r * 8, c.z + Math.cos(az + 0.7) * r * 6);
  key.target.position.copy(c);
  const s = key.shadow.camera as THREE.OrthographicCamera;
  s.left = s.bottom = -r * 2; s.right = s.top = r * 2; s.near = 0.1; s.far = r * 20; s.updateProjectionMatrix();
  await ready;
  renderer.render(scene, camera);
  await new Promise(requestAnimationFrame);
  renderer.render(scene, camera);
  return { id, angle, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
}

// `?plain=1` is the flat look (the `low` quality setting); otherwise the material kit from the served textures/.
if (!new URLSearchParams(location.search).has("plain")) { const kit = gearSurfaces({ base: "/textures/" }); setLook(kit.look, kit.ready); }

Object.assign(window, { turntable: { ids: GEAR_IDS, angles: Object.keys(ANGLES), show, ready: true } });
