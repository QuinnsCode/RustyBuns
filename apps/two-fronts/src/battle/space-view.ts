// Draws a SpaceBattle in three.js and turns the keyboard and mouse into the hero's SpaceInput.
// 2.5D: the camera looks down on the battle at an angle, from behind your own line, and follows
// your fighter. The fighter turns towards the mouse and holds to the battle's plane, W boosts,
// S brakes, hold the button to fire and the wheel zooms. A faint grid marks the plane, and a line
// drops from each capital ship to it, so you can tell what's high and what's low.
import * as THREE from "three";
import { FACTION_COLORS, type Side, type SpaceBattleResult, type SpaceBattleSpec } from "./contract.ts";
import { animate, cruiser, fighter, texture } from "./models.ts";
import { spaceRecorder } from "./replay.ts";
import { DT, LINE, SPACE_LIMIT, SPACE_STATS, heroCraft, startSpaceBattle, stepSpace } from "./space.ts";
import { makeSfx } from "./sfx.ts";
import { settings } from "../settings.ts";
import { isTouch, mountTouch } from "./touch.ts";

const BOLT_COLORS = { marines: 0xff4a4a, wooka: 0x8cff5a };

export function playSpaceBattle(spec: SpaceBattleSpec, canvas: HTMLCanvasElement, hud: HTMLElement): Promise<SpaceBattleResult> {
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

  // The planet below, its atmosphere, and the stars.
  // Doren from orbit: forest green, darker woods and pale cloud.
  const land = texture("planet", 512, 256, [1, 1], (c, r) => {
    c.fillStyle = "#2f5a3a"; c.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 260; i++) { c.fillStyle = r() < 0.55 ? "rgba(20,52,30,0.5)" : "rgba(80,120,70,0.35)"; c.beginPath(); c.ellipse(r() * 512, r() * 256, 6 + r() * 30, 3 + r() * 14, r() * 3, 0, Math.PI * 2); c.fill(); }
    for (let i = 0; i < 120; i++) { c.fillStyle = "rgba(235,242,248,0.28)"; c.beginPath(); c.ellipse(r() * 512, r() * 256, 10 + r() * 50, 2 + r() * 6, r() * 0.4, 0, Math.PI * 2); c.fill(); }
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1400, 64, 32), new THREE.MeshLambertMaterial({ color: 0xffffff, map: land }));
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
    if (u.kind !== "cruiser") g.scale.setScalar(1.8); // fighters, big enough to follow from up here
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
    const boost = keys.has(settings.keys.forward) ? "▶▶" : keys.has(settings.keys.back) ? "◀" : "▶";
    const help = b.time < 10 ? touch ? `Drag to steer · fire, boost and brake on the right` : `Mouse steers · hold the button to fire · W boost · S brake · wheel zooms · M sound` : "";
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
      <div class="b-help">${help}<button id="b-auto" type="button">Let the AI finish it</button></div>`;
  };

  return new Promise((resolve) => {
    let last = performance.now(), acc = 0, hudAt = 0, raf = 0;
    const rec = spaceRecorder();
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      acc += dt;
      last = now;
      while (handOver && !b.over) stepSpace(b, null);
      while (acc >= DT && !b.over) {
        const input = rec.take({ yaw: aimYaw, pitch: aimPitch, throttle: (keys.has(settings.keys.forward) ? 1 : 0) - (keys.has(settings.keys.back) ? 1 : 0), fire: firing });
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
        animate(m, { t: now / 1000, dt, moved: 0, since: 9 }); // engine fire flickers
        if (u.id !== b.hero.id) {
          dotPts.push(u.x, u.y, u.z);
          col.setHex(FACTION_COLORS[spec.factions[u.side]]);
          dotCols.push(col.r, col.g, col.b);
        }
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { scene.remove(m); meshes.delete(id); }
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
      const pts: number[] = [], cols: number[] = [];
      const me = heroCraft(b);
      sfx.hear({ x: follow.x, z: follow.z, rx: back === 1 ? 1 : -1, rz: 0 });
      let lasers = 0;
      for (const f of b.bolts) if (!heard.has(f)) { heard.add(f); const mine = !!me && Math.hypot(f.x - me.x, f.z - me.z) < 8; if (mine || lasers++ < 6) sfx.laser(mine ? null : f, f.heavy, mine ? 0.28 : 0.3); }
      for (const f of b.blasts) if (!heard.has(f)) { heard.add(f); sfx.boom(f, f.big); }
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

      // The camera looks down from behind your own line and eases after the hero; while the hero
      // is down it waits over your line.
      const hero = heroCraft(b);
      const at = hero ?? { x: 0, y: 0, z: back * (LINE + 60) };
      follow.lerp(new THREE.Vector3(at.x, at.y, at.z), 1 - Math.exp(-dt * 4));
      camera.position.set(follow.x, follow.y + 240 * zoom, follow.z + back * 160 * zoom);
      camera.lookAt(follow.x, follow.y, follow.z - back * 70 * zoom);
      if (hero) steer(hero);

      renderer.render(scene, camera);
      if (now - hudAt > 100 || b.over) { drawHud(); hudAt = now; }
      if (b.over) {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); removeEventListener("resize", resize);
        canvas.removeEventListener("mousedown", md); canvas.removeEventListener("wheel", wheel);
        unTouch?.();
        document.body.classList.remove("space-2d");
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
