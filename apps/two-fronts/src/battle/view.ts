// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a vehicle (as a champion: Warbur's throw, or Gumpert's
// change of kit). Things that die come apart in chunks, and blasts throw dirt.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { groundRecorder } from "./replay.ts";
import { animate, gunship, marine, speeder, tank, turret, walker, wooka } from "./models.ts";
import { buildWorld } from "./terrain.ts";
import { CHAMP_AT, SPRINT_AFTER, DT, POST_RADIUS, STRIKE_RADIUS, TROOPERS, altitude, facing, heroUnit, inPlay, isHorde, startBattle, statsOf, step, timeLimit, vipUnit, type Fx, type Trooper, type Unit } from "./sim.ts";

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
const FEED_KEEP = /^(Surge|Dig in|Out in|Left behind|Hold |.*FALL BACK)/;

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
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
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

  // Shots are one batch of line segments; blasts and strike markers are pooled meshes.
  const shotGeo = new THREE.BufferGeometry();
  const shots = new THREE.LineSegments(shotGeo, new THREE.LineBasicMaterial({ color: 0xfff2a8 }));
  const throwGeo = new THREE.BufferGeometry();
  const throws = new THREE.LineSegments(throwGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  scene.add(shots, throws);
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
  const smashPalette = [0x7a4f2a, 0x5a3b22, 0x3d4a22, 0x9b8b6a, 0x4f7a2c];

  // Input.
  const keys = new Set<string>();
  let yaw = heroSide === "attacker" ? 0 : Math.PI, pitch = -0.12, firing = false, strike = false, use = false;
  const onKey = (e: KeyboardEvent, down: boolean) => {
    const k = e.key.toLowerCase();
    if (down && k === "q") strike = true;
    if (down && k === "e") use = true;
    down ? keys.add(k) : keys.delete(k);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  const md = (e: MouseEvent) => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); else if (e.button === 0) firing = true; };
  const mu = (e: MouseEvent) => { if (e.button === 0) firing = false; };
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0025;
    pitch = Math.max(-0.9, Math.min(0.5, pitch - e.movementY * 0.0025));
  };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  canvas.addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("mousemove", mm);

  const aimPoint = () => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const me = heroUnit(b), floor = me ? ground(me.x, me.z) : 0; // the strike lands on the floor about where you stand
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floor), new THREE.Vector3());
    return hit && hit.distanceTo(camera.position) < 160 ? { x: hit.x, z: hit.z } : null;
  };

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
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
  feel.innerHTML = `<div class="b-alarm"></div><div class="b-hurt"></div><div class="b-heat"><i></i></div><div class="b-toast"></div>`;
  canvas.parentElement!.append(feel);
  const alarmEl = feel.querySelector<HTMLElement>(".b-alarm")!, hurtEl = feel.querySelector<HTMLElement>(".b-hurt")!, heatEl = feel.querySelector<HTMLElement>(".b-heat")!, toastEl = feel.querySelector<HTMLElement>(".b-toast")!;
  const foeHorde = isHorde(b, heroSide === "attacker" ? "defender" : "attacker");
  const STREAK: Record<number, string> = foeHorde
    ? { 2: "Two in a row", 3: "Three. Fluff everywhere", 5: "Five. They'll sing about you. Badly", 8: "Eight. The forest has gone quiet", 12: "Twelve. Command is concerned about you" }
    : { 2: "Two backpacks", 3: "Three. Start a collection", 5: "Five. The totems need helmets", 8: "Eight. The shiny ones are all crying", 12: "Twelve. The chieftain wants a word" };
  let hurt = 0, shake = 0, lastHp = Infinity, lastKills = 0, toastT = 0, markT = 0;
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
  const drawHud = () => {
    const hero = heroUnit(b), mine = heroSide, foe = mine === "attacker" ? "defender" : "attacker";
    const riding = b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle);
    const bar = (s: Side) => `<div class="tickets ${spec.factions[s]}"><b>${s === mine ? "You" : "Enemy"}</b><span>${Math.max(0, Math.ceil(b.tickets[s]))}</span><i style="width:${Math.min(100, (100 * Math.max(0, b.tickets[s])) / (spec.tickets[s] + spec.reinforcements[s]))}%"></i></div>`;
    hud.innerHTML = `
      <div class="b-top">${bar(mine)}
        <div class="b-clock" title="${b.mode === "conquest" || b.mode === "hill" ? "Time left. When it runs out, the side with more tickets wins (the defender on a tie)." : "Time left. When it runs out, the defender has held."}"><span class="clock">${fmt(Math.max(0, timeLimit(spec) - b.time))}</span><sup>i</sup></div>
        ${bar(foe)}</div>
      <div class="b-posts">${objectiveLine()}${b.posts.map((p, i) => `<span class="post ${p.owner ? spec.factions[p.owner] : ""}${inPlay(b, i) ? "" : " out"}">${p.name}</span>`).join("")}</div>
      ${beatLine()}
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Back in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span title="Orbital strikes (Q)">☄ ${b.strikesLeft[mine]}</span>
        ${riding ? `<span title="Driving a ${riding.kind} (E to get out)">▣</span>` : ""}
        ${hero?.champ ? `<span class="champ-on">${hero.champ === "warbur" ? "WARBUR · E throws a Wooka" : `GUMPERT · ${hero.kit} · E swaps kit`}</span>`
          : `<span class="champ" title="Kills till your champion takes the field">${champName}<i style="width:${Math.min(100, (100 * b.kills[mine]) / CHAMP_AT)}%"></i></span>`}
      </div>
      <ul class="b-feed">${feedLines()}</ul>
      ${document.pointerLockElement === canvas ? "" : `<div class="b-help">Click the field to take control · WASD move · mouse look · click fire · Q orbital strike · E vehicle · Esc to let go<button id="b-auto" type="button">Let the AI finish it</button></div>`}`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const rec = groundRecorder();
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      acc += dt;
      last = now;
      while (handOver && !b.over) step(b, null);
      while (acc >= DT && !b.over) {
        const input = rec.take({
          forward: (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0),
          right: (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0),
          yaw, fire: firing, use,
          strike: strike ? aimPoint() ?? undefined : undefined,
        });
        strike = use = false;
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
        animate(m, { t: now / 1000, dt, moved: moved < 5 ? moved : 0, since: Math.max(0, statsOf(u).cool - u.cool) });
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
      const pts: number[] = [];
      let nb = 0;
      const tpts: number[] = [], tcols: number[] = [];
      let nt = 0;
      for (const f of b.fx) {
        const fy = ground(f.x, f.z);
        if (!spawned.has(f)) {
          spawned.add(f);
          const me = heroUnit(b);
          if (f.from !== undefined && f.from === b.hero.id && (f.hit || f.kind === "blast")) markT = 0.15;
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
        if (f.kind === "shot") pts.push(f.x, (f.y ?? 0) + 1.4 + fy, f.z, f.tx, (f.ty ?? 0) + 1.2 + ground(f.tx, f.tz), f.tz);
        else if (f.kind === "spear" || f.kind === "hex") {
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
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
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
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); // with the gunships' tracers in
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
      // A Mossback walks in: the screen goes red for a while.
      for (const u of b.units) if (u.role === "mossback" && !seenBig.has(u.id)) { seenBig.add(u.id); alarmT = 7; shake = Math.max(shake, 0.5); }
      alarmT = Math.max(0, alarmT - dt);
      alarmEl.classList.toggle("on", alarmT > 0);

      // Feel: the hit marker, heat, the red edge, a kill toast, and the sprint's wider view.
      const me = heroUnit(b);
      if (me) { if (me.hp < lastHp && lastHp !== Infinity) hurt = Math.min(1, hurt + (lastHp - me.hp) / 60); lastHp = me.hp; } else lastHp = Infinity;
      hurt = Math.max(0, hurt - dt * 1.5);
      hurtEl.style.opacity = String(hurt);
      cross?.classList.toggle("hit", (markT -= dt) > 0);
      heatEl.style.opacity = b.hero.heat > 0.05 || b.hero.overheated > 0 ? "1" : "0";
      heatEl.classList.toggle("hot", b.hero.overheated > 0);
      heatEl.firstElementChild!.setAttribute("style", `width:${Math.round(b.hero.heat * 100)}%`);
      if (b.hero.kills > lastKills) {
        toastEl.textContent = STREAK[b.hero.streak] ?? `+${b.hero.kills - lastKills}`;
        toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
        toastT = 1.5;
      }
      lastKills = b.hero.kills;
      if ((toastT -= dt) <= 0) toastEl.classList.remove("show");
      const fov = b.hero.run > SPRINT_AFTER ? 74 : 65;
      if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
      shake = Math.max(0, shake - dt * 2.5);

      // Third-person camera over the hero's shoulder (or the vehicle's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inVehicle !== null && b.units.find((u) => u.id === b.hero.inVehicle)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? 100 : -100 };
      const [back, high] = body?.champ === "warbur" ? [11, 5.5] : !body || body.kind === "hero" ? [7, 3.2] : body.kind === "walker" ? [15, 10] : body.kind === "gunship" ? [18, 6] : [13, 6];
      const floor = ground(at.x, at.z), up = high + (body ? altitude(body) : 0) + floor;
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      // Never under the floor behind you.
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
      camera.lookAt(at.x + f.x * 20, floor + (body ? altitude(body) : 0) + 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);
      if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      world.update(now / 1000, camera.position, { x: at.x + f.x * 30, z: at.z + f.z * 30 });

      renderer.render(scene, camera);
      if (now - hudAt > 100 || b.over) { drawHud(); hudAt = now; }
      if (b.over) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        feel.remove();
        cross?.classList.remove("hit");
        renderer.dispose();
        hud.onpointerdown = null;
        resolve({ ...b.over, inputs: rec.log() });
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
