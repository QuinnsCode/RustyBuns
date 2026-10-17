// Draws a Battle in three.js and turns the keyboard and mouse into the hero's Input.
// Third person: WASD to move, the mouse to look, click to fire, Q for an orbital strike where
// you're aiming, E to climb into or out of a vehicle (as a champion: Warbur's throw, or Gumpert's
// change of kit). Things that die come apart in chunks, and blasts throw dirt.
import * as THREE from "three";
import { FACTION_COLORS, type BattleResult, type BattleSpec, type Side } from "./contract.ts";
import { groundRecorder } from "./replay.ts";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { animate, gunship, marine, speeder, tank, turret, walker, wooka } from "./models.ts";
import { buildWorld } from "./terrain.ts";
import { boom, whoosh, wooka as wookaCall, zap } from "./sound.ts";
import { CHAMP_AT, SPRINT_AFTER, DT, POST_RADIUS, SPAWN, STRIKE_RADIUS, TROOPERS, altitude, facing, heroUnit, inPlay, isHorde, startBattle, statsOf, step, timeLimit, vipUnit, type Fx, type Trooper, type Unit } from "./sim.ts";

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

  // Halo-style outline on the enemy: bright where you can see them, dim where foliage or a wall
  // is in front, so a Wooka coming through the ferns still reads.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
  outline.edgeStrength = 5;
  outline.edgeThickness = 2;
  outline.visibleEdgeColor.set(0xff5a2a);
  outline.hiddenEdgeColor.set(0xc0381c);
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
  feel.innerHTML = `<div class="b-hurt"></div><div class="b-heat"><i></i></div><div class="b-toast"></div>`;
  canvas.parentElement!.append(feel);
  const hurtEl = feel.querySelector<HTMLElement>(".b-hurt")!, heatEl = feel.querySelector<HTMLElement>(".b-heat")!, toastEl = feel.querySelector<HTMLElement>(".b-toast")!;
  const foeHorde = isHorde(b, heroSide === "attacker" ? "defender" : "attacker");
  const STREAK: Record<number, string> = foeHorde
    ? { 2: "Two in a row", 3: "Three. Fluff everywhere", 5: "Five. They'll sing about you. Badly", 8: "Eight. The forest has gone quiet", 12: "Twelve. Command is concerned about you" }
    : { 2: "Two backpacks", 3: "Three. Start a collection", 5: "Five. The totems need helmets", 8: "Eight. The shiny ones are all crying", 12: "Twelve. The chieftain wants a word" };
  let hurt = 0, shake = 0, lastHp = Infinity, lastKills = 0, toastT = 0, markT = 0, chatterT = 0;
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
  const drawHud = () => {
    const hero = heroUnit(b), mine = heroSide, foe = mine === "attacker" ? "defender" : "attacker";
    const riding = b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle);
    const bar = (s: Side) => `<div class="tickets ${spec.factions[s]}"><b>${s === mine ? "You" : "Enemy"}</b><span>${Math.max(0, Math.ceil(b.tickets[s]))}</span><i style="width:${Math.min(100, (100 * Math.max(0, b.tickets[s])) / (spec.tickets[s] + spec.reinforcements[s]))}%"></i></div>`;
    hud.innerHTML = `
      <div class="b-top">${bar(mine)}
        <div class="b-clock" title="${b.mode === "conquest" || b.mode === "hill" ? "Time left. When it runs out, the side with more tickets wins (the defender on a tie)." : "Time left. When it runs out, the defender has held."}"><span class="clock">${fmt(Math.max(0, timeLimit(spec) - b.time))}</span><sup>i</sup></div>
        ${bar(foe)}</div>
      <div class="b-posts">${objectiveLine()}${b.posts.map((p, i) => `<span class="post ${p.owner ? spec.factions[p.owner] : ""}${inPlay(b, i) ? "" : " out"}">${p.name}</span>`).join("")}</div>
      <div class="b-hero">
        ${hero ? `<div class="hp"><i style="width:${(100 * hero.hp) / hero.maxHp}%"></i></div>` : `<div class="respawn">${b.hero.lives > 0 ? `Back in ${Math.ceil(b.hero.respawn)}s` : "Your hero is down"}</div>`}
        <span title="Lives">♥ ${b.hero.lives}</span>
        <span title="Orbital strikes (Q)">☄ ${b.strikesLeft[mine]}</span>
        ${riding ? `<span title="Driving a ${riding.kind} (E to get out)">▣</span>` : ""}
        ${hero?.champ ? `<span class="champ-on">${hero.champ === "warbur" ? "WARBUR · E throws a Wooka" : `GUMPERT · ${hero.kit} · E swaps kit`}</span>`
          : `<span class="champ" title="Kills till your champion takes the field">${champName}<i style="width:${Math.min(100, (100 * b.kills[mine]) / CHAMP_AT)}%"></i></span>`}
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
          if (f.kind === "blast") burst(f.x, fy + 0.3, f.z, f.big ? 60 : 14, DIRT, f.big ? 14 : 7);
          // Sound, loudest near the hero: bolts, booms, thrown spears and the Wooka's cries.
          const dist = me ? Math.hypot(f.x - me.x, f.z - me.z) : 60, shooter = f.from === undefined ? undefined : b.units.find((u) => u.id === f.from);
          if (f.kind === "shot") zap(dist, !shooter || !isHorde(b, shooter.side));
          else if (f.kind === "blast") boom(dist, !!f.big);
          else if (f.kind === "spear" || f.kind === "hex") { whoosh(dist); wookaCall(dist, shooter?.role === "chub" ? 1.5 : 1); }
          else if (f.kind === "toss") wookaCall(dist, 2, true);
          else if (f.kind === "gore" && f.side && isHorde(b, f.side)) wookaCall(dist, f.big ? 1.6 : 1, true);
        }
        if (f.kind === "shot") pts.push(f.x, (f.y ?? 0) + 1.0 + fy, f.z, f.tx, (f.ty ?? 0) + 0.8 + ground(f.tx, f.tz), f.tz);
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
      b.strikes.forEach((s, i) => { const m = pooled(marks, i, () => { const x = new THREE.Mesh(markGeo, markMat); x.rotation.x = -Math.PI / 2; return x; }); m.position.set(s.x, 0.15 + ground(s.x, s.z), s.z); });
      for (let i = b.strikes.length; i < marks.length; i++) marks[i]!.visible = false;

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
      // The horde chatters: now and then one of the Wooka nearest the hero calls out.
      if ((chatterT -= dt) <= 0) {
        chatterT = 0.4 + Math.random() * 1.1;
        const me = heroUnit(b), near = b.units.filter((u) => u.kind === "wooka" && me && Math.hypot(u.x - me.x, u.z - me.z) < 90);
        const u = near[Math.floor(Math.random() * near.length)];
        if (u && me) wookaCall(Math.hypot(u.x - me.x, u.z - me.z), u.role === "chub" ? 1.5 : u.role === "boomie" ? 0.8 : 1, u.role === "boomie");
      }

      // Third-person camera over the hero's shoulder (or the vehicle's), or over the spawn while down.
      const hero = heroUnit(b);
      const body = (b.hero.inVehicle !== null && b.units.find((u) => u.id === b.hero.inVehicle)) || hero;
      const at = body ?? { x: 0, z: heroSide === "attacker" ? SPAWN.attacker.z : SPAWN.defender.z };
      const [back, high] = body?.champ === "warbur" ? [11, 5.5] : !body || body.kind === "hero" ? [7, 3.2] : body.kind === "walker" ? [15, 10] : body.kind === "gunship" ? [18, 6] : [13, 6];
      const floor = ground(at.x, at.z), up = high + (body ? altitude(body) : 0) + floor;
      const f = facing(yaw);
      camera.position.set(at.x - f.x * back * Math.cos(pitch) + -f.z * 1.2, up - Math.sin(pitch) * back, at.z - f.z * back * Math.cos(pitch) + f.x * 1.2);
      // Never under the floor behind you.
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
      camera.lookAt(at.x + f.x * 20, floor + (body ? altitude(body) : 0) + 1.6 + Math.sin(pitch) * 20, at.z + f.z * 20);
      if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      world.update(now / 1000, camera.position, { x: at.x + f.x * 30, z: at.z + f.z * 30 });

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
        feel.remove();
        cross?.classList.remove("hit");
        composer.dispose();
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
