// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a vehicle (as a champion: Warbur's throw, or Gumpert's
// change of kit). Things that die come apart in chunks, and blasts throw dirt. Blaster fire is
// glowing bolts that fly; sound is sfx.ts (M mutes), and the mission card and waypoint, mission.ts.
// 1 to 4 order the squad round you (forward, hold, fall back, focus fire where the gun points).
// Heavy weapons wait out in the open under a beacon. The intro cutscenes play first, once each,
// and a sting when a Mossback walks in (cutscenes.ts). Comrades talk in bubbles over their heads.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { groundRecorder } from "./replay.ts";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { animate, gunship, marine, speeder, tank, turret, walker, wooka } from "./models.ts";
import { buildWorld } from "./terrain.ts";
import { mission, sameMission, standing, type Mission, type Standing } from "./mission.ts";
import { makeSfx } from "./sfx.ts";
import { isTouch, mountTouch } from "./touch.ts";
import { keyName, lookTurn, settings } from "../settings.ts";
import { icon } from "../ui/icons.ts";
import { makeBubbles } from "../ui/bubbles.ts";
import { chatterFor } from "./lines.ts";
import CHATTER_SCRIPT from "../../content/chatter.json";
import { introOf, mossbackSting, prologueOf, rideOf } from "./cutscenes.ts";
import { nextRide, playCutscene, shouldPlay } from "./cutscene-view.ts";
import { WORLDS } from "./worlds.ts";
import { CHAMP_AT, HEAVY, ORDERS, ORDER_FOR, OVERHEAT, SPRINT_AFTER, DT, POST_RADIUS, STRIKE_RADIUS, TROOPERS, altitude, facing, heroUnit, inPlay, isHorde, isVehicle, startBattle, statsOf, step, timeLimit, vipUnit, yawTo, type Fx, type OrderKind, type Trooper, type Unit } from "./sim.ts";

// The squad orders, by key, with their icons and what the HUD calls them.
const ORDER_KEYS: Record<string, OrderKind> = { "1": "forward", "2": "hold", "3": "back", "4": "focus", f: "focus" };
const ORDER_INFO: Record<OrderKind, { icon: string; name: string; color: number }> = {
  forward: { icon: "chevrons-up", name: "Forward", color: 0x7ad87a },
  hold: { icon: "shield", name: "Hold", color: 0xffd27a },
  back: { icon: "undo-2", name: "Fall back", color: 0x9fd3ff },
  focus: { icon: "crosshair", name: "Focus fire", color: 0xff5a3a },
};
// What comrades say over their heads: something daft when it's quiet, something worried when it isn't.
const CHATTER = CHATTER_SCRIPT;

// A few lucide icons (ISC licence) for the rhythm strip: the HUD says it with icons and a ticking clock.
const HUD_ICONS: Record<string, string> = {
  shovel: '<path d="M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z"/><path d="M3 22a1 1 0 0 1-1-1v-3.586a1 1 0 0 1 .293-.707l3.355-3.355a1.205 1.205 0 0 1 1.704 0l3.296 3.296a1.205 1.205 0 0 1 0 1.704l-3.355 3.355a1 1 0 0 1-.707.293z"/><path d="m9 15 7.879-7.878"/>',
  "log-out": '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>',
  skull: '<path d="m12.5 17-.5-1-.5 1h1z"/><path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};
const hudIcon = (name: string) => `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HUD_ICONS[name] ?? ""}</svg>`;
// The strip's own rules live here, with the thing that draws it.
const RHYTHM_CSS = `
.b-beat { position: absolute; top: 84px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; white-space: nowrap; }
.b-beat .chip { display: inline-flex; align-items: center; gap: 6px; background: rgb(0 0 0 / 0.55); border-radius: 6px; padding: 3px 9px; border-bottom: 3px solid #888; pointer-events: auto; cursor: help; }
.b-beat .chip .clock { min-width: 3.2em; }
.b-beat .chip sup { font-style: italic; opacity: 0.7; }
.b-beat .surge { border-color: #ff9a3c; } .b-beat .dig { border-color: #ffd27a; color: #ffd27a; }
.b-beat .fall { border-color: #ff4a3a; color: #fff; background: rgb(150 20 10 / 0.75); animation: beat-flash 0.7s ease-in-out infinite alternate; }
.b-beat .moss { border-color: #7dff6a; color: #bfffa8; } .b-beat .air { border-color: #9fe6ff; }
@keyframes beat-flash { from { opacity: 0.65; } to { opacity: 1; } }
.b-feed li.cut { opacity: 0.6; font-style: italic; } .b-feed li.over { color: #ffb0a0; letter-spacing: 0.03em; }
.b-alarm { position: absolute; inset: 0; opacity: 0; box-shadow: inset 0 0 90px 24px rgb(200 20 10 / 0.7); }
.b-alarm.on { animation: beat-alarm 0.5s ease-in-out infinite alternate; }
@keyframes beat-alarm { from { opacity: 0.1; } to { opacity: 0.8; } }`;
const FEED_KEEP = /^(Surge|Dig in|Out in|Left behind|Hold |.*FALL BACK|Squad|Chieftain|Picked up)/;
// The heat gauge under the crosshair: ten segments along an arc, lit as the blaster heats (or as
// a heavy weapon's ammo runs down).
const HEAT_N = 10;
const HEAT_SEGS = Array.from({ length: HEAT_N }, (_, i) => {
  // From lower left, round the bottom, to lower right.
  const span = (140 / HEAT_N) * (Math.PI / 180), a0 = ((200 * Math.PI) / 180) + i * span + 0.03, a1 = a0 + span - 0.06, r = 34;
  const pt = (a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(-Math.sin(a) * r).toFixed(2)}`;
  return `<path d="M ${pt(a0)} A ${r} ${r} 0 0 0 ${pt(a1)}"/>`;
}).join("");

export function playBattle(spec: BattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement): Promise<BattleResult> {
  const b = startBattle(spec);
  const heroSide = spec.hero;
  const color = (s: Side) => FACTION_COLORS[spec.factions[s]];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 2000);
  // Doren's haze and light, the floor, the trees and everything on it: terrain.ts.
  const world = buildWorld(scene, b);
  const ground = world.heightAt;

  // Command posts: a ring on the ground, a banner on a pole, and a column of light in the
  // holder's colour you can see through the trees.
  const posts = b.posts.map((p) => {
    const y = ground(p.x, p.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(POST_RADIUS - 0.6, POST_RADIUS, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, y + 0.12, p.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 9, 8), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.5, roughness: 0.4 }));
    pole.position.set(p.x, y + 4.5, p.z);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.9, 8, 1), new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(p.x + 1.6, y + 7.8, p.z);
    flag.castShadow = true;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.set(p.x, y, p.z);
    // The power point itself: a squat bunker with a core that glows in the holder's colour.
    const bunker = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.85 }));
    bunker.position.set(p.x - 4, y + 0.9, p.z - 4);
    bunker.castShadow = bunker.receiveShadow = true;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    core.position.set(p.x - 4, y + 2.6, p.z - 4);
    scene.add(ring, pole, flag, beam, bunker, core);
    return { ring, flag, beam, core };
  });
  // Units, by id. Each side looks like its faction, whichever end of the field it's on.
  const meshes = new Map<number, THREE.Group>();
  // A unit's look changes when the hero becomes a champion, so the mesh is keyed on it.
  const lookOf = (u: Unit) => `${u.kind}:${u.role ?? ""}:${u.champ ?? ""}`;
  const makeMesh = (u: Unit) => {
    const f = spec.factions[u.side];
    const g = u.kind === "tank" ? tank() : u.kind === "walker" ? walker() : u.kind === "speeder" ? speeder() : u.kind === "gunship" ? gunship()
      : u.kind === "turret" ? turret(f) : u.champ === "warbur" ? wooka(false, "warbur") : u.champ === "gumpert" ? marine(true, "heavy")
      : f === "wooka" ? wooka(u.kind === "hero", u.role ?? "fodder") : marine(u.kind === "hero", (TROOPERS as string[]).includes(u.kind) ? (u.kind as Trooper) : "assault");
    if (u.champ === "gumpert") g.scale.setScalar(1.35);
    g.userData.last = { x: u.x, z: u.z };
    g.userData.look = lookOf(u);
    scene.add(g);
    return g;
  };

  // Blaster bolts: a glow in the shooter's colour round a hot core, flying from muzzle to target,
  // with a flash where they leave and a spark where they land. The sim's shot lasts a frame or
  // two; the bolt is the view's own and takes as long as the flight does.
  // Fast over distance, but never quicker than BOLT_MIN in the air, so a shot up close is still seen.
  const BOLTS = 400, BOLT_SPEED = 140, BOLT_MIN = 0.12;
  const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateX(Math.PI / 2);
  // Out of the fog and tone mapping, so a bolt stays its own colour against Doren's bright haze;
  // the glow is solid rather than added, or it washes out pink on the mist.
  const glowing = (color: number, add: boolean) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: add ? 1 : 0.9, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false, fog: false });
  const additive = (color = 0xffffff) => glowing(color, true);
  const boltGlow = new THREE.InstancedMesh(boltGeo, glowing(0xffffff, false), BOLTS), boltCore = new THREE.InstancedMesh(boltGeo, additive(0xfff4ec), BOLTS);
  const flashes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), additive(), BOLTS);
  for (const m of [boltGlow, boltCore, flashes]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; scene.add(m); }
  boltCore.renderOrder = 1; // the hot core over its glow
  // The Thunder Marines' blasters fire red; the Wooka's only "shots" are rock-chuckers, a blur of amber.
  const BOLT_COLORS: Record<string, number> = { marines: 0xff3326, wooka: 0xd08a3a };
  type Bolt = { a: THREE.Vector3; b: THREE.Vector3; t: number; speed: number; len: number; w: number; color: THREE.Color; hit: boolean };
  type Flash = { p: THREE.Vector3; t: number; life: number; s: number; color: THREE.Color };
  const bolts: Bolt[] = [], flashList: Flash[] = [];
  const boltDir = new THREE.Vector3(), boltZ = new THREE.Vector3(0, 0, 1), boltP = new THREE.Vector3(), boltM = new THREE.Matrix4(), boltQ = new THREE.Quaternion(), boltS = new THREE.Vector3();
  const flash = (p: THREE.Vector3, s: number, color: THREE.Color, life = 0.06) => { if (flashList.length < BOLTS) flashList.push({ p: p.clone(), t: 0, life, s, color }); };
  const throwGeo = new THREE.BufferGeometry();
  const throws = new THREE.LineSegments(throwGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  scene.add(throws);
  // Gunship tracers: pale lines from the pass down to the ground.
  const shotGeo = new THREE.BufferGeometry();
  const shots = new THREE.LineSegments(shotGeo, new THREE.LineBasicMaterial({ color: 0xfff2a8 }));
  shots.frustumCulled = false;
  scene.add(shots);
  // Chunks: voxel bits of whatever came apart, and dirt from blasts. They fly, fall and bounce.
  const CHUNKS = 1600;
  const chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.8 }), CHUNKS);
  chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chunkMesh.castShadow = true;
  chunkMesh.count = 0;
  scene.add(chunkMesh);
  type Chunk = { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; r: THREE.Euler; life: number; s: number };
  const chunks: Chunk[] = [];
  const chunkCol: THREE.Color[] = [];
  const spawned = new WeakSet<Fx>();
  const GORE: Record<string, number[]> = { marines: [0x1d2026, 0xf1f3f6, 0x8a0f0f, 0xb01818, 0x30343b], wooka: [0x9a6438, 0x5a3518, 0xd6ad78, 0x8a0f0f, 0xb01818] };
  const DIRT = [0x5a3b22, 0x3d4a22, 0x7a5a3a, 0x2a2a2a];
  const burst = (x: number, y: number, z: number, n: number, palette: number[], speed: number) => {
    for (let i = 0; i < n; i++) {
      if (chunks.length >= CHUNKS) { chunks.shift(); chunkCol.shift(); }
      const a = Math.random() * Math.PI * 2, up = 0.5 + Math.random();
      chunks.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(Math.cos(a) * speed * Math.random(), up * speed, Math.sin(a) * speed * Math.random()), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), r: new THREE.Euler(), life: 2.5 + Math.random() * 1.5, s: 0.6 + Math.random() * 1.4 });
      chunkCol.push(new THREE.Color(palette[Math.floor(Math.random() * palette.length)]!));
    }
  };
  const chunkM = new THREE.Matrix4(), chunkQ = new THREE.Quaternion(), chunkS = new THREE.Vector3();
  const tossed: THREE.Group[] = [];
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.7 });
  const blastGeo = new THREE.SphereGeometry(1, 12, 8);
  const blasts: THREE.Mesh[] = [];
  const markMat = new THREE.MeshBasicMaterial({ color: 0xff3030, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  const markGeo = new THREE.RingGeometry(STRIKE_RADIUS - 0.8, STRIKE_RADIUS, 40);
  const marks: THREE.Mesh[] = [];
  const pooled = (pool: THREE.Mesh[], i: number, make: () => THREE.Mesh) => {
    while (pool.length <= i) { const m = make(); scene.add(m); pool.push(m); }
    pool[i]!.visible = true;
    return pool[i]!;
  };

  const sfx = makeSfx();
  sfx.wake(); // the click that dropped you in is still fresh enough to open the sound
  const section = canvas.parentElement!;
  section.classList.add(`hud-${spec.factions[heroSide]}`);
  // The chaos: shells and strikes coming down out of the sky, gunships going past, trees burning,
  // smoke and flares. All of it is for the eye. What it hurts is in the sim (b.strikes, b.passes).
  if (!document.getElementById("rhythm-css")) {
    const st = document.createElement("style");
    st.id = "rhythm-css";
    st.textContent = RHYTHM_CSS;
    document.head.append(st);
  }
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xffb040, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  const colGeo = new THREE.CylinderGeometry(1, 1, 120, 10, 1, true).translate(0, 60, 0);
  const colMat = new THREE.MeshBasicMaterial({ color: 0xff4a30, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const columns: THREE.Mesh[] = [];
  // A ring on the ground with a shaft of light over it, for where to run to and where to hold.
  const ringMark = (color: number, r: number) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.9, r, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 70, 16, 1, true).translate(0, 35, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    g.add(ring, beam);
    g.visible = false;
    scene.add(g);
    return g;
  };
  const fallMark = ringMark(0x6dff8a, POST_RADIUS), digMark = ringMark(0xffd27a, POST_RADIUS + 1.5);
  // Where the last order sent the squad.
  const orderMarks = Object.fromEntries(ORDERS.map((k) => [k, ringMark(ORDER_INFO[k].color, 5)])) as Record<OrderKind, THREE.Group>;
  // Heavy weapons out on the field: a crate under a beacon you can see from across it.
  const cacheMeshes = b.caches.map((c) => {
    const g = new THREE.Group(), y = ground(c.x, c.z);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 1), new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.45 }));
    crate.position.y = 0.4;
    crate.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.12, 1.04), additive(0x6ad8ff));
    strip.position.y = 0.55;
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.8, roughness: 0.3 }));
    gun.position.y = 1.1;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 50, 12, 1, true).translate(0, 25, 0), new THREE.MeshBasicMaterial({ color: 0x6ad8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    g.add(crate, strip, gun, beam);
    g.position.set(c.x, y, c.z);
    scene.add(g);
    return { g, gun };
  });
  const jets: THREE.Group[] = [];
  // Fires: a tree struck by a blast burns for a while, some of them up where the huts are.
  type Fire = { x: number; z: number; y: number; life: number; seed: number; emit: number };
  const fires: Fire[] = [];
  const flameGeo = new THREE.ConeGeometry(0.75, 2.6, 7).translate(0, 1.3, 0);
  const flameOuter = new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const flameInner = new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const flamesA: THREE.Mesh[] = [], flamesB: THREE.Mesh[] = [];
  const ignite = (x: number, z: number) => {
    let near: { x: number; z: number } | null = null, bd = 10;
    for (const t of b.trees) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; near = t; } }
    if (!near || fires.some((f) => Math.hypot(f.x - near!.x, f.z - near!.z) < 0.5)) return;
    if (fires.length >= 22) fires.shift();
    fires.push({ x: near.x, z: near.z, y: ground(near.x, near.z) + (Math.random() < 0.35 ? 6 + Math.random() * 4 : 0.4), life: 14 + Math.random() * 16, seed: Math.random() * 10, emit: 0 });
  };
  // Smoke: grey puffs that rise, swell and thin out.
  const SMOKES = 260;
  const smokeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0x2e2c2a, transparent: true, opacity: 0.4, depthWrite: false }), SMOKES);
  smokeMesh.count = 0;
  smokeMesh.frustumCulled = false;
  scene.add(smokeMesh);
  type Puff = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number };
  const puffs: Puff[] = [];
  const puff = (x: number, y: number, z: number, up = 2.5) => {
    if (puffs.length >= SMOKES) puffs.shift();
    const max = 3 + Math.random() * 3;
    puffs.push({ p: new THREE.Vector3(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5)), v: new THREE.Vector3(1 + Math.random(), up * (0.6 + Math.random() * 0.8), (Math.random() - 0.5)), life: max, max });
  };
  // Flares: one rises, hangs, and comes down slowly, lighting the trees.
  type Flare = { x: number; z: number; age: number; sway: number; color: number };
  const flares: Flare[] = [];
  const flareMesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b8, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  const flareLight = new THREE.PointLight(0xffe2a0, 0, 140, 1.4);
  flareMesh.visible = false;
  scene.add(flareMesh, flareLight);
  const FLARE_LIFE = 9;
  const launchFlare = (x: number, z: number, color = 0xffe2a0) => { if (flares.length < 3) flares.push({ x, z, age: 0, sway: Math.random() * 6, color }); };
  let nextFlare = 4, lastSurge = 0;
  const seenBig = new Set<number>();
  let alarmT = 0;
  const smashPalette = WORLDS[spec.sector].debris;

  // Input. Any click or key also wakes the sound, which browsers keep shut till then.
  const keys = new Set<string>();
  let yaw = heroSide === "attacker" ? 0 : Math.PI, pitch = -0.12, firing = false, strike = false, use = false, order: OrderKind | null = null;
  const onKey = (e: KeyboardEvent, down: boolean) => {
    const k = e.key.toLowerCase();
    if (down) sfx.wake();
    if (down && k === settings.keys.mute && !e.repeat) sfx.toggle();
    if (down && k === settings.keys.strike) strike = true;
    if (down && k === settings.keys.use) use = true;
    if (down && !e.repeat && ORDER_KEYS[k]) order = ORDER_KEYS[k]!;
    down ? keys.add(k) : keys.delete(k);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  const md = (e: MouseEvent) => { sfx.wake(); if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); else if (e.button === 0) firing = settings.fireToggle ? !firing : true; };
  const mu = (e: MouseEvent) => { if (e.button === 0 && !settings.fireToggle) firing = false; };
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    const t = lookTurn(e.movementX, e.movementY, "mouse");
    yaw += t.yaw; pitch = Math.max(-0.9, Math.min(0.5, pitch + t.pitch));
  };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  canvas.addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("mousemove", mm);
  // A phone: a stick to move, a drag to look, and buttons for the rest (touch.ts).
  const touch = isTouch();
  let stickF = 0, stickR = 0;
  const unTouch = touch ? mountTouch(section, canvas, {
    stick: (f, r) => { sfx.wake(); stickF = f; stickR = r; },
    drag: (dx, dy) => { const t = lookTurn(dx, dy, "touch"); yaw += t.yaw; pitch = Math.max(-0.9, Math.min(0.5, pitch + t.pitch)); },
    buttons: [
      { id: "fire", icon: "crosshair", label: "Fire", hold: true, on: (d) => { sfx.wake(); firing = settings.fireToggle ? (d ? !firing : firing) : d; } },
      { id: "strike", icon: "zap", label: "Orbital strike", on: (d) => { if (d) strike = true; } },
      { id: "use", icon: "car-front", label: "Vehicle or special", on: (d) => { if (d) use = true; } },
      ...(["forward", "hold", "back", "focus"] as const).map((k) => ({ id: k, icon: ORDER_INFO[k].icon, label: `Squad: ${ORDER_INFO[k].name}`, row: true, on: (d: boolean) => { if (d) order = k; } })),
    ],
  }) : null;

  const aimPoint = () => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const me = heroUnit(b), floor = me ? ground(me.x, me.z) : 0; // the strike lands on the floor about where you stand
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floor), new THREE.Vector3());
    return hit && hit.distanceTo(camera.position) < 160 ? { x: hit.x, z: hit.z } : null;
  };
  const gunPoint = () => {
    const me = heroUnit(b), f = facing(yaw);
    return aimPoint() ?? (me ? { x: me.x + f.x * 40, z: me.z + f.z * 40 } : { x: 0, z: 0 });
  };

  // Halo-style outline on the enemy: bright where you can see them, dim where foliage or a wall
  // is in front, so a Wooka coming through the ferns still reads.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
  outline.edgeStrength = 5;
  outline.edgeThickness = 2;
  // Orange is lost against sand, so the desert and the beach get a cold cyan instead.
  const sandy = spec.sector === "canyon" || spec.sector === "cannon";
  outline.visibleEdgeColor.set(sandy ? 0x2ee6ff : 0xff5a2a);
  outline.hiddenEdgeColor.set(sandy ? 0x1590b8 : 0xc0381c);
  composer.addPass(outline);
  composer.addPass(new OutputPass());
  const OUTLINE_RANGE = 80;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    outline.resolution.set(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);
  resize();
  // With the mouse free, the player can hand the rest of the battle to the AI.
  let handOver = false;
  hud.onpointerdown = (e) => { if ((e.target as HTMLElement).id === "b-auto") handOver = true; };

  const champName = isHorde(b, heroSide) ? "Warbur" : "Gumpert";
  // Feel, over the canvas and outside the HUD it redraws: the hit marker on the crosshair, the
  // blaster's heat under it, a red edge when you're hit, and a toast for each kill in a streak.
  const cross = document.querySelector<HTMLElement>(".crosshair");
  const feel = document.createElement("div");
  feel.className = "b-feel";
  feel.innerHTML = `<div class="b-alarm"></div><div class="b-hurt"></div><div class="b-heat"><svg viewBox="-50 -50 100 100" aria-hidden="true">${HEAT_SEGS}</svg><span class="b-heat-label"></span></div><div class="b-caches"></div><div class="b-toast"></div><div class="b-leave">${icon("triangle-alert", 18)}<span></span></div><div class="b-note"></div><div class="b-way"><i class="b-way-arrow">${icon("arrow-right", 14)}</i><span class="b-way-icon"></span><b></b></div>`;
  canvas.parentElement!.append(feel);
  const bubbles = makeBubbles(feel);
  const cachesEl = feel.querySelector<HTMLElement>(".b-caches")!;
  cachesEl.innerHTML = b.caches.map(() => `<div class="b-cache">${icon("package", 14)}<b></b></div>`).join("");
  const cacheEls = [...cachesEl.children] as HTMLElement[];
  const segEls = [...feel.querySelectorAll<SVGPathElement>(".b-heat path")], heatLabel = feel.querySelector<HTMLElement>(".b-heat-label")!;
  const alarmEl = feel.querySelector<HTMLElement>(".b-alarm")!, hurtEl = feel.querySelector<HTMLElement>(".b-hurt")!, heatEl = feel.querySelector<HTMLElement>(".b-heat")!, toastEl = feel.querySelector<HTMLElement>(".b-toast")!;
  const leaveEl = feel.querySelector<HTMLElement>(".b-leave")!, noteEl = feel.querySelector<HTMLElement>(".b-note")!, wayEl = feel.querySelector<HTMLElement>(".b-way")!;
  const wayArrow = wayEl.querySelector<HTMLElement>(".b-way-arrow")!, wayIcon = wayEl.querySelector<HTMLElement>(".b-way-icon")!, wayDist = wayEl.querySelector<HTMLElement>("b")!;
  // The mission: what it is, where the hero stands against it, and what they're told on the way.
  const VERB_ICON: Record<Mission["verb"], string> = { Defend: "shield", Take: "flag", Escort: "users", Stop: "crosshair", Reach: "map-pin" };
  const IN_AREA: Record<Mission["verb"], string> = { Defend: "Hold the area", Take: "Stand in the ring till it turns", Escort: "Stay close", Stop: "Bring them down", Reach: "Step into the ring" };
  let job: Mission | null = null, stand: Standing = "travel", jobDist = 0, warnAt = 0, noteT = 0, wayIconOf = "";
  const noteFor = (was: Mission, now: Mission) => was.name === now.name ? (now.verb === "Defend" ? `${now.name} is ours. Hold it` : `${now.name} lost. Take it back`) : `Next: ${now.verb} ${now.name}`;
  const wayPos = new THREE.Vector3();
  const foeHorde = isHorde(b, heroSide === "attacker" ? "defender" : "attacker");
  const STREAK: Record<number, string> = foeHorde
    ? { 2: "Two in a row", 3: "Three. Fluff everywhere", 5: "Five. They'll sing about you. Badly", 8: "Eight. The forest has gone quiet", 12: "Twelve. Command is concerned about you" }
    : { 2: "Two backpacks", 3: "Three. Start a collection", 5: "Five. The totems need helmets", 8: "Eight. The shiny ones are all crying", 12: "Twelve. The chieftain wants a word" };
  let wasVent = false, nextTalk = 3, stung = false;
  const noCuts = new URLSearchParams(location.search).get("cutscenes") === "off";
  const talk: { id: number; text: string; until: number }[] = [];
  let hurt = 0, shake = 0, lastHp = Infinity, lastKills = 0, toastT = 0, markT = 0, gruntAt = 0, chatterAt = 0;
  let ear = { x: 0, z: 0 };
  // What the mode asks of you right now, over the posts.
  const objectiveLine = () => {
    const live = b.posts[b.live]!, vip = vipUnit(b), vipName = isHorde(b, "attacker") ? "Warbur" : "Gumpert";
    const text = b.mode === "assault" ? (b.phase > 0 ? `Hold ${live.name} ${Math.ceil(b.phase)}s` : `Take ${live.name}`)
      : b.mode === "hill" ? `Hill: ${live.name}, moves in ${Math.ceil(b.phase)}s`
      : b.mode === "holdout" ? (heroSide === "defender" ? "Hold any post till the clock runs out" : "Take every post")
      : b.mode === "escort" ? (vip ? `${vip.id === b.hero.id ? "You're the VIP" : `Escort ${vipName}`} ${Math.round((100 * vip.hp) / vip.maxHp)}%` : `${vipName} is down`)
      : "";
    return text ? `<span class="objective">${text}</span>` : "";
  };
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  // The rhythm, in icons and ticking clocks: the next surge, the post to dig in at, the fall-back to run for.
  const clock = (s: number) => `<span class="clock">${fmt(Math.max(0, s))}</span>`;
  const beatLine = () => {
    const beat = b.beat, chips: string[] = [], mossN = b.units.filter((u) => u.role === "mossback").length;
    if (beat.fall) {
      const f = beat.fall;
      chips.push(`<span class="chip fall" title="${f.evac ? "Nowhere left to fall back to: reach the evac point" : "Overrun: get to the next post"} before the clock runs out. Out in time costs a few tickets; left behind costs a lot.">${hudIcon("log-out")}${f.evac ? "Evac" : "Fall back"}: ${f.name} ${clock(f.left)}<sup>i</sup></span>`);
    } else if (beat.dig) {
      chips.push(`<span class="chip dig" title="Hold this post with at least two of yours and nobody overrunning it, and the countdown runs. Held, it pays a drop of troops and tickets, then an orbital strike.">${hudIcon("shovel")}Dig in: ${b.posts[beat.dig.post]!.name} ${clock(beat.dig.left)}<sup>i</sup></span>`);
    }
    if (mossN) chips.push(`<span class="chip moss" title="Rifles barely mark it and it mends. Rockets, strikes and Boomies finish it.">${hudIcon("skull")}Mossback${mossN > 1 ? ` x${mossN}` : ""}</span>`);
    if (b.passes.length) chips.push(`<span class="chip air" title="A gunship is making a run across the field.">${hudIcon("plane")}Gunship</span>`);
    if (b.units.some((u) => u.wild) || isHorde(b, "attacker") || isHorde(b, "defender")) chips.push(`<span class="chip surge" title="The next surge of Wooka out of the treeline. Between surges the radio calls a dig-in.">${hudIcon("siren")}Surge ${beat.surge + 1} ${clock(beat.nextSurge - b.time)}<sup>i</sup></span>`);
    return `<div class="b-beat">${chips.join("")}</div>`;
  };
  // The radio, with lines that land on top of each other cutting each other off.
  const feedLines = () => {
    const from = Math.max(0, b.events.length - 5);
    return b.events.slice(from).map((e, k) => {
      const i = from + k, t = b.eventAt[i] ?? 0, next = b.eventAt[i + 1];
      const cut = !FEED_KEEP.test(e) && e.length > 24 && next !== undefined && next - t < 1;
      const over = i > 0 && t - (b.eventAt[i - 1] ?? -9) < 1;
      return `<li class="${cut ? "cut" : ""} ${over ? "over" : ""}">${cut ? `${e.slice(0, Math.ceil(e.length * 0.6))}--` : e}</li>`;
    }).join("");
  };
  // The squad's orders, by key, the one in force lit with what's left of it.
  const orderBar = () => {
    const o = b.order && b.time - b.order.at < ORDER_FOR ? b.order : null;
    return `<div class="b-orders">${ORDERS.map((k, i) => `<span class="ord${o?.kind === k ? " on" : ""}" title="${ORDER_INFO[k].name}${k === "forward" || k === "focus" ? ": where your gun points" : k === "back" ? ": towards home" : ": where they stand"}"><kbd>${i + 1}</kbd>${icon(ORDER_INFO[k].icon, 16)}${o?.kind === k ? `<i style="width:${Math.round((100 * (ORDER_FOR - (b.time - o.at))) / ORDER_FOR)}%"></i>` : ""}</span>`).join("")}</div>`;
  };
  const drawHud = () => {
    const hero = heroUnit(b), mine = heroSide, foe = mine === "attacker" ? "defender" : "attacker";
    const riding = b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle);
    const bar = (s: Side) => `<div class="tickets ${spec.factions[s]}"><b>${spec.factions[s] === "wooka" ? "Kin" : "Thunder Marines"}</b><span>${Math.max(0, Math.ceil(b.tickets[s]))}</span><i style="width:${Math.min(100, (100 * Math.max(0, b.tickets[s])) / (spec.tickets[s] + spec.reinforcements[s]))}%"></i></div>`;
    hud.innerHTML = `
      <div class="b-top">${bar(mine)}
        <div class="b-clock" title="${b.mode === "conquest" || b.mode === "hill" ? "Time left. When it runs out, the side with more tickets wins (the defender on a tie)." : "Time left. When it runs out, the defender has held."}"><span class="clock">${fmt(Math.max(0, timeLimit(spec) - b.time))}</span><sup>i</sup></div>
        ${bar(foe)}</div>
      ${job ? `<div class="b-mission ${stand}"><small>${spec.factions[heroSide] === "wooka" ? "The chieftain says" : "Orders of the Fleet"}</small><b>${icon(VERB_ICON[job.verb], 15)}${job.verb} ${job.name}</b><span>${stand === "travel" ? `Make it to ${job.name} · ${Math.round(jobDist)} m` : stand === "in" ? IN_AREA[job.verb] : "Leaving the area"}</span></div>` : ""}
      <div class="b-posts">${objectiveLine()}${b.posts.map((p, i) => `<span class="post ${p.owner ? spec.factions[p.owner] : ""}${inPlay(b, i) ? "" : " out"}">${p.name}</span>`).join("")}</div>
      ${beatLine()}
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Back in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span class="stat" title="Lives">${icon("heart", 15)}${b.hero.lives}</span>
        <span class="stat" title="Orbital strikes (Q)">${icon("zap", 15)}${b.strikesLeft[mine]}</span>
        ${b.hero.arm ? `<span class="stat arm" title="Heavy weapon: fires till it's empty, never overheats">${icon("package", 15)}${HEAVY[b.hero.arm.kind].name[spec.factions[mine]]} · ${b.hero.arm.ammo}</span>` : ""}
        ${riding ? `<span class="stat" title="Driving a ${riding.kind} (E to get out)">${icon("car-front", 15)}</span>` : ""}
        ${sfx.muted ? `<span class="muted" title="Sound off (M)">${icon("volume-x", 15)}</span>` : ""}
        ${hero?.champ ? `<span class="champ-on">${hero.champ === "warbur" ? "WARBUR · E throws a Wooka" : `GUMPERT · ${hero.kit} · E swaps kit`}</span>`
          : `<span class="champ" title="Kills till your champion takes the field">${champName}<i style="width:${Math.min(100, (100 * b.kills[mine]) / CHAMP_AT)}%"></i></span>`}
      </div>
      <ul class="b-feed">${feedLines()}</ul>
      ${orderBar()}
      ${touch ? `<div class="b-help"><button id="b-auto" type="button">Let the AI finish it</button></div>` : document.pointerLockElement === canvas ? "" : `<div class="b-help">Click the field to take control · ${keyName(settings.keys.forward)}${keyName(settings.keys.left)}${keyName(settings.keys.back)}${keyName(settings.keys.right)} move · mouse look · click fire · ${keyName(settings.keys.strike)} orbital strike · ${keyName(settings.keys.use)} vehicle · 1-4 squad orders · ${keyName(settings.keys.mute)} sound · Esc to let go, then the gear for Controls<button id="b-auto" type="button">Let the AI finish it</button></div>`}`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const rec = groundRecorder();
    const stage = { scene, camera, render: () => composer.render(), ground, sfx, host: section };
    // Cutscenes hold the battle: the sim doesn't step and the HUD steps aside till they're over.
    const cut = (cs: Parameters<typeof playCutscene>[0] | Parameters<typeof playCutscene>[0][], origin: Parameters<typeof playCutscene>[2]) => {
      section.classList.add("cutting");
      const list = Array.isArray(cs) ? cs : [cs];
      return list.reduce((p, c) => p.then(() => playCutscene(c, stage, origin)), Promise.resolve()).then(() => {
        section.classList.remove("cutting");
        firing = false;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      });
    };
    const frame = (now: number) => {
      // The first Mossback of the battle gets its moment.
      const big = !stung && !noCuts ? b.units.find((u) => u.role === "mossback" && !seenBig.has(u.id)) : undefined;
      if (big) {
        stung = true;
        const me = heroUnit(b) ?? b.spawn[heroSide];
        void cut(mossbackSting(spec.factions[heroSide]), { x: big.x, z: big.z, yaw: yawTo(big, me) });
        return;
      }
      const dt = Math.min(0.25, (now - last) / 1000);
      acc += dt;
      last = now;
      while (handOver && !b.over) step(b, null);
      while (acc >= DT && !b.over) {
        const input = rec.take({
          forward: Math.max(-1, Math.min(1, (keys.has(settings.keys.forward) ? 1 : 0) - (keys.has(settings.keys.back) ? 1 : 0) + stickF)),
          right: Math.max(-1, Math.min(1, (keys.has(settings.keys.right) ? 1 : 0) - (keys.has(settings.keys.left) ? 1 : 0) + stickR)),
          yaw, fire: firing, use,
          strike: strike ? aimPoint() ?? undefined : undefined,
          order: order ? { kind: order, ...gunPoint() } : undefined,
        });
        strike = use = false;
        order = null;
        step(b, input);
        acc -= DT;
      }

      // Sync meshes.
      const seen = new Set<number>();
      for (const u of b.units) {
        seen.add(u.id);
        let m = meshes.get(u.id);
        if (m && m.userData.look !== lookOf(u)) { scene.remove(m); m = undefined; }
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        m.position.set(u.x, altitude(u) + ground(u.x, u.z), u.z);
        m.rotation.y = u.yaw;
        // Walk cycles from how far it moved; recoil and club swings from how long since it fired.
        const last = m.userData.last as { x: number; z: number }, moved = Math.hypot(u.x - last.x, u.z - last.z);
        last.x = u.x; last.z = u.z;
        animate(m, { t: now / 1000, dt, moved: moved < 5 ? moved : 0, since: Math.max(0, statsOf(u).cool - u.cool), call: (now - ((m.userData.calledAt as number | undefined) ?? -1e9)) / 1000 });
        m.visible = !(u.kind === "hero" && b.hero.inVehicle !== null);
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); meshes.delete(id); }
      posts.forEach((p, i) => {
        const post = b.posts[i]!;
        (p.flag.material as THREE.MeshStandardMaterial).color.setHex(post.owner ? color(post.owner) : 0xdddddd);
        (p.ring.material as THREE.MeshBasicMaterial).color.setHex(post.progress > 0 ? color("attacker") : post.progress < 0 ? color("defender") : 0xffffff);
        (p.beam.material as THREE.MeshBasicMaterial).color.setHex(post.owner ? color(post.owner) : 0x888888);
        (p.core.material as THREE.MeshBasicMaterial).color.setHex(post.owner ? color(post.owner) : 0x888888);
        p.core.rotation.y = now / 600 + i;
        p.beam.visible = p.ring.visible = inPlay(b, i) || (b.mode === "escort" && i === b.posts.length - 1); // only what's in play glows
        p.core.position.y = ground(post.x - 4, post.z - 4) + 2.6 + Math.sin(now / 400 + i) * 0.2;
        p.flag.rotation.y = Math.sin(now / 700 + i) * 0.25; // it flaps
      });
      let nb = 0, lasers = 0;
      const byId = new Map(b.units.map((u) => [u.id, u]));
      const tpts: number[] = [], tcols: number[] = [];
      let nt = 0;
      for (const f of b.fx) {
        const fy = ground(f.x, f.z);
        if (!spawned.has(f)) {
          spawned.add(f);
          const me = heroUnit(b);
          if (f.from !== undefined && f.from === b.hero.id && (f.hit || f.kind === "blast")) { markT = 0.15; if (f.kind !== "blast") sfx.tick(); }
          const by = f.from === undefined ? undefined : byId.get(f.from);
          if (f.kind === "shot") {
            const heavy = f.big || (!!by && (isVehicle(by.kind) || by.kind === "turret")), mine = f.from === b.hero.id;
            const a = new THREE.Vector3(f.x, (f.y ?? 0) + (heavy ? 2.2 : 1.4) + fy, f.z), z = new THREE.Vector3(f.tx, (f.ty ?? 0) + 1.2 + ground(f.tx, f.tz), f.tz);
            const rocks = spec.factions[by?.side ?? "attacker"] === "wooka", c = new THREE.Color(BOLT_COLORS[rocks ? "wooka" : "marines"]!);
            if (bolts.length < BOLTS) bolts.push({ a, b: z, t: 0, speed: Math.min(BOLT_SPEED, a.distanceTo(z) / BOLT_MIN), len: heavy ? 5 : mine ? 4 : 3.2, w: heavy ? 0.4 : mine ? 0.28 : 0.2, color: c, hit: !!f.hit });
            flash(a, heavy ? 0.9 : 0.45, c);
            // The hero's own shots always sound; the battle's, a handful a frame.
            if (rocks) sfx.swish(f, 0.35);
            else if (mine || lasers++ < 6) sfx.laser(mine ? null : f, heavy, mine ? 0.32 : 0.3);
          }
          if (f.kind === "spear" || f.kind === "hex") sfx.swish(f);
          if (f.kind === "blast") sfx.boom(f, f.big);
          if (f.kind === "gore") sfx.hurt(spec.factions[f.side ?? "attacker"], f, true, undefined, f.big ? 0.6 : 1);
          if (f.kind === "toss") sfx.whoop(f);
          if (f.kind === "blast" && me) shake = Math.max(shake, (f.big ? 1.2 : 0.4) * Math.max(0, 1 - Math.hypot(f.x - me.x, f.z - me.z) / 35));
          if (f.kind === "gore") burst(f.x, fy + 0.8 + (f.y ?? 0), f.z, f.big ? 46 : 16, GORE[spec.factions[f.side ?? "attacker"]]!, f.big ? 9 : 6);
          if (f.kind === "blast") {
            burst(f.x, fy + 0.3, f.z, f.big ? 60 : 14, DIRT, f.big ? 14 : 7);
            for (let i = 0; i < (f.big ? 6 : 1); i++) puff(f.x, fy + 0.5, f.z, 3);
            if (f.big || Math.random() < 0.25) ignite(f.x, f.z);
          }
          if (f.kind === "smash") {
            // Something big came down on the ground, or through a log: wood, earth and moss everywhere.
            burst(f.x, fy + 0.4, f.z, f.big ? 70 : 34, smashPalette, f.big ? 12 : 8);
            for (let i = 0; i < 3; i++) puff(f.x, fy + 0.3, f.z, 2);
            if (me) shake = Math.max(shake, (f.big ? 1.6 : 0.7) * Math.max(0, 1 - Math.hypot(f.x - me.x, f.z - me.z) / 30));
          }
        }
        if (f.kind === "spear" || f.kind === "hex") {
          // A spear flies in an arc, a hex in a wobble; both from thrower to target over the throw.
          const c = f.kind === "spear" ? [0.55, 0.38, 0.2] : [0.5, 1, 0.42], k = 1 - f.t / 0.3, k0 = Math.max(0, k - 0.25);
          const at = (u: number) => [f.x + (f.tx - f.x) * u, fy + 1.4 + Math.sin(u * Math.PI) * (f.kind === "spear" ? 4 : 1.5), f.z + (f.tz - f.z) * u];
          tpts.push(...at(k0), ...at(k)); tcols.push(...c, ...c);
        } else if (f.kind === "toss") {
          // Warbur's throw: a Wooka, flailing, along a high arc.
          const g = tossed[nt] ?? (tossed[nt] = wooka(false, "fodder"));
          if (!g.parent) scene.add(g);
          g.visible = true;
          const u = 1 - f.t / 0.6;
          g.position.set(f.x + (f.tx - f.x) * u, ground(f.tx, f.tz) * u + fy * (1 - u) + Math.sin(u * Math.PI) * 12, f.z + (f.tz - f.z) * u);
          g.rotation.set(now / 80, now / 120, 0);
          nt++;
        } else if (f.kind === "blast") { const m = pooled(blasts, nb++, () => new THREE.Mesh(blastGeo, blastMat)); m.position.set(f.x, 1 + fy, f.z); m.scale.setScalar((f.big ? STRIKE_RADIUS : 3) * (0.6 + f.t)); }
      }
      for (let i = nt; i < tossed.length; i++) tossed[i]!.visible = false;
      for (let i = nb; i < blasts.length; i++) blasts[i]!.visible = false;
      // Bolts fly; one that gets there leaves a spark, a bigger one if it hit something.
      let nbolt = 0;
      for (let i = bolts.length - 1; i >= 0; i--) {
        const o = bolts[i]!, d = o.a.distanceTo(o.b);
        o.t += dt;
        const head = Math.min(d, o.t * o.speed), tail = Math.max(0, head - Math.min(o.len, d * 0.5));
        if (head >= d) { flash(o.b, o.hit ? 0.7 : 0.35, o.color, 0.09); bolts.splice(i, 1); continue; }
        boltDir.subVectors(o.b, o.a).divideScalar(d || 1);
        boltP.copy(o.a).addScaledVector(boltDir, (head + tail) / 2);
        boltQ.setFromUnitVectors(boltZ, boltDir);
        boltGlow.setMatrixAt(nbolt, boltM.compose(boltP, boltQ, boltS.set(o.w, o.w, head - tail)));
        boltGlow.setColorAt(nbolt, o.color);
        boltCore.setMatrixAt(nbolt, boltM.compose(boltP, boltQ, boltS.set(o.w * 0.35, o.w * 0.35, head - tail)));
        nbolt++;
      }
      boltGlow.count = boltCore.count = nbolt;
      let nflash = 0;
      for (let i = flashList.length - 1; i >= 0; i--) {
        const o = flashList[i]!;
        if ((o.t += dt) >= o.life) { flashList.splice(i, 1); continue; }
        flashes.setMatrixAt(nflash, boltM.compose(o.p, boltQ.identity(), boltS.setScalar(o.s * (1 - o.t / o.life * 0.5))));
        flashes.setColorAt(nflash, o.color);
        nflash++;
      }
      flashes.count = nflash;
      for (const m of [boltGlow, boltCore, flashes]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      throwGeo.setAttribute("position", new THREE.Float32BufferAttribute(tpts, 3));
      throwGeo.setAttribute("color", new THREE.Float32BufferAttribute(tcols, 3));
      // The chunks fall, bounce on the floor and fade out by shrinking.
      let live = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!;
        if ((c.life -= dt) <= 0) continue;
        c.v.y -= 22 * dt;
        c.p.addScaledVector(c.v, dt);
        const floor = ground(c.p.x, c.p.z) + 0.1;
        if (c.p.y < floor) { c.p.y = floor; c.v.y *= -0.3; c.v.x *= 0.6; c.v.z *= 0.6; c.spin.multiplyScalar(0.5); }
        c.r.set(c.r.x + c.spin.x * dt, c.r.y + c.spin.y * dt, c.r.z + c.spin.z * dt);
        chunkMesh.setMatrixAt(live, chunkM.compose(c.p, chunkQ.setFromEuler(c.r), chunkS.setScalar(c.s * Math.min(1, c.life))));
        chunkMesh.setColorAt(live, chunkCol[i]!);
        live++;
      }
      chunkMesh.count = live;
      chunkMesh.instanceMatrix.needsUpdate = true;
      if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
      for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i]!.life <= 0) { chunks.splice(i, 1); chunkCol.splice(i, 1); }
      // Strikes and shells: a ring on the ground. A strike has a shaft of light that swells as it lands; a shell, a streak falling.
      b.strikes.forEach((s, i) => {
        const m = pooled(marks, i, () => { const x = new THREE.Mesh(markGeo, markMat); x.rotation.x = -Math.PI / 2; return x; });
        const gy = ground(s.x, s.z), r = (s.r ?? STRIKE_RADIUS) / STRIKE_RADIUS;
        m.material = s.shell ? shellMat : markMat;
        m.position.set(s.x, 0.15 + gy, s.z);
        m.scale.setScalar(r);
        const c = pooled(columns, i, () => new THREE.Mesh(colGeo, colMat));
        c.material = s.shell ? streakMat : colMat;
        if (s.shell) { c.scale.set(0.25, 0.25, 0.25); c.position.set(s.x, gy + Math.max(0, s.t) * 45, s.z); }
        else { const k = 1 + Math.max(0, 2.5 - s.t); c.scale.set(STRIKE_RADIUS * 0.3 * k * 0.5, 1, STRIKE_RADIUS * 0.3 * k * 0.5); c.position.set(s.x, gy, s.z); }
      });
      for (let i = b.strikes.length; i < marks.length; i++) { marks[i]!.visible = false; if (columns[i]) columns[i]!.visible = false; }

      // Gunships going past, firing down.
      const pts: number[] = [];
      b.passes.forEach((p, i) => {
        const g = jets[i] ?? (jets[i] = gunship());
        if (!g.parent) scene.add(g);
        g.visible = true;
        const k = Math.min(1, p.age / p.dur), x = p.x0 + (p.x1 - p.x0) * k, z = p.z0 + (p.z1 - p.z0) * k, gy = ground(x, z);
        g.position.set(x, gy + 13, z);
        g.rotation.y = Math.atan2(-(p.x1 - p.x0), -(p.z1 - p.z0));
        animate(g, { t: now / 1000, dt, moved: 0.3, since: 1 });
        const tx = x + (Math.random() - 0.5) * 8, tz = z + (Math.random() - 0.5) * 8;
        pts.push(x, gy + 12, z, tx, ground(tx, tz) + 0.3, tz);
      });
      for (let i = b.passes.length; i < jets.length; i++) jets[i]!.visible = false;
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      // Fires and smoke.
      let nf = 0;
      for (const f of fires) {
        f.life -= dt;
        if (f.life <= 0) continue;
        const flick = 0.85 + Math.sin(now / 70 + f.seed) * 0.18 + Math.sin(now / 130 + f.seed * 3) * 0.1, fade = Math.min(1, f.life / 3);
        const a = pooled(flamesA, nf, () => new THREE.Mesh(flameGeo, flameOuter)), c = pooled(flamesB, nf, () => new THREE.Mesh(flameGeo, flameInner));
        a.position.set(f.x, f.y, f.z); c.position.set(f.x, f.y, f.z);
        a.scale.set(flick * fade, (1.1 + flick * 0.5) * fade, flick * fade);
        c.scale.set(0.55 * flick * fade, 0.7 * (1 + flick * 0.4) * fade, 0.55 * flick * fade);
        nf++;
        if ((f.emit -= dt) <= 0) { f.emit = 0.18; puff(f.x, f.y + 2, f.z, 2.6); }
      }
      for (let i = nf; i < flamesA.length; i++) { flamesA[i]!.visible = false; flamesB[i]!.visible = false; }
      for (let i = fires.length - 1; i >= 0; i--) if (fires[i]!.life <= 0) fires.splice(i, 1);
      let np = 0;
      for (const q of puffs) {
        if ((q.life -= dt) <= 0) continue;
        q.p.addScaledVector(q.v, dt);
        const grow = 0.6 + (1 - q.life / q.max) * 2.4;
        smokeMesh.setMatrixAt(np++, chunkM.compose(q.p, chunkQ.identity(), chunkS.setScalar(grow * Math.min(1, q.life / 0.8))));
      }
      smokeMesh.count = np;
      smokeMesh.instanceMatrix.needsUpdate = true;
      for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i]!.life <= 0) puffs.splice(i, 1);
      // Flares: now and then, and a pair of red ones over the treeline when a surge breaks.
      const hz = heroUnit(b);
      if ((nextFlare -= dt) <= 0) { nextFlare = 8 + Math.random() * 8; const at = hz ?? { x: 0, z: 0 }; launchFlare(at.x + (Math.random() - 0.5) * 120, at.z + (Math.random() - 0.5) * 120); }
      if (b.beat.surge !== lastSurge) { lastSurge = b.beat.surge; for (let i = 0; i < 2; i++) launchFlare((Math.random() - 0.5) * 200, (Math.random() < 0.5 ? -1 : 1) * 60, 0xff6a50); }
      for (const f of flares) f.age += dt;
      for (let i = flares.length - 1; i >= 0; i--) if (flares[i]!.age > FLARE_LIFE) flares.splice(i, 1);
      const fl = flares[flares.length - 1];
      flareMesh.visible = !!fl;
      if (fl) {
        const y = fl.age < 1.2 ? 4 + (fl.age / 1.2) * 52 : 56 - (fl.age - 1.2) * 4.5, fade = Math.min(1, (FLARE_LIFE - fl.age) / 2) * Math.min(1, fl.age * 2);
        flareMesh.position.set(fl.x + Math.sin(fl.age * 0.8 + fl.sway) * 3, y, fl.z);
        flareMesh.scale.setScalar(0.7 + fade * 0.6);
        (flareMesh.material as THREE.MeshBasicMaterial).color.setHex(fl.color);
        flareLight.color.setHex(fl.color);
        flareLight.position.copy(flareMesh.position);
        flareLight.intensity = 5000 * fade * (0.9 + Math.sin(now / 90) * 0.1);
      } else flareLight.intensity = 0;
      // The fall-back's destination, and the post to dig in at.
      const fb = b.beat.fall;
      fallMark.visible = !!fb;
      if (fb) { fallMark.position.set(fb.x, ground(fb.x, fb.z) + 0.2, fb.z); fallMark.scale.setScalar(1 + Math.sin(now / 160) * 0.06); }
      const dg = b.beat.dig;
      digMark.visible = !!dg && !fb;
      if (dg) { const p = b.posts[dg.post]!; digMark.position.set(p.x, ground(p.x, p.z) + 0.25, p.z); digMark.scale.setScalar(1 + Math.sin(now / 220) * 0.04); }
      // The order's spot, while it lasts.
      const od = b.order && b.time - b.order.at < ORDER_FOR && b.order.kind !== "hold" ? b.order : null;
      for (const k of ORDERS) orderMarks[k].visible = od?.kind === k;
      if (od) { orderMarks[od.kind].position.set(od.x, ground(od.x, od.z) + 0.2, od.z); orderMarks[od.kind].scale.setScalar(1 + Math.sin(now / 150) * 0.08); }
      // The heavy weapons, while they're there to take.
      b.caches.forEach((c, i) => { const m = cacheMeshes[i]!; m.g.visible = c.ready <= b.time; m.gun.rotation.y = now / 700; m.gun.position.y = 1.1 + Math.sin(now / 300 + i) * 0.12; });
      // A Mossback walks in: the screen goes red for a while.
      for (const u of b.units) if (u.role === "mossback" && !seenBig.has(u.id)) { seenBig.add(u.id); alarmT = 7; shake = Math.max(shake, 0.5); }
      alarmT = Math.max(0, alarmT - dt);
      alarmEl.classList.toggle("on", alarmT > 0);

      // Feel: the hit marker, heat, the red edge, a kill toast, and the sprint's wider view.
      const me = heroUnit(b);
      if (me) {
        if (me.hp < lastHp && lastHp !== Infinity) {
          hurt = Math.min(1, hurt + (lastHp - me.hp) / 60);
          if (now - gruntAt > 450) { sfx.hurt(spec.factions[heroSide], null, false, 0.4); gruntAt = now; }
        }
        lastHp = me.hp;
      } else lastHp = Infinity;
      // Now and then a Wooka near you has something to say about it.
      if (now > chatterAt) {
        chatterAt = now + 700 + Math.random() * 1800;
        const near = b.units.filter((u) => u.hp > 0 && (u.role || u.champ === "warbur") && u.id !== b.hero.id && Math.hypot(u.x - ear.x, u.z - ear.z) < 60);
        const who = near[Math.floor(Math.random() * near.length)];
        if (who) {
          // Bigger Wooka are lower. The Mossback howls, the Chubs roar, and the odd one beats its chest.
          const size = who.role === "mossback" ? 0.45 : who.champ === "warbur" ? 0.55 : who.role === "chub" ? 0.8 : 1, roll = Math.random();
          const mesh = meshes.get(who.id);
          if (mesh && roll < 0.5) mesh.userData.calledAt = now;
          if (size < 1 && roll < 0.35) sfx.howl(who, 0.5, size);
          else if (size < 1 && roll < 0.5) sfx.thump(who, 0.45, size);
          else if (roll < 0.7) sfx.chatter(who, 0.3, size);
          else sfx.whoop(who, 0.4, size);
        }
      }
      hurt = Math.max(0, hurt - dt * 1.5);
      hurtEl.style.opacity = String(hurt);
      cross?.classList.toggle("hit", (markT -= dt) > 0);
      // The gauge: heat by segment, yellow to red, a warning near the top and a vent countdown
      // once it's locked; with a heavy weapon in hand, the ammo left instead.
      const arm = b.hero.arm, vent = b.hero.overheated > 0;
      if (vent && !wasVent) sfx.vent();
      wasVent = vent;
      const fill = arm ? arm.ammo / HEAVY[arm.kind].ammo : vent ? b.hero.overheated / OVERHEAT : b.hero.heat;
      const lit = Math.ceil(fill * HEAT_N - 0.001);
      segEls.forEach((el, i) => el.setAttribute("class", i < lit ? (arm ? "ammo" : vent ? "vent" : i >= HEAT_N * 0.8 ? "red" : i >= HEAT_N * 0.5 ? "amber" : "on") : ""));
      const warm = !arm && !vent && b.hero.heat >= 0.75;
      heatEl.classList.toggle("show", !!arm || vent || b.hero.heat > 0.05);
      heatEl.classList.toggle("hot", vent);
      heatEl.classList.toggle("warm", warm);
      heatLabel.textContent = arm ? `${HEAVY[arm.kind].name[spec.factions[heroSide]]} ${arm.ammo}` : vent ? `Venting ${b.hero.overheated.toFixed(1)}` : warm ? "Overheating" : "";
      cross?.classList.toggle("locked", vent);
      if (b.hero.kills > lastKills) {
        toastEl.textContent = STREAK[b.hero.streak] ?? `+${b.hero.kills - lastKills}`;
        toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
        toastT = 1.5;
      }
      lastKills = b.hero.kills;
      if ((toastT -= dt) <= 0) toastEl.classList.remove("show");
      const fov = settings.fov + (b.hero.run > SPRINT_AFTER ? 9 : 0);
      if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
      shake = Math.max(0, shake - dt * 2.5);

      // Third-person camera over the hero's shoulder (or the vehicle's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inVehicle !== null && b.units.find((u) => u.id === b.hero.inVehicle)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? b.spawn.attacker.z : b.spawn.defender.z };
      const [back, high] = body?.champ === "warbur" ? [11, 5.5] : !body || body.kind === "hero" ? [7, 3.2] : body.kind === "walker" ? [15, 10] : body.kind === "gunship" ? [18, 6] : [13, 6];
      const floor = ground(at.x, at.z), up = high + (body ? altitude(body) : 0) + floor;
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      // Never under the floor behind you.
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
      camera.lookAt(at.x + f.x * 20, floor + (body ? altitude(body) : 0) + 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);
      if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      world.update(now / 1000, camera.position, { x: at.x + f.x * 30, z: at.z + f.z * 30 });
      ear = { x: at.x, z: at.z };
      sfx.hear({ x: at.x, z: at.z, rx: -f.z, rz: f.x });

      // The mission, and the waypoint that points at it: on it when it's on screen, at the edge
      // pointing the way when it isn't.
      const next = mission(b, heroSide);
      if (job && !sameMission(job, next)) {
        noteEl.textContent = noteFor(job, next);
        noteEl.classList.remove("show"); void noteEl.offsetWidth; noteEl.classList.add("show");
        noteT = 2.5;
        stand = "travel";
        sfx.chime();
      }
      job = next;
      if ((noteT -= dt) <= 0) noteEl.classList.remove("show");
      jobDist = Math.hypot(at.x - job.x, at.z - job.z);
      if (body) stand = standing(job, body, stand);
      if (stand === "leaving" && now - warnAt > 1100) { sfx.warn(); warnAt = now; }
      leaveEl.classList.toggle("show", stand === "leaving");
      leaveEl.lastElementChild!.textContent = `Leaving the area. Get back to ${job.name}`;
      if (wayIconOf !== job.verb) { wayIcon.innerHTML = icon(VERB_ICON[job.verb], 16); wayIconOf = job.verb; }
      wayDist.textContent = `${Math.round(jobDist)} m`;
      wayPos.set(job.x, ground(job.x, job.z) + 5, job.z).project(camera);
      const W = canvas.clientWidth, H = canvas.clientHeight, EDGE = 44, behind = wayPos.z > 1;
      let wx = (behind ? -wayPos.x : wayPos.x) * 0.5 * W, wy = -(behind ? -wayPos.y : wayPos.y) * 0.5 * H; // from the centre
      const off = behind || Math.abs(wx) > W / 2 - EDGE || Math.abs(wy) > H / 2 - EDGE;
      if (off) {
        if (behind && Math.hypot(wx, wy) < 1) wy = 1;
        const k = Math.min((W / 2 - EDGE) / Math.max(1e-6, Math.abs(wx)), (H / 2 - EDGE) / Math.max(1e-6, Math.abs(wy)));
        wx *= k; wy *= k;
      }
      wayEl.style.transform = `translate(${W / 2 + wx}px, ${H / 2 + wy}px)`;
      wayEl.classList.toggle("off", off);
      wayEl.classList.toggle("here", stand === "in");
      wayArrow.style.transform = `rotate(${Math.atan2(wy, wx)}rad)`;
      // A marker over each heavy weapon in reach, with how far it is.
      const onScreen = (x: number, y: number, z: number) => {
        wayPos.set(x, y, z).project(camera);
        return wayPos.z < 1 && Math.abs(wayPos.x) < 1 && Math.abs(wayPos.y) < 1 ? { x: (wayPos.x * 0.5 + 0.5) * W, y: (-wayPos.y * 0.5 + 0.5) * H } : null;
      };
      b.caches.forEach((c, i) => {
        const el = cacheEls[i]!, d = Math.hypot(at.x - c.x, at.z - c.z), p = c.ready <= b.time && d < 220 ? onScreen(c.x, ground(c.x, c.z) + 3, c.z) : null;
        el.hidden = !p;
        if (!p) return;
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.lastElementChild!.textContent = `${HEAVY[c.kind].name[spec.factions[heroSide]]} ${Math.round(d)} m`;
      });
      // Comrades talk: now and then one near you says something, daft when it's quiet, worried when it isn't.
      const pals = b.units.filter((u) => u.side === heroSide && u.id !== b.hero.id && u.hp > 0 && (TROOPERS.includes(u.kind as Trooper) || !!u.role) && Math.hypot(u.x - at.x, u.z - at.z) < 30);
      if ((nextTalk -= dt) <= 0 && talk.length < 2) {
        nextTalk = 3 + Math.random() * 4;
        const quiet = pals.filter((u) => !talk.some((x) => x.id === u.id)), who = quiet[Math.floor(Math.random() * quiet.length)];
        if (who) {
          const side = spec.factions[heroSide], lines = chatterFor(spec.sector, side, CHATTER[side]), foes = b.units.filter((u) => u.side !== heroSide && u.kind !== "turret" && Math.hypot(u.x - at.x, u.z - at.z) < 30).length;
          const pool = b.units.some((u) => u.role === "mossback" && u.side !== heroSide) ? lines.big : who.hp < who.maxHp * 0.5 ? lines.hurt : foes >= 4 ? lines.scared : lines.calm;
          talk.push({ id: who.id, text: pool[Math.floor(Math.random() * pool.length)]!, until: now + 3200 });
        }
      }
      for (let i = talk.length - 1; i >= 0; i--) {
        const x = talk[i]!, u = b.units.find((v) => v.id === x.id), m = meshes.get(x.id);
        if (now > x.until || !u || !m) { talk.splice(i, 1); continue; }
        bubbles.put(x.id, x.text, onScreen(m.position.x, m.position.y + (u.role ? 1.5 : 2.3), m.position.z), spec.factions[heroSide]);
      }
      bubbles.sweep();

      // The enemy gets an outline that shows through foliage.
      const eyeUnit = heroUnit(b);
      outline.selectedObjects = b.units.filter((u) => u.hp > 0 && eyeUnit && u.side !== eyeUnit.side && Math.hypot(u.x - eyeUnit.x, u.z - eyeUnit.z) < OUTLINE_RANGE).map((u) => meshes.get(u.id)).filter((g): g is THREE.Group => !!g);
      composer.render();
      if (now - hudAt > 100 || b.over) { drawHud(); hudAt = now; }
      if (b.over) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        unTouch?.();
        feel.remove();
        section.classList.remove(`hud-${spec.factions[heroSide]}`, "cutting");
        sfx.close();
        cross?.classList.remove("hit");
        composer.dispose();
        renderer.dispose();
        hud.onpointerdown = null;
        resolve({ ...b.over, inputs: rec.log() });
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    // The intros, once each, from where the hero stands: the drop (the Thunder Marines'), then the
    // briefing; then the battle. Once those are seen, a Thunder Marine battle opens on the ride
    // down instead: the next seat across, the next story.
    const h0 = heroUnit(b), f = spec.factions[heroSide];
    const intros = h0 ? [prologueOf(f, spec.sector), introOf(f, spec.sector)].filter((c): c is NonNullable<typeof c> => !!c && shouldPlay(c.id)) : [];
    if (h0 && f === "marines" && !noCuts && (!intros.length || new URLSearchParams(location.search).get("cutscenes") === "always")) intros.push(rideOf(nextRide()));
    if (h0 && intros.length) void cut(intros, { x: h0.x, z: h0.z, yaw });
    else raf = requestAnimationFrame(frame);
  });
}
