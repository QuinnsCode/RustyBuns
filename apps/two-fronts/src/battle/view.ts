// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a tank.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { DT, HALF, POST_RADIUS, STRIKE_RADIUS, TIME_LIMIT, facing, heroUnit, startBattle, step, type Input, type Unit } from "./sim.ts";


export function playBattle(spec: BattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement): Promise<BattleResult> {
  const b = startBattle(spec);
  const heroSide = spec.hero;
  const color = (s: Side) => FACTION_COLORS[spec.factions[s]];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9c7cf);
  scene.fog = new THREE.Fog(0xb9c7cf, 80, 260);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 600);
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x6b5a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  // The plain: grass, a scatter of rocks from the battle's seed, and the two ends of the field.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.6, HALF * 2.6), new THREE.MeshLambertMaterial({ color: 0x7d8f5a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  let seed = spec.seed;
  const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8577 });
  for (let i = 0; i < 70; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + r() * 3, 0), rockMat);
    rock.position.set((r() - 0.5) * HALF * 2, 0.4, (r() - 0.5) * HALF * 2);
    rock.rotation.set(r() * 3, r() * 3, 0);
    scene.add(rock);
  }

  // Command posts: a ring on the ground and a flag in the side's colour.
  const posts = b.posts.map((p) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(POST_RADIUS - 0.6, POST_RADIUS, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.05, p.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    pole.position.set(p.x, 4, p.z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshLambertMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
    flag.position.set(p.x + 1.5, 7, p.z);
    scene.add(ring, pole, flag);
    return { ring, flag };
  });
  // A shield sector puts the generator and its dome on the defender's post.
  const gen = b.posts[1]!;
  if (spec.sector === "shield") {
    const core = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 9, 12), new THREE.MeshLambertMaterial({ color: 0x9aa4ad }));
    core.position.set(gen.x - 6, 4.5, gen.z - 6);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.12, depthWrite: false }));
    dome.position.set(gen.x, 0, gen.z);
    scene.add(core, dome);
  } else {
    const bunker = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), new THREE.MeshLambertMaterial({ color: 0x8b8f94 }));
    bunker.position.set(gen.x - 8, 2, gen.z - 8);
    scene.add(bunker);
  }

  // Units, by id.
  const mats = { attacker: new THREE.MeshLambertMaterial({ color: color("attacker") }), defender: new THREE.MeshLambertMaterial({ color: color("defender") }) };
  const heroMat = new THREE.MeshLambertMaterial({ color: color(heroSide), emissive: 0xffc640, emissiveIntensity: 0.5 });
  const geo = {
    trooper: new THREE.CapsuleGeometry(0.45, 1.1, 4, 8),
    hero: new THREE.CapsuleGeometry(0.6, 1.4, 4, 8),
    tankBody: new THREE.BoxGeometry(3.4, 1.4, 5),
    tankTurret: new THREE.BoxGeometry(1.8, 0.9, 1.8),
    barrel: new THREE.CylinderGeometry(0.2, 0.2, 3.2),
    turret: new THREE.CylinderGeometry(1.2, 1.6, 3, 10),
  };
  const meshes = new Map<number, THREE.Object3D>();
  const makeMesh = (u: Unit) => {
    const m = mats[u.side];
    const g = new THREE.Group();
    if (u.kind === "trooper" || u.kind === "hero") {
      const body = new THREE.Mesh(u.kind === "hero" ? geo.hero : geo.trooper, u.kind === "hero" ? heroMat : m);
      body.position.y = u.kind === "hero" ? 1.3 : 1;
      g.add(body);
    } else {
      const base = new THREE.Mesh(u.kind === "tank" ? geo.tankBody : geo.turret, m);
      base.position.y = u.kind === "tank" ? 0.9 : 1.5;
      const top = new THREE.Mesh(geo.tankTurret, m);
      top.position.y = u.kind === "tank" ? 2 : 3.3;
      const barrel = new THREE.Mesh(geo.barrel, m);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, top.position.y, -1.8);
      g.add(base, top, barrel);
    }
    scene.add(g);
    return g;
  };

  // Shots are one batch of line segments; blasts and strike markers are pooled meshes.
  const shotGeo = new THREE.BufferGeometry();
  const shots = new THREE.LineSegments(shotGeo, new THREE.LineBasicMaterial({ color: 0xfff2a8 }));
  scene.add(shots);
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
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
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

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const drawHud = () => {
    const hero = heroUnit(b), mine = heroSide, foe = mine === "attacker" ? "defender" : "attacker";
    const bar = (s: Side) => `<div class="tickets ${spec.factions[s]}"><b>${s === mine ? "You" : "Enemy"}</b><span>${Math.max(0, b.tickets[s])}</span><i style="width:${Math.min(100, (100 * Math.max(0, b.tickets[s])) / (spec.tickets[s] + spec.reinforcements[s]))}%"></i></div>`;
    hud.innerHTML = `
      <div class="b-top">${bar(mine)}
        <div class="b-clock" title="Time left. When it runs out, the side with more tickets wins (the defender on a tie)."><span class="clock">${fmt(Math.max(0, TIME_LIMIT - b.time))}</span><sup>i</sup></div>
        ${bar(foe)}</div>
      <div class="b-posts">${b.posts.map((p) => `<span class="post ${p.owner ? spec.factions[p.owner] : ""}">${p.name}</span>`).join("")}</div>
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Back in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span title="Orbital strikes (Q)">☄ ${b.strikesLeft[mine]}</span>
        ${b.hero.inTank !== null ? `<span title="Driving a tank (E to get out)">▣</span>` : ""}
      </div>
      <ul class="b-feed">${b.events.slice(-5).map((e) => `<li>${e}</li>`).join("")}</ul>
      ${document.pointerLockElement === canvas ? "" : `<div class="b-help">Click the field to take control · WASD move · mouse look · click fire · Q orbital strike · E tank · Esc to let go<button id="b-auto" type="button">Let the AI finish it</button></div>`}`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (handOver && !b.over) step(b, null);
      while (acc >= DT && !b.over) {
        const input: Input = {
          forward: (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0),
          right: (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0),
          yaw, fire: firing, use,
          strike: strike ? aimPoint() ?? undefined : undefined,
        };
        strike = use = false;
        step(b, input);
        acc -= DT;
      }

      // Sync meshes.
      const seen = new Set<number>();
      for (const u of b.units) {
        seen.add(u.id);
        let m = meshes.get(u.id);
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        m.position.set(u.x, 0, u.z);
        m.rotation.y = u.yaw;
        m.visible = !(u.kind === "hero" && b.hero.inTank !== null);
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); meshes.delete(id); }
      posts.forEach((p, i) => {
        const post = b.posts[i]!;
        (p.flag.material as THREE.MeshLambertMaterial).color.setHex(post.owner ? color(post.owner) : 0xdddddd);
        (p.ring.material as THREE.MeshBasicMaterial).color.setHex(post.progress > 0 ? color("attacker") : post.progress < 0 ? color("defender") : 0xffffff);
      });
      const pts: number[] = [];
      let nb = 0;
      for (const f of b.fx) {
        if (f.kind === "shot") pts.push(f.x, 1.4, f.z, f.tx, 1.2, f.tz);
        else { const m = pooled(blasts, nb++, () => new THREE.Mesh(blastGeo, blastMat)); m.position.set(f.x, 1, f.z); m.scale.setScalar(f.t > 0.3 ? STRIKE_RADIUS : 3); }
      }
      for (let i = nb; i < blasts.length; i++) blasts[i]!.visible = false;
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      b.strikes.forEach((s, i) => { const m = pooled(marks, i, () => { const x = new THREE.Mesh(markGeo, markMat); x.rotation.x = -Math.PI / 2; return x; }); m.position.set(s.x, 0.1, s.z); });
      for (let i = b.strikes.length; i < marks.length; i++) marks[i]!.visible = false;

      // Third-person camera over the hero's shoulder (or the tank's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inTank !== null && b.units.find((u) => u.id === b.hero.inTank)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? 100 : -100 };
      const back = body?.kind === "tank" ? 13 : 7, up = body?.kind === "tank" ? 6 : 3.2;
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      camera.lookAt(at.x + f.x * 20, 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);

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
