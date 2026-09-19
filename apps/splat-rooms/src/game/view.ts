// The game view. The player stands still and only looks around, which is what
// makes the blackout cheap: reveals are stored as world points and re-projected
// every frame onto a 2D mask canvas over the render. No splat shader needed.
//
// A shot is a ray from the crosshair against the round's blockers (object boxes
// and walls), so the hit point is the first surface along it: the centre of the
// splat we reveal around.
import * as pc from "playcanvas";
import { rayObb, BOX_EDGES, type Obb, type Vec3 } from "../viewer/boxes.ts";
import type { Candidate, Round } from "./round.ts";

export interface Reveal { point: Vec3; radius: number }
export interface ShotResult { reveals: Reveal[]; hit: boolean }
export interface GameViewOptions {
  onPick?(c: Candidate | null): void;
  onProgress?(msg: string | null): void;
}

const FOV = 60;

export class GameView {
  private app: pc.AppBase;
  private root: pc.Entity;
  private camera: pc.Entity;
  private splat?: pc.Entity;
  private asset?: pc.Asset;
  private round: Round | null = null;
  private reveals: Reveal[] = [];
  private yaw = 0;
  private pitch = 0;
  private revealed = false;      // "reveal all" debug / end-of-round
  private detach: (() => void)[] = [];
  private mask: CanvasRenderingContext2D | null;
  private pickMode = false;
  private highlight: Candidate | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private maskCanvas: HTMLCanvasElement,
    private opts: GameViewOptions = {},
  ) {
    this.mask = maskCanvas.getContext("2d");
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      graphicsDeviceOptions: { antialias: false, alpha: false },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    this.camera = new pc.Entity("camera");
    this.camera.addComponent("camera", { clearColor: new pc.Color(0, 0, 0), farClip: 200, fov: FOV });
    this.app.root.addChild(this.camera);

    this.root = new pc.Entity("data-root");   // z-up data -> y-up world
    this.root.setLocalEulerAngles(-90, 0, 0);
    this.app.root.addChild(this.root);

    this.app.on("update", () => this.frame());
    this.bindInput();
    this.app.start();
  }

  /** data space -> world space */
  private w(v: Vec3): pc.Vec3 {
    return this.root.getWorldTransform().transformPoint(new pc.Vec3(v[0], v[1], v[2]), new pc.Vec3());
  }

  private frame() {
    const r = this.round;
    if (!r) return;
    // Look direction in data space (z-up), converted by the root.
    const y = (this.yaw * Math.PI) / 180;
    const p = (this.pitch * Math.PI) / 180;
    const fwd: Vec3 = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
    this.camera.setPosition(this.w(r.eye));
    this.camera.lookAt(this.w([r.eye[0] + fwd[0], r.eye[1] + fwd[1], r.eye[2] + fwd[2]]), new pc.Vec3(0, 1, 0));

    if (this.highlight) {
      const c = new pc.Color(0.4, 1, 0.55);
      for (const [i, j] of BOX_EDGES) {
        const a = this.highlight.obb.corners[i], b = this.highlight.obb.corners[j];
        if (a && b) this.app.drawLine(this.w(a), this.w(b), c, true);
      }
    }
    this.paintMask();
  }

  /** Black over everything, holes where shots landed. */
  private paintMask() {
    const ctx = this.mask;
    if (!ctx) return;
    const { width: w, height: h } = this.maskCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.revealed) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const cam = this.camera.camera!;
    const dpr = w / this.maskCanvas.clientWidth || 1;
    // Screen radius of a world-space sphere: r/dist scaled by the projection.
    const halfH = h / 2;
    const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
    ctx.globalCompositeOperation = "destination-out";
    for (const rev of this.reveals) {
      const world = this.w(rev.point);
      const s = cam.worldToScreen(world, new pc.Vec3());
      const behind = s.z <= 0;
      if (behind) continue;
      const px = s.x * dpr, py = s.y * dpr;
      const rPx = (rev.radius / Math.max(s.z, 0.2)) * (halfH / tanHalf);
      if (rPx < 0.5) continue;
      // Soft edge: a hard circle looks like a sticker, a gradient looks like light.
      const g = ctx.createRadialGradient(px, py, rPx * 0.35, px, py, rPx);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, rPx, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private bindInput() {
    const el = this.maskCanvas;
    let dragging = false, lx = 0, ly = 0, moved = 0;
    const down = (e: PointerEvent) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.18;
      this.pitch = Math.max(-80, Math.min(80, this.pitch - dy * 0.18));
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (moved < 4 && this.pickMode) this.pickAtCentreOf(e);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    this.detach.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    });
  }

  /** Ray for a screen point, in data space. */
  private rayFor(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 } {
    const rect = this.maskCanvas.getBoundingClientRect();
    const cam = this.camera.camera!;
    const a = cam.screenToWorld(clientX - rect.left, clientY - rect.top, cam.nearClip);
    const b = cam.screenToWorld(clientX - rect.left, clientY - rect.top, cam.farClip);
    const inv = this.root.getWorldTransform().clone().invert();
    const pa = inv.transformPoint(a, new pc.Vec3());
    const pb = inv.transformPoint(b, new pc.Vec3());
    const d: Vec3 = [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z];
    const l = Math.hypot(...d) || 1;
    return { origin: [pa.x, pa.y, pa.z], dir: [d[0] / l, d[1] / l, d[2] / l] };
  }

  private centre(): { x: number; y: number } {
    const r = this.maskCanvas.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** First surface along a ray: the shot's hit point. */
  private trace(origin: Vec3, dir: Vec3, blockers: Obb[]): { point: Vec3; distance: number } | null {
    let best = Infinity;
    for (const b of blockers) {
      const t = rayObb(origin, dir, b);
      if (t !== null && t > 0.2 && t < best) best = t;
    }
    if (!Number.isFinite(best)) return null;
    return { point: [origin[0] + dir[0] * best, origin[1] + dir[1] * best, origin[2] + dir[2] * best], distance: best };
  }

  /** One precise splat at the crosshair. */
  shoot(): ShotResult {
    const r = this.round;
    if (!r) return { reveals: [], hit: false };
    const c = this.centre();
    const { origin, dir } = this.rayFor(c.x, c.y);
    const hit = this.trace(origin, dir, r.blockers);
    if (!hit) return { reveals: [], hit: false };
    const rev = { point: hit.point, radius: 0.34 };
    this.reveals.push(rev);
    return { reveals: [rev], hit: true };
  }

  /** A wide scatter: cheap coverage, no precision. */
  spray(count = 20, spreadDeg = 14): ShotResult {
    const r = this.round;
    if (!r) return { reveals: [], hit: false };
    const c = this.centre();
    const rect = this.maskCanvas.getBoundingClientRect();
    const spreadPx = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan(((FOV / 2) * Math.PI) / 180)) * (rect.height / 2);
    const out: Reveal[] = [];
    for (let i = 0; i < count; i++) {
      // Golden-angle spiral: even cover, no clumping, no randomness needed.
      const t = (i + 0.5) / count;
      const rad = Math.sqrt(t) * spreadPx;
      const a = i * 2.39996;
      const { origin, dir } = this.rayFor(c.x + Math.cos(a) * rad, c.y + Math.sin(a) * rad);
      const hit = this.trace(origin, dir, r.blockers);
      if (!hit) continue;
      const rev = { point: hit.point, radius: 0.22 };
      this.reveals.push(rev);
      out.push(rev);
    }
    return { reveals: out, hit: out.length > 0 };
  }

  /** In pick mode a click asks "is this the thing?" */
  private pickAtCentreOf(e: PointerEvent) {
    const r = this.round;
    if (!r) return;
    const { origin, dir } = this.rayFor(e.clientX, e.clientY);
    let best: { c: Candidate; t: number } | null = null;
    for (const c of r.visible) {
      const t = rayObb(origin, dir, c.obb);
      if (t === null) continue;
      // Near-ties prefer the smaller object: the mug, not the table under it.
      if (!best || t < best.t - 0.05 || (Math.abs(t - best.t) <= 0.05 && c.obb.volume < best.c.obb.volume)) best = { c, t };
    }
    this.opts.onPick?.(best?.c ?? null);
  }

  setPickMode(on: boolean) { this.pickMode = on; }
  setHighlight(c: Candidate | null) { this.highlight = c; }
  revealAll(on: boolean) { this.revealed = on; }
  get shotCount() { return this.reveals.length; }

  async startRound(round: Round, plyUrl: string | null) {
    this.round = round;
    this.reveals = [];
    this.revealed = false;
    this.highlight = null;
    this.yaw = round.yaw;
    this.pitch = Math.max(-25, Math.min(25, round.pitch));
    if (plyUrl && this.asset?.file?.url !== plyUrl) {
      if (this.splat) { this.splat.destroy(); this.splat = undefined; }
      if (this.asset) { this.app.assets.remove(this.asset); this.asset.unload(); this.asset = undefined; }
      this.opts.onProgress?.("Loading room…");
      const asset = new pc.Asset(plyUrl, "gsplat", { url: plyUrl });
      this.asset = asset;
      this.app.assets.add(asset);
      await new Promise<void>((resolve, reject) => {
        asset.once("load", () => resolve());
        asset.once("error", (err: string) => reject(new Error(String(err))));
        this.app.assets.load(asset);
      });
      const e = new pc.Entity("splats");
      e.addComponent("gsplat", { asset });
      this.root.addChild(e);
      this.splat = e;
      this.opts.onProgress?.(null);
    }
  }

  resize(w: number, h: number) {
    this.app.resizeCanvas(w, h);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.maskCanvas.width = Math.round(w * dpr);
    this.maskCanvas.height = Math.round(h * dpr);
  }

  destroy() { for (const d of this.detach) d(); this.app.destroy(); }
}
