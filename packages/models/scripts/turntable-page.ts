// The turntable's page (see turntable.ts): one piece of gear on a stage deck, lit as a photo of it would be: a real
// room's light (a CC0 HDRI from Poly Haven, also the soft background), a key light with a soft shadow, and ambient
// occlusion for the contact shadows and the creases. `window.turntable.show(id, angle)` sets it up and resolves once
// its textures have loaded. `?hdri=0` falls back to three's RoomEnvironment and a flat backdrop (no download).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GEAR_IDS, GEAR_SIZES, type GearId, gear, gearLook } from "../src/gear.ts";
import { surface, gearSurfaces } from "../src/surfaces.ts";

// `close` is a macro shot: the front three-quarter view moved in on the top front corner, where a pixel is about
// half a millimetre, so the coat's grain, the grille's holes and the hardware show as they would in a close photo.
// `photo` is the dance stack top's reference photo's own view (#5948): from the box's left, near straight on, a little
// above; `straight` is the owner's straight-on photo's. Neither is in the default set; `--js "turntable.angles = ['photo']"` picks one.
const ANGLES = { front: [35, 16], side: [90, 10], back: [215, 18], close: [35, 16], photo: [-15, 8], straight: [0, 4] } as const;
type Angle = keyof typeof ANGLES;

// `?sky=1` (an outdoor overcast HDRI, the default): the photos' soft daylight. The sky does most of the lighting, the
// key is a weak sun through cloud with a wide blurred shadow, and the deck fades into a pale haze, not a dark room.
const q = new URLSearchParams(location.search), size = Number(q.get("size") ?? 768), plain = q.has("plain"), hdri = q.get("hdri") !== "0";
const sky = hdri && q.has("sky");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = sky ? 1.0 : 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = sky ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const backdrop = sky ? 0x8c9196 : 0x3b3d40;
let lit: Promise<unknown> = Promise.resolve();
if (hdri) {
  lit = new HDRLoader().loadAsync("/hdri.hdr").then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(t).texture;
    scene.background = t;
    scene.backgroundBlurriness = 0.35;
    scene.backgroundIntensity = sky ? 0.6 : 0.45;
  });
} else {
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = new THREE.Color(backdrop);
}
scene.environmentIntensity = sky ? 0.95 : 0.8;
const key = new THREE.DirectionalLight(0xfff4e8, sky ? 1.0 : 1.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = sky ? 10 : 8;
key.shadow.blurSamples = 24;
key.shadow.bias = sky ? -0.0002 : -0.0004;
key.shadow.normalBias = 0.01;
const rim = new THREE.DirectionalLight(0xdfe8ff, sky ? 0.35 : 0.9);
scene.add(key, key.target, rim, rim.target);

// The contact shadow: under overcast sky the darkest thing in a photo is the thin band where a box meets the floor. A
// soft dark pad the size of the piece's footprint, fading out over a few centimetres past it, laid just above the deck.
const PAD = 256, FADE = 0.025, REACH = 0.1;
const px = new Uint8Array(PAD * PAD * 4), pad = new THREE.DataTexture(px, PAD, PAD);
/** Redraws the pad for a footprint `w` by `d` metres: solid under it, falling off as e^(-distance / FADE) past it. */
function padFor(w: number, d: number) {
  for (let j = 0; j < PAD; j++) for (let i = 0; i < PAD; i++) {
    const x = Math.abs((i + 0.5) / PAD - 0.5) * (w + 2 * REACH) - w / 2, z = Math.abs((j + 0.5) / PAD - 0.5) * (d + 2 * REACH) - d / 2;
    const out = Math.hypot(Math.max(x, 0), Math.max(z, 0)), a = Math.round(255 * Math.exp(-out / FADE));
    px.fill(a, (j * PAD + i) * 4, (j * PAD + i) * 4 + 4);
  }
  pad.needsUpdate = true;
}
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: pad, transparent: true, opacity: 0.7, depthWrite: false }));
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.0015;
contact.renderOrder = 1;
scene.add(contact);

// The stage deck: painted ply sheets, 1.22 by 2.44 m, with a 3 mm gap between them, fading into the room's haze. One
// mesh, each sheet's grain shifted (UVs in metres, so the grain is at its real size), so no two sheets repeat.
const deckLook = plain ? { material: new THREE.MeshStandardMaterial({ color: 0x2b2b2c, roughness: 0.8 }), ready: Promise.resolve() } : surface("ply", { base: "/textures/" });
if (!plain) deckLook.material.color.setHex(0x34332f);
// matte under the sky: a painted deck is flat, and a glossy one reads as brushed metal
deckLook.material.roughness = sky ? 0.95 : 0.75;
// and under it the grain is painted over: no colour streaks, only a faint relief from the wood under the paint (more reads as brushed metal at a slant)
if (sky && !plain) void deckLook.ready.then(() => {
  const m = deckLook.material;
  m.map = null;
  m.color.setHex(0x3a3936);
  m.normalScale.setScalar(0.12);
  m.envMapIntensity = 0.7;
  m.needsUpdate = true;
});
const sheets: THREE.BufferGeometry[] = [];
for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
  const g = new THREE.BoxGeometry(1.217, 0.02, 2.437), uv = g.getAttribute("uv"), pos = g.getAttribute("position"), nor = g.getAttribute("normal");
  const du = ((i * 7 + j * 13) % 5) * 0.37, dv = ((i * 3 + j * 11) % 7) * 0.53;
  for (let k = 0; k < uv.count; k++) {
    const ny = Math.abs(nor.getY(k)), nx = Math.abs(nor.getX(k));
    uv.setXY(k, du + (ny > 0.5 || nx < 0.5 ? pos.getX(k) : pos.getZ(k)), dv + (ny > 0.5 ? pos.getZ(k) : pos.getY(k)));
  }
  sheets.push(g.translate(i * 1.22 + 0.4, -0.01, j * 2.44 + 0.3));
}
const deck = new THREE.Mesh(mergeGeometries(sheets), deckLook.material);
deck.receiveShadow = true;
const gap = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
gap.rotation.x = -Math.PI / 2;
gap.position.y = -0.019;
scene.add(deck, gap);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(size, size);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, size, size);
ao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.6, thickness: 1, scale: 1.1, samples: 16 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());

let look = gearLook(), ready: Promise<unknown> = Promise.resolve();
let shown: THREE.Object3D | null = null;

/** Swaps in another look (the material kit) for the pieces shown from now on; `done` resolves once its textures are in. */
function setLook(l: typeof look, done: Promise<unknown>) { look = l; ready = done; }

/** `dance-stack`: the stack as the photos show one, two bass bins side by side and three columns of mid-bass and top
 * on them, the outer columns splayed out. */
function danceStack(): THREE.Group {
  const g = new THREE.Group(), sh = 0.8, bh = GEAR_SIZES["stack-mid-bass"][1];
  for (const x of [-0.552, 0.552]) { const s = gear("horn-sub-21", { look }); s.position.x = x; g.add(s); }
  for (const k of [-1, 0, 1]) {
    const col = new THREE.Group();
    col.position.set(k * 0.62, sh, k ? -0.06 : 0);
    col.rotation.y = -k * 0.2;
    const mb = gear("stack-mid-bass", { look }), mh = gear("stack-mid-high", { look });
    mh.position.y = bh;
    col.add(mb, mh);
    g.add(col);
  }
  return g;
}

async function show(id: GearId | "dance-stack", angle: Angle) {
  if (shown) scene.remove(shown);
  shown = id === "dance-stack" ? danceStack() : gear(id, { look, height: 1.6 });
  scene.add(shown);
  shown.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(shown), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const [az, el] = ANGLES[angle].map((d) => (d * Math.PI) / 180);
  const far = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02, dist = angle === "close" ? far * 0.4 : far;
  const aim = angle === "close" ? c.clone().lerp(box.max, 0.62) : c;
  camera.position.set(aim.x + Math.sin(az) * Math.cos(el) * dist, aim.y + Math.sin(el) * dist, aim.z + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  // the key sits up and to the camera's left, so faces read and the shadow falls behind and right; the rim comes from
  // behind on the other side, so a black box's edges part from the dark room
  key.position.set(c.x + Math.sin(az + 0.7) * r * 6, c.y + r * 8, c.z + Math.cos(az + 0.7) * r * 6);
  key.target.position.copy(c);
  rim.position.set(c.x + Math.sin(az + Math.PI - 0.9) * r * 6, c.y + r * 4, c.z + Math.cos(az + Math.PI - 0.9) * r * 6);
  rim.target.position.copy(c);
  const s = key.shadow.camera as THREE.OrthographicCamera;
  s.left = s.bottom = -r * 2; s.right = s.top = r * 2; s.near = 0.1; s.far = r * 20; s.updateProjectionMatrix();
  scene.fog = new THREE.Fog(backdrop, dist + r * 2, dist + r * 14);
  // the pad covers the footprint, and only when the piece stands on the deck
  const foot = box.getSize(new THREE.Vector3());
  contact.visible = sky && box.min.y < 0.02;
  if (contact.visible) padFor(foot.x, foot.z);
  contact.scale.set(foot.x + 2 * REACH, foot.z + 2 * REACH, 1);
  contact.position.x = c.x;
  contact.position.z = c.z;
  ao.updateGtaoMaterial({ radius: Math.max(0.05, r * 0.25) });
  await Promise.all([ready, lit, deckLook.ready]);
  // count the gear's own triangles and draws on a plain render, then take the picture through the AO
  renderer.render(scene, camera);
  const info = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  composer.render();
  await new Promise(requestAnimationFrame);
  composer.render();
  return { id, angle, ...info };
}

// `?plain=1` is the flat look (the `low` quality setting); otherwise the material kit from the served textures/.
if (!plain) { const kit = gearSurfaces({ base: "/textures/" }); setLook(kit.look, kit.ready); }

Object.assign(window, { turntable: { ids: [...GEAR_IDS, "dance-stack"], angles: ["front", "side", "back", "close"], show, ready: true, look: () => look, ao, contact, key } });
