// Q Amp on a stage (#4570): the clear head on the clear cabinet, the pedalboard on the
// floor in front, the stage screens as LED walls behind and two lights from the rig
// above, in three.js. Everything is made here in code, in metres.
//
// The acrylic refracts (a physical material with transmission), each preamp tube's
// filament glows with its stage's swing, the power tubes with the output, the cones
// push out with it, the warm light pulses with the low mids and the cool one with the
// highs. The knobs stay on the page's DOM panel under the stage; this only shows.
//
// `buildStage` is the scene and its per-frame update, with no renderer, so a test can
// drive it in Bun. `mountStage` adds the WebGL renderer, the camera's parallax and the
// resize; it returns null when the browser has no WebGL, and the page stays 2D.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** What the stage shows this frame, each 0 to 1. */
export interface StageFrame {
  /** Each preamp tube's glow, V1 first. */
  pre: number[];
  /** The power tubes' glow (all alike: they share the output). */
  power: number;
  /** How far the cones are pushed out. */
  push: number;
  /** The low mids and the highs, for the warm and the cool light. */
  lowMid: number;
  high: number;
}

export interface StageAmp { preTubes: number; powerTubes: number; pedals: string[] }

// The sizes: a 2x12 cabinet and a head on it, a pedalboard, two walls 3 m up.
const CAB = { w: 0.76, h: 0.6, d: 0.3 };
const HEAD = { w: 0.76, h: 0.27, d: 0.26 };
const CONE_R = 0.135;
const WALL = { y: 1.4, z: -2.2, h: 1.55 };

const PEDAL_COLOURS: Record<string, number> = { drive: 0x2f9e5b, dist: 0xe0b020, fuzz: 0xc8422f, bench: 0x5a6470, bbd: 0x3b7fd0, tape: 0xb8b0a0, spring: 0x8a5cc8 };

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Makes the tubes and pedals for this amp (a new amp has its own count of tubes). */
  setAmp(amp: StageAmp): void;
  /** The LED walls: one wide or two half, each showing a canvas (or nothing, in a test). */
  setWalls(sources: (HTMLCanvasElement | null)[]): void;
  update(f: StageFrame): void;
  state(): { tubes: { pre: number; power: number }; filaments: number[]; cones: number; push: number; lights: { warm: number; cool: number }; walls: number; pedals: string[] };
  dispose(): void;
}

const filamentGlow = (g: number) => 0.15 + 4 * g * g;
const WARM_BASE = 6, COOL_BASE = 4, BAND_GAIN = 40;

export function buildStage(amp: StageAmp): Stage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050608);
  scene.fog = new THREE.Fog(0x050608, 5, 11);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.05, 30);
  camera.position.set(0, 1.05, 2.9);
  camera.lookAt(0, 0.52, 0);

  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const acrylic = keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 0.04, thickness: 0.012, ior: 1.49, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide }));
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: 0xf4f6ff, transmission: 1, roughness: 0.02, thickness: 0.002, ior: 1.5 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.9, roughness: 0.32 }));
  const black = keep(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85 }));
  const paper = keep(new THREE.MeshStandardMaterial({ color: 0x23201c, roughness: 0.95, side: THREE.DoubleSide }));
  const box = (w: number, hh: number, d: number) => keep(new THREE.BoxGeometry(w, hh, d));
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

  // The stage floor and the riser the rig stands on.
  const floor = mesh(keep(new THREE.PlaneGeometry(14, 9)), keep(new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.55, metalness: 0.1 })));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, mesh(box(1.7, 0.08, 1.0), black, 0, 0.04, -0.05));

  // The cabinet: an acrylic shell, a black baffle you see through it, two cones on it.
  const cab = new THREE.Group();
  cab.position.y = 0.08;
  cab.add(mesh(box(CAB.w, CAB.h, CAB.d), acrylic, 0, CAB.h / 2, 0));
  cab.add(mesh(box(CAB.w - 0.03, CAB.h - 0.03, 0.012), black, 0, CAB.h / 2, 0.04));
  const coneGeo = keep(new THREE.CylinderGeometry(CONE_R, 0.035, 0.07, 40, 1, true));
  const capGeo = keep(new THREE.SphereGeometry(0.035, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const rimGeo = keep(new THREE.TorusGeometry(CONE_R + 0.008, 0.008, 8, 48));
  const cones: THREE.Group[] = [];
  for (const x of [-0.18, 0.18]) {
    const c = new THREE.Group();
    const cone = mesh(coneGeo, paper, 0, 0, 0.035);
    cone.rotation.x = -Math.PI / 2;
    const cap = mesh(capGeo, black, 0, 0, 0.005);
    cap.rotation.x = Math.PI / 2;
    c.add(cone, cap);
    c.position.set(x, CAB.h / 2, 0.012);
    c.userData.rest = c.position.z;
    cab.add(c, mesh(rimGeo, steel, x, CAB.h / 2, 0.082));
    cones.push(c);
  }
  scene.add(cab);

  // The head: an acrylic shell over a steel chassis the tubes stand on, a front panel.
  const head = new THREE.Group();
  head.position.y = 0.08 + CAB.h + 0.005;
  head.add(mesh(box(HEAD.w, HEAD.h, HEAD.d), acrylic, 0, HEAD.h / 2, 0));
  head.add(mesh(box(HEAD.w - 0.04, 0.03, HEAD.d - 0.05), steel, 0, 0.06, -0.01));
  head.add(mesh(box(HEAD.w - 0.03, 0.055, 0.01), black, 0, 0.035, HEAD.d / 2 - 0.015));
  const knobGeo = keep(new THREE.CylinderGeometry(0.011, 0.012, 0.016, 20));
  for (let i = 0; i < 7; i++) {
    const k = mesh(knobGeo, steel, -0.27 + i * 0.075, 0.035, HEAD.d / 2 - 0.002);
    k.rotation.x = Math.PI / 2;
    head.add(k);
  }
  const tubes = new THREE.Group();
  head.add(tubes);
  // One warm light in the head, as bright as the tubes are on average.
  const tubeLight = new THREE.PointLight(0xff8a3a, 0, 0.9, 2);
  tubeLight.position.set(0, 0.16, 0);
  head.add(tubeLight);
  scene.add(head);

  // The pedalboard on the floor in front.
  const board = new THREE.Group();
  board.position.set(0, 0.025, 0.75);
  board.rotation.x = -0.12;
  scene.add(board);

  // The lights from the rig above: warm with the low mids, cool with the highs; a dim fill.
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x080808, 0.35));
  const spot = (colour: number, x: number) => {
    const s = new THREE.SpotLight(colour, 0, 9, 0.42, 0.55, 1.2);
    s.position.set(x, 3.6, 2.2);
    s.target.position.set(0, 0.6, 0);
    scene.add(s, s.target);
    return s;
  };
  const warm = spot(0xffb36a, -1.7), cool = spot(0x7ec8ff, 1.7);
  const back = new THREE.DirectionalLight(0xffe2c0, 0.6);
  back.position.set(0, 3, -3);
  scene.add(back);

  // The LED walls, rebuilt when the layout changes.
  const walls = new THREE.Group();
  scene.add(walls);
  let wallTextures: THREE.CanvasTexture[] = [];
  const clearWalls = () => {
    for (const o of walls.children) if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.material instanceof THREE.Material) o.material.dispose(); }
    for (const t of wallTextures) t.dispose();
    walls.clear();
    wallTextures = [];
  };

  let filaments: THREE.MeshStandardMaterial[] = [], preCount = 0, powerCount = 0, pedalIds: string[] = [];
  const clearTubes = () => {
    for (const m of filaments) m.dispose();
    filaments = [];
    tubes.clear();
  };
  const plateGeo = keep(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 12));
  const filGeo = keep(new THREE.CylinderGeometry(0.003, 0.003, 0.045, 6));
  const preGlass = keep(new THREE.CylinderGeometry(0.011, 0.011, 0.075, 20));
  const powGlass = keep(new THREE.CylinderGeometry(0.018, 0.016, 0.12, 24));
  const boardGeo = box(1, 0.03, 0.32), pedalGeo = box(0.09, 0.045, 0.13);
  const tube = (x: number, power: boolean) => {
    const t = new THREE.Group(), hh = power ? 0.12 : 0.075;
    // A filament's own material, disposed with its tube (clearTubes), not with the stage.
    const fil = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff6a1a, emissiveIntensity: filamentGlow(0), roughness: 0.6 });
    filaments.push(fil);
    t.add(mesh(power ? powGlass : preGlass, glass, 0, hh / 2, 0), mesh(plateGeo, steel, 0, hh / 2, 0), mesh(filGeo, fil, 0, hh / 2, 0));
    t.position.set(x, 0.075, -0.03);
    tubes.add(t);
  };

  const setAmp = (a: StageAmp) => {
    clearTubes();
    preCount = a.preTubes; powerCount = a.powerTubes;
    const n = preCount + powerCount, gap = 0.04, step = 0.055;
    const width = (n - 1) * step + gap;
    let x = -width / 2;
    for (let i = 0; i < preCount; i++, x += step) tube(x, false);
    x += gap - step + 0.01;
    for (let i = 0; i < powerCount; i++, x += step) tube(x + 0.01, true);
    // The board: a pedal per id, in chain order.
    for (const o of board.children) if (o instanceof THREE.Mesh && o.material !== black && o.material instanceof THREE.Material) o.material.dispose();
    board.clear();
    pedalIds = [...a.pedals];
    const bw = Math.max(0.6, pedalIds.length * 0.13 + 0.06);
    const plank = mesh(boardGeo, black);
    plank.scale.x = bw;
    board.add(plank);
    pedalIds.forEach((id, i) => {
      const p = mesh(pedalGeo, new THREE.MeshStandardMaterial({ color: PEDAL_COLOURS[id] ?? 0x666b72, roughness: 0.45, metalness: 0.3 }), -bw / 2 + 0.095 + i * 0.13, 0.037, 0);
      board.add(p);
    });
  };

  const setWalls = (sources: (HTMLCanvasElement | null)[]) => {
    clearWalls();
    const n = Math.max(1, sources.length), total = 5.6, gap = 0.12, w = (total - gap * (n - 1)) / n;
    sources.forEach((src, i) => {
      let mat: THREE.MeshBasicMaterial;
      if (src) {
        const t = new THREE.CanvasTexture(src);
        t.colorSpace = THREE.SRGBColorSpace;
        wallTextures.push(t);
        mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
      } else mat = new THREE.MeshBasicMaterial({ color: 0x05080a });
      const wall = mesh(new THREE.PlaneGeometry(w, WALL.h), mat, -total / 2 + w / 2 + i * (w + gap), WALL.y, WALL.z);
      walls.add(wall);
    });
  };

  let push = 0, warmOn = 0, coolOn = 0;
  const update = (f: StageFrame) => {
    filaments.forEach((m, i) => { m.emissiveIntensity = filamentGlow(i < preCount ? f.pre[i] ?? 0 : f.power); });
    const all = [...f.pre.slice(0, preCount), ...Array.from({ length: powerCount }, () => f.power)];
    tubeLight.intensity = all.length ? (0.05 + 0.6 * all.reduce((a, b) => a + b, 0) / all.length) : 0;
    push = Math.max(0, Math.min(1, f.push));
    for (const c of cones) c.position.z = c.userData.rest + push * 0.014;
    warm.intensity = warmOn = WARM_BASE + BAND_GAIN * f.lowMid * f.lowMid;
    cool.intensity = coolOn = COOL_BASE + BAND_GAIN * f.high * f.high;
    for (const t of wallTextures) t.needsUpdate = true;
  };

  setAmp(amp);
  setWalls([null]);

  return {
    scene, camera, setAmp, setWalls, update,
    state: () => ({
      tubes: { pre: preCount, power: powerCount }, filaments: filaments.map((m) => +m.emissiveIntensity.toFixed(3)), cones: cones.length,
      push: +push.toFixed(3), lights: { warm: +warmOn.toFixed(2), cool: +coolOn.toFixed(2) }, walls: walls.children.length, pedals: [...pedalIds],
    }),
    dispose: () => { clearWalls(); clearTubes(); for (const o of owned) o.dispose(); },
  };
}

export interface MountedStage extends Stage {
  /** Draws a frame (the page calls it from its own requestAnimationFrame). */
  render(): void;
  readonly canvas: HTMLCanvasElement;
}

/** The stage in `host`, or null when there is no WebGL. The camera drifts a little with the pointer. */
export function mountStage(host: HTMLElement, amp: StageAmp): MountedStage | null {
  const canvas = document.createElement("canvas");
  canvas.className = "stage3d-canvas";
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const stage = buildStage(amp);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  stage.scene.environment = env;
  stage.scene.environmentIntensity = 0.25;
  host.append(canvas);

  const size = () => {
    const w = host.clientWidth, hh = host.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh, false);
    stage.camera.aspect = w / hh;
    // A narrow screen steps back so the whole rig fits.
    stage.camera.position.z = w / hh < 1 ? 4.2 : 2.9;
    stage.camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(size);
  ro.observe(host);
  size();

  // Parallax: the camera eases towards where the pointer is, a few centimetres either way.
  const aim = { x: 0, y: 0 }, at = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    aim.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    aim.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  host.addEventListener("pointermove", onMove);
  const baseY = stage.camera.position.y;

  return {
    ...stage,
    canvas,
    render: () => {
      at.x += (aim.x - at.x) * 0.06; at.y += (aim.y - at.y) * 0.06;
      stage.camera.position.x = at.x * 0.28;
      stage.camera.position.y = baseY - at.y * 0.12;
      stage.camera.lookAt(0, 0.52, 0);
      renderer.render(stage.scene, stage.camera);
    },
    dispose: () => {
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      stage.dispose();
      env.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
