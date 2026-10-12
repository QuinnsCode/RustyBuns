// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a vehicle.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { groundRecorder } from "./replay.ts";
import { forest, gunship, marine, speeder, tank, turret, walker, wooka } from "./models.ts";
import { DT, EYE, HALF, POST_RADIUS, STATS, STRIKE_RADIUS, TIME_LIMIT, TROOPERS, altitude, facing, heroUnit, startBattle, step, type Trooper, type Unit } from "./sim.ts";

// The light, ground and stone of each map.
const LOOKS = {
  forest: { sky: 0x8fa48a, fog: [30, 190], ground: 0x3b4a26, stone: 0x9aa4ad },
  canyon: { sky: 0xd9a77a, fog: [40, 220], ground: 0xa8663f, stone: 0x8e4f32 },
  jungle: { sky: 0x5f7a55, fog: [18, 130], ground: 0x2c3a1c, stone: 0x6f7a5e },
} as const;


export function playBattle(spec: BattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement): Promise<BattleResult> {
  const b = startBattle(spec);
  const heroSide = spec.hero;
  const color = (s: Side) => FACTION_COLORS[spec.factions[s]];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // The forest moon: green gloom, light coming down through the canopy. The canyon is dust and
  // red rock, the jungle closer and darker still.
  const look = LOOKS[spec.sector === "canyon" || spec.sector === "jungle" ? spec.sector : "forest"];
  scene.background = new THREE.Color(look.sky);
  scene.fog = new THREE.Fog(look.sky, look.fog[0], look.fog[1]);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 600);
  scene.add(new THREE.HemisphereLight(0xd6e8c4, 0x2f2a1a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.2);
  sun.position.set(40, 120, 30);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.6, HALF * 2.6), new THREE.MeshLambertMaterial({ color: look.ground }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  forest(scene, b.trees, spec.seed, HALF, spec.sector === "canyon" ? "none" : spec.sector === "jungle" ? "jungle" : "redwood");

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
  // The scenery the sim laid out, which blocks movement and sight: buildings, rock and the
  // landmark by the defender's keep in the map's stone, low walls as sandbags.
  const keep = b.posts.at(-1)!;
  const concrete = new THREE.MeshLambertMaterial({ color: look.stone });
  const stone = spec.sector === "capital" ? new THREE.MeshLambertMaterial({ color: 0xc9c2b2 }) : concrete;
  const sandbags = new THREE.MeshLambertMaterial({ color: spec.sector === "canyon" ? 0x6b5a48 : 0x8a7d5c });
  const box = (w: number, h: number, d: number, x: number, z: number, mat: THREE.Material = concrete) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    scene.add(m);
    return m;
  };
  for (const k of b.blocks) box(k.w, k.h, k.d, k.x, k.z, k.h < EYE ? sandbags : stone);
  // Then the trimmings, which are only for show.
  if (spec.sector === "shield") {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.12, depthWrite: false }));
    dome.position.set(keep.x, 0, keep.z);
    scene.add(dome);
  } else if (spec.sector === "capital") {
    ground.material.color.setHex(0x8d8a82);
    box(8, 24, 8, keep.x, keep.z - 18, stone); // the palace's tower
  } else if (spec.sector === "spaceport") {
    // Landing pads round the first post, and the control tower by the keep.
    ground.material.color.setHex(0x9b9688);
    const padMat = new THREE.MeshLambertMaterial({ color: 0x5d6168 });
    const pads = b.posts[0]!;
    for (const [dx, dz] of [[-24, -18], [24, -18], [-24, 22], [24, 22]] as const) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.4, 24), padMat);
      pad.position.set(pads.x + dx, 0.2, pads.z + dz);
      scene.add(pad);
    }
    box(10, 4, 10, keep.x + 10, keep.z - 10).position.y = 24; // the tower's cab
  } else if (spec.sector === "cannon") {
    // The anti-ship cannon: its barrel cocked at the sky over the base.
    ground.material.color.setHex(0x8f7f62);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 30, 12), new THREE.MeshLambertMaterial({ color: 0x5b6067 }));
    barrel.position.set(keep.x - 12, 16, keep.z - 22);
    barrel.rotation.x = -0.6;
    scene.add(barrel);
  } else if (spec.sector === "canyon") {
    // A conveyor from the mine head's rig, and its tower.
    box(2, 1, 30, keep.x + 12, keep.z + 4, sandbags).position.y = 6;
    box(3, 16, 3, keep.x + 16, keep.z - 16);
  } else if (spec.sector === "jungle") {
    // The temple's stepped top.
    box(14, 4, 9, keep.x, keep.z - 22).position.y = 14;
    box(8, 4, 5, keep.x, keep.z - 22).position.y = 18;
  }

  // Units, by id. Each side looks like its faction, whichever end of the field it's on.
  const meshes = new Map<number, THREE.Group>();
  const makeMesh = (u: Unit) => {
    const f = spec.factions[u.side];
    const g = u.kind === "tank" ? tank() : u.kind === "walker" ? walker() : u.kind === "speeder" ? speeder() : u.kind === "gunship" ? gunship()
      : u.kind === "turret" ? turret(f) : f === "wooka" ? wooka(u.kind === "hero") : marine(u.kind === "hero", (TROOPERS as string[]).includes(u.kind) ? (u.kind as Trooper) : "assault");
    g.userData.last = { x: u.x, z: u.z };
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
    const riding = b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle);
    const bar = (s: Side) => `<div class="tickets ${spec.factions[s]}"><b>${s === mine ? "You" : "Enemy"}</b><span>${Math.max(0, Math.ceil(b.tickets[s]))}</span><i style="width:${Math.min(100, (100 * Math.max(0, b.tickets[s])) / (spec.tickets[s] + spec.reinforcements[s]))}%"></i></div>`;
    hud.innerHTML = `
      <div class="b-top">${bar(mine)}
        <div class="b-clock" title="Time left. When it runs out, the side with more tickets wins (the defender on a tie)."><span class="clock">${fmt(Math.max(0, TIME_LIMIT - b.time))}</span><sup>i</sup></div>
        ${bar(foe)}</div>
      <div class="b-posts">${b.posts.map((p) => `<span class="post ${p.owner ? spec.factions[p.owner] : ""}">${p.name}</span>`).join("")}</div>
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Back in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span title="Orbital strikes (Q)">☄ ${b.strikesLeft[mine]}</span>
        ${riding ? `<span title="Driving a ${riding.kind} (E to get out)">▣</span>` : ""}
      </div>
      <ul class="b-feed">${b.events.slice(-5).map((e) => `<li>${e}</li>`).join("")}</ul>
      ${document.pointerLockElement === canvas ? "" : `<div class="b-help">Click the field to take control · WASD move · mouse look · click fire · Q orbital strike · E vehicle · Esc to let go<button id="b-auto" type="button">Let the AI finish it</button></div>`}`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const rec = groundRecorder();
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
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
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        m.position.set(u.x, altitude(u), u.z);
        m.rotation.y = u.yaw;
        // Wooka bounce when they run; Marine antennas wobble, more so on the move.
        const last = m.userData.last as { x: number; z: number }, moving = Math.hypot(u.x - last.x, u.z - last.z) > 0.01;
        last.x = u.x; last.z = u.z;
        const t = now / 1000 + u.id;
        if (m.userData.bob) m.userData.bob.position.y = moving ? Math.abs(Math.sin(t * 13)) * 0.14 : 0;
        for (const [i, leg] of ((m.userData.legs ?? []) as THREE.Group[]).entries()) leg.rotation.x = moving ? Math.sin(t * 4 + i * Math.PI) * 0.35 : 0;
        if (m.userData.club) m.userData.club.rotation.x = -0.6 + (u.cool > STATS.wooka.cool - 0.2 ? -1.2 : 0);
        for (const [i, a] of ((m.userData.antennas ?? []) as THREE.Group[]).entries()) {
          a.rotation.z = Math.sin(t * (5 + i) + i) * (moving ? 0.18 : 0.05);
          a.rotation.x = Math.cos(t * (4 + i)) * (moving ? 0.12 : 0.03);
        }
        m.visible = !(u.kind === "hero" && b.hero.inVehicle !== null);
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
        if (f.kind === "shot") pts.push(f.x, (f.y ?? 0) + 1.4, f.z, f.tx, (f.ty ?? 0) + 1.2, f.tz);
        else { const m = pooled(blasts, nb++, () => new THREE.Mesh(blastGeo, blastMat)); m.position.set(f.x, 1, f.z); m.scale.setScalar(f.t > 0.3 ? STRIKE_RADIUS : 3); }
      }
      for (let i = nb; i < blasts.length; i++) blasts[i]!.visible = false;
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      b.strikes.forEach((s, i) => { const m = pooled(marks, i, () => { const x = new THREE.Mesh(markGeo, markMat); x.rotation.x = -Math.PI / 2; return x; }); m.position.set(s.x, 0.1, s.z); });
      for (let i = b.strikes.length; i < marks.length; i++) marks[i]!.visible = false;

      // Third-person camera over the hero's shoulder (or the vehicle's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inVehicle !== null && b.units.find((u) => u.id === b.hero.inVehicle)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? 100 : -100 };
      const [back, high] = !body || body.kind === "hero" ? [7, 3.2] : body.kind === "walker" ? [15, 10] : body.kind === "gunship" ? [18, 6] : [13, 6];
      const up = high + (body ? altitude(body) : 0);
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      camera.lookAt(at.x + f.x * 20, (body ? altitude(body) : 0) + 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);

      renderer.render(scene, camera);
      if (now - hudAt > 100 || b.over) { drawHud(); hudAt = now; }
      if (b.over) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
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
