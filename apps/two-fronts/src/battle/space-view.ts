// Draws a SpaceBattle in three.js and turns the keyboard and mouse into the hero's SpaceInput.
// 2.5D: the camera looks down on the battle at an angle, from behind your own line, and follows
// your fighter. The fighter turns towards the mouse and holds to the battle's plane, W boosts,
// S brakes, hold the button to fire and the wheel zooms. A faint grid marks the plane, and a line
// drops from each capital ship to it, so you can tell what's high and what's low. Bolts cross the
// gap, engines leave trails, hits throw sparks, a hurt cruiser burns and smokes, and a ship that
// goes up leaves a fireball, debris and a shock ring (space-fx.ts). Arrows at the screen's edge
// point to the enemy's cruisers out of sight, and a bracket marks what your guns would hit.
import * as THREE from "three";
import { FACTION_COLORS, type Side, type SpaceBattleResult, type SpaceBattleSpec } from "./contract.ts";
import { animate, cruiser, fighter, texture } from "./models.ts";
import { spaceRecorder } from "./replay.ts";
import { DT, HULL, LINE, SPACE_LIMIT, SPACE_STATS, heroCraft, spaceAimTarget, startSpaceBattle, stepSpace } from "./space.ts";
import { makeBolts, makeParticles, makeRings, makeTrails, type BoltDraw } from "./space-fx.ts";
import { makeSfx } from "./sfx.ts";
import { settings } from "../settings.ts";
import { isTouch, mountTouch } from "./touch.ts";

const BOLT_COLORS = { marines: 0xff4a4a, wooka: 0x8cff5a };
// The glow out the back: the Thunder Marines' ion engines, the Wooka's bonfires.
const TRAIL_COLORS = { marines: 0x5ab8ff, wooka: 0xff8a30 };
const FIRE = [0xffd27a, 0xff9a3a, 0xff5a1a], SMOKE = [0x2a2826, 0x3a3632, 0x1c1b1a];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;

// `watch`: the AI flies the hero's fighter and the camera follows it (the `?orbit=1&watch=1` jump link).
export function playSpaceBattle(spec: SpaceBattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement, opts: { watch?: boolean } = {}): Promise<SpaceBattleResult> {
  const b = startSpaceBattle(spec);
  const heroSide = spec.hero;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);
  const camera = new THREE.PerspectiveCamera(48, 1, 1, 8000);
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1408, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d0, 2);
  sun.position.set(300, 400, -200);
  scene.add(sun);
  // Film-like tone mapping, as on the ground, and something for the metal to reflect: black space
  // above, the planet's green glow below and the sun. Baked once into an environment map.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vP; void main() { float y = normalize(vP).y; vec3 below = mix(vec3(0.05, 0.12, 0.08), vec3(0.12, 0.22, 0.32), smoothstep(-0.6, -0.05, y)); gl_FragColor = vec4(mix(below, vec3(0.01, 0.012, 0.025), smoothstep(-0.05, 0.15, y)), 1.0); }`,
  })));
  const envSun = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1d0).multiplyScalar(30) }));
  envSun.position.copy(sun.position).normalize().multiplyScalar(8);
  envScene.add(envSun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  pmrem.dispose();

  // The planet below, its atmosphere, and the stars.
  // Doren from orbit: forest in many greens, lakes and rivers of dark water, bare ridges, and over
  // it all a cloud layer of its own that drifts a little faster than the ground turns.
  // Each blob is drawn again a map's width either side, so nothing tears at the seam.
  const blob = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a: number, w: number) => {
    for (const dx of [-w, 0, w]) { c.beginPath(); c.ellipse(x + dx, y, rx, ry, a, 0, Math.PI * 2); c.fill(); }
  };
  const land = texture("planet", 1024, 512, [1, 1], (c, r) => {
    c.fillStyle = "#2c5536"; c.fillRect(0, 0, 1024, 512);
    // Forest, in layers from broad to fine: old growth darker, younger and higher ground lighter.
    for (const [n, size, cols] of [[90, 80, ["rgba(18,46,28,0.45)", "rgba(70,110,60,0.35)"]], [500, 26, ["rgba(22,58,32,0.4)", "rgba(88,124,70,0.3)", "rgba(50,84,44,0.4)"]], [2200, 7, ["rgba(16,40,24,0.35)", "rgba(96,132,78,0.25)"]]] as const) {
      for (let i = 0; i < n; i++) { c.fillStyle = cols[Math.floor(r() * cols.length)]!; blob(c, r() * 1024, r() * 512, size * (0.4 + r()), size * (0.2 + r() * 0.5), r() * 3, 1024); }
    }
    // Ridges of bare rock, in strings.
    for (let i = 0; i < 14; i++) {
      let x = r() * 1024, y = 60 + r() * 392, a = r() * Math.PI * 2;
      for (let k = 0; k < 30; k++) { c.fillStyle = r() < 0.5 ? "rgba(128,120,98,0.45)" : "rgba(170,160,135,0.3)"; blob(c, x, y, 5 + r() * 6, 2 + r() * 3, a, 1024); a += (r() - 0.5) * 0.6; x += Math.cos(a) * 7; y += Math.sin(a) * 4; }
    }
    // Lakes, and rivers wandering out of them.
    for (let i = 0; i < 26; i++) {
      const x = r() * 1024, y = 70 + r() * 372;
      c.fillStyle = "rgba(14,40,58,0.95)"; blob(c, x, y, 6 + r() * 22, 4 + r() * 10, r() * 3, 1024);
      c.strokeStyle = "rgba(16,46,64,0.8)"; c.lineWidth = 1.2;
      c.beginPath(); let px = x, py = y; c.moveTo(px, py);
      for (let k = 0; k < 18; k++) { px += (r() - 0.5) * 22; py += (r() - 0.3) * 10; c.lineTo(px, py); }
      c.stroke();
    }
    // Cold at the poles.
    for (const y of [0, 512]) { const g = c.createLinearGradient(0, y, 0, y ? y - 40 : 40); g.addColorStop(0, "rgba(225,235,240,0.9)"); g.addColorStop(1, "rgba(225,235,240,0)"); c.fillStyle = g; c.fillRect(0, y ? y - 40 : 0, 1024, 40); }
  });
  const cloudMap = texture("planet-clouds", 1024, 512, [1, 1], (c, r) => {
    // Bands of weather: long streaks, then knots of thicker cloud along them.
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.16})`; blob(c, r() * 1024, r() * 512, 20 + r() * 90, 2 + r() * 7, (r() - 0.5) * 0.3, 1024); }
    for (let i = 0; i < 70; i++) {
      const x = r() * 1024, y = r() * 512;
      for (let k = 0; k < 12; k++) { c.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`; blob(c, x + (r() - 0.5) * 50, y + (r() - 0.5) * 20, 6 + r() * 16, 4 + r() * 9, r() * 3, 1024); }
    }
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1400, 96, 48), new THREE.MeshLambertMaterial({ color: 0xffffff, map: land }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1412, 96, 48), new THREE.MeshLambertMaterial({ color: 0xffffff, map: cloudMap, transparent: true, depthWrite: false }));
  planet.add(clouds);
  planet.position.set(0, -1700, -400);
  // Tipped on its side, so the poles (where the map pinches) face neither camera, and turning slowly.
  planet.rotation.order = "ZXY";
  planet.rotation.z = Math.PI / 2;
  // The air: a haze just off the planet's edge, fading out into space. Seen from inside the shell,
  // so the faces point away and the limb is where they turn side-on.
  const air = new THREE.Mesh(new THREE.SphereGeometry(1470, 64, 32), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0x6fb8ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV; void main() { float d = -dot(vN, vV); float rim = pow(clamp(d / 0.3, 0.0, 1.0), 2.5); gl_FragColor = vec4(color * rim * 0.9, 1.0); }`,
  }));
  air.position.copy(planet.position);
  let seed = spec.seed;
  const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  // Stars, most faint, a few bright, from cool red through white to blue.
  const starPts: number[] = [], starCols: number[] = [], tint = new THREE.Color();
  for (let i = 0; i < 2400; i++) {
    const v = new THREE.Vector3(r() - 0.5, r() * 0.9 - 0.2, r() - 0.5).normalize().multiplyScalar(4000);
    starPts.push(v.x, v.y, v.z);
    const bright = 0.25 + 0.75 * r() ** 3, t = r();
    tint.setRGB(t < 0.15 ? 1 : t > 0.85 ? 0.75 : 1, t < 0.15 ? 0.8 : 0.95, t < 0.15 ? 0.65 : 1).multiplyScalar(bright);
    starCols.push(tint.r, tint.g, tint.b);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
  starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starCols, 3));
  scene.add(planet, air, new THREE.Points(starGeo, new THREE.PointsMaterial({ vertexColors: true, size: 1.8, sizeAttenuation: false })));
  // The sun, far off where the light comes from: a white-hot disc in a wide soft glow.
  const glowTex = texture("sun-glow", 128, 128, [1, 1], (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.08, "rgba(255,248,225,0.95)"); g.addColorStop(0.25, "rgba(255,220,160,0.25)"); g.addColorStop(1, "rgba(255,200,140,0)");
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunGlow.position.copy(sun.position).normalize().multiplyScalar(3600);
  sunGlow.scale.setScalar(900);
  scene.add(sunGlow);

  // The battle's plane: a faint tactical grid under it, and drop lines from the capital ships.
  const PLANE = -40;
  const grid = new THREE.GridHelper(1000, 40, 0x3b5a8a, 0x22324f);
  grid.position.y = PLANE;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  const dropGeo = new THREE.BufferGeometry();
  const drops = new THREE.LineSegments(dropGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }));
  scene.add(grid, drops);

  // Craft, by id. A dot over each one too, so a fighter far off is still something to chase.
  const meshes = new Map<number, THREE.Group>();
  const makeMesh = (u: (typeof b.craft)[number]) => {
    const f = spec.factions[u.side];
    const g = u.kind === "cruiser" ? cruiser(f) : fighter(f, u.kind === "hero");
    g.rotation.order = "YXZ";
    g.userData.cruiser = u.kind === "cruiser";
    if (u.kind !== "cruiser") g.scale.setScalar(1.8); // fighters, big enough to follow from up here
    // A soft halo on the engines, so a ship reads as lit from across the battle. It rides the
    // flame joint, so it flickers with the fire.
    const flame = g.getObjectByName("flame");
    if (flame) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: TRAIL_COLORS[f], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      halo.scale.setScalar(u.kind === "cruiser" ? 34 : 3.2);
      halo.position.z = u.kind === "cruiser" ? 4 : 0.6;
      halo.name = "halo";
      flame.add(halo);
    }
    scene.add(g);
    return g;
  };
  const dotGeo = new THREE.BufferGeometry();
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8 }));
  scene.add(dots);
  const col = new THREE.Color();
  const drawBolts = makeBolts(scene), glows = makeParticles(scene, 1800, true), smoke = makeParticles(scene, 900, false);
  const trails = makeTrails(scene), rings = makeRings(scene);
  const boltCol = { marines: new THREE.Color(BOLT_COLORS.marines), wooka: new THREE.Color(BOLT_COLORS.wooka) };
  const trailCol = { marines: new THREE.Color(TRAIL_COLORS.marines), wooka: new THREE.Color(TRAIL_COLORS.wooka) };
  const landed = new WeakSet<object>(), boltDraws: BoltDraw[] = [];
  const rnd = (k: number) => (Math.random() - 0.5) * 2 * k;
  // Sparks off a hit: a quick white-hot spray and a flash.
  const sparks = (x: number, y: number, z: number, n: number, speed: number, color = 0xffe6b0) => {
    glows.add({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.12, size: 3 + n * 0.3, grow: 0.5, color: 0xffffff });
    for (let i = 0; i < n; i++) glows.add({ x, y, z, vx: rnd(speed), vy: rnd(speed), vz: rnd(speed), life: 0.25 + Math.random() * 0.35, size: 0.7 + Math.random() * 0.6, grow: -0.6, color, drag: 2 });
  };
  // A craft going up: a fireball, burning debris flung out, smoke left hanging, and for a ship of
  // the line a shock ring.
  const explode = (x: number, y: number, z: number, big: boolean) => {
    const k = big ? 1 : 0.25;
    glows.add({ x, y, z, vx: 0, vy: 0, vz: 0, life: big ? 0.5 : 0.25, size: big ? 90 : 18, grow: 0.6, color: 0xfff4dc });
    for (let i = 0; i < (big ? 70 : 18); i++) glows.add({ x: x + rnd(8 * k), y: y + rnd(6 * k), z: z + rnd(20 * k), vx: rnd(20 * k), vy: rnd(14 * k), vz: rnd(20 * k), life: 0.6 + Math.random() * (big ? 1.4 : 0.5), size: (6 + Math.random() * 10) * k * (big ? 1.4 : 2.2), grow: 1.2, color: pick(FIRE), drag: 1.5 });
    for (let i = 0; i < (big ? 60 : 14); i++) glows.add({ x, y, z, vx: rnd(90 * k + 25), vy: rnd(60 * k + 15), vz: rnd(90 * k + 25), life: 0.8 + Math.random() * (big ? 2.2 : 0.8), size: 0.8 + Math.random() * 1.2, grow: -0.5, color: pick(FIRE), drag: 0.4 });
    for (let i = 0; i < (big ? 40 : 8); i++) smoke.add({ x: x + rnd(10 * k), y: y + rnd(6 * k), z: z + rnd(24 * k), vx: rnd(8 * k + 3), vy: rnd(5 * k + 2), vz: rnd(8 * k + 3), life: 2.5 + Math.random() * (big ? 4 : 1.5), size: (10 + Math.random() * 10) * (big ? 1.2 : 0.5), grow: 1.5, color: pick(SMOKE), drag: 0.6 });
    if (big) { rings.add(x, y, z, 150, 1.4); rings.add(x, y, z, 70, 0.8); }
  };
  // Where on a cruiser's hull a hit or a fire is: somewhere along its length, on its skin.
  const onHull = (u: { x: number; y: number; z: number }, seed: number) => {
    const a = seed * 2.399, along = ((seed * 0.618) % 1) * 2 - 1;
    return { x: u.x + Math.cos(a) * HULL.r * 0.9, y: u.y + Math.abs(Math.sin(a)) * HULL.r * 0.7, z: u.z + along * HULL.half * 0.85 };
  };
  let trailAt = 0;
  // A dead cruiser's hull stays a while: its own darkened copy of the paint, tumbling slowly off
  // towards the planet, burning, with the odd blast going off inside before it fades.
  type Wreck = { m: THREE.Object3D; t: number; spin: THREE.Vector3; drift: THREE.Vector3; mats: THREE.Material[] };
  const wrecks: Wreck[] = [];
  const WRECK_LIFE = 14;
  const wreck = (m: THREE.Object3D) => {
    const mats: THREE.Material[] = [];
    m.traverse((o) => {
      if (o.name === "halo" || o.name === "flame") { o.visible = false; return; }
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      const c = o.material.clone();
      c.color.multiplyScalar(0.3);
      c.transparent = true;
      o.material = c;
      mats.push(c);
    });
    wrecks.push({ m, t: 0, mats, spin: new THREE.Vector3(rnd(0.08), rnd(0.05), rnd(0.12)), drift: new THREE.Vector3(rnd(3), -2 - Math.random() * 3, rnd(3)) });
  };
  const stepWrecks = (dt: number) => {
    for (let i = wrecks.length - 1; i >= 0; i--) {
      const w = wrecks[i]!, m = w.m;
      w.t += dt;
      m.rotation.x += w.spin.x * dt; m.rotation.y += w.spin.y * dt; m.rotation.z += w.spin.z * dt;
      m.position.addScaledVector(w.drift, dt);
      const fade = Math.max(0, 1 - Math.max(0, w.t - WRECK_LIFE * 0.6) / (WRECK_LIFE * 0.4));
      for (const c of w.mats) c.opacity = fade;
      if (w.t < WRECK_LIFE * 0.7 && Math.random() < dt * 6) {
        const p = onHull(m.position, Math.random() * 100);
        glows.add({ ...p, vx: rnd(2), vy: 2 + Math.random() * 3, vz: rnd(2), life: 0.5 + Math.random() * 0.5, size: 4 + Math.random() * 4, grow: 0.8, color: pick(FIRE) });
        smoke.add({ ...p, vx: rnd(3), vy: 3 + Math.random() * 3, vz: rnd(3), life: 3 + Math.random() * 2, size: 6 + Math.random() * 6, grow: 2, color: pick(SMOKE), drag: 0.3 });
      }
      if (w.t < WRECK_LIFE * 0.5 && Math.random() < dt * 0.5) { const p = onHull(m.position, Math.random() * 100); explode(p.x, p.y, p.z, false); sfx.boom(p, false); }
      if (w.t >= WRECK_LIFE) { scene.remove(m); wrecks.splice(i, 1); for (const c of w.mats) c.dispose(); }
    }
  };

  // Input: the fighter turns towards the point on the battle's plane under the mouse.
  const keys = new Set<string>(), mouse = new THREE.Vector2(0, 0.3), ray = new THREE.Raycaster();
  const back = heroSide === "attacker" ? 1 : -1; // the camera sits behind your own line
  let aimYaw = heroSide === "attacker" ? 0 : Math.PI, aimPitch = 0, firing = false, zoom = 1;
  // Sound: bolts and blasts, as on the ground (sfx.ts), carrying further. M mutes.
  const sfx = makeSfx(6), heard = new WeakSet<object>();
  const kd = (e: KeyboardEvent) => { sfx.wake(); if (e.key.toLowerCase() === settings.keys.mute && !e.repeat) sfx.toggle(); keys.add(e.key.toLowerCase()); }, ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const md = (e: MouseEvent) => { sfx.wake(); if (e.button === 0) firing = true; };
  const mu = (e: MouseEvent) => { if (e.button === 0) firing = false; };
  const mm = (e: MouseEvent) => {
    const box = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
  };
  const wheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(2.2, zoom * Math.exp(e.deltaY * 0.001))); };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  canvas.addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("mousemove", mm);
  canvas.addEventListener("wheel", wheel, { passive: false });
  // A phone: a finger on the field steers towards it; buttons fire, boost and brake (touch.ts).
  const touch = isTouch();
  const unTouch = touch ? mountTouch(canvas.parentElement!, canvas, {
    drag: (_dx, _dy, x, y) => { const box = canvas.getBoundingClientRect(); mouse.set(((x - box.left) / box.width) * 2 - 1, -((y - box.top) / box.height) * 2 + 1); },
    buttons: [
      { id: "fire", icon: "crosshair", label: "Fire", hold: true, on: (d) => { sfx.wake(); firing = d; } },
      { id: "boost", icon: "chevrons-up", label: "Boost", hold: true, on: (d) => { d ? keys.add(settings.keys.forward) : keys.delete(settings.keys.forward); } },
      { id: "brake", icon: "octagon", label: "Brake", hold: true, on: (d) => { d ? keys.add(settings.keys.back) : keys.delete(settings.keys.back); } },
    ],
  }) : null;
  document.body.classList.add("space-2d");
  const aimPoint = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // Where the mouse points on the hero's level, and so where to turn.
  const steer = (at: { x: number; y: number; z: number }) => {
    plane.constant = -at.y;
    ray.setFromCamera(mouse, camera);
    if (!ray.ray.intersectPlane(plane, aimPoint)) return;
    const dx = aimPoint.x - at.x, dz = aimPoint.z - at.z;
    if (dx * dx + dz * dz > 4) aimYaw = Math.atan2(-dx, -dz);
    aimPitch = Math.max(-0.4, Math.min(0.4, -at.y * 0.03)); // drift back to the plane
  };
  const follow = new THREE.Vector3(0, 0, back * (LINE + 60));

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    pointScale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  };
  let pointScale = 400;
  addEventListener("resize", resize);
  resize();
  // Over the canvas: arrows at the edge to the enemy cruisers out of sight, a bracket on what your
  // guns would hit, and a red flash when you're hit.
  const over = document.createElement("div");
  over.className = "space-over";
  over.innerHTML = `<div class="sv-hurt"></div><div class="sv-lock"></div>`;
  canvas.parentElement!.append(over);
  const hurtEl = over.querySelector<HTMLElement>(".sv-hurt")!, lockEl = over.querySelector<HTMLElement>(".sv-lock")!;
  const arrows: HTMLElement[] = [];
  const proj = new THREE.Vector3();
  let heroHp = Infinity;
  let handOver = false;
  hud.onpointerdown = (e) => { if ((e.target as HTMLElement).id === "b-auto") handOver = true; };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const drawHud = () => {
    const hero = heroCraft(b), mine = heroSide, foe: Side = mine === "attacker" ? "defender" : "attacker";
    const fleet = (s: Side) => {
      const line = b.craft.filter((u) => u.side === s && u.kind === "cruiser");
      const hull = line.reduce((n, u) => n + u.hp, 0) / Math.max(1, spec.fleets[s] * SPACE_STATS.cruiser.hp);
      return `<div class="tickets ${spec.factions[s]}" title="Cruisers still up, and their hull left"><b>${s === mine ? "You" : "Enemy"}</b><span>▲ ${line.length}</span><i style="width:${Math.max(0, hull) * 100}%"></i></div>`;
    };
    const boost = keys.has(settings.keys.forward) ? "▶▶" : keys.has(settings.keys.back) ? "◀" : "▶";
    const help = opts.watch ? "Watching: the AI flies your fighter" : b.time < 10 ? touch ? `Drag to steer · fire, boost and brake on the right` : `Mouse steers · hold the button to fire · W boost · S brake · wheel zooms · M sound` : "";
    hud.innerHTML = `
      <div class="b-top">${fleet(mine)}
        <div class="b-clock" title="Time left. When it runs out, the side with more cruiser hull left holds the orbit (the defender on a tie)."><span class="clock">${fmt(Math.max(0, SPACE_LIMIT - b.time))}</span><sup>i</sup></div>
        ${fleet(foe)}</div>
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Launching in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span class="throttle" title="Throttle (W boost, S brake)">${boost}</span>
      </div>
      ${b.hero.out ? `<div class="sv-warn">Leaving the battle: turning back</div>` : ""}
      <ul class="b-feed">${b.events.slice(-5).map((e) => `<li>${e}</li>`).join("")}</ul>
      <div class="b-help">${help}<button id="b-auto" type="button">Let the AI finish it</button></div>`;
  };

  // Where a point lands on the canvas, in pixels, and whether it's on screen and in front.
  const toScreen = (p: { x: number; y: number; z: number }) => {
    proj.set(p.x, p.y, p.z).project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight, ahead = proj.z < 1;
    const sx = ahead ? proj.x : -proj.x, sy = ahead ? proj.y : -proj.y;
    return { x: (sx + 1) / 2 * w, y: (1 - sy) / 2 * h, on: ahead && Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1, w, h };
  };
  const overlay = (hero: ReturnType<typeof heroCraft>) => {
    const foes = b.craft.filter((u) => u.side !== heroSide && u.kind === "cruiser");
    let n = 0;
    for (const u of foes) {
      const s = toScreen(u);
      if (s.on) continue;
      // Pinned to the edge, on the line from the middle of the screen out towards it.
      const cx = s.w / 2, cy = s.h / 2, dx = s.x - cx, dy = s.y - cy, k = Math.min((cx - 28) / Math.abs(dx || 1e-6), (cy - (dy < 0 ? 70 : 28)) / Math.abs(dy || 1e-6)); // clear of the score bar
      let a = arrows[n];
      if (!a) { a = document.createElement("div"); a.className = `sv-arrow ${spec.factions[u.side]}`; a.title = "Enemy cruiser"; over.append(a); arrows.push(a); }
      a.style.display = "";
      a.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px) rotate(${Math.atan2(dy, dx)}rad)`;
      a.style.opacity = String(0.5 + 0.5 * (u.hp / u.maxHp));
      n++;
    }
    for (let i = n; i < arrows.length; i++) arrows[i]!.style.display = "none";
    const t = hero && spaceAimTarget(b, hero, SPACE_STATS.hero.range);
    if (t) {
      const s = toScreen(t), size = t.kind === "cruiser" ? 64 : 26;
      lockEl.style.display = s.on ? "" : "none";
      lockEl.style.transform = `translate(${s.x - size / 2}px, ${s.y - size / 2}px)`;
      lockEl.style.width = lockEl.style.height = `${size}px`;
    } else lockEl.style.display = "none";
    if (hero && hero.hp < heroHp) { hurtEl.classList.remove("on"); void hurtEl.offsetWidth; hurtEl.classList.add("on"); }
    heroHp = hero ? hero.hp : Infinity;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0, endAt = 0;
    const rec = spaceRecorder();
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      acc += dt;
      last = now;
      while (handOver && !b.over) stepSpace(b, null);
      while (acc >= DT && !b.over) {
        const input = rec.take({ yaw: aimYaw, pitch: aimPitch, throttle: (keys.has(settings.keys.forward) ? 1 : 0) - (keys.has(settings.keys.back) ? 1 : 0), fire: firing });
        stepSpace(b, opts.watch ? null : input);
        acc -= DT;
      }

      // Sync meshes. Fighters bank into their turns; a cruiser rides a slow swell, and anything hit flashes.
      const seen = new Set<number>(), dotPts: number[] = [], dotCols: number[] = [];
      for (const u of b.craft) {
        seen.add(u.id);
        let m = meshes.get(u.id);
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        const turn = Math.atan2(Math.sin(u.yaw - (m.userData.yaw ?? u.yaw)), Math.cos(u.yaw - (m.userData.yaw ?? u.yaw)));
        m.userData.yaw = u.yaw;
        m.position.set(u.x, u.y, u.z);
        const swell = u.kind === "cruiser" ? Math.sin(now / 1700 + u.id) * 0.025 : m.rotation.z * 0.9 + Math.max(-0.9, Math.min(0.9, turn * 12)) * 0.1;
        m.rotation.set(u.pitch + (u.kind === "cruiser" ? Math.sin(now / 2300 + u.id * 2) * 0.012 : 0), u.yaw, swell);
        if (u.kind === "cruiser" && u.hurt > (m.userData.hurt ?? 0)) { const p = onHull(u, Math.random() * 100); sparks(p.x, p.y, p.z, 8, 22); }
        m.userData.hurt = u.hurt;
        animate(m, { t: now / 1000, dt, moved: 0, since: 9 }); // engine fire flickers
        if (u.id === b.hero.id && !opts.watch) { const h = m.getObjectByName("halo"); if (h) h.scale.setScalar(3.2 * (keys.has(settings.keys.forward) ? 1.8 : keys.has(settings.keys.back) ? 0.5 : 1)); }
        if (u.id !== b.hero.id) {
          dotPts.push(u.x, u.y, u.z);
          col.setHex(FACTION_COLORS[spec.factions[u.side]]);
          dotCols.push(col.r, col.g, col.b);
        }
      }
      for (const [id, m] of meshes) if (!seen.has(id)) {
        meshes.delete(id);
        if (m.userData.cruiser) wreck(m);
        else scene.remove(m);
      }
      stepWrecks(dt);
      const dropPts: number[] = [], dropCols: number[] = [];
      for (const u of b.craft) {
        if (u.kind === "fighter") continue;
        dropPts.push(u.x, u.y, u.z, u.x, PLANE, u.z);
        col.setHex(u.kind === "hero" ? 0xffc640 : FACTION_COLORS[spec.factions[u.side]]);
        dropCols.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
      dropGeo.setAttribute("position", new THREE.Float32BufferAttribute(dropPts, 3));
      dropGeo.setAttribute("color", new THREE.Float32BufferAttribute(dropCols, 3));
      dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPts, 3));
      dotGeo.setAttribute("color", new THREE.Float32BufferAttribute(dotCols, 3));
      const me = heroCraft(b);
      sfx.hear({ x: follow.x, z: follow.z, rx: back === 1 ? 1 : -1, rz: 0 });
      let lasers = 0;
      for (const f of b.bolts) if (!heard.has(f)) {
        heard.add(f);
        const mine = !!me && Math.hypot(f.x - me.x, f.z - me.z) < 8;
        if (mine || lasers++ < 6) sfx.laser(mine ? null : f, f.heavy, mine ? 0.28 : 0.3);
        glows.add({ x: f.x, y: f.y, z: f.z, vx: 0, vy: 0, vz: 0, life: f.heavy ? 0.2 : 0.08, size: f.heavy ? 9 : 3, grow: 0.4, color: BOLT_COLORS[spec.factions[f.side]] }); // muzzle flash
      }
      for (const f of b.blasts) if (!heard.has(f)) { heard.add(f); sfx.boom(f, f.big); explode(f.x, f.y, f.z, f.big); }
      // Bolts fly the gap; one that lands on something throws sparks.
      boltDraws.length = 0;
      for (const f of b.bolts) {
        const at = Math.min(1, 1 - (f.t - acc) / f.life);
        boltDraws.push({ ax: f.x, ay: f.y, az: f.z, bx: f.tx, by: f.ty, bz: f.tz, at, len: f.heavy ? 26 : 10, w: f.heavy ? 0.55 : 0.28, color: boltCol[spec.factions[f.side]] });
        if (f.hit && f.t <= DT + 1e-6 && !landed.has(f)) { landed.add(f); sparks(f.tx, f.ty, f.tz, f.heavy ? 22 : 6, f.heavy ? 40 : 18); }
      }
      drawBolts(boltDraws);
      // A cruiser below half its hull burns, and smokes; under a quarter it burns all over.
      for (const u of b.craft) {
        if (u.kind !== "cruiser" || u.hp > u.maxHp * 0.6) continue;
        const fires = u.hp < u.maxHp * 0.25 ? 4 : u.hp < u.maxHp * 0.45 ? 2 : 1;
        for (let i = 0; i < fires; i++) {
          if (Math.random() > dt * 14) continue;
          const p = onHull(u, u.id * 7 + i * 3 + 1);
          glows.add({ ...p, vx: rnd(2), vy: 3 + Math.random() * 4, vz: rnd(2), life: 0.4 + Math.random() * 0.4, size: 3 + Math.random() * 3, grow: 0.8, color: pick(FIRE) });
          if (Math.random() < 0.5) smoke.add({ ...p, vx: rnd(3), vy: 4 + Math.random() * 4, vz: rnd(3) + back * 4, life: 2 + Math.random() * 2, size: 5 + Math.random() * 5, grow: 2, color: pick(SMOKE), drag: 0.3 });
        }
      }
      glows.step(dt, pointScale); smoke.step(dt, pointScale); rings.step(dt);
      // Trails, sampled at a steady rate so their length is time, not frames.
      if ((trailAt -= dt) <= 0) {
        trailAt = 0.045;
        for (const u of b.craft) if (u.kind !== "cruiser") trails.push(u.id, u.x, u.y, u.z, trailCol[spec.factions[u.side]]);
        trails.sweep();
      }
      trails.draw((id) => meshes.get(id)?.position ?? null);

      // The camera looks down from behind your own line and eases after the hero; while the hero
      // is down it waits over your line.
      const hero = heroCraft(b);
      const at = hero ?? { x: 0, y: 0, z: back * (LINE + 60) };
      // Ahead of the hero, along where it's flying, so what's coming is on screen before it arrives.
      // A tall, narrow screen (a phone held upright) sees little side to side: stand further back.
      const z = zoom * Math.max(1, Math.sqrt(1.3 / camera.aspect));
      const lead = hero ? 45 * z : 0;
      follow.lerp(new THREE.Vector3(at.x - Math.sin(hero?.yaw ?? 0) * lead, at.y, at.z - Math.cos(hero?.yaw ?? 0) * lead), 1 - Math.exp(-dt * 3));
      camera.position.set(follow.x, follow.y + 240 * z, follow.z + back * 160 * z);
      camera.lookAt(follow.x, follow.y, follow.z - back * 20 * z);
      if (hero) steer(hero);

      planet.rotation.y += dt * 0.004;
      clouds.rotation.y += dt * 0.0025;
      renderer.render(scene, camera);
      overlay(hero);
      if (now - hudAt > 100 && !b.over) { drawHud(); hudAt = now; }
      // Once it's decided, the last blasts play out for a few seconds before the result. Handed
      // to the AI, it's straight to the result.
      if (b.over && endAt === 0) {
        endAt = handOver ? now : now + 3500;
        const won = b.over.winner === heroSide;
        if (!handOver) hud.insertAdjacentHTML("beforeend", `<div class="sv-end ${won ? "won" : "lost"}">${won ? "The orbit is ours" : "The orbit is lost"}</div>`);
      }
      if (b.over && now >= endAt) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md); canvas.removeEventListener("wheel", wheel);
        unTouch?.();
        document.body.classList.remove("space-2d");
        over.remove();
        env.dispose();
        renderer.dispose();
        sfx.close();
        hud.onpointerdown = null;
        resolve({ ...b.over, inputs: rec.log() });
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
