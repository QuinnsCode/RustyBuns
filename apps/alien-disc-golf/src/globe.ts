// The planet in three.js: a dark globe with Natural Earth coastlines, wind drawn as streaks that ride the
// chosen level of NOAA's grid, the hole's tee, basket and fairway, the throw's still-air ghost line, and the
// disc with its trail. The camera orbits (drag) and eases towards whatever it's told to look at.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clamp, lerp, mulberry32 } from "@rustybuns/util";
import type { Country } from "./countries.ts";
import { arc, destination, toLatLon, toVec, type LatLon } from "./geo.ts";
import { sampleWind, type WindLevel } from "./grib2.ts";
import { BASKET_KM } from "./course.ts";
import { EARTH_KM } from "./geo.ts";

const PARTICLES = 3200;
const SPEED_DEG = 0.2;    // degrees of travel per second per m/s of wind: visible flow, not a blur
const STREAK = 1.2;       // s of motion a streak shows

const v3 = (p: LatLon, r = 1) => { const [x, y, z] = toVec(p); return new THREE.Vector3(x * r, z * r, -y * r); }; // y up, lon 0 towards +x
const fromV3 = (v: THREE.Vector3): LatLon => toLatLon([v.x, -v.z, v.y]);

export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sphere: THREE.Mesh;
  private outlines: THREE.LineSegments | null = null;
  private streaks: THREE.LineSegments;
  private streakPos: Float32Array;
  private streakCol: Float32Array;
  private pLat = new Float32Array(PARTICLES);
  private pLon = new Float32Array(PARTICLES);
  private pAge = new Float32Array(PARTICLES);
  private rnd = mulberry32(99);
  private wind: WindLevel | null = null;
  private windAlt = 1.004;
  private gain = 1; // currents are a few hundredths of the wind's speed; scaled up so they show
  private tee: THREE.Mesh;
  private basket: THREE.Group;
  private fairway: THREE.Line;
  private ghost: THREE.Line;
  private aimDot: THREE.Mesh;
  private disc: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private want: THREE.Vector3 | null = null; // direction the camera should ease to
  private wantDist = 2.2;
  private dragging = false;
  private sinceDrag = 99;
  private wobble = 0;
  onPick: ((p: LatLon) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x050b14);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
    this.camera.position.set(0, 0.8, 2.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.45;
    this.controls.maxDistance = 4.5;
    this.controls.rotateSpeed = 0.6;
    this.controls.addEventListener("start", () => { this.dragging = true; this.sinceDrag = 0; });
    this.controls.addEventListener("end", () => { this.dragging = false; });

    // Stars, a soft sun and a cool fill so the night side still reads.
    this.scene.add(new THREE.AmbientLight(0x6a86a8, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.4);
    sun.position.set(3, 2, 2);
    this.scene.add(sun);
    this.scene.add(stars(this.rnd));

    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), new THREE.MeshPhongMaterial({ color: 0x0c1c30, specular: 0x1a3a5c, shininess: 18 }));
    this.scene.add(this.sphere);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.035, 48, 32), new THREE.MeshBasicMaterial({ color: 0x3fa9c9, transparent: true, opacity: 0.08, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(glow);
    this.scene.add(graticule());

    this.streakPos = new Float32Array(PARTICLES * 6);
    this.streakCol = new Float32Array(PARTICLES * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.streakPos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.streakCol, 3));
    this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.streaks);
    for (let i = 0; i < PARTICLES; i++) this.respawn(i, true);

    this.tee = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 12), new THREE.MeshBasicMaterial({ color: 0x5ee6c8 }));
    this.scene.add(this.tee);
    this.basket = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BASKET_KM / EARTH_KM, 0.003, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    ring.rotation.x = Math.PI / 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    post.position.y = 0.03;
    const cup = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd791 }));
    cup.rotation.x = Math.PI / 2; cup.position.y = 0.06;
    this.basket.add(ring, post, cup);
    this.scene.add(this.basket);

    this.fairway = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.25 }));
    this.scene.add(this.fairway);
    this.ghost = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 0.02, gapSize: 0.014, transparent: true, opacity: 0.8 }));
    this.scene.add(this.ghost);
    this.aimDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    this.scene.add(this.aimDot);
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.005, 24), new THREE.MeshPhongMaterial({ color: 0x8cf5ff, emissive: 0x2bb1c9, emissiveIntensity: 0.9, shininess: 80 }));
    this.disc.visible = false;
    this.scene.add(this.disc);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8cf5ff, transparent: true, opacity: 0.9 }));
    this.scene.add(this.trail);

    // A click (not a drag) on the planet is a pick.
    let down: [number, number] | null = null;
    canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 6 || !this.onPick) return;
      const p = this.pick(e.clientX, e.clientY);
      if (p) this.onPick(p);
    });
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Where on the planet a screen point is, or null for space. */
  pick(x: number, y: number): LatLon | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.sphere)[0];
    return hit ? fromV3(hit.point.clone().normalize()) : null;
  }

  setCountries(list: Country[]) {
    const pts: number[] = [];
    for (const c of list) for (const ring of c.rings) {
      for (let k = 1; k < ring.length; k++) {
        const a = v3({ lon: ring[k - 1]![0]!, lat: ring[k - 1]![1]! }, 1.003), b = v3({ lon: ring[k]![0]!, lat: ring[k]![1]! }, 1.003);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (this.outlines) this.scene.remove(this.outlines);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.outlines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb8d2, transparent: true, opacity: 0.75 }));
    this.scene.add(this.outlines);
  }

  /** The level the streaks ride: the wind at a loft, or the ocean current. */
  setWind(level: WindLevel | null, loft: "low" | "high" | "sea") {
    this.wind = level;
    this.windAlt = loft === "high" ? 1.03 : loft === "sea" ? 1.002 : 1.006;
    this.gain = loft === "sea" ? 25 : 1;
    for (let i = 0; i < PARTICLES; i++) this.respawn(i, true);
  }

  setHole(tee: LatLon, basket: LatLon) {
    place(this.tee, tee, 1.02);
    place(this.basket, basket, 1.0);
    this.fairway.geometry.dispose();
    this.fairway.geometry = new THREE.BufferGeometry().setFromPoints(arc(tee, basket, 96).map((p) => v3(p, 1.004)));
    this.trailPts = [];
    this.trail.geometry.dispose(); this.trail.geometry = new THREE.BufferGeometry();
    this.disc.visible = false;
  }

  /** The still-air line of the throw being aimed, and the disc sitting at its start. */
  setAim(from: LatLon, heading: number, carry: number, loft: "low" | "high") {
    const pts: THREE.Vector3[] = [];
    const n = 40;
    const alt = loft === "high" ? 1.03 : 1.012;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push(v3(destination(from, heading, carry * t), 1.004 + (alt - 1.004) * Math.sin(Math.PI * t)));
    }
    this.ghost.geometry.dispose();
    this.ghost.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.ghost.computeLineDistances();
    this.ghost.visible = true;
    place(this.aimDot, destination(from, heading, carry), 1.004);
    this.aimDot.visible = true;
    place(this.disc, from, 1.008);
    this.disc.visible = true;
  }
  /** The throw is away: the ghost line goes, and the trail starts afresh (the last one stays until then). */
  startFlight() {
    this.ghost.visible = false; this.aimDot.visible = false;
    this.trailPts = [];
    this.trail.geometry.dispose(); this.trail.geometry = new THREE.BufferGeometry();
  }
  hideAim() { this.ghost.visible = false; this.aimDot.visible = false; }

  /** The disc in flight: at `p`, altitude by loft and how far along it is. */
  setDisc(p: LatLon, t: number, loft: "low" | "high") {
    const peak = loft === "high" ? 1.05 : 1.018;
    const r = 1.006 + (peak - 1.006) * Math.sin(Math.PI * clamp(t, 0, 1));
    place(this.disc, p, r);
    this.disc.visible = true;
    this.trailPts.push(this.disc.position.clone());
    if (this.trailPts.length > 400) this.trailPts.shift();
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry().setFromPoints(this.trailPts);
  }

  /** Ease the camera to look down on this point. */
  lookAt(p: LatLon, dist?: number) { this.want = v3(p, 1); if (dist) this.wantDist = dist; }

  tick(dt: number) {
    dt = Math.min(dt, 0.1);
    this.sinceDrag += dt;
    this.wobble += dt;
    this.disc.rotation.y += dt * 9;
    if (this.want && !this.dragging && this.sinceDrag > 1.5) {
      const k = 1 - Math.exp(-dt * 2.5);
      const dist = lerp(this.camera.position.length(), this.wantDist, k);
      const dir = this.camera.position.clone().normalize();
      dir.lerp(this.want, k).normalize();
      this.camera.position.copy(dir.multiplyScalar(dist));
      if (dir.distanceTo(this.want) < 0.002) this.want = null;
    }
    this.controls.update();
    this.advect(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private respawn(i: number, scatter: boolean) {
    this.pLat[i] = (Math.asin(2 * this.rnd() - 1) * 180) / Math.PI;
    this.pLon[i] = this.rnd() * 360 - 180;
    this.pAge[i] = scatter ? this.rnd() * 6 : 0;
  }

  private advect(dt: number) {
    const w: [number, number] = [0, 0];
    const c = new THREE.Color();
    for (let i = 0; i < PARTICLES; i++) {
      let lat = this.pLat[i]!, lon = this.pLon[i]!;
      let u = 0, v = 0;
      if (this.wind) { sampleWind(this.wind, lat, lon, w); u = w[0] * this.gain; v = w[1] * this.gain; }
      const speed = Math.hypot(u, v);
      const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
      // The jet is several times faster; shown at full speed it's a blur, so it gets a smaller scale.
      const k = SPEED_DEG * (this.windAlt > 1.02 ? 0.35 : 1);
      const dLon = (u * k * dt) / cosLat, dLat = v * k * dt;
      const a = v3({ lat, lon }, this.windAlt);
      lat = clamp(lat + dLat, -89, 89);
      lon = ((lon + dLon + 540) % 360) - 180;
      const b = v3({ lat, lon }, this.windAlt);
      // The streak: from where it was STREAK seconds ago (at this speed) to where it is.
      const back = a.clone().sub(b).multiplyScalar(STREAK / Math.max(dt, 1e-3)).add(b);
      this.streakPos.set([back.x, back.y, back.z, b.x, b.y, b.z], i * 6);
      this.pLat[i] = lat; this.pLon[i] = lon;
      this.pAge[i] = this.pAge[i]! + dt;
      const life = Math.min(1, this.pAge[i]! / 0.6) * Math.max(0, 1 - (this.pAge[i]! - 5) / 1.5);
      const s = clamp(speed / (this.windAlt > 1.02 ? 60 : 16), 0, 1);
      c.setHSL(lerp(0.52, 0.1, s), 0.9, lerp(0.35, 0.72, s)).multiplyScalar(life);
      this.streakCol.set([c.r * 0.25, c.g * 0.25, c.b * 0.25, c.r, c.g, c.b], i * 6);
      if (this.pAge[i]! > 6.5 || speed < 0.4) this.respawn(i, false);
    }
    (this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.streaks.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function place(o: THREE.Object3D, p: LatLon, r: number) {
  const v = v3(p, r);
  o.position.copy(v);
  // Stand up along the surface normal.
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
}

function graticule(): THREE.LineSegments {
  const pts: number[] = [];
  const push = (a: LatLon, b: LatLon) => { const p = v3(a, 1.001), q = v3(b, 1.001); pts.push(p.x, p.y, p.z, q.x, q.y, q.z); };
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 3) push({ lat, lon }, { lat, lon: lon + 3 });
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 3) push({ lat, lon }, { lat: lat + 3, lon });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1d3147, transparent: true, opacity: 0.6 }));
}

function stars(rnd: () => number): THREE.Points {
  const n = 1500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = 2 * rnd() - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z) * 30;
    pos[i * 3] = r * Math.cos(t); pos[i * 3 + 1] = z * 30; pos[i * 3 + 2] = r * Math.sin(t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb8d2, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.7 }));
}
