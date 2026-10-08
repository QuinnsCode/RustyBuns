import * as THREE from "three";
import type { Frame } from "../driver.ts";
import { GOLD, GULP_BACK, GULP_OUT, NAIL, SEATS, SLUDGE, TICK_HZ, WATER } from "../../sim/rules.ts";
import { hippoPoint, lungeAt } from "../../sim/geom.ts";
import { AXES } from "../../sim/geom.ts";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Arena, at } from "./arena.ts";
import { loadFluid } from "./fluid.ts";
import { Post } from "./post.ts";
import { DropLayer } from "./drops.ts";
import { Particles, Popups } from "./fx.ts";
import { HippoRig } from "./hippo.ts";
import type { Event } from "../../sim/types.ts";

const TICK_MS = 1000 / TICK_HZ;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const KIND_COLOR = [0x303030, 0xffc933, 0x6b4a22, 0xb5bcc4, 0x55b6ff];
const jawOpen = (g: number) => (g < 0 ? 0 : g <= GULP_OUT ? g / GULP_OUT : Math.max(0, 1 - (g - GULP_OUT) / 1.5));

export class Renderer {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private rigs: HippoRig[] = [];
  private drops = new DropLayer();
  private fx = new Particles();
  private popups: Popups;
  private shake = 0;
  private snarlUntil = new Array<number>(SEATS).fill(0);
  private predicted = new Array<number>(SEATS).fill(-1e9);
  private lastNow = 0;
  private smokeClock = 0;
  private arena: Arena;
  private post: Post;

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 1.0;
    this.popups = new Popups(overlay);

    // golden hour over a tropical island: teal sky, a warm band at the horizon, green haze in front
    const bg = document.createElement("canvas"); bg.width = 4; bg.height = 256;
    const g2 = bg.getContext("2d")!, grad = g2.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0f3a4a"); grad.addColorStop(0.4, "#3f8a86"); grad.addColorStop(0.72, "#f2b878"); grad.addColorStop(1, "#7a8a5a");
    g2.fillStyle = grad; g2.fillRect(0, 0, 4, 256);
    const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bgTex;
    this.scene.fog = new THREE.Fog(0x93a67e, 90, 280);
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.38;

    this.scene.add(new THREE.HemisphereLight(0xcdeedd, 0x3a4a24, 0.8));
    const sun = new THREE.DirectionalLight(0xffd29a, 2.9);       // low golden sun from the front-left
    sun.position.set(-18, 20, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
    this.scene.add(sun);
    const glow = new THREE.PointLight(0xff9a4a, 22, 26, 1.8);     // the geyser lights the pan from within
    glow.position.set(0, 3.5, 0); this.scene.add(glow);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 0.7); rim.position.set(14, 9, -18); this.scene.add(rim);
    this.arena = new Arena();
    void loadFluid().then((f) => this.arena.geyser.setFluid(f));      // the Rust/wasm build if it is there, else the TypeScript twin
    this.scene.add(this.arena.group, this.drops.group, this.fx.points);
    for (let i = 0; i < SEATS; i++) { const r = new HippoRig(i); this.rigs.push(r); this.scene.add(r.group); }
    this.post = new Post(this.gl, this.scene, this.camera, canvas.clientWidth || 800, canvas.clientHeight || 600);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post?.resize(w * this.gl.getPixelRatio(), h * this.gl.getPixelRatio());
  }

  /** The player pressed gulp: start the lunge now; the server decides what it ate. */
  predictGulp(seat: number, now: number) {
    if (now - this.predicted[seat]! > GULP_COOLDOWN_MS) this.predicted[seat] = now;
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight };
  }

  private frameCamera(now: number) {
    const a = this.camera.aspect, k = Math.max(1.18, 1.6 / a);
    const s = this.shake; this.shake *= 0.9;
    this.camera.position.set(Math.sin(now / 4000) * 0.8 + (Math.random() - 0.5) * s, 15.5 * k + (Math.random() - 0.5) * s, 26 * k);
    this.camera.lookAt(0, 0.5, 1.0 * k - 3.5);
    void now;
  }

  private onEvent(e: Event, now: number, frame: Frame) {
    switch (e.t) {
      case "eat": {
        const p = at(e.x, e.y, 0.8), kind = e.kind;
        const good = e.pts > 0;
        this.fx.emit(p, KIND_COLOR[kind]!, kind === GOLD ? 36 : 14, kind === GOLD ? 7 : 4);
        const text = e.pts > 0 ? `+${e.pts}${kind === GOLD ? "!" : ""}` : e.pts < 0 ? `${e.pts}` : "";
        const color = kind === GOLD ? "#ffd45a" : good ? "#f4efe2" : kind === WATER ? "#7fc8ff" : "#ff7a5a";
        if (text) this.popups.show(this.project(at(e.x, e.y, 2.2)), text, color, kind === GOLD);
        if (kind === GOLD) {
          this.shake = Math.max(this.shake, 0.55);
          for (let s = 0; s < SEATS; s++) if (s !== e.seat) this.snarlUntil[s] = now + 1100;   // jealous growls
        } else if (e.pts < 0) this.shake = Math.max(this.shake, 0.25);
        if (kind === NAIL) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "OW! SORE JAW", "#ffb14a");
        if (kind === SLUDGE) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "*COUGH*", "#c9a26a");
        if (kind === WATER) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "WATERED DOWN!", "#7fc8ff", true);
        break;
      }
      case "dud": this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "*glub*", "#7fc8ff"); break;
      case "bellow": this.fx.emit(this.rigPoint(e.seat, 1.6), 0xffe9b0, 18, 5, 0.5, 0); break;
      case "slick": this.fx.emit(at(e.x, e.y, 0.2), 0xb07aff, 24, 3.5, 0.9, 2); this.popups.show(this.project(at(e.x, e.y, 1.5)), "SLICK!", "#d9b3ff"); break;
      case "overflow": this.shake = 0.8; break;
      case "spawn": this.arena.geyser.erupt(e.kind); break;
      default: break;
    }
    void frame;
  }

  private seatXY(seat: number): [number, number] {
    const k = AXES[seat]!; return [k.ax * 6.2, k.ay * 6.2];
  }
  private rigPoint(seat: number, h: number) { return this.rigs[seat]!.group.localToWorld(new THREE.Vector3(0, h, -1.8)); }

  draw(frame: Frame, now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000)); this.lastNow = now;
    const t = now / 1000, { prev, cur, alpha } = frame;
    for (const e of frame.events) this.onEvent(e, now, frame);

    for (let i = 0; i < SEATS; i++) {
      const hp = prev.hippos[i]!, hc = cur.hippos[i]!;
      const slide = lerp(hp.slide, hc.slide, alpha);
      let g = hc.gulp >= 0 ? (hp.gulp >= 0 ? lerp(hp.gulp, hc.gulp, alpha) : alpha * hc.gulp) : -1;
      const pg = (now - this.predicted[i]!) / TICK_MS;
      if (g < 0 && pg >= 0 && pg <= GULP_OUT + GULP_BACK && frame.mine.includes(i)) g = pg;   // cosmetic local prediction
      const lunge = lungeAt(g);
      const p = hippoPoint(i, slide, lunge);
      const rig = this.rigs[i]!, k = AXES[i]!;
      rig.group.position.copy(at(p.x, p.y, 0));
      rig.group.rotation.y = Math.atan2(k.ax, -k.ay);
      const snarl = Math.max(0, Math.min(1, (this.snarlUntil[i]! - now) / 400));
      rig.pose(hc, lunge, jawOpen(g), snarl, t);
      if (hc.sputter > 0) this.smoke(i, dt);
    }
    // drops and slicks blend by id between the two snapshots
    const before = new Map(prev.drops.map((d) => [d.id, d]));
    this.drops.sync(cur.drops.map((d) => {
      const b = before.get(d.id);
      return b ? { id: d.id, kind: d.kind, x: lerp(b.x, d.x, alpha), y: lerp(b.y, d.y, alpha) } : d;
    }), t);
    this.drops.syncSlicks(cur.slicks);
    if (cur.drops.some((d) => d.kind === GOLD) && Math.random() < 0.5) {
      const d = cur.drops.find((x) => x.kind === GOLD)!;
      this.fx.emit(at(d.x, d.y, 0.8), 0xfff0a0, 1, 1.4, 0.5, 1);
    }
    this.fx.update(dt);
    this.arena.update(t, dt);
    this.frameCamera(now);
    this.post.render(t);
  }

  private smoke(seat: number, dt: number) {
    this.smokeClock += dt;
    if (this.smokeClock < 0.05) return;
    this.smokeClock = 0;
    const r = this.rigs[seat]!;
    this.fx.emit(r.group.localToWorld(r.ears.clone()), 0xe8e8e8, 2, 1.8, 0.8, -1.5, 1);           // steam from the ears
    this.fx.emit(r.group.localToWorld(r.mouth.clone()), 0x3a3a3a, 2, 1.4, 0.9, -1, 1);           // smoke from the cough
  }

  /** Which engine runs the geyser's fluid: "rust" or "ts". */
  get fluidEngine() { return this.arena.geyser.engine; }

  dispose() { this.gl.dispose(); }
}
const GULP_COOLDOWN_MS = 11 * TICK_MS;
