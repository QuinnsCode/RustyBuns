// PlayCanvas viewer. The PLY is splat-transform's compressed format, which is
// PlayCanvas's own, so its gsplat loader reads it directly.
//
// Data is z-up metres; PlayCanvas is y-up, so the scene hangs under a root
// rotated -90 about X. Picking happens in DATA space: the camera ray is
// transformed by the root's inverse, so boxes need no conversion.
import * as pc from "playcanvas";
import { toObb, rayObb, BOX_EDGES, type Obb, type Vec3 } from "./boxes.ts";
import type { SceneObject } from "../actions/scenes.ts";

export interface Pick { ins_id: string; distance: number }
export interface ViewerOptions { onPick?(p: Pick | null): void; onProgress?(msg: string | null): void }

interface Entry { id: string; label: string; obb: Obb }

export class Viewer {
  private app: pc.AppBase;
  private root: pc.Entity;
  private camera: pc.Entity;
  private splat?: pc.Entity;
  private asset?: pc.Asset;
  private entries: Entry[] = [];
  private selected: string | null = null;
  private showAll = false;
  // Orbit state, in data space: target point plus spherical offset.
  private target = new pc.Vec3(0, 0, 0);
  private yaw = 45;
  private pitch = 20;
  private dist = 12;
  private detach: (() => void)[] = [];
  private home: { target: [number, number, number]; dist: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private opts: ViewerOptions = {}) {
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      graphicsDeviceOptions: { antialias: false, alpha: false },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    this.camera = new pc.Entity("camera");
    this.camera.addComponent("camera", { clearColor: new pc.Color(0.03, 0.04, 0.05), farClip: 200, fov: 60 });
    this.app.root.addChild(this.camera);

    this.root = new pc.Entity("data-root");     // z-up data -> y-up world
    this.root.setLocalEulerAngles(-90, 0, 0);
    this.app.root.addChild(this.root);

    this.app.on("update", () => this.frame());
    this.bindInput();
    this.app.start();
  }

  private frame() {
    // Orbit camera, computed in data space then pushed through the root.
    const y = this.yaw * Math.PI / 180, p = Math.max(-1.5, Math.min(1.5, this.pitch * Math.PI / 180));
    const eye = new pc.Vec3(
      this.target.x + this.dist * Math.cos(p) * Math.cos(y),
      this.target.y + this.dist * Math.cos(p) * Math.sin(y),
      this.target.z + this.dist * Math.sin(p),
    );
    const w = (v: pc.Vec3) => this.root.getWorldTransform().transformPoint(v, new pc.Vec3());
    this.camera.setPosition(w(eye));
    this.camera.lookAt(w(this.target), new pc.Vec3(0, 1, 0));

    const line = (a: Vec3, b: Vec3, c: pc.Color) => this.app.drawLine(w(new pc.Vec3(a[0], a[1], a[2])), w(new pc.Vec3(b[0], b[1], b[2])), c, true);
    const draw = (e: Entry, c: pc.Color) => { for (const [i, j] of BOX_EDGES) line(e.obb.corners[i], e.obb.corners[j], c); };
    if (this.showAll) { const dim = new pc.Color(0.35, 0.4, 0.45, 0.5); for (const e of this.entries) draw(e, dim); }
    const sel = this.entries.find((e) => e.id === this.selected);
    if (sel) draw(sel, new pc.Color(0.4, 1, 0.55));
  }

  private bindInput() {
    const el = this.canvas;
    let dragging = false, lx = 0, ly = 0, moved = 0;
    const down = (e: PointerEvent) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (e.shiftKey) {   // pan across the view plane
        const s = this.dist * 0.0015;
        const y = this.yaw * Math.PI / 180;
        this.target.x += (-Math.sin(y) * -dx - Math.cos(y) * 0) * s;
        this.target.y += (Math.cos(y) * -dx) * s;
        this.target.z += dy * s;
      } else { this.yaw -= dx * 0.3; this.pitch = Math.max(-85, Math.min(85, this.pitch + dy * 0.3)); }
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (moved < 4) this.pickAt(e);   // a click, not a drag
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.dist = Math.max(1.2, Math.min(60, this.dist * (1 + Math.sign(e.deltaY) * 0.12))); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    this.detach.push(() => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("wheel", wheel);
    });
  }

  private pickAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const cam = this.camera.camera!;
    const a = cam.screenToWorld(e.clientX - r.left, e.clientY - r.top, cam.nearClip);
    const b = cam.screenToWorld(e.clientX - r.left, e.clientY - r.top, cam.farClip);
    const inv = this.root.getWorldTransform().clone().invert();
    const pa = inv.transformPoint(a, new pc.Vec3()), pb = inv.transformPoint(b, new pc.Vec3());
    const origin: Vec3 = [pa.x, pa.y, pa.z];
    const dir: Vec3 = [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z];
    const dl = Math.hypot(...dir) || 1;
    const unit: Vec3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    let best: { id: string; t: number; volume: number } | null = null;
    for (const en of this.entries) {
      const t = rayObb(origin, unit, en.obb);
      if (t === null) continue;
      // Nearest hit wins, but near-ties go to the smaller object so clicking a
      // mug on a table doesn't select the table.
      const nearer = !best || t < best.t - 0.05;
      const tieSmaller = best && Math.abs(t - best.t) <= 0.05 && en.obb.volume < best.volume;
      if (nearer || tieSmaller) best = { id: en.id, t, volume: en.obb.volume };
    }
    this.selected = best?.id ?? null;
    this.opts.onPick?.(best ? { ins_id: best.id, distance: best.t } : null);
  }

  async load(plyUrl: string | null, objects: SceneObject[]) {
    this.entries = [];
    for (const o of objects) {
      const obb = o.bounding_box ? toObb(o.bounding_box) : null;
      if (obb) this.entries.push({ id: o.ins_id, label: o.label, obb });
    }
    // Frame the room from its boxes before the splats arrive.
    if (this.entries.length) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const e of this.entries) for (const c of e.obb.corners) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
      this.home = {
        target: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
        dist: Math.max(hi[0] - lo[0], hi[1] - lo[1]) * 1.1 + 2,
      };
      this.frameRoom();
    }
    if (this.splat) { this.splat.destroy(); this.splat = undefined; }
    if (this.asset) { this.app.assets.remove(this.asset); this.asset.unload(); this.asset = undefined; }
    // Labels-only scene: show the boxes, skip the splats.
    if (!plyUrl) { this.showAll = true; this.opts.onProgress?.(null); return; }
    this.opts.onProgress?.("Loading splats…");
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

  select(insId: string | null, fly = true) {
    this.selected = insId;
    const e = this.entries.find((x) => x.id === insId);
    if (e && fly) {
      this.target.set(e.obb.center[0], e.obb.center[1], e.obb.center[2]);
      // Splats are volumetric: closer than ~1.8 m you are inside them and the
      // view turns to coloured fog, so frame small objects from further back.
      this.dist = Math.min(9, Math.max(1.8, Math.max(...e.obb.size) * 3.5));
    }
  }

  /** Back to the whole-room view: the reliable escape from being inside a splat. */
  frameRoom() {
    if (!this.home) return;
    this.target.set(...this.home.target);
    this.dist = this.home.dist;
    this.yaw = 45; this.pitch = 20;
  }

  setShowAllBoxes(on: boolean) { this.showAll = on; }
  resize(w: number, h: number) { this.app.resizeCanvas(w, h); }
  destroy() { for (const d of this.detach) d(); this.app.destroy(); }
}
