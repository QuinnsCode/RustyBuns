// An open-air party, drawn (room.ts `outdoor`; Desert Gathering, rooms/desert-gathering.ts): the night in place of
// look.ts's lit room. A sky fading from deep blue overhead to a dusty glow on the horizon, stars and a full moon, the
// ranges standing black against it; a clearing of sand in the Mojave, under the moon's cold light; the speaker stacks
// from Sound Guy Simulator's desert night (packages/models gear: a 21" horn bin, a mid-bass horn and a mid-high horn on
// a sand dolly); a truss with moving heads that sweep the floor and lasers that fan over the crowd, for a party that
// has one; tall hand-carved wooden poles with a vine cut up each one and a lantern hung from its crook, the flames never
// quite still; the generator off to one side with its jerry cans; Joshua trees, creosote, barrel cactus, beavertail and
// granite boulders out in the dark. On high a bloom, so the lanterns glow. Every light moves on the clock it's given
// (`render`), the same for everyone.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@rustybuns/util";
import { van } from "@rustybuns/models/van";
import { gear, gearLook, type GearId, type GearLook } from "@rustybuns/models/gear";
import { SYSTEMS, stackWidth } from "@rustybuns/gear";
import { rigStacks, roomRig } from "./pa-room.ts";
import { clothTime, rugs } from "./tapestry.ts";
import { barrel, boulder, creosote, joshua, pear } from "@rustybuns/models/flora";
import { thingBox, type Outdoor, type StudioDef } from "./room.ts";
import { metreUV, surface, type Look, type Quality } from "./look.ts";

/** The beams' colours, cycling across the heads: magenta, cyan, amber, violet. */
export const BEAMS = ["#ff2bd6", "#22e3ff", "#ffb02b", "#8a5bff"] as const;
/** Where the lasers fan from on the truss, and how many. */
const LASERS = 10;

/** The ground's height at (x, z): flat where people walk, rising into dunes past `flat` metres from the middle. */
export function duneAt(x: number, z: number, flat: number): number {
  const r = Math.hypot(x, z), k = Math.min(1, Math.max(0, (r - flat) / 40));
  const swell = Math.sin(x * 0.045 + Math.cos(z * 0.03) * 2) * 0.5 + Math.sin(z * 0.06 + x * 0.02) * 0.5;
  return k * k * (4 + 5 * swell);
}

/** How high the far ranges stand at compass angle `a` (radians), metres: a few ridges on top of each other, never flat. */
export function ridgeAt(a: number, seed: number): number {
  return Math.max(3, 11 + 8 * Math.sin(3 * a + seed) + 5 * Math.sin(7 * a + seed * 2.3) + 3 * Math.sin(13 * a + seed * 0.7) + 1.8 * Math.sin(29 * a + seed * 5.1));
}

/** A dance stack (packages/models gear): a horn bin, a mid-bass horn and a mid-high horn on a sand dolly, standing at
 *  (x, z) with its front turned `yaw` from +z. Desert Gathering's, and the pair a room with decks but no PA gets (pa-room.ts). */
export function paStack(at: readonly [number, number], yaw: number, look: GearLook = gearLook(), ids: readonly string[] = SYSTEMS["dance-stack"].stack): THREE.Group {
  const st = new THREE.Group();
  st.position.set(at[0], 0, at[1]); st.rotation.y = yaw;
  let y = 0;
  for (const id of ids) {
    const g = gear(id as GearId, { look });
    g.position.y = y;
    st.add(g);
    y += new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y;
  }
  return st;
}

/** Indoors a DJ table's PA is a club's: an 18" sub on the floor with a powered 12" top on a pole out of its socket,
 *  the top's horn at about 1.9 m, facing `yaw` from +z. */
export function clubStack(at: readonly [number, number], yaw: number, look: GearLook = gearLook()): THREE.Group {
  const st = new THREE.Group(), sub = gear("sub-18", { look }), top = gear("top-12-powered", { look });
  st.position.set(at[0], 0, at[1]); st.rotation.y = yaw;
  const socket = sub.getObjectByName("pole")?.position.y ?? GEAR_SIZE_SUB_H, pole = 0.62;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, pole, 12), look.metal);
  rod.position.y = socket + pole / 2;
  top.position.y = socket + pole - 0.05;
  st.add(sub, rod, top);
  return st;
}
const GEAR_SIZE_SUB_H = 0.7;

/** The full moon's face as you see it, a flat disc (a full moon shows almost no shading at its edge): the pale
 *  highlands, the dark seas in their places (a big one upper left, a chain upper right, the wide one down the left),
 *  and one young crater low down with its bright rays, painted once onto a canvas. */
function moonFace(): THREE.CanvasTexture {
  const n = 256, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!, r = mulberry32(1969), R = n / 2 - 2;
  g.save(); g.beginPath(); g.arc(n / 2, n / 2, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#ece7d8"; g.fillRect(0, 0, n, n);
  const sea = (u: number, v: number, rx: number, ry: number, a = 0.62) => {
    const gr = g.createRadialGradient(u * n, v * n, 0, u * n, v * n, Math.max(rx, ry) * n);
    gr.addColorStop(0, `rgba(118,118,122,${a})`); gr.addColorStop(0.75, `rgba(132,132,136,${a * 0.6})`); gr.addColorStop(1, "rgba(150,150,150,0)");
    g.save(); g.translate(u * n, v * n); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-u * n, -v * n);
    g.fillStyle = gr; g.beginPath(); g.arc(u * n, v * n, Math.max(rx, ry) * n, 0, Math.PI * 2); g.fill(); g.restore();
  };
  sea(0.36, 0.33, 0.14, 0.12); sea(0.58, 0.3, 0.08, 0.08); sea(0.66, 0.43, 0.1, 0.08); sea(0.74, 0.36, 0.05, 0.05, 0.5);
  sea(0.26, 0.5, 0.11, 0.18, 0.5); sea(0.42, 0.6, 0.08, 0.06, 0.45); sea(0.6, 0.6, 0.06, 0.05, 0.4); sea(0.8, 0.5, 0.04, 0.06, 0.5);
  // the rayed crater low down, and its rays running out across the highlands
  const [tx, ty] = [0.48 * n, 0.82 * n];
  g.strokeStyle = "rgba(255,255,250,0.22)"; g.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, l = (0.15 + r() * 0.35) * n; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + Math.cos(a) * l, ty + Math.sin(a) * l); g.stroke(); }
  g.fillStyle = "rgba(255,255,252,0.9)"; g.beginPath(); g.arc(tx, ty, 2.2, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,250,${0.08 + r() * 0.2})`; g.beginPath(); g.arc(r() * n, r() * n, 0.5 + r() * 1.2, 0, Math.PI * 2); g.fill(); }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft round glow, bright in the middle and gone at the edge, for the moon's halo. */
function glowDisc(): THREE.CanvasTexture {
  const c = document.createElement("canvas"), n = 128;
  c.width = c.height = n;
  const g = c.getContext("2d")!, gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.12, "rgba(255,255,255,0.45)"); gr.addColorStop(0.4, "rgba(255,255,255,0.1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}

/**
 * A fire pit about a metre across: eleven stones in a ring, five split logs leant into a teepee (charred where they
 * meet), a glowing bed of embers, three flames that sway and stretch on their own beats, and a warm light that breathes
 * with them. `tick(t)` moves the flames and the light.
 */
export function firePit(seed: number): { group: THREE.Group; tick: (t: number) => void } {
  const g = new THREE.Group(), rnd = mulberry32(seed);
  g.name = "fire-pit";
  const stone = new THREE.MeshStandardMaterial({ color: "#5e574f", roughness: 0.97, flatShading: true }), stoneGeo = new THREE.DodecahedronGeometry(0.11, 1);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.15, s = new THREE.Mesh(stoneGeo, stone);
    s.position.set(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5);
    s.scale.set(0.9 + rnd() * 0.5, 0.55 + rnd() * 0.3, 0.8 + rnd() * 0.4);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(s);
  }
  // the bed: ash grey at the edge, embers in the middle
  const bed = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#2b2522", roughness: 1 }));
  bed.position.y = 0.01; g.add(bed);
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#1a0a04", emissive: "#ff4a10", emissiveIntensity: 1.6, roughness: 1 }));
  embers.position.y = 0.015; g.add(embers);
  // the logs: bark outside, charred toward the tips where they meet over the embers
  const bark = surface("wood", "#4d3826"), char = new THREE.MeshStandardMaterial({ color: "#120c0a", emissive: "#7a1e06", emissiveIntensity: 0.6, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.4, lean = 0.5 + rnd() * 0.1, len = 0.6 + rnd() * 0.12, r = 0.035 + rnd() * 0.015;
    const log = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len * 0.65, 8), bark);
    body.position.y = len * 0.325;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len * 0.35, 8), char);
    tip.position.y = len * 0.825;
    log.add(body, tip);
    log.position.set(Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34);
    // lean in toward the middle, so the tips meet over the embers
    const toward = new THREE.Vector3(-Math.cos(a) * Math.sin(lean), Math.cos(lean), -Math.sin(a) * Math.sin(lean));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toward);
    g.add(log);
  }
  // the flames: soft cones of additive glow, yellow inside orange
  const flameMat = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const flames: { m: THREE.Mesh; base: number; ph: number; hz: number }[] = [];
  for (const [i, [c, o, h, w]] of ([["#ff5a14", 0.5, 0.85, 0.2], ["#ff9a2a", 0.65, 0.66, 0.14], ["#ffe08a", 0.8, 0.44, 0.08]] as const).entries()) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 10, 1, true).translate(0, h / 2, 0), flameMat(c, o));
    m.position.y = 0.04;
    m.renderOrder = 3 + i;
    g.add(m);
    flames.push({ m, base: h, ph: rnd() * 6, hz: 1.7 + rnd() * 1.3 });
  }
  const light = new THREE.PointLight("#ff8a3a", 8, 12, 1.8);
  light.position.y = 0.45; g.add(light);
  return {
    group: g,
    tick(t) {
      let all = 0;
      for (const f of flames) {
        const k = 0.8 + 0.18 * Math.sin(t * f.hz * 2 + f.ph) + 0.1 * Math.sin(t * f.hz * 5.3 + f.ph * 2);
        f.m.scale.set(1 - (k - 1) * 0.5, k, 1 - (k - 1) * 0.5);
        f.m.rotation.set(0.08 * Math.sin(t * 1.3 + f.ph), t * 0.6 + f.ph, 0.08 * Math.cos(t * 1.1 + f.ph));
        all += k;
      }
      light.intensity = 8 * (all / flames.length) * (0.92 + 0.08 * Math.sin(t * 17.3));
    },
  };
}

/** How bright lantern `i`'s flame is at time `t` seconds, about 1: a slow breath and a quick flutter, each lantern out of step. */
export function flameAt(i: number, t: number): number {
  return 0.86 + 0.09 * Math.sin(t * 2.1 + i * 1.7) + 0.05 * Math.sin(t * 9.3 + i * 4.1) * Math.sin(t * 3.7 + i);
}

/**
 * A lantern pole, carved by hand: a crooked staff 3.3 m tall that curls over into a crook at the top, a vine cut in a
 * spiral up it, and from the crook a lantern on a cord: a little wooden house with a pointed roof and paper panes.
 * Foot at the origin, the crook reaching toward +x. `wood` is everything carved, `glow` the lit panes.
 */
export function lanternPole(seed: number): { wood: THREE.BufferGeometry; glow: THREE.BufferGeometry; flame: THREE.Vector3 } {
  const r = mulberry32(seed), wob = () => (r() - 0.5) * 0.12;
  const staff = new THREE.CatmullRomCurve3([[0, 0, 0], [wob(), 1, wob()], [wob(), 2, wob()], [0, 2.9, 0], [0.18, 3.28, 0], [0.42, 3.34, 0], [0.58, 3.16, 0], [0.52, 2.98, 0], [0.44, 3.02, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const wood: THREE.BufferGeometry[] = [new THREE.TubeGeometry(staff, 48, 0.05, 7)];
  // the vine: a thinner strand wound round the staff from the knee to the shoulder
  const vine: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) { const u = 0.1 + (i / 60) * 0.6, a = i * 0.42, c = staff.getPointAt(u); vine.push(new THREE.Vector3(c.x + Math.cos(a) * 0.062, c.y, c.z + Math.sin(a) * 0.062)); }
  wood.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vine), 120, 0.014, 5));
  // two turned bands and a foot, so it reads as made, not found
  for (const u of [0.07, 0.66]) { const c = staff.getPointAt(u); wood.push(new THREE.TorusGeometry(0.062, 0.016, 6, 12).rotateX(Math.PI / 2).translate(c.x, c.y, c.z)); }
  wood.push(new THREE.CylinderGeometry(0.075, 0.1, 0.16, 8).translate(0, 0.08, 0));
  // the lantern, hung under the crook's tip
  const x = 0.52, base = 2.28, h = 0.3, half = 0.11;
  wood.push(new THREE.CylinderGeometry(0.006, 0.006, 2.98 - (base + h + 0.16), 5).translate(x, (2.98 + base + h + 0.16) / 2, 0));
  wood.push(new THREE.BoxGeometry(half * 2 + 0.04, 0.025, half * 2 + 0.04).translate(x, base, 0));
  wood.push(new THREE.BoxGeometry(half * 2 + 0.04, 0.02, half * 2 + 0.04).translate(x, base + h, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(new THREE.BoxGeometry(0.022, h, 0.022).translate(x + sx * half, base + h / 2, sz * half));
  // a lattice bar across each pane, a third of the way up
  for (const a of [0, Math.PI / 2]) wood.push(new THREE.BoxGeometry(half * 2, 0.014, 0.008).translate(0, 0, half).rotateY(a).translate(x, base + h * 0.36, 0), new THREE.BoxGeometry(half * 2, 0.014, 0.008).translate(0, 0, -half).rotateY(a).translate(x, base + h * 0.36, 0));
  wood.push(new THREE.CylinderGeometry(0.012, half * 1.75, 0.16, 4).rotateY(Math.PI / 4).translate(x, base + h + 0.09, 0));
  const glow = new THREE.BoxGeometry(half * 2 - 0.02, h - 0.02, half * 2 - 0.02).translate(x, base + h / 2, 0);
  return { wood: mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g))!, glow, flame: new THREE.Vector3(x, base + h / 2, 0) };
}

/** Where a head on the truss points at time `t` seconds: pan and tilt in radians, each head out of step with the next. */
export function headAim(i: number, n: number, t: number): { pan: number; tilt: number } {
  const ph = (i / n) * Math.PI * 2;
  return { pan: Math.sin(t * 0.6 + ph) * 0.7, tilt: 0.55 + Math.sin(t * 0.43 + ph * 1.7) * 0.3 };
}

export function openAir(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, def: StudioDef, quality: Quality, kit: GearLook = gearLook()): Look {
  const out: Outdoor = def.outdoor ?? { stacks: [], seed: 1 };
  const high = quality === "high";
  // a room's lens stops at 80 m; out here the sky and the dunes are further than that
  camera.far = 400; camera.updateProjectionMatrix();
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(high ? 1.5 : 1, devicePixelRatio));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12; // a little sheen on the metal, no room light
  pm.dispose();

  const group = new THREE.Group();
  group.name = "open-air";
  scene.add(group);
  const rnd = mulberry32(out.seed);
  const horizon = new THREE.Color("#1c1a34"), zenith = new THREE.Color("#03040c");
  scene.background = zenith;
  scene.fog = new THREE.Fog(horizon, 60, 200);

  // ---- the sky: a dome shaded from the horizon's glow to the deep blue overhead, paler round the full moon; the stars
  // as a full moon leaves them (the faint ones washed out near it, the bright ones in their colours); the moon with
  // its dark seas and a soft glow round it
  const moonAt = new THREE.Vector3(-70, 62, -120), moonDir = moonAt.clone().normalize();
  const dome = new THREE.SphereGeometry(190, 48, 24), col: number[] = [], p = dome.attributes.position, moonSky = new THREE.Color("#3a4a78"), at = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, Math.min(1, p.getY(i) / 190));
    const c = new THREE.Color("#3a2436").lerp(horizon, Math.min(1, k * 6)).lerp(new THREE.Color("#0b0f26"), Math.min(1, k * 2.5)).lerp(zenith, Math.max(0, k * 1.4 - 0.3));
    const near = at.fromBufferAttribute(p, i).normalize().angleTo(moonDir);
    c.lerp(moonSky, 0.55 * Math.exp(-((near / 0.45) ** 2)));
    col.push(c.r, c.g, c.b);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  group.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const TINTS = ["#b8c8ff", "#dfe6ff", "#ffffff", "#fff4dc", "#ffd9a8"].map((h) => new THREE.Color(h));
  const faint: number[] = [], faintCol: number[] = [], bright: number[] = [], brightCol: number[] = [];
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2, y = 0.06 + rnd() * 0.94, r = Math.sqrt(1 - y * y), dir = at.set(Math.cos(a) * r, y, Math.sin(a) * r);
    // brightness: most stars faint, a few bright; the moon's glare and the haze low down put the faint ones out
    const mag = rnd() ** 2.4, glare = Math.exp(-((dir.angleTo(moonDir) / 0.7) ** 2)), haze = Math.min(1, y / 0.25);
    const shown = (1 - mag) * haze * (1 - 0.85 * glare);
    // and none behind the moon's disc (about 2.3 degrees across from here)
    if (shown < 0.12 || dir.angleTo(moonDir) < 0.05) continue;
    const tint = TINTS[Math.floor(rnd() * TINTS.length)]!.clone().multiplyScalar(Math.min(1, 0.3 + shown));
    (mag < 0.97 ? faint : bright).push(dir.x * 180, dir.y * 180, dir.z * 180);
    (mag < 0.97 ? faintCol : brightCol).push(tint.r, tint.g, tint.b);
  }
  for (const [pos, c, size] of [[faint, faintCol, 1.3], [bright, brightCol, 2.4]] as const) {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 })));
  }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonFace(), fog: false, toneMapped: false, transparent: true }));
  moon.position.copy(moonAt); moon.scale.setScalar(12);
  group.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: "#c9d6ff", transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(moonAt).multiplyScalar(1.02); halo.scale.setScalar(70);
  group.add(halo);
  const moonlight = new THREE.DirectionalLight("#9fb2e8", 0.9);
  moonlight.position.copy(moonAt).normalize().multiplyScalar(40);
  moonlight.castShadow = high;
  moonlight.shadow.mapSize.set(2048, 2048);
  Object.assign(moonlight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 });
  moonlight.shadow.bias = -0.0005;
  group.add(moonlight, moonlight.target);
  group.add(new THREE.HemisphereLight("#33406e", "#2a1d14", 0.55));

  // ---- the ranges: two lines of bare mountains all the way round, black against the horizon's glow
  for (const [radius, tall, color, seed] of [[176, 1, "#151329", out.seed % 7], [150, 0.55, "#0c0b17", (out.seed % 11) + 3]] as const) {
    const n = 240, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, -4, z, x, ridgeAt(a, seed) * tall, z);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const ridge = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ridge.setIndex(idx);
    group.add(new THREE.Mesh(ridge, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false })));
  }

  // ---- the ground: sand to the dunes, laid in metres so its ripples come out their real size
  const flat = Math.max(def.size.w, def.size.d) / 2 + 6;
  const ground = new THREE.PlaneGeometry(360, 360, 120, 120).rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, duneAt(gp.getX(i), gp.getZ(i), flat));
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(metreUV(ground), surface("sand", "#a88a66"));
  sand.receiveShadow = true;
  group.add(sand);

  // ---- the stacks: bin, mid-bass horn, mid-high horn, on a sand dolly
  // the boxes in the photo kit's coats and grilles (the page hands in gear-kit.ts's look), as the gear climb shoots them
  const look = kit;
  // ---- the rugs on the sand
  group.add(rugs(out));

  const rig = roomRig(def);
  for (const s of rigStacks(def)) group.add(paStack(s.at, s.yaw, look, rig.stack));

  // ---- the truss, where the party has one: two towers and a span of box truss, the heads hung under it, the lasers on top
  const heads: { yoke: THREE.Group; head: THREE.Group; light: THREE.SpotLight; beam: THREE.Mesh }[] = [];
  const lasers: THREE.Mesh[] = [];
  if (out.truss) {
    const truss = new THREE.Group(), tr = out.truss;
    truss.position.set(tr.at[0], 0, tr.at[1]); truss.rotation.y = tr.yaw;
    group.add(truss);
    const alu = surface("metal", "#c9ccd1");
    const chord = (len: number, along: "x" | "y") => {
      const sec = new THREE.Group(), r = 0.025, off = 0.14;
      for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), alu);
        if (along === "x") { c.rotation.z = Math.PI / 2; c.position.set(0, a * off, b * off); } else c.position.set(a * off, 0, b * off);
        sec.add(c);
      }
      // the zig-zag lacing between the chords, one draw call
      const n = Math.floor(len / 0.3), lace = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), alu, n * 2), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
        const t = -len / 2 + (i + 0.5) * 0.3;
        e.set(along === "x" ? 0 : (i % 2 ? 0.8 : -0.8), 0, along === "x" ? (i % 2 ? 0.8 : -0.8) + Math.PI / 2 : 0);
        q.setFromEuler(e);
        lace.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.compose(along === "x" ? new THREE.Vector3(t, 0, side * off) : new THREE.Vector3(side * off, t, 0), q, new THREE.Vector3(1, 1, 1)));
      }
      sec.add(lace);
      return sec;
    };
    for (const x of [-tr.w / 2, tr.w / 2]) { const tw = chord(tr.h, "y"); tw.position.set(x, tr.h / 2, 0); truss.add(tw); }
    const span = chord(tr.w + 0.3, "x"); span.position.y = tr.h; truss.add(span);

    // the moving heads: a yoke and a head each, a spot light and its beam, seen in the dust
    const n = 6, black = surface("plastic", "#121316");
    const beamGeo = new THREE.CylinderGeometry(0.05, 1.6, 22, 24, 1, true).translate(0, -11, 0);
    for (let i = 0; i < n; i++) {
      const yoke = new THREE.Group();
      yoke.position.set(-tr.w / 2 + 1 + (i * (tr.w - 2)) / (n - 1), tr.h - 0.25, 0.1);
      const arms = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.12), black);
      arms.position.y = -0.1;
      const head = new THREE.Group();
      head.position.y = -0.3;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 18), black);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18).rotateX(Math.PI / 2).translate(0, -0.185, 0), new THREE.MeshBasicMaterial({ color: BEAMS[i % BEAMS.length] }));
      lens.userData.looked = true;
      const color = new THREE.Color(BEAMS[i % BEAMS.length]);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const light = new THREE.SpotLight(color, 160, 30, 0.12, 0.5, 1.6);
      light.position.set(0, -0.2, 0);
      light.target.position.set(0, -10, 0);
      head.add(body, lens, beam, light, light.target);
      yoke.add(arms, head);
      truss.add(yoke);
      heads.push({ yoke, head, light, beam });
    }

    // the lasers: thin green and cyan lines fanning out over the crowd from the top of the truss
    const laserGeo = new THREE.CylinderGeometry(0.012, 0.012, 60, 4).translate(0, 30, 0).rotateX(Math.PI / 2);
    for (let i = 0; i < LASERS; i++) {
      const m = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? "#3dff6a" : "#28d8ff", transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.position.set(0, tr.h + 0.3, 0);
      truss.add(m);
      lasers.push(m);
    }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.4), black);
    box.position.set(0, tr.h + 0.22, 0);
    truss.add(box);
  }

  // ---- the tall lantern poles: three carvings, each pole one of them, none quite the same height or quite upright,
  // its crook reaching the way the room turns it
  const flames: THREE.PointLight[] = [];
  if (out.lanternPoles?.length) {
    const stand = out.lanternPoles;
    const carved = [0, 1, 2].map((k) => lanternPole(out.seed + k * 97));
    const wood = surface("wood", "#8a6844"), paper = new THREE.MeshStandardMaterial({ color: "#2a1606", emissive: "#ffb257", emissiveIntensity: 2.4 });
    const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion();
    carved.forEach((pole, k) => {
      const mine = stand.map((p, i) => ({ p, i })).filter(({ i }) => i % carved.length === k);
      if (!mine.length) return;
      const poles = new THREE.InstancedMesh(pole.wood, wood, mine.length), panes = new THREE.InstancedMesh(pole.glow, paper, mine.length);
      panes.userData.looked = true;
      mine.forEach(({ p: { at: [x, z], yaw }, i }, n) => {
        const size = 1.05 + rnd() * 0.15;
        // the crook reaches toward +x: turned so it reaches the pole's yaw (0 toward +z, as a seat faces)
        e.set((rnd() - 0.5) * 0.06, yaw - Math.PI / 2 + (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.06);
        m.compose(new THREE.Vector3(x, duneAt(x, z, flat) - 0.03, z), q.setFromEuler(e), new THREE.Vector3(size, size, size));
        poles.setMatrixAt(n, m); panes.setMatrixAt(n, m);
        const l = new THREE.PointLight("#ffb060", 12, 14, 1.8);
        l.position.copy(pole.flame).applyMatrix4(m);
        l.userData.i = i;
        group.add(l);
        flames.push(l);
      });
      group.add(poles, panes);
    });
  }

  // ---- the fire pit: a ring of stones, logs leant together over a bed of embers, flames licking up between them
  let fire: ReturnType<typeof firePit> | null = null;
  if (out.fire) {
    fire = firePit(out.seed + 5);
    const [x, z] = out.fire.at;
    fire.group.position.set(x, duneAt(x, z, flat), z);
    group.add(fire.group);
  }

  // ---- the vans people came in, parked round the edge
  (out.vans ?? []).forEach((v, i) => {
    const m = van(out.seed + 31 * i, { awning: v.awning });
    m.position.set(v.at[0], duneAt(v.at[0], v.at[1], flat), v.at[1]); m.rotation.y = v.yaw;
    group.add(m);
  });

  // ---- the generator and its jerry cans, off to the side
  if (out.generator) {
    const g = gear("generator-7kva", { look });
    g.position.set(out.generator.at[0], 0, out.generator.at[1]); g.rotation.y = out.generator.yaw;
    group.add(g);
    for (let i = 0; i < 3; i++) {
      const c = gear("jerry-can-20l", { look });
      c.position.set(out.generator.at[0] + 1 + i * 0.4, 0, out.generator.at[1] + 0.6); c.rotation.y = rnd() * 0.4;
      group.add(c);
    }
  }

  // ---- the cables on the sand: the generator's orange feed to a distro behind the wall, power on to the amp rack
  // beside it, a speaker run from the rack to the back of each stack, and the line from the booth's mixer round the end
  // of the wall to the rack. Each lies on the sand with a little wander, as a run does when it's been walked on.
  const stacks = rigStacks(def), dj = def.spots.find((sp) => sp.kind === "dj");
  if (out.generator && stacks.length) {
    const fx = Math.sin(stacks[0]!.yaw), fz = Math.cos(stacks[0]!.yaw), rx = Math.cos(stacks[0]!.yaw), rz = -Math.sin(stacks[0]!.yaw);
    const mx = stacks.reduce((t, st) => t + st.at[0], 0) / stacks.length, mz = stacks.reduce((t, st) => t + st.at[1], 0) / stacks.length;
    const back = (d: number, side = 0): [number, number] => [mx - fx * d + rx * side, mz - fz * d + rz * side];
    const span = Math.max(...stacks.map((st) => (st.at[0] - mx) * rx + (st.at[1] - mz) * rz)) + stackWidth(roomRig(def)) / 2;
    const rackAt = back(1.7, -0.6), distroAt = back(1.7, 0.9);
    const rack = gear("amp-rack-4u", { look }); rack.position.set(rackAt[0], 0, rackAt[1]); rack.rotation.y = stacks[0]!.yaw + Math.PI; group.add(rack);
    const distro = gear("distro-box", { look }); distro.position.set(distroAt[0], 0, distroAt[1]); distro.rotation.y = stacks[0]!.yaw + Math.PI; group.add(distro);
    const run = (pts: [number, number][], r: number, color: string, seed: number) => {
      const wr = mulberry32(seed), path: THREE.Vector3[] = [];
      pts.forEach(([x, z], i) => {
        path.push(new THREE.Vector3(x, r, z));
        const next = pts[i + 1];
        if (!next) return;
        // a few points between, nudged sideways: a cable never lies dead straight
        const len = Math.hypot(next[0] - x, next[1] - z), n = Math.max(1, Math.floor(len / 1.2)), ux = (next[0] - x) / len, uz = (next[1] - z) / len;
        for (let k = 1; k < n; k++) { const t = k / n, off = (wr() - 0.5) * 0.35; path.push(new THREE.Vector3(x + (next[0] - x) * t - uz * off, r, z + (next[1] - z) * t + ux * off)); }
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), Math.max(16, path.length * 8), r, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
      tube.castShadow = tube.receiveShadow = true;
      group.add(tube);
    };
    const [gx, gz] = out.generator.at;
    run([[gx + 0.4, gz + 0.2], [(gx + distroAt[0]) / 2, (gz + distroAt[1]) / 2 + 0.8], distroAt], 0.014, "#d2602a", 1);
    run([distroAt, [(distroAt[0] + rackAt[0]) / 2, distroAt[1] - fz * 0.4], rackAt], 0.008, "#151515", 2);
    stacks.forEach((st, i) => {
      const behind: [number, number] = [st.at[0] - fx * 0.55, st.at[1] - fz * 0.55];
      run([rackAt, [(rackAt[0] + behind[0]) / 2, (rackAt[1] + behind[1]) / 2 - fz * 0.3], behind], 0.0065, "#101010", 10 + i);
    });
    if (dj) {
      const b = thingBox(dj), end: [number, number] = [mx + rx * (span + 0.7), mz + rz * (span + 0.7)];
      run([[b.cx, b.cz], [b.cx + rx * (span * 0.6), b.cz + rz * (span * 0.6) - fz * 0.4], end, back(1.2, span + 0.4), rackAt], 0.0045, "#0c0c0c", 30);
    }
    // the band's monitors: a floor wedge for each player, its sloped grille looking up at them (in front of the keys,
    // the bass and the mic, beside the kit at the drummer's left), each with its speaker run back to the rack
    def.spots.filter((sp) => ["keys", "bass", "drums", "booth"].includes(sp.kind) && !sp.made).forEach((sp, i) => {
      const sx = -Math.sin(sp.yaw), sz = -Math.cos(sp.yaw), rx2 = Math.cos(sp.yaw), rz2 = -Math.sin(sp.yaw), side = sp.kind === "drums";
      const reach = side ? 0 : sp.thing.ahead + sp.thing.d / 2 + 0.5;
      const at: [number, number] = side ? [sp.at[0] - rx2 * 1.1, sp.at[1] - rz2 * 1.1] : [sp.at[0] + sx * reach, sp.at[1] + sz * reach];
      const w = gear("wedge-12", { look });
      w.position.set(at[0], 0, at[1]); w.rotation.y = side ? sp.yaw + Math.PI / 2 : sp.yaw;
      group.add(w);
      run([at, [(at[0] + rackAt[0]) / 2 + rx * 0.6, (at[1] + rackAt[1]) / 2], rackAt], 0.0065, "#101010", 40 + i);
    });
  }

  // ---- the plants and the rocks, round the clearing: one instanced mesh per carving, each copy turned and sized from
  // the seed. Joshua trees stand apart; creosote fills between them; the boulders run from a football to a van.
  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const keepOut = (x: number, z: number) => Math.abs(x) < def.size.w / 2 + 2 && Math.abs(z) < def.size.d / 2 + 2;
  for (const [grow, count, near, small, big] of [
    [joshua, 13, 24, 0.8, 1.25], [joshua, 13, 30, 0.7, 1.2], [joshua, 12, 40, 0.8, 1.3],
    [creosote, 80, 22, 0.6, 1.2], [creosote, 80, 22, 0.6, 1.2], [barrel, 30, 22, 0.7, 1.3], [pear, 30, 22, 0.7, 1.3],
    [boulder, 45, 23, 0.3, 1.2], [boulder, 22, 26, 1.2, 3.2],
  ] as const) {
    const geo = grow(Math.floor(rnd() * 1e6)), inst = new THREE.InstancedMesh(geo, plantMat, count), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 20; tries++) { const a = rnd() * Math.PI * 2, r = near + rnd() * 70; x = Math.cos(a) * r; z = Math.sin(a) * r; if (!keepOut(x, z)) break; }
      const s = small + rnd() * (big - small);
      m.compose(new THREE.Vector3(x, duneAt(x, z, flat) - 0.05 * s, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2), new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = high;
    group.add(inst);
  }

  // ---- the post: a strong bloom, so the beams, the lenses and the bulbs glow
  let composer: EffectComposer | null = null;
  const post: string[] = [];
  if (high) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0.82));
    composer.addPass(new OutputPass());
    post.push("bloom");
  }

  // every solid mesh casts and takes shadows from the moon (the beams and the sky don't)
  function walk() {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.looked) return;
      o.userData.looked = true;
      const mat = o.material, see = !(mat instanceof THREE.Material && (mat.transparent || mat instanceof THREE.MeshBasicMaterial));
      o.castShadow = high && see;
      o.receiveShadow = see;
    });
  }
  walk();

  let frames = 0, fps = 0, since = performance.now(), count = 0;
  const lights = 2 + heads.length + flames.length + (fire ? 1 : 0);
  return {
    quality,
    render(cam) {
      if (frames++ % 60 === 0) walk();
      renderer.info.reset();
      const now = performance.now(), t = now / 1000;
      count++;
      if (now - since > 1000) { fps = Math.round((count * 1000) / (now - since)); count = 0; since = now; }
      heads.forEach((h, i) => {
        const a = headAim(i, heads.length, t);
        h.yoke.rotation.y = a.pan;
        // tilt the head out toward the floor (+z, in the truss's frame)
        h.head.rotation.x = -a.tilt;
      });
      lasers.forEach((l, i) => {
        const spread = ((i / (LASERS - 1)) - 0.5) * 1.3;
        l.rotation.set(-0.06 - Math.abs(Math.sin(t * 0.7)) * 0.12, spread + Math.sin(t * 0.9) * 0.25, 0);
        l.visible = Math.sin(t * 0.25) > -0.3; // they go out now and then, and come back
      });
      for (const l of flames) l.intensity = 12 * flameAt(l.userData.i as number, t);
      fire?.tick(t);
      clothTime.value = t;
      if (composer) composer.render(); else renderer.render(scene, cam);
    },
    resize(wpx, hpx) {
      renderer.setSize(wpx, hpx, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(wpx, hpx); }
    },
    state: () => ({ quality, lights, shadows: high ? 1 : 0, post, tone: "aces", exposure: renderer.toneMappingExposure, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, ground: 0, env: "generated" }),
  };
}
