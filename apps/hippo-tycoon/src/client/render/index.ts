import * as THREE from "three";
import type { Frame } from "../driver.ts";
import { COUNTDOWN_TICKS, GOLD, GULP_BACK, GULP_OUT, NAIL, SEATS, SLUDGE, TICK_HZ, WATER } from "../../sim/rules.ts";
import { hippoPoint, lungeAt } from "../../sim/geom.ts";
import { AXES } from "../../sim/geom.ts";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Arena, at } from "./arena.ts";
import { loadFluid } from "./fluid.ts";
import { Cinematic, finaleName, type Sfx, type Style } from "./cinematic.ts";
import { PRESETS, type ViewSettings } from "../settings.ts";
import { Post } from "./post.ts";
import { DropLayer } from "./drops.ts";
import { Particles, Popups } from "./fx.ts";
import { HippoRig } from "./hippo.ts";
import type { Event } from "../../sim/types.ts";

const TICK_MS = 1000 / TICK_HZ;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const KIND_COLOR = [0x303030, 0xffc933, 0x6b4a22, 0xb5bcc4, 0x55b6ff];
const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** The gameplay shot (scaled up on narrow screens): a touch lower than it was, so the sunset and the peaks show over the far rim. */
const CAM = { y: 14.2, z: 26.5, lookY: 1.6, lookZ: -3.5 };
export interface RendererOpts {
  sfx?: (s: Sfx) => void;
  view?: ViewSettings;
  /** "attract" is the menu's backdrop: no HUD, a slow orbit, the geyser bubbling. */
  mode?: "game" | "attract";
}
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
  private cine: Cinematic;
  private lastPhase = "";
  private lastFrame: Frame | null = null;
  private view: ViewSettings;
  private mode: "game" | "attract";
  private sun: THREE.DirectionalLight;
  /** The camera's eased response to the finale's cues. */
  private camPush = 0;
  private camFocus = new THREE.Vector3();
  /** Dev/preview: force the finale's toss styles, in toss order. */
  styles: (Style | undefined)[] = [];

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLElement, opts: RendererOpts = {}) {
    this.view = opts.view ?? { reducedMotion: false, filmLook: true, quality: "high" };
    this.mode = opts.mode ?? "game";
    const q = PRESETS[this.view.quality];
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(q.pixelRatio, window.devicePixelRatio || 1));
    this.gl.info.autoReset = false;                  // the composer renders several passes; count the whole frame
    this.gl.shadowMap.enabled = q.shadows; this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 0.95;
    this.popups = new Popups(overlay);

    // a hot, humid dusk: a Miami sunset (indigo, pink, orange) behind a haze of purple-green, neon in the shadows
    const bg = document.createElement("canvas"); bg.width = 4; bg.height = 256;
    const g2 = bg.getContext("2d")!, grad = g2.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0a0620"); grad.addColorStop(0.35, "#3d1858"); grad.addColorStop(0.6, "#d9437a"); grad.addColorStop(0.74, "#ff9a58"); grad.addColorStop(1, "#1d2a24");
    g2.fillStyle = grad; g2.fillRect(0, 0, 4, 256);
    const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bgTex;
    this.scene.fog = new THREE.Fog(0x3a3350, 55, 210);
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;

    this.scene.add(new THREE.HemisphereLight(0x8a6ab0, 0x16241a, 0.55));
    const sun = new THREE.DirectionalLight(0xff8a5a, 2.3);       // the low sun, burnt orange
    sun.position.set(-22, 11, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); this.sun = sun; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
    this.scene.add(sun);
    const glow = new THREE.PointLight(0xff9a4a, 26, 26, 1.8);     // the geyser lights the basin from within
    glow.position.set(0, 3.5, 0); this.scene.add(glow);
    const rim = new THREE.DirectionalLight(0x39e6ff, 1.5); rim.position.set(16, 9, -20); this.scene.add(rim);     // cyan from behind
    const pink = new THREE.PointLight(0xff3d9a, 70, 30, 1.7); pink.position.set(-13, 3, 5); this.scene.add(pink);   // and neon pink from the left
    const cyan = new THREE.PointLight(0x39e6ff, 55, 30, 1.7); cyan.position.set(13, 3, -3); this.scene.add(cyan);
    this.arena = new Arena(q.foliage); this.arena.geyser.cap = q.fluidCap;
    void loadFluid().then((f) => this.arena.geyser.setFluid(f));      // the Rust/wasm build if it is there, else the TypeScript twin
    this.scene.add(this.arena.group, this.drops.group, this.fx.points);
    for (let i = 0; i < SEATS; i++) { const r = new HippoRig(i); this.rigs.push(r); this.scene.add(r.group); }
    this.cine = new Cinematic(this.rigs, {
      fx: this.fx, shake: (n) => this.jolt(n), sfx: (n) => opts.sfx?.(n),
      popup: (text, pos, color, big) => this.popups.show(this.project(pos), text, color, big),
    });
    this.post = new Post(this.gl, this.scene, this.camera, canvas.clientWidth || 800, canvas.clientHeight || 600);
    this.post.configure({ film: this.view.filmLook, bloom: q.bloom });
    this.cine.calm = this.view.reducedMotion;
    this.resize();
  }

  /** Apply the options live: quality preset, film look, reduced motion. */
  setView(v: ViewSettings) {
    const q = PRESETS[v.quality], hadShadows = this.gl.shadowMap.enabled;
    this.view = v;
    this.gl.setPixelRatio(Math.min(q.pixelRatio, window.devicePixelRatio || 1));
    this.gl.shadowMap.enabled = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) { this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (hadShadows !== q.shadows) this.scene.traverse((o) => { if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) m.needsUpdate = true; });   // recompile without (or with) shadow lookups
    this.post.configure({ film: v.filmLook, bloom: q.bloom });
    this.arena.setFoliage(q.foliage); this.arena.geyser.cap = q.fluidCap;
    this.cine.calm = v.reducedMotion;
    if (v.reducedMotion) this.shake = 0;
    this.resize();
  }

  /** Screen shake, unless the player asked for less motion. */
  private jolt(n: number) { if (!this.view.reducedMotion) this.shake = Math.max(this.shake, n); }

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

  private frameCamera(now: number, dt: number, frame: Frame) {
    const a = this.camera.aspect, k = Math.max(1.18, 1.6 / a), calm = this.view.reducedMotion;
    const s = calm ? 0 : this.shake; this.shake *= 0.9;
    const pos = new THREE.Vector3(calm ? 0 : Math.sin(now / 4000) * 0.8, CAM.y * k, CAM.z * k), look = new THREE.Vector3(0, CAM.lookY, k + CAM.lookZ);

    if (this.mode === "attract") {                    // the menu: a slow drift through the clearing on the camera's side, over the basin to the peaks and the sunset
      const ang = calm ? 0.12 : Math.sin(now / 9000) * 0.28;
      pos.set(Math.sin(ang) * 30, 9.5, Math.cos(ang) * 30); look.set(Math.sin(ang) * 6, 6.5, -14);
    } else if (frame.phase === "countdown" && !calm) {
      // a short fly-in each round: from a wide, low view of the peaks and the sky, down into the gameplay shot
      const left = lerp(frame.prev.countdown, frame.cur.countdown, frame.alpha) / COUNTDOWN_TICKS;
      // (it starts inside the clear wedge in front of the camera, so no palm stands in the way)
      const p = ease(clamp01((1 - left) / 0.8)), wide = new THREE.Vector3(-9, 5.5, 40);
      pos.lerpVectors(wide, pos, p); look.lerpVectors(new THREE.Vector3(0, 13, -40), look, p);
    }

    // the finale's cues: in for the grab and the hero shot, back and up for the star
    const f = 1 - Math.exp(-dt * 4);
    this.camPush += ((this.cine.active && !calm ? this.cine.shot.push : 0) - this.camPush) * f;
    this.camFocus.lerp(this.cine.shot.focus, f);
    // pushing in is a zoom: the camera stays where the jungle is cleared for it, so no fern swings into the shot
    const fov = 38 / (1 + Math.max(0, this.camPush) * 1.1);
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.camPush > 0) look.lerp(this.camFocus, this.camPush * 0.6);
    else if (this.camPush < 0) { const b = -this.camPush; pos.multiplyScalar(1 + 0.18 * b); look.y += 24 * b; }   // back a little and look up after the star

    this.camera.position.set(pos.x + (Math.random() - 0.5) * s, pos.y + (Math.random() - 0.5) * s, pos.z);
    this.camera.lookAt(look);
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
          this.jolt(0.55);
          for (let s = 0; s < SEATS; s++) if (s !== e.seat) this.snarlUntil[s] = now + 1100;   // jealous growls
        } else {
          for (let s = 0; s < SEATS; s++) if (s !== e.seat) this.snarlUntil[s] = Math.max(this.snarlUntil[s]!, now + 420);   // everyone resents every bite
          if (e.pts < 0) this.jolt(0.25);
        }
        if (kind === NAIL) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "OW! SORE JAW", "#ffb14a");
        if (kind === SLUDGE) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "*COUGH*", "#c9a26a");
        if (kind === WATER) this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "WATERED DOWN!", "#7fc8ff", true);
        break;
      }
      case "gulp": this.fx.emit(this.rigPoint(e.seat, 0.2), 0x6a5238, 9, 3.2, 0.55, 8, 0.7); break;   // dirt kicked up by the lunge
      case "dud": this.popups.show(this.project(at(...this.seatXY(e.seat), 3)), "*glub*", "#7fc8ff"); break;
      case "bellow": this.fx.emit(this.rigPoint(e.seat, 1.6), 0xffe9b0, 18, 5, 0.5, 0); break;
      case "slick": this.fx.emit(at(e.x, e.y, 0.2), 0xb07aff, 24, 3.5, 0.9, 2); this.popups.show(this.project(at(e.x, e.y, 1.5)), "SLICK!", "#d9b3ff"); break;
      case "overflow": this.jolt(0.8); break;
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

    if (frame.phase === "podium" && this.lastPhase !== "podium") {
      this.cine.start(cur.hippos.map((h) => h.score), cur.hippos.map((h) => h.slide), now,
        { names: frame.seats.map((_, i) => finaleName(i, frame.seats)), mine: frame.mine, styles: this.styles });
    }
    if (frame.phase !== "podium" && this.cine.active) this.stopFinale();
    this.lastPhase = frame.phase; this.lastFrame = frame;
    if (this.cine.active) this.cine.update(now, t);

    for (let i = 0; i < SEATS && !this.cine.active; i++) {
      const hp = prev.hippos[i]!, hc = cur.hippos[i]!;
      const slide = lerp(hp.slide, hc.slide, alpha);
      let g = hc.gulp >= 0 ? (hp.gulp >= 0 ? lerp(hp.gulp, hc.gulp, alpha) : alpha * hc.gulp) : -1;
      const pg = (now - this.predicted[i]!) / TICK_MS;
      if (g < 0 && pg >= 0 && pg <= GULP_OUT + GULP_BACK && frame.mine.includes(i)) g = pg;   // cosmetic local prediction
      const lunge = lungeAt(g);
      const p = hippoPoint(i, slide, lunge);
      const rig = this.rigs[i]!, k = AXES[i]!;
      rig.group.position.copy(at(p.x, p.y, 0));
      rig.group.rotation.set(0, Math.atan2(k.ax, -k.ay), 0);
      const snarl = Math.max(0, Math.min(1, (this.snarlUntil[i]! - now) / 400));
      rig.pose(hc, lunge, jawOpen(g), snarl, t);
      if (hc.sputter > 0) this.smoke(i, dt);
    }
    // drops and slicks blend by id between the two snapshots
    const before = new Map(prev.drops.map((d) => [d.id, d]));
    this.drops.sync(frame.phase === "podium" ? [] : cur.drops.map((d) => {
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
    this.frameCamera(now, dt, frame);
    this.gl.info.reset();
    this.post.render(t);
  }

  /** Back to the round: belt, scale, visibility, camera, confetti and popups all reset. */
  private stopFinale() { this.cine.stop(); this.fx.clear(); this.popups.clear(); this.shake = 0; this.camPush = 0; }

  /** The finale, for the UI's Skip button and the preview's transport. */
  get finale() { const now = performance.now(); return { playing: this.cine.active, clock: this.cine.active ? this.cine.clock(now) : 0, duration: this.cine.duration, paused: this.cine.override !== null, tosses: this.cine.tosses }; }
  skipFinale() { if (!this.cine.active) return; this.cine.skip(performance.now()); this.fx.clear(); this.popups.clear(); this.shake = 0; }
  pauseFinale() { this.cine.pause(performance.now()); }
  resumeFinale() { this.cine.resume(performance.now()); }
  /** Preview: play the finale again from the bell on the next podium frame. */
  replayFinale() { if (this.cine.active) this.stopFinale(); this.lastPhase = ""; }

  /** Preview: a jealous snarl, the belt on or off, the geyser fired. */
  snarl(seat: number, ms = 1100) { this.snarlUntil[seat] = performance.now() + ms; }
  setBelt(seat: number, on: boolean) { this.rigs[seat]?.setChampion(on); }
  erupt(kind: number, strength = 1) { this.arena.geyser.erupt(kind, strength); }
  /** Draw calls in the last frame, every pass included. */
  get drawCalls() { return this.gl.info.render.calls; }

  private smoke(seat: number, dt: number) {
    this.smokeClock += dt;
    if (this.smokeClock < 0.05) return;
    this.smokeClock = 0;
    const r = this.rigs[seat]!;
    this.fx.emit(r.group.localToWorld(r.ears.clone()), 0xe8e8e8, 2, 1.8, 0.8, -1.5, 1);           // steam from the ears
    this.fx.emit(r.group.localToWorld(r.mouth.clone()), 0x3a3a3a, 2, 1.4, 0.9, -1, 1);           // smoke from the cough
  }

  /** Dev hook: jump the finale to this many seconds in and redraw. */
  seek(seconds: number) { if (!this.cine.active) return; this.cine.override = seconds; if (this.lastFrame) this.draw({ ...this.lastFrame, events: [] }, performance.now()); }

  /** Which engine runs the geyser's fluid: "rust" or "ts". */
  get fluidEngine() { return this.arena.geyser.engine; }

  dispose() { this.popups.clear(); this.gl.dispose(); this.gl.forceContextLoss(); }
}
const GULP_COOLDOWN_MS = 11 * TICK_MS;
