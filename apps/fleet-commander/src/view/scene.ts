// The view from the bridge: the battle drawn from the sim each frame. Nothing here changes the battle; it reads
// `World` and draws ships, wings, torpedoes and the fire between them (PDC streams, heavy bolts, drive plumes),
// plus your orders as lines. Two looks: "cinema" (lit hulls in black space) and "holo" (the tactical table).
import * as THREE from "three";
import type { Role, Side } from "../names.ts";
import { HULL, alive, type Fx, type Ship, type World } from "../sim/world.ts";
import { ENGINE, craftGeometry, craftMaterial, dotTexture, planetTexture, shipModel } from "./models.ts";
import { Fog } from "./fog.ts";

export type Look = "cinema" | "holo";

const FIRE: Record<Side, { gun: number; bolt: number; pdc: number }> = {
  navy: { gun: 0xbfe0ff, bolt: 0x7fbfff, pdc: 0xf0f7ff },
  rim: { gun: 0xff7a2a, bolt: 0xffa04a, pdc: 0xffe0b0 },
};

interface Streak { x1: number; z1: number; x2: number; z2: number; born: number; life: number; len: number; width: number; color: THREE.Color; y: number }
interface Flash { x: number; z: number; y: number; born: number; life: number; size: number; color: THREE.Color }

export interface Overlay {
  selected: Set<number>;
  target: number;
  /** Lines from a thing to where it is going, in sim coordinates, with a colour. */
  lines: { x1: number; z1: number; x2: number; z2: number; color: number }[];
  rings: { x: number; z: number; r: number; color: number }[];
  /** In the theater: the Compact ships, wings and mines your side sees. The rest are not drawn. */
  sees?: Set<number>;
}

export class Bridge {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 10, 40000);
  /** Where the camera looks (sim x, z) and how far out it sits. */
  view = { x: -600, z: 0, dist: 2600, tilt: 0.95, yaw: 0 };
  look: Look = "holo";
  private ships = new Map<number, THREE.Group>();
  private crafts = new Map<string, THREE.InstancedMesh>();
  private planet: THREE.Mesh;
  private atmo: THREE.Mesh;
  private grid: THREE.GridHelper;
  private stars: THREE.Points;
  private streaks: Streak[] = [];
  private flashes: Flash[] = [];
  private streakMesh: THREE.InstancedMesh;
  private flashMesh: THREE.InstancedMesh;
  private lineGeo = new THREE.BufferGeometry();
  private lineMesh: THREE.LineSegments;
  private overlayGeo = new THREE.BufferGeometry();
  private overlayMesh: THREE.LineSegments;
  private seenFx = 0;
  private holoMats = new Map<string, THREE.Material>();
  private clock = 0;
  private scorches: THREE.Mesh[] = [];
  private shields = new Map<number, { mesh: THREE.Mesh; hit: number }>();
  private dummy = new THREE.Object3D();
  private planetSeed: number;
  private p = { x: 0, z: 0, r: 1 };
  /** The theater's bodies (star, other planets, rift whorls), the fog laid over the table, and the visible mines. */
  private bodies: THREE.Object3D[] = [];
  private bodiesFor: World | null = null;
  private fogPlane: THREE.Mesh | null = null;
  private fogTex: THREE.CanvasTexture | null = null;
  private mineMesh: THREE.InstancedMesh;
  fog: Fog | null = null;

  constructor(canvas: HTMLCanvasElement, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.planetSeed = seed;
    const s = this.scene;
    s.background = new THREE.Color(0x020306);
    s.add(new THREE.AmbientLight(0x6a7890, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4); sun.position.set(-3000, 4000, 1500); s.add(sun);
    const rim = new THREE.DirectionalLight(0x5a7cff, 0.6); rim.position.set(3000, -1000, -2000); s.add(rim);

    // Stars on a far shell, and a faint nebula.
    const sp: number[] = [], sc: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 16000;
      sp.push(Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r * 0.6 - 3000, Math.sqrt(1 - u * u) * Math.sin(a) * r);
      const k = 0.5 + Math.random() * 0.5; sc.push(k, k, k * (0.9 + Math.random() * 0.2));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    s.add(this.stars);
    const dot = dotTexture();
    for (const [x, z, c, k] of [[4000, -6000, 0x3a1d5a, 9000], [-7000, 3000, 0x14304a, 11000]] as const) {
      const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: c, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      n.position.set(x, -4000, z); n.scale.set(k, k, 1); s.add(n);
    }

    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshStandardMaterial({ map: planetTexture(seed), roughness: 1 }));
    s.add(this.planet);
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 48, 32), new THREE.MeshBasicMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.16, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.atmo);

    this.grid = new THREE.GridHelper(20000, 100, 0x1d6f8a, 0x0b3344);
    this.grid.visible = false; s.add(this.grid);

    // Every streak (guns, bolts, tracers) is one instance of a stretched glowing plane; every flash one instance of a dot.
    const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
    this.streakMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 2400);
    this.streakMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2400 * 3), 3);
    this.streakMesh.frustumCulled = false; s.add(this.streakMesh);
    const fplane = new THREE.PlaneGeometry(1, 1);
    this.flashMesh = new THREE.InstancedMesh(fplane, new THREE.MeshBasicMaterial({ map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 600);
    this.flashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.flashMesh.frustumCulled = false; s.add(this.flashMesh);

    // Thin lines: drive plumes, craft trails, and the orders overlay.
    this.lineMesh = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lineMesh.frustumCulled = false; s.add(this.lineMesh);
    this.overlayMesh = new THREE.LineSegments(this.overlayGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    this.overlayMesh.frustumCulled = false; s.add(this.overlayMesh);
    // Drawn after the fog, so fire and your orders show through it.
    this.overlayMesh.renderOrder = 3; this.lineMesh.renderOrder = 3; this.streakMesh.renderOrder = 3; this.flashMesh.renderOrder = 3;
    this.mineMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(14), new THREE.MeshBasicMaterial({ color: 0xff7a2a, wireframe: true }), 128);
    this.mineMesh.frustumCulled = false; this.mineMesh.count = 0; s.add(this.mineMesh);
    this.setLook(this.look);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setLook(look: Look) {
    this.look = look;
    this.grid.visible = look === "holo";
    this.stars.visible = look === "cinema";
    this.scene.background = new THREE.Color(look === "holo" ? 0x020b12 : 0x020306);
    for (const g of this.ships.values()) this.paint(g);
    for (const [key, m] of this.crafts) m.material = look === "holo" ? this.holo(key.startsWith("navy") ? "navy" : "rim") : craftMaterial(key.startsWith("navy") ? "navy" : "rim");
    (this.planet.material as THREE.MeshStandardMaterial).wireframe = look === "holo";
  }

  private holo(side: Side) {
    const k = "holo-" + side;
    if (!this.holoMats.has(k)) this.holoMats.set(k, new THREE.MeshBasicMaterial({ color: side === "navy" ? 0x63e6ff : 0xff9a4d, wireframe: true, transparent: true, opacity: 0.7 }));
    return this.holoMats.get(k)!;
  }

  private paint(g: THREE.Group) {
    const side: Side = g.userData.side;
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.engine) return;
      o.userData.mat ??= o.material;
      o.material = this.look === "holo" ? this.holo(side) : o.userData.mat;
    });
  }

  /** Sim (x, z) under a screen point, on the battle plane. */
  pick(px: number, py: number, w: number, h: number): { x: number; z: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, z: p.z } : null;
  }

  /** Where a sim point lands on screen, in pixels. */
  toScreen(x: number, z: number, w: number, h: number) {
    const v = new THREE.Vector3(x, 0, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, on: v.z < 1 };
  }

  /** World units per screen pixel at the view centre, for click slop. */
  unitsPerPixel(h: number) { return (2 * this.view.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h; }

  draw(w: World, alpha: number, overlay: Overlay, dtReal: number) {
    this.clock += dtReal;
    const now = this.clock;
    const v = this.view;
    const cy = Math.sin(v.tilt) * v.dist, back = Math.cos(v.tilt) * v.dist;
    this.camera.position.set(v.x - Math.sin(v.yaw) * back, cy, v.z + Math.cos(v.yaw) * back);
    this.camera.lookAt(v.x, 0, v.z);
    this.camera.near = Math.max(5, v.dist / 200); this.camera.updateProjectionMatrix();

    const p = w.planet;
    this.planet.position.set(p.x, -p.r * 0.55, p.z); this.planet.scale.setScalar(p.r);
    this.planet.rotation.y = now * 0.01;
    this.atmo.position.copy(this.planet.position); this.atmo.scale.setScalar(p.r);
    this.atmo.visible = this.look === "cinema";

    this.drawField(w, overlay, now);
    this.drawShips(w, now, overlay.sees);
    this.drawCraft(w, overlay.sees);
    this.p = w.planet;
    this.takeFx(w, now);
    this.drawFx(now);
    this.drawLines(w, overlay, now);
    this.renderer.render(this.scene, this.camera);
    void alpha;
  }

  /** The theater: build its bodies and fog once per battle, then lay the fog and the seen mines each frame. */
  private drawField(w: World, o: Overlay, now: number) {
    const f = w.field;
    if (this.bodiesFor !== w) {
      for (const b of this.bodies) this.scene.remove(b);
      this.bodies = []; this.bodiesFor = w;
      if (this.fogPlane) { this.scene.remove(this.fogPlane); this.fogPlane = null; this.fog = null; }
      if (f) {
        const dot = dotTexture();
        f.wells.forEach((g, i) => {
          if (g.kind === "star") {
            const star = new THREE.Mesh(new THREE.SphereGeometry(g.core, 40, 24), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
            star.position.set(g.x, -g.core * 0.4, g.z); this.bodies.push(star);
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff9a40, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
            halo.position.copy(star.position); halo.scale.set(g.core * 5, g.core * 5, 1); this.bodies.push(halo);
          } else if (g.kind === "planet" && g.name !== w.planet.name) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(g.core, 40, 24), new THREE.MeshStandardMaterial({ map: planetTexture(this.planetSeed + i * 31), roughness: 1 }));
            p.position.set(g.x, -g.core * 0.55, g.z); p.userData.planet = true; this.bodies.push(p);
          }
        });
        for (const b of this.bodies) this.scene.add(b);
        this.fog = new Fog(f.wide, f.deep);
        this.fogTex = new THREE.CanvasTexture(this.fog.canvas);
        const plane = new THREE.PlaneGeometry(f.wide * 2, f.deep * 2); plane.rotateX(-Math.PI / 2);
        this.fogPlane = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false, depthTest: false }));
        this.fogPlane.position.y = 40; this.fogPlane.renderOrder = 2; this.scene.add(this.fogPlane);
      }
    }
    for (const b of this.bodies) if (b.userData.planet) { b.rotation.y = now * 0.01; ((b as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = this.look === "holo"; }
    if (this.fogTex) this.fogTex.needsUpdate = true;
    let n = 0;
    if (f) for (const m of f.mines) {
      if (n >= 128 || (o.sees && m.side === "rim" && !o.sees.has(m.id))) continue;
      this.dummy.position.set(m.x, 10, m.z); this.dummy.rotation.set(0, now + m.id, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
      this.mineMesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.mineMesh.count = n; this.mineMesh.instanceMatrix.needsUpdate = true;
  }

  private drawShips(w: World, now: number, sees?: Set<number>) {
    for (const s of w.ships) {
      let g = this.ships.get(s.id);
      if (!g) {
        g = shipModel(s.kind, s.side); g.userData.side = s.side; this.paint(g);
        this.scene.add(g); this.ships.set(s.id, g);
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(HULL[s.kind].r * 1.15, 24, 16), new THREE.MeshBasicMaterial({ color: s.side === "navy" ? 0x8fd0ff : 0xffc28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        bubble.scale.y = 0.35; this.scene.add(bubble);
        this.shields.set(s.id, { mesh: bubble, hit: -9 });
      }
      const sh = this.shields.get(s.id)!;
      const hidden = !!sees && s.side === "rim" && !sees.has(s.id);
      if (s.dead || hidden) {
        if (g.visible) { g.visible = false; sh.mesh.visible = false; }
        continue;
      }
      if (!g.visible) { g.visible = true; sh.mesh.visible = true; }
      g.position.set(s.x, 0, s.z);
      // A heading along +x in the sim is the model's nose; three's y rotation turns the other way.
      g.rotation.y = -s.a;
      if (s.kind === "station") g.rotation.y = now * 0.05;
      // A slow list and bob, so a hull at rest still feels afloat.
      g.position.y = Math.sin(now * 0.4 + s.id) * 3;
      g.rotation.z = Math.sin(now * 0.3 + s.id) * 0.01;
      sh.mesh.position.set(s.x, 0, s.z);
      if (s.lastHit > w.t - 0.25 && s.shield > 0) sh.hit = now;
      const m = sh.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 0.22 - (now - sh.hit) * 0.5) * (s.shield / s.shieldMax + 0.2);
    }
  }

  private drawCraft(w: World, sees?: Set<number>) {
    const counts = new Map<string, number>();
    // Drawn bigger the further out the camera is, so a wing still reads at fleet scale.
    const k = Math.max(1.4, Math.min(5, this.view.dist / 1300));
    for (const g of w.wings) {
      if (g.state !== "out" && g.state !== "returning") continue;
      if (sees && g.side === "rim" && !sees.has(g.id)) continue;
      const key = `${g.side}-${g.role}`;
      let m = this.crafts.get(key);
      if (!m) {
        m = new THREE.InstancedMesh(craftGeometry(g.role as Role, g.side), this.look === "holo" ? this.holo(g.side) : craftMaterial(g.side), 200);
        m.frustumCulled = false; this.scene.add(m); this.crafts.set(key, m);
      }
      let n = counts.get(key) ?? 0;
      for (const c of alive(g)) {
        if (n >= 200) break;
        this.dummy.position.set(c.x, 12 + (c.id % 7) * 3, c.z);
        this.dummy.rotation.set(0, -Math.atan2(c.vz, c.vx), 0);
        this.dummy.scale.setScalar(k);
        this.dummy.updateMatrix();
        m.setMatrixAt(n++, this.dummy.matrix);
      }
      counts.set(key, n);
    }
    for (const [key, m] of this.crafts) { m.count = counts.get(key) ?? 0; m.instanceMatrix.needsUpdate = true; }
  }

  /** New fire from the sim turns into streaks and flashes. */
  private takeFx(w: World, now: number) {
    for (const f of w.fx) {
      if (f.n <= this.seenFx) continue;
      this.seenFx = f.n;
      this.spawn(f, now);
    }
  }

  private spawn(f: Fx, now: number) {
    const c = FIRE[f.side];
    const col = (n: number) => new THREE.Color(n);
    const d = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
    if (f.k === "gun") this.streaks.push({ ...f, born: now, life: 0.18, len: 16, width: 2.2, color: col(c.gun), y: 14 });
    else if (f.k === "pdc") {
      // A PDC stream: a line of tracers walking out, one after another.
      for (let i = 0; i < 5; i++) this.streaks.push({ x1: f.x1, z1: f.z1, x2: f.x2, z2: f.z2, born: now + i * 0.04, life: Math.max(0.2, d / 900), len: 9, width: 1.6, color: col(c.pdc), y: 8 });
    } else if (f.k === "bolt") this.streaks.push({ ...f, born: now + Math.random() * 0.5, life: Math.max(0.3, d / 1800), len: 90, width: 7, color: col(c.bolt), y: 6 });
    else if (f.k === "rake") {
      this.streaks.push({ ...f, born: now + Math.random() * 0.6, life: 0.45, len: 110, width: 9, color: col(0xbfe0ff), y: 20 });
      // The surface under the shot: the planet sits half below the battle plane.
      const p = this.p, dd = Math.hypot(f.x2 - p.x, f.z2 - p.z), y = -p.r * 0.55 + Math.sqrt(Math.max(0, p.r * p.r - dd * dd));
      this.flashes.push({ x: f.x2, z: f.z2, y, born: now + 0.5, life: 2.2, size: 140, color: col(0xff7a2a) });
    } else if (f.k === "boom") this.flashes.push({ x: f.x1, z: f.z1, y: 14, born: now, life: 0.5, size: 40, color: col(0xffc070) });
    else if (f.k === "torphit") { this.flashes.push({ x: f.x1, z: f.z1, y: 10, born: now, life: 0.9, size: 130, color: col(0xfff0d0) }); this.flashes.push({ x: f.x1, z: f.z1, y: 10, born: now, life: 1.4, size: 70, color: col(0xff6a20) }); }
    else if (f.k === "bigboom") {
      const r = f.x2;
      for (let i = 0; i < 9; i++) this.flashes.push({ x: f.x1 + (Math.random() - 0.5) * r, z: f.z1 + (Math.random() - 0.5) * r, y: 10, born: now + i * 0.25, life: 1.6, size: r * (0.8 + Math.random()), color: col(i % 2 ? 0xffb050 : 0xfff2e0) });
      this.flashes.push({ x: f.x1, z: f.z1, y: 10, born: now + 2, life: 3, size: r * 5, color: col(0x8a4a20) });
    } else if (f.k === "jump") {
      this.streaks.push({ x1: f.x2, z1: f.z2, x2: f.x1, z2: f.z1, born: now, life: 0.35, len: 700, width: 14, color: col(0xe8f4ff), y: 4 });
      this.flashes.push({ x: f.x1, z: f.z1, y: 4, born: now + 0.3, life: 0.8, size: 320, color: col(0xcfe8ff) });
    }
  }

  private drawFx(now: number) {
    const sm = this.streakMesh, d = this.dummy;
    let n = 0;
    this.streaks = this.streaks.filter((s) => now < s.born + s.life);
    for (const s of this.streaks) {
      if (now < s.born || n >= 2400) continue;
      const k = (now - s.born) / s.life;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L = Math.hypot(dx, dz) || 1;
      const x = s.x1 + dx * k, z = s.z1 + dz * k;
      d.position.set(x, s.y, z); d.rotation.set(0, -Math.atan2(dz, dx), 0); d.scale.set(Math.min(s.len, L), 1, s.width); d.updateMatrix();
      sm.setMatrixAt(n, d.matrix); sm.setColorAt(n, s.color); n++;
    }
    sm.count = n; sm.instanceMatrix.needsUpdate = true; if (sm.instanceColor) sm.instanceColor.needsUpdate = true;

    const fm = this.flashMesh;
    let m = 0;
    this.flashes = this.flashes.filter((f) => now < f.born + f.life);
    const tmp = new THREE.Color();
    for (const f of this.flashes) {
      if (now < f.born || m >= 600) continue;
      const k = (now - f.born) / f.life;
      d.position.set(f.x, f.y + 6, f.z); d.quaternion.copy(this.camera.quaternion); d.scale.setScalar(f.size * (0.4 + k * 0.9)); d.updateMatrix();
      fm.setMatrixAt(m, d.matrix); fm.setColorAt(m, tmp.copy(f.color).multiplyScalar(1 - k)); m++;
    }
    fm.count = m; fm.instanceMatrix.needsUpdate = true; if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  }

  private drawLines(w: World, o: Overlay, now: number) {
    const pos: number[] = [], col: number[] = [];
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, c: THREE.Color, k = 1) => { pos.push(x1, y1, z1, x2, y2, z2); col.push(c.r * k, c.g * k, c.b * k, c.r * k * 0.1, c.g * k * 0.1, c.b * k * 0.1); };
    const eng = { navy: new THREE.Color(ENGINE.navy), rim: new THREE.Color(ENGINE.rim) };
    // Craft trails.
    const shown = (side: Side, id: number) => !o.sees || side === "navy" || o.sees.has(id);
    for (const g of w.wings) {
      if ((g.state !== "out" && g.state !== "returning") || !shown(g.side, g.id)) continue;
      for (const c of alive(g)) { const y = 12 + (c.id % 7) * 3; seg(c.x, y, c.z, c.x - c.vx * 0.35, y, c.z - c.vz * 0.35, eng[g.side], 0.8); }
    }
    // Torpedoes: a hot point and a long drive plume.
    const torpC = new THREE.Color(0xbfe4ff);
    for (const t of w.torps) seg(t.x, 10, t.z, t.x - t.vx * 0.7, 10, t.z - t.vz * 0.7, t.side === "navy" ? torpC : eng.rim, 1.4);
    // Capital drive plumes.
    for (const s of w.ships) {
      if (s.dead || s.kind === "station" || s.v < 1 || !shown(s.side, s.id)) continue;
      const r = HULL[s.kind].r, bx = s.x - Math.cos(s.a) * r * 1.05, bz = s.z - Math.sin(s.a) * r * 1.05;
      seg(bx, 0, bz, bx - Math.cos(s.a) * s.v * 6, 0, bz - Math.sin(s.a) * s.v * 6, eng[s.side], 1);
    }
    this.lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));

    const op: number[] = [], oc: number[] = [];
    const tc = new THREE.Color();
    const line = (x1: number, z1: number, x2: number, z2: number, c: number) => { tc.set(c); op.push(x1, 3, z1, x2, 3, z2); oc.push(tc.r, tc.g, tc.b, tc.r, tc.g, tc.b); };
    const ring = (x: number, z: number, r: number, c: number) => { for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, b = ((i + 1) / 40) * Math.PI * 2; line(x + Math.cos(a) * r, z + Math.sin(a) * r, x + Math.cos(b) * r, z + Math.sin(b) * r, c); } };
    for (const l of o.lines) line(l.x1, l.z1, l.x2, l.z2, l.color);
    for (const r of o.rings) ring(r.x, r.z, r.r, r.color);
    // The marked target: a ring that breathes.
    const t = w.ships.find((s) => s.id === o.target && !s.dead);
    if (t) ring(t.x, t.z, HULL[t.kind].r * (1.35 + Math.sin(now * 5) * 0.05), 0xff5a4a);
    if (this.look === "holo") for (const s of w.ships) if (!s.dead && shown(s.side, s.id)) ring(s.x, s.z, HULL[s.kind].r * 1.2, s.side === "navy" ? 0x2aa8c8 : 0xc86a2a);
    // The theater: gravity contours round each well, and each strongpoint's ring with an arc for how far it is held.
    if (w.field) {
      for (const g of w.field.wells) for (const k of [1, 0.66, 0.36]) ring(g.x, g.z, g.r * k, g.kind === "rift" ? 0x3a2a66 : 0x173a52);
      for (const p of w.field.points) {
        const c = p.owner === "navy" ? 0x63e6ff : p.owner === "rim" ? 0xff9a4d : 0x8a96a3;
        ring(p.x, p.z, p.r, c); ring(p.x, p.z, p.r * 0.2, c);
        const arc = Math.abs(p.hold) * Math.PI * 2, ac = p.hold > 0 ? 0x63e6ff : 0xff9a4d;
        for (let i = 0; i < 48 && (i / 48) * Math.PI * 2 < arc; i++) { const a = (i / 48) * Math.PI * 2 - Math.PI / 2, b = a + Math.PI / 24; line(p.x + Math.cos(a) * p.r * 1.08, p.z + Math.sin(a) * p.r * 1.08, p.x + Math.cos(b) * p.r * 1.08, p.z + Math.sin(b) * p.r * 1.08, ac); }
      }
    }
    this.overlayGeo.setAttribute("position", new THREE.Float32BufferAttribute(op, 3));
    this.overlayGeo.setAttribute("color", new THREE.Float32BufferAttribute(oc, 3));
  }

  /** Drop every model (a new battle). */
  reset() {
    for (const g of this.ships.values()) this.scene.remove(g);
    for (const s of this.shields.values()) this.scene.remove(s.mesh);
    for (const m of this.scorches) this.scene.remove(m);
    this.ships.clear(); this.shields.clear(); this.scorches = []; this.streaks = []; this.flashes = []; this.seenFx = 0;
  }
}

export const shipAt = (w: World, x: number, z: number, slop: number): Ship | undefined =>
  w.ships.filter((s) => !s.dead && Math.hypot(s.x - x, s.z - z) < HULL[s.kind].r + slop).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
