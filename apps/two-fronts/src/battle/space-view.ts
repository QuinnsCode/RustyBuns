// Draws a SpaceBattle in three.js and turns the keyboard and mouse into the hero's SpaceInput.
// A chase camera: the mouse points where you want to fly and the fighter turns after it, W to
// boost, S to brake, click to fire.
import * as THREE from "three";
import { FACTION_COLORS, type Side, type SpaceBattleResult, type SpaceBattleSpec } from "./contract.ts";
import { cruiser, fighter } from "./models.ts";
import { DT, LINE, SPACE_LIMIT, SPACE_STATS, heading, heroCraft, startSpaceBattle, stepSpace, type SpaceInput } from "./space.ts";

const BOLT_COLORS = { marines: 0xff4a4a, wooka: 0x8cff5a };

export function playSpaceBattle(spec: SpaceBattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement): Promise<SpaceBattleResult> {
  const b = startSpaceBattle(spec);
  const heroSide = spec.hero;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 6000);
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1408, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d0, 2);
  sun.position.set(300, 400, -200);
  scene.add(sun);

  // The planet below, its atmosphere, and the stars.
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1400, 64, 32), new THREE.MeshLambertMaterial({ color: 0x2f5a3a }));
  planet.position.set(0, -1700, -400);
  const air = new THREE.Mesh(new THREE.SphereGeometry(1440, 64, 32), new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
  air.position.copy(planet.position);
  let seed = spec.seed;
  const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const starPts: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3(r() - 0.5, r() * 0.9 - 0.2, r() - 0.5).normalize().multiplyScalar(4000);
    starPts.push(v.x, v.y, v.z);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
  scene.add(planet, air, new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

  // Craft, by id. A dot over each one too, so a fighter far off is still something to chase.
  const meshes = new Map<number, THREE.Group>();
  const makeMesh = (u: (typeof b.craft)[number]) => {
    const f = spec.factions[u.side];
    const g = u.kind === "cruiser" ? cruiser(f) : fighter(f, u.kind === "hero");
    g.rotation.order = "YXZ";
    scene.add(g);
    return g;
  };
  const dotGeo = new THREE.BufferGeometry();
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8 }));
  const boltGeo = new THREE.BufferGeometry();
  const bolts = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  scene.add(dots, bolts);
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.75 });
  const blastGeo = new THREE.SphereGeometry(1, 12, 8);
  const blasts: THREE.Mesh[] = [];
  const col = new THREE.Color();

  // Input: the mouse sets where to fly.
  const keys = new Set<string>();
  let aimYaw = heroSide === "attacker" ? 0 : Math.PI, aimPitch = 0, firing = false;
  const kd = (e: KeyboardEvent) => keys.add(e.key.toLowerCase()), ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const md = (e: MouseEvent) => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); else if (e.button === 0) firing = true; };
  const mu = (e: MouseEvent) => { if (e.button === 0) firing = false; };
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    aimYaw -= e.movementX * 0.0025;
    aimPitch = Math.max(-1.25, Math.min(1.25, aimPitch - e.movementY * 0.0025));
  };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  canvas.addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("mousemove", mm);

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);
  resize();
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
    const boost = keys.has("w") ? "▶▶" : keys.has("s") ? "◀" : "▶";
    hud.innerHTML = `
      <div class="b-top">${fleet(mine)}
        <div class="b-clock" title="Time left. When it runs out, the side with more cruiser hull left holds the orbit (the defender on a tie)."><span class="clock">${fmt(Math.max(0, SPACE_LIMIT - b.time))}</span><sup>i</sup></div>
        ${fleet(foe)}</div>
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Launching in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span class="throttle" title="Throttle (W boost, S brake)">${boost}</span>
      </div>
      <ul class="b-feed">${b.events.slice(-5).map((e) => `<li>${e}</li>`).join("")}</ul>
      ${document.pointerLockElement === canvas ? "" : `<div class="b-help">Click to take the stick · mouse steers · W boost · S brake · click fire · Esc to let go<button id="b-auto" type="button">Let the AI finish it</button></div>`}`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (handOver && !b.over) stepSpace(b, null);
      while (acc >= DT && !b.over) {
        const input: SpaceInput = { yaw: aimYaw, pitch: aimPitch, throttle: (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0), fire: firing };
        stepSpace(b, input);
        acc -= DT;
      }

      // Sync meshes. Fighters bank into their turns.
      const seen = new Set<number>(), dotPts: number[] = [], dotCols: number[] = [];
      for (const u of b.craft) {
        seen.add(u.id);
        let m = meshes.get(u.id);
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        const turn = Math.atan2(Math.sin(u.yaw - (m.userData.yaw ?? u.yaw)), Math.cos(u.yaw - (m.userData.yaw ?? u.yaw)));
        m.userData.yaw = u.yaw;
        m.position.set(u.x, u.y, u.z);
        m.rotation.set(u.pitch, u.yaw, u.kind === "cruiser" ? 0 : m.rotation.z * 0.9 + Math.max(-0.9, Math.min(0.9, turn * 12)) * 0.1);
        if (u.id !== b.hero.id) {
          dotPts.push(u.x, u.y, u.z);
          col.setHex(FACTION_COLORS[spec.factions[u.side]]);
          dotCols.push(col.r, col.g, col.b);
        }
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); meshes.delete(id); }
      dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPts, 3));
      dotGeo.setAttribute("color", new THREE.Float32BufferAttribute(dotCols, 3));
      const pts: number[] = [], cols: number[] = [];
      for (const f of b.bolts) {
        pts.push(f.x, f.y, f.z, f.tx, f.ty, f.tz);
        col.setHex(BOLT_COLORS[spec.factions[f.side]]);
        cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
      boltGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      boltGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      b.blasts.forEach((f, i) => {
        while (blasts.length <= i) { const m = new THREE.Mesh(blastGeo, blastMat); scene.add(m); blasts.push(m); }
        const m = blasts[i]!;
        m.visible = true;
        m.position.set(f.x, f.y, f.z);
        m.scale.setScalar(f.big ? 30 * (1.4 - f.t) : 5 * (0.6 - f.t) + 1);
      });
      for (let i = b.blasts.length; i < blasts.length; i++) blasts[i]!.visible = false;

      // The chase camera sits behind the hero, looking where the mouse points; while the hero is
      // down it waits over our own line.
      const hero = heroCraft(b), aim = heading(aimYaw, aimPitch);
      const at = hero ?? { x: 0, y: 20, z: heroSide === "attacker" ? LINE + 60 : -LINE - 60 };
      camera.position.set(at.x - aim.x * 16, at.y - aim.y * 16 + 4, at.z - aim.z * 16);
      camera.lookAt(at.x + aim.x * 60, at.y + aim.y * 60 + 2, at.z + aim.z * 60);

      renderer.render(scene, camera);
      if (now - hudAt > 100 || b.over) { drawHud(); hudAt = now; }
      if (b.over) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        renderer.dispose();
        hud.onpointerdown = null;
        resolve(b.over);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
