// An open-air party, drawn (room.ts `outdoor`; Desert Gathering, rooms/desert-gathering.ts): the night in place of
// look.ts's lit room. Night here is a change of colour, not darkness (you have to see the party): a sky going from blue
// overhead through violet to a coral glow on the horizon, stars and a full moon, the ranges standing purple against it;
// a clearing of sand in the Mojave, lit blue by the moon and pink by the last of the glow; the speaker stacks
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
import { firePit } from "@rustybuns/models/fire";
import { gear, gearLook, type GearId, type GearLook } from "@rustybuns/models/gear";
import { banks, type Bank, SYSTEMS, stackWidth, behindStacks, isTop, LINE_PINS, powerPlan, topsMount, gear as sheet, type StackPlace } from "@rustybuns/gear";
import { rigPlan, rigStacks, roomRig } from "./pa-room.ts";
import { clothTime, rugs } from "./tapestry.ts";
import { barrel, boulder, creosote, joshua, pear } from "@rustybuns/models/flora";
import { thingBox, type Outdoor, type StudioDef } from "./room.ts";
import { metreUV, surface, type Look, type Quality } from "./look.ts";

/** The field's banks as ground you can see: a sheet over each one's footprint, lifted to the height the sound reads
 *  (@rustybuns/gear `banks`, the one height map), in the sand the floor is made of. Empty with no banks. */
export function bankMounds(list: readonly Bank[], material: THREE.Material = surface("sand", "#a88a66")): THREE.Group {
  const g = new THREE.Group(), land = banks(list);
  for (const b of list) {
    const wide = b.width ?? Math.max(2, 4 * b.h), long = b.len + wide;
    const geo = new THREE.PlaneGeometry(long, wide, Math.max(8, Math.ceil(long / 0.5)), Math.max(8, Math.ceil(wide / 0.4))).rotateX(-Math.PI / 2).rotateY(b.yaw).translate(b.at[0], 0, b.at[1]);
    const p = geo.attributes.position!;
    // a hair over the floor where the bank runs out, so its foot never flickers into it
    for (let i = 0; i < p.count; i++) p.setY(i, land(p.getX(i), p.getZ(i)) + 0.008);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(metreUV(geo), material);
    m.receiveShadow = m.castShadow = true;
    g.add(m);
  }
  return g;
}

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
 *  `place.at` with its front turned `place.yaw` from +z. Desert Gathering's, and the pair a room with decks but no PA gets
 *  (pa-room.ts). `splay` turns the boxes above the bass (the ones that carry the mids and highs) that much further, on their
 *  own axis, as a crew fans a side's two tops out across the floor; a line array's boxes tip down by `pins` (@rustybuns/gear
 *  LINE_PINS). The tops sit where `tops` says (@rustybuns/gear topsMount, the same place the sound comes from): on the
 *  subs, on a pole out of the top sub, or on their own tripod beside the subs. */
export function paStack(place: StackPlace, look: GearLook = gearLook(), ids: readonly string[] = SYSTEMS["dance-stack"].stack): THREE.Group {
  const { at, yaw, splay = 0, pins = LINE_PINS } = place, mount = topsMount({ stack: ids }, place);
  const st = new THREE.Group();
  st.position.set(at[0], 0, at[1]); st.rotation.y = yaw;
  let y = 0, lean = 0, k = 0;
  const size = new THREE.Vector3();
  if (mount.from < ids.length && mount.base > mount.subs) {
    if (mount.side) {
      // the tops' own tripod beside the subs, its pole's top under the lowest top
      const stand = gear("stand-tripod", { look, height: mount.base });
      stand.position.x = mount.side;
      stand.name = "tops-stand";
      st.add(stand);
    } else {
      // a pole out of the top sub's socket, up into the lowest top's
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, mount.base - mount.subs + 0.1, 12), look.metal);
      rod.position.y = (mount.subs + mount.base) / 2;
      rod.name = "tops-pole";
      st.add(rod);
    }
  }
  for (const [i, id] of ids.entries()) {
    if (i === mount.from) y = mount.base;
    const x = i >= mount.from ? mount.side : 0;
    const g = gear(id as GearId, { look });
    new THREE.Box3().setFromObject(g).getSize(size);
    if (id.startsWith("line-array")) {
      // a ground-stacked line array: each box rests on the one below at the back, the gap opening at the front, the
      // lowest aimed down most (at the front of the floor, on a wedge so its nose clears the sub) and the top one near level
      const first = k === 0, aim = pins[Math.min(k++, pins.length - 1)] ?? 0, hinge = new THREE.Group();
      if (first) y += size.z * Math.sin(aim);
      hinge.position.set(x, y, lean - size.z / 2); hinge.rotation.x = aim;
      g.position.z = size.z / 2;
      hinge.add(g); st.add(hinge);
      y += size.y * Math.cos(aim); lean += size.y * Math.sin(aim);
      continue;
    }
    g.position.set(x, y, 0);
    if (splay && isTop(id)) g.rotation.y = splay;
    st.add(g);
    y += size.y;
  }
  return st;
}

/** The sub block in the middle of the floor: `wide` of the rig's sub box side by side and `high` up, standing at (x, z)
 *  with its fronts turned `yaw` from +z. The boxes touch, so the block couples as one big sub. */
export function subBlock(at: readonly [number, number], yaw: number, wide: number, high: number, sub: string, look: GearLook = gearLook()): THREE.Group {
  const block = new THREE.Group(), [w, h] = [sheet(sub).size.w, sheet(sub).size.h];
  block.position.set(at[0], 0, at[1]); block.rotation.y = yaw;
  for (let i = 0; i < wide; i++) for (let j = 0; j < high; j++) {
    const g = gear(sub as GearId, { look });
    g.position.set((i - (wide - 1) / 2) * (w + 0.01), j * h, 0);
    block.add(g);
  }
  return block;
}

/** A DJ's booth monitor: a mid-high horn on a tripod stand at head height, at (x, z), its horn turned `yaw` from +z. */
export function boothMonitor(at: readonly [number, number], yaw: number, look: GearLook = gearLook()): THREE.Group {
  const m = new THREE.Group(), stand = gear("stand-tripod", { look, height: 1.3 }), horn = gear("stack-mid-high", { look });
  m.position.set(at[0], 0, at[1]); m.rotation.y = yaw;
  horn.position.y = stand.getObjectByName("pole")?.position.y ?? 1.3;
  m.add(stand, horn);
  return m;
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

/** How far a sub's cone stands out at `beat` (0 to 1): kicked out on each beat and settling back within it; null (the band
 *  stopped) leaves it at rest. */
export const conePush = (beat: number | null) => (beat === null ? 0 : Math.exp(-(beat - Math.floor(beat)) * 9));
/** Every sub cone (gear.ts `part:cone`) under `roots`, and a frame call that pumps them all to `conePush(beat)`. */
export function subCones(roots: THREE.Object3D[]): (beat: number | null) => void {
  const cones: { o: THREE.Object3D; home: number; reach: number }[] = [];
  for (const r of roots) r.traverse((o) => {
    if (o.name === "part:cone" && typeof o.parent?.userData.coneThrow === "number") cones.push({ o, home: o.position.z, reach: o.parent.userData.coneThrow });
  });
  return (beat) => { const k = conePush(beat); for (const c of cones) c.o.position.z = c.home + c.reach * k; };
}

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
  // a little sheen on the metal, no room light; low quality's plain materials (below) take none, so it isn't made
  if (high) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;
    pm.dispose();
  }

  const group = new THREE.Group();
  group.name = "open-air";
  scene.add(group);
  const rnd = mulberry32(out.seed);
  const horizon = new THREE.Color("#8e4a8c"), zenith = new THREE.Color("#131c52");
  scene.background = zenith;
  scene.fog = new THREE.Fog("#62467f", 60, 220);

  // ---- the sky: a dome shaded from the horizon's glow through violet to the blue overhead, paler round the full moon; the stars
  // as a full moon leaves them (the faint ones washed out near it, the bright ones in their colours); the moon with
  // its dark seas and a soft glow round it
  const moonAt = new THREE.Vector3(-70, 62, -120), moonDir = moonAt.clone().normalize();
  const dome = new THREE.SphereGeometry(190, 48, 24), col: number[] = [], p = dome.attributes.position, moonSky = new THREE.Color("#7f9be0"), at = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, Math.min(1, p.getY(i) / 190));
    const c = new THREE.Color("#ec7f6a").lerp(horizon, Math.min(1, k * 6)).lerp(new THREE.Color("#403a8c"), Math.min(1, k * 2.5)).lerp(zenith, Math.max(0, k * 1.4 - 0.3));
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
  const moonlight = new THREE.DirectionalLight("#b4c4ff", 1.5);
  moonlight.position.copy(moonAt).normalize().multiplyScalar(40);
  moonlight.castShadow = high;
  moonlight.shadow.mapSize.set(2048, 2048);
  Object.assign(moonlight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 });
  moonlight.shadow.bias = -0.0005;
  group.add(moonlight, moonlight.target);
  group.add(new THREE.HemisphereLight("#8494ff", "#b0645c", 1.35));
  // the glow on the horizon, from the side away from the moon: faces turned from it come out pink, not black
  const glow = new THREE.DirectionalLight("#ff6fae", 0.8);
  glow.position.set(-moonAt.x, 12, -moonAt.z);
  group.add(glow, glow.target);

  // ---- the ranges: two lines of bare mountains all the way round, purple against the horizon's glow
  for (const [radius, tall, color, seed] of [[176, 1, "#5b4287", out.seed % 7], [150, 0.55, "#3b2d66", (out.seed % 11) + 3]] as const) {
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
  // ---- the banks on the field, and the rugs on the sand
  group.add(bankMounds(out.banks ?? []));
  group.add(rugs(out));

  const rig = roomRig(def);
  for (const s of rigStacks(def)) group.add(paStack(s, look, rig.stack));
  // the sub block in the middle, and the DJ's monitors either side of the decks
  if (out.subs) group.add(subBlock(out.subs.at, out.subs.yaw, out.subs.wide, out.subs.high, rig.sub, look));
  for (const m of out.monitors ?? []) group.add(boothMonitor(m.at, m.yaw, look));

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

  // ---- festoon lights: warm bulbs hanging every 45 cm from a cable that sags between its ties, on wooden posts
  const bulbs: THREE.Vector3[] = [], cablePts: THREE.Vector3[][] = [];
  for (const run of out.festoons ?? []) {
    run.points.forEach(([x, y, z], i) => {
      if (!run.posts?.[i]) return;
      const g0 = duneAt(x, z, flat), post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, y + 0.1 - g0, 8), surface("wood", "#6e5236"));
      post.position.set(x, (y + 0.1 + g0) / 2, z); group.add(post);
    });
    for (let i = 0; i + 1 < run.points.length; i++) {
      const a = new THREE.Vector3(...run.points[i]!), b = new THREE.Vector3(...run.points[i + 1]!), span = a.distanceTo(b), sag = 0.06 * span;
      const line: THREE.Vector3[] = [];
      for (let k = 0; k <= 24; k++) { const u = k / 24; line.push(a.clone().lerp(b, u).setY(a.y + (b.y - a.y) * u - 4 * sag * u * (1 - u))); }
      cablePts.push(line);
      const n = Math.max(1, Math.round(span / 0.45));
      for (let k = 0; k < n; k++) { const u = (k + 0.5) / n; bulbs.push(a.clone().lerp(b, u).setY(a.y + (b.y - a.y) * u - 4 * sag * u * (1 - u) - 0.07)); }
    }
  }
  if (bulbs.length) {
    const cable = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.7 });
    for (const line of cablePts) group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), 24, 0.006, 4), cable));
    const glass = new THREE.MeshStandardMaterial({ color: "#3a2410", emissive: "#ffc070", emissiveIntensity: 3, roughness: 0.3 });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), glass, bulbs.length), m = new THREE.Matrix4();
    bulbs.forEach((p, i) => lamps.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    lamps.userData.looked = true;
    group.add(lamps);
  }

  // ---- the generator, off to the side: a 7 kVA set and its jerry cans while it can run the amps flat out, the
  // 100 kVA trailer (its own big tank) once they'd trip it
  const stacks = rigStacks(def), dj = def.spots.find((sp) => sp.kind === "dj");
  // the amps (a 12-channel rack for every twelve channels the rig takes) and the set, as @rustybuns/gear plans the rig's power
  const power = powerPlan(rigPlan(def)!), racks = Math.max(1, power.racks), set = power.generator;
  if (out.generator) {
    const g = gear(set, { look });
    g.position.set(out.generator.at[0], 0, out.generator.at[1]); g.rotation.y = out.generator.yaw;
    group.add(g);
    if (set === "generator-7kva") for (let i = 0; i < 3; i++) {
      const c = gear("jerry-can-20l", { look });
      c.position.set(out.generator.at[0] + 1 + i * 0.4, 0, out.generator.at[1] + 0.6); c.rotation.y = rnd() * 0.4;
      group.add(c);
    }
  }

  // ---- the cables on the sand: the generator's orange feed to a distro behind the wall, power on to the amp rack
  // beside it, a speaker run from the rack to the back of each stack, and the line from the booth's mixer round the end
  // of the wall to the rack. Each lies on the sand with a little wander, as a run does when it's been walked on.
  if (out.generator && stacks.length) {
    const fx = Math.sin(stacks[0]!.yaw), fz = Math.cos(stacks[0]!.yaw), rx = Math.cos(stacks[0]!.yaw), rz = -Math.sin(stacks[0]!.yaw);
    const mx = stacks.reduce((t, st) => t + st.at[0], 0) / stacks.length, mz = stacks.reduce((t, st) => t + st.at[1], 0) / stacks.length;
    const back = (d: number, side = 0) => behindStacks(stacks, d, side);
    const span = Math.max(...stacks.map((st) => (st.at[0] - mx) * rx + (st.at[1] - mz) * rz)) + stackWidth(roomRig(def)) / 2;
    const rackAt = back(1.7, -0.6), distroAt = back(1.7, 0.9);
    // the amp racks side by side
    for (let i = 0; i < racks; i++) {
      const at = back(1.7, -0.6 - i * 0.66), rack = gear("amp-rack-12u", { look });
      rack.position.set(at[0], 0, at[1]); rack.rotation.y = stacks[0]!.yaw + Math.PI; group.add(rack);
    }
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
  if (!high) plain(group);

  let frames = 0, fps = 0, since = performance.now(), count = 0;
  const lights = 3 + heads.length + flames.length + (fire ? 1 : 0);
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
    state: () => ({ quality, lights, shadows: high ? 1 : 0, post, tone: "aces", exposure: renderer.toneMappingExposure, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, ground: 0, env: high ? "generated" : "none" }),
  };
}

/**
 * Low quality's look: every standard or physical material under `root` that doesn't patch its own shader traded for a
 * Lambert one, shared by everything that looks the same. Software GL (a weak laptop, CI's runners) then links a few short
 * programs instead of a physical one per variant, and lights each pixel once (#5922: the desert linked 40). Colour,
 * texture, vertex colours, glow and see-through stay; roughness, metal and bumps go. Returns how many it made.
 */
export function plain(root: THREE.Object3D): number {
  const made = new Map<string, THREE.MeshLambertMaterial>(), unpatched = THREE.Material.prototype.onBeforeCompile;
  const swap = (m: THREE.Material): THREE.Material => {
    if (!(m instanceof THREE.MeshStandardMaterial) || m.onBeforeCompile !== unpatched) return m;
    const key = [m.color.getHex(), m.emissive.getHex(), m.emissiveIntensity, m.map?.uuid, m.emissiveMap?.uuid, m.vertexColors, m.flatShading, m.transparent, m.opacity, m.side, m.alphaTest, m.depthWrite, m.fog, m.blending].join();
    let p = made.get(key);
    if (!p) made.set(key, (p = new THREE.MeshLambertMaterial({ name: m.name, color: m.color, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, map: m.map, emissiveMap: m.emissiveMap, vertexColors: m.vertexColors, flatShading: m.flatShading, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, depthWrite: m.depthWrite, fog: m.fog, blending: m.blending })));
    return p;
  };
  root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
  return made.size;
}
