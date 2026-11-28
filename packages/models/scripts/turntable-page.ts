// The turntable's page (see turntable.ts): one piece of gear on a raised stage deck, lit as a photo of it would be: a
// real place's light and an out-of-focus background (CC0 HDRIs from Poly Haven), a key light with a soft shadow, and ambient
// occlusion for the contact shadows and the creases. `window.turntable.show(id, angle)` sets it up and resolves once
// its textures have loaded. `?hdri=0` falls back to three's RoomEnvironment and a flat backdrop (no download).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GEAR_IDS, GEAR_SIZES, type GearId, gear, gearLook, gearPieces } from "../src/gear.ts";
import { surface, gearSurfaces } from "../src/surfaces.ts";
import { plugPieces, socketPieces } from "../src/sockets.ts";
import { CONNECTOR_TYPES, CONNECTORS, type ConnectorType, type Gender } from "@rustybuns/util/connectors";
import type { Piece } from "../src/shapes.ts";

// `close` is a macro shot: the front three-quarter view moved in on the top front corner, where a pixel is about
// half a millimetre, so the coat's grain, the grille's holes and the hardware show as they would in a close photo.
// `panel` looks straight at a box's jacks from behind, close enough that a socket's pins and latch read (opt in:
// `--js "turntable.angles = ['panel']"`; on the `connectors` board it looks at the board's face).
// `photo` is the dance stack top's reference photo's own view (#5948): from the box's left, near straight on, a little
// above; `straight` is the owner's straight-on photo's. Neither is in the default set; `--js "turntable.angles = ['photo']"` picks one.
const ANGLES = { front: [35, 16], side: [90, 10], back: [215, 18], close: [35, 16], photo: [-15, 8], straight: [0, 4], panel: [195, 12] } as const;
type Angle = keyof typeof ANGLES;
/** The elevations under the sky, where the default angles look nearly level. */
const LEVEL: Partial<Record<Angle, number>> = { front: 7, side: 5, back: 9, close: 10 };

// `?sky=1` (an outdoor overcast HDRI, the default): the photos' soft daylight. The sky does most of the lighting, the
// key is a weak sun through cloud with a wide blurred shadow. The camera stands lower there, as a photographer would,
// so the place shows behind the deck.
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
/** An HDRI as a texture. Under the sky it is white-balanced as a camera would (the average colour made grey), so the
 * overcast's blue doesn't tint the black paint and steel. */
async function loadHdr(url: string) {
  const t = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(url);
  t.mapping = THREE.EquirectangularReflectionMapping;
  const data: unknown = t.image.data;
  if (sky && data instanceof Float32Array) {
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
    const lum = 0.2126 * sum[0]! + 0.7152 * sum[1]! + 0.0722 * sum[2]!, gain = sum.map((s) => lum / s);
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c]! *= gain[c]!;
    t.needsUpdate = true;
  }
  return t;
}
let lit: Promise<unknown> = Promise.resolve();
if (hdri) {
  // `?place=1`: what the camera sees behind the deck is another HDRI than the one that lights it (a sky has no horizon)
  lit = Promise.all([loadHdr("/hdri.hdr"), q.has("place") ? loadHdr("/place.hdr") : null]).then(([light, place]) => {
    scene.environment = pmrem.fromEquirectangular(light).texture;
    scene.background = place ?? light;
    scene.backgroundBlurriness = place ? 0.06 : 0.35;
    scene.backgroundIntensity = place ? 1.3 : 0.45;
  });
} else {
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = new THREE.Color(0x3b3d40);
}
scene.environmentIntensity = sky ? 0.95 : 0.8;
const key = new THREE.DirectionalLight(0xfff4e8, sky ? 1.0 : 1.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = sky ? 10 : 8;
key.shadow.blurSamples = 24;
key.shadow.bias = sky ? -0.0002 : -0.0004;
key.shadow.normalBias = 0.01;
const rim = new THREE.DirectionalLight(sky ? 0xffffff : 0xdfe8ff, sky ? 0.35 : 0.9);
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

// The raised deck, as the photos show gear: a painted ply riser just wider than the piece, an aluminium frame round
// its top edge and a black drape hanging from it, with the place behind and below it out of focus. No sheet joints.
const deckLook = plain ? { material: new THREE.MeshStandardMaterial({ color: 0x2b2b2c, roughness: 0.8 }), ready: Promise.resolve() } : surface("ply", { base: "/textures/" });
if (!plain) deckLook.material.color.setHex(0x34332f);
// matte under the sky: a painted deck is flat, and a glossy one reads as brushed metal
deckLook.material.roughness = sky ? 0.95 : 0.75;
// and under it the grain is painted over: no colour streaks, only a faint relief from the wood under the paint (more reads as brushed metal at a slant)
if (sky && !plain) void deckLook.ready.then(() => {
  const m = deckLook.material;
  m.map = m.roughnessMap = null;
  m.roughness = 0.95;
  m.color.setHex(0x3a3936);
  m.normalScale.setScalar(0.12);
  m.envMapIntensity = 0.7;
  m.needsUpdate = true;
});
const frameLook = new THREE.MeshStandardMaterial({ color: 0x55575a, metalness: 0.8, roughness: 0.55 });
const drapeLook = new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 1 });
const deck = new THREE.Group();
scene.add(deck);
const FRAME = 0.04, DROP = 2.5, PLEAT = 0.14;
/** Rebuilds the deck for a footprint `box`: its top at y = 0, `margin` metres of deck past the piece on every side. */
function deckFor(box: THREE.Box3, margin: number) {
  for (const m of deck.children as THREE.Mesh[]) m.geometry.dispose();
  deck.clear();
  const size = box.getSize(new THREE.Vector3()), at = box.getCenter(new THREE.Vector3()), w = size.x + 2 * margin, d = size.z + 2 * margin;
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, turn = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(at.x + x, y, at.z + z);
    mesh.rotation.y = turn;
    mesh.receiveShadow = true;
    deck.add(mesh);
  };
  // the top: UVs in metres, so the grain under the paint is at its real size
  const top = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), uv = top.getAttribute("uv");
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w, uv.getY(k) * d);
  add(top, deckLook.material, 0, 0, 0);
  for (const [run, off, turn] of [[w, d / 2, 0], [w, d / 2, Math.PI], [d, w / 2, Math.PI / 2], [d, w / 2, -Math.PI / 2]] as const) {
    const x = Math.sin(turn) * off, z = Math.cos(turn) * off;
    add(new THREE.BoxGeometry(run + 0.03, FRAME, 0.015), frameLook, x, -FRAME / 2 + 0.001, z, turn); // 1 mm proud: flush, it fights the top for the same depth
    // the drape: pleats that hang straight and open a little towards the floor
    const cloth = new THREE.PlaneGeometry(run, DROP, Math.ceil((run / PLEAT) * 12), 4), pos = cloth.getAttribute("position");
    for (let k = 0; k < pos.count; k++) {
      const fall = 0.5 - pos.getY(k) / DROP;
      // set 16 mm back, so no pleat comes through the frame
      pos.setZ(k, Math.sin((pos.getX(k) / PLEAT) * 2 * Math.PI) * (0.008 + 0.025 * fall) - 0.016);
    }
    cloth.computeVertexNormals();
    add(cloth, drapeLook, x, -FRAME / 2 - DROP / 2, z, turn);
  }
}
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

/** `dance-stack`: the stack as the photos show one, two long F221 bins side by side and three columns of mid-bass and top
 * on them, the outer columns splayed out. */
function danceStack(): THREE.Group {
  const g = new THREE.Group(), sh = GEAR_SIZES["horn-sub-21"][1], bh = GEAR_SIZES["stack-mid-bass"][1];
  const [bw] = GEAR_SIZES["horn-sub-21"];
  for (const s of [-1, 1]) { const bin = gear("horn-sub-21", { look }); bin.position.x = (s * bw) / 2; g.add(bin); }
  for (const k of [-1, 0, 1]) {
    const col = new THREE.Group();
    col.position.set(k * 1.05, sh, k ? -0.05 : 0);
    col.rotation.y = -k * 0.1;
    const mb = gear("stack-mid-bass", { look }), mh = gear("stack-mid-high", { look });
    mh.position.y = bh;
    col.add(mb, mh);
    g.add(col);
  }
  return g;
}

/** `<id>~exploded`: a box built piece by piece (`gearPieces`) pulled apart, each piece forward of the last in the order
 * it goes in; `<id>~<piece>`: that piece alone, where it sits in the box. */
function pieces(name: string): THREE.Group {
  const [id, which] = name.split("~") as [GearId, string], g = new THREE.Group();
  for (const [i, p] of (gearPieces(id, { look }) ?? []).entries()) {
    if (which !== "exploded" && which !== p.name) continue;
    if (which === "exploded") p.group.position.z = i * 0.22;
    g.add(p.group);
  }
  return g;
}
/** Pieces as meshes, a mesh per piece in the look's material for its slot. */
const meshes = (ps: Piece[]) => ps.map((p) => { const m = new THREE.Mesh(p.geo, look[p.slot as keyof typeof look]); m.castShadow = m.receiveShadow = true; return m; });

/** `connectors`: every connector (@rustybuns/util/connectors) on a panel plate standing up, each socket with its cable's
 * plug under it turned nose-first toward you (its pins or holes and its latch showing), a row per kind (speaker, signal, mains and the rest), so the close shot can be
 * read against the makers' photos. An XLR shows both genders. */
function connectorBoard(): THREE.Group {
  const g = new THREE.Group(), rows: [ConnectorType, Gender][][] = [[], [], []];
  for (const t of CONNECTOR_TYPES) {
    const c = CONNECTORS[t], row = c.carries === "speaker" ? 0 : c.carries === "signal" ? 1 : 2;
    for (const gender of t === "xlr3" ? (["female", "male"] as const) : [c.genders.includes("male") && c.genders.length === 1 ? "male" : c.genders.includes("female") ? "female" : c.genders[0]!]) rows[row]!.push([t, gender]);
  }
  const step = 0.075, wide = Math.max(...rows.map((r) => r.length)) * step;
  // a pale plate, so the black sockets read on it
  const plate = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.04, rows.length * 0.13 + 0.03, 0.006), new THREE.MeshStandardMaterial({ color: 0x9a9ea4, roughness: 0.6, metalness: 0.2 }));
  plate.position.set(0, 0.06 + (rows.length * 0.13) / 2, -0.003);
  plate.receiveShadow = true;
  g.add(plate);
  rows.forEach((row, r) => row.forEach(([t, gender], i) => {
    const at = new THREE.Vector3(-wide / 2 + step * (i + 0.5), 0.06 + (rows.length - r - 0.5) * 0.13 + 0.025, 0);
    const sock = new THREE.Group(), plug = new THREE.Group();
    sock.add(...meshes(socketPieces(t, gender)));
    plug.add(...meshes(plugPieces(t, gender)));
    sock.position.copy(at);
    plug.position.copy(at).add(new THREE.Vector3(0, -0.055, 0.07));
    plug.rotation.y = Math.PI;
    g.add(sock, plug);
  }));
  return g;
}

const PIECE_IDS = GEAR_IDS.flatMap((id) => { const p = gearPieces(id); return p ? [`${id}~exploded`, ...p.map((q) => `${id}~${q.name}`)] : []; });

async function show(id: string, angle: Angle) {
  if (shown) scene.remove(shown);
  shown = id === "dance-stack" ? danceStack() : id === "connectors" ? connectorBoard() : id.includes("~") ? pieces(id) : gear(id as GearId, { look, height: 1.6 });
  scene.add(shown);
  shown.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(shown), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const view = angle === "panel" && id === "connectors" ? "straight" : angle;
  const [az, el] = [ANGLES[view][0], (sky ? LEVEL[view] : undefined) ?? ANGLES[view][1]].map((d) => (d * Math.PI) / 180) as [number, number];
  const far = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  let dist = angle === "close" ? far * 0.4 : far;
  // the panel shot aims at the middle of the jacks (or the board's face) from 40 cm
  const jacks = shown.children.filter((o) => o.name.startsWith("jack:")), panelAt = jacks.length ? jacks.reduce((a, o) => a.add(o.position), new THREE.Vector3()).divideScalar(jacks.length) : c;
  if (angle === "panel") dist = id === "connectors" ? far * 0.75 : 0.4;
  const aim = angle === "close" ? c.clone().lerp(box.max, 0.62) : angle === "panel" ? panelAt : c;
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
  deckFor(box, Math.max(0.15, r * 0.3));
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

Object.assign(window, { turntable: { ids: [...GEAR_IDS, "dance-stack", "connectors", ...PIECE_IDS], angles: ["front", "side", "back", "close"], show, ready: true, look: () => look, ao, contact, key } });
