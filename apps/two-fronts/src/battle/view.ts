// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a vehicle.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { groundRecorder } from "./replay.ts";
import { animate, gunship, marine, speeder, tank, turret, walker, wooka } from "./models.ts";
import { buildWorld } from "./terrain.ts";
import { DT, POST_RADIUS, STATS, STRIKE_RADIUS, TIME_LIMIT, TROOPERS, altitude, facing, heroUnit, startBattle, step, type Trooper, type Unit } from "./sim.ts";

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
    scene.add(ring, pole, flag, beam);
    return { ring, flag, beam };
  });
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
        if (!m) meshes.set(u.id, (m = makeMesh(u)));
        m.position.set(u.x, altitude(u) + ground(u.x, u.z), u.z);
        m.rotation.y = u.yaw;
        // Walk cycles from how far it moved; recoil and club swings from how long since it fired.
        const last = m.userData.last as { x: number; z: number }, moved = Math.hypot(u.x - last.x, u.z - last.z);
        last.x = u.x; last.z = u.z;
        animate(m, { t: now / 1000, dt, moved: moved < 5 ? moved : 0, since: Math.max(0, STATS[u.kind].cool - u.cool) });
        m.visible = !(u.kind === "hero" && b.hero.inVehicle !== null);
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); meshes.delete(id); }
      posts.forEach((p, i) => {
        const post = b.posts[i]!;
        (p.flag.material as THREE.MeshStandardMaterial).color.setHex(post.owner ? color(post.owner) : 0xdddddd);
        (p.ring.material as THREE.MeshBasicMaterial).color.setHex(post.progress > 0 ? color("attacker") : post.progress < 0 ? color("defender") : 0xffffff);
        (p.beam.material as THREE.MeshBasicMaterial).color.setHex(post.owner ? color(post.owner) : 0x888888);
        p.flag.rotation.y = Math.sin(now / 700 + i) * 0.25; // it flaps
      });
      const pts: number[] = [];
      let nb = 0;
      for (const f of b.fx) {
        if (f.kind === "shot") pts.push(f.x, (f.y ?? 0) + 1.4 + ground(f.x, f.z), f.z, f.tx, (f.ty ?? 0) + 1.2 + ground(f.tx, f.tz), f.tz);
        else { const m = pooled(blasts, nb++, () => new THREE.Mesh(blastGeo, blastMat)); m.position.set(f.x, 1 + ground(f.x, f.z), f.z); m.scale.setScalar(f.t > 0.3 ? STRIKE_RADIUS : 3); }
      }
      for (let i = nb; i < blasts.length; i++) blasts[i]!.visible = false;
      shotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      b.strikes.forEach((s, i) => { const m = pooled(marks, i, () => { const x = new THREE.Mesh(markGeo, markMat); x.rotation.x = -Math.PI / 2; return x; }); m.position.set(s.x, 0.15 + ground(s.x, s.z), s.z); });
      for (let i = b.strikes.length; i < marks.length; i++) marks[i]!.visible = false;

      // Third-person camera over the hero's shoulder (or the vehicle's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inVehicle !== null && b.units.find((u) => u.id === b.hero.inVehicle)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? 100 : -100 };
      const [back, high] = !body || body.kind === "hero" ? [7, 3.2] : body.kind === "walker" ? [15, 10] : body.kind === "gunship" ? [18, 6] : [13, 6];
      const floor = ground(at.x, at.z), up = high + (body ? altitude(body) : 0) + floor;
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      // Never under the floor behind you.
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
      camera.lookAt(at.x + f.x * 20, floor + (body ? altitude(body) : 0) + 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);
      world.update(now / 1000, camera.position, { x: at.x + f.x * 30, z: at.z + f.z * 30 });

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
