// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The 3D part, loaded only once the widget scrolls into view. Renders on the main thread: one hat is a few draw
// calls, and pointer picking (dragging the picture over the fabric) needs the canvas the pointer is on. It draws
// only when something changed, and not at all while the widget is off screen.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Design, Model } from "../api.ts";
import { buildHat, type Hat } from "./hats.ts";
import { clampPlacement, onPicture, paint, zoneSpot, type Placement } from "./print.ts";
import { prepare, type Prepared } from "./image.ts";
import ImageWorker from "./image-worker.ts?worker&inline";

export type View = "front" | "angle" | "side" | "back";
const VIEWS: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2, back: Math.PI };

export type Layer = { picture: Prepared; at: Placement; texture?: string; original?: string };

export class Viewer {
  readonly canvas: HTMLCanvasElement;
  model: Model = "cap";
  color = "#1f2937";
  layer: Layer | null = null;
  /** Called after any change the shopper made (drag, colour, model, picture). */
  onChange: () => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  private controls: OrbitControls;
  private hat!: Hat;
  private printCanvas = document.createElement("canvas");
  private printCtx = this.printCanvas.getContext("2d")!;
  private printTex = new THREE.CanvasTexture(this.printCanvas);
  private ray = new THREE.Raycaster();
  private dirty = true;
  private visible = true;
  private dragging: { pointer: number; du: number; dv: number } | null = null;
  private frame = 0;
  private worker: Worker | null = null;
  private noWorker = false;
  private jobs = new Map<number, { resolve: (p: Prepared) => void; reject: (e: Error) => void }>();
  private resize: ResizeObserver;
  private seen: IntersectionObserver;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.NeutralToneMapping; // made for product viewers: colours stay the colours shoppers picked;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
    host.append(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.renderer.toneMappingExposure = 0.95;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 0.35));
    this.scene.add(contactShadow());

    this.printCanvas.width = 2048;
    this.printCanvas.height = 1024;
    this.printTex.colorSpace = THREE.SRGBColorSpace;
    this.printTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // Picking comes before OrbitControls' own listener, so a press on the picture drags it instead of the camera.
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.up);
    this.canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.addEventListener("change", () => (this.dirty = true));

    this.setModel("cap");
    this.camera.position.set(0, 2, 5.6);
    this.view("angle", false);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.seen = new IntersectionObserver(([e]) => { this.visible = !!e?.isIntersecting; this.dirty = true; });
    this.seen.observe(host);
    this.fit();
    this.loop();
  }

  private fit() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall frame (a phone) keeps the wide one's side-to-side view, so the hat fits across it.
    const fov = 32, a = w / h;
    this.camera.fov = a >= 1 ? fov : Math.min(62, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) / a)));
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  /** Redraw the print canvas and mark the frame dirty. */
  private repaint(outline = !!this.dragging) {
    const pictures = this.layer ? [{ image: this.layer.picture.bitmap, aspect: this.layer.picture.aspect, at: this.layer.at }] : [];
    paint(this.printCtx, this.hat, this.color, pictures, outline);
    this.printTex.needsUpdate = true;
    this.dirty = true;
  }

  setModel(m: Model) {
    if (this.hat) {
      this.scene.remove(this.hat.group);
      this.hat.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.model = m;
    this.hat = buildHat(m);
    this.hat.print.material.map = this.printTex;
    this.hat.group.position.y = -0.3;
    this.scene.add(this.hat.group);
    this.controls.target.copy(this.hat.target).add(this.hat.group.position);
    this.setColor(this.color);
  }

  setColor(c: string) {
    this.color = c;
    for (const m of this.hat.dyed) m.material.color.set(c);
    this.repaint();
  }

  /** Swing the camera round to a named side, keeping its height and distance. */
  view(v: View, animate = true) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    const to = VIEWS[v];
    if (!animate) {
      s.theta = to;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
      this.dirty = true;
      return;
    }
    const from = s.theta;
    let d = to - from;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 450), e = 1 - Math.pow(1 - t, 3);
      s.theta = from + d * e;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  /** Swing to the named side after the one the camera is nearest now, so a shopper who orbited still moves on. */
  nextView() {
    const az = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)).theta;
    const order = Object.keys(VIEWS) as View[];
    const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const at = order.reduce((best, v, i) => (gap(VIEWS[v], az) < gap(VIEWS[order[best]!], az) ? i : best), 0);
    this.view(order[(at + 1) % order.length]!);
  }

  /** Decode, shrink and hash a photo (in a Worker when allowed), then put it on the front of the hat. */
  async addImage(file: Blob): Promise<Layer> {
    const picture = await this.prepare(file);
    this.layer?.picture.bitmap.close();
    this.layer = { picture, at: { u: 0.5, v: 0.55, scale: 0.7, rotation: 0 } };
    this.repaint();
    this.view("front");
    this.onChange();
    return this.layer;
  }

  removeImage() {
    this.layer?.picture.bitmap.close();
    this.layer = null;
    this.repaint();
    this.onChange();
  }

  place(p: Partial<Placement>) {
    if (!this.layer) return;
    this.layer.at = clampPlacement({ ...this.layer.at, ...p });
    this.repaint();
    this.onChange();
  }

  private prepare(file: Blob): Promise<Prepared> {
    if (!this.worker && !this.noWorker) {
      try {
        this.worker = new ImageWorker();
        this.worker.onmessage = (e: MessageEvent<{ id: number; ok?: Prepared; error?: string }>) => {
          const job = this.jobs.get(e.data.id);
          this.jobs.delete(e.data.id);
          if (e.data.ok) job?.resolve(e.data.ok);
          else job?.reject(new Error(e.data.error ?? "could not read that picture"));
        };
      } catch {
        this.noWorker = true; // a CSP without blob: workers: do it in the page from now on
      }
    }
    if (!this.worker) return prepare(file);
    const id = this.jobs.size + Math.random();
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker!.postMessage({ id, file });
    });
  }

  private pick(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.hat.print, false)[0];
    return hit?.uv ? zoneSpot(this.hat.zone, hit.uv) : null;
  }

  private down = (e: PointerEvent) => {
    if (!this.layer || this.dragging) return;
    const spot = this.pick(e);
    if (!spot || !onPicture(this.hat, this.layer.at, this.layer.picture.aspect, spot)) return;
    this.dragging = { pointer: e.pointerId, du: this.layer.at.u - spot.u, dv: this.layer.at.v - spot.v };
    this.controls.enabled = false;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that already ended */ }
    this.canvas.style.cursor = "grabbing";
    this.repaint(true);
  };

  private move = (e: PointerEvent) => {
    if (!this.layer) return;
    if (!this.dragging) {
      const spot = e.pointerType === "mouse" ? this.pick(e) : null;
      this.canvas.style.cursor = spot && onPicture(this.hat, this.layer.at, this.layer.picture.aspect, spot) ? "grab" : "";
      return;
    }
    if (e.pointerId !== this.dragging.pointer) return;
    const spot = this.pick(e);
    if (!spot) return;
    this.layer.at = clampPlacement({ ...this.layer.at, u: spot.u + this.dragging.du, v: spot.v + this.dragging.dv });
    this.repaint(true);
  };

  private up = (e: PointerEvent) => {
    if (!this.dragging || e.pointerId !== this.dragging.pointer) return;
    this.dragging = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = "";
    this.repaint(false);
    this.onChange();
  };

  /** The wheel over the picture resizes it (with Shift, turns it); anywhere else it zooms. */
  private wheel = (e: WheelEvent) => {
    if (!this.layer) return;
    const spot = this.pick(e);
    if (!spot || !onPicture(this.hat, this.layer.at, this.layer.picture.aspect, spot)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.shiftKey) this.place({ rotation: this.layer.at.rotation + Math.sign(e.deltaY || e.deltaX) * 0.08 });
    else this.place({ scale: this.layer.at.scale * Math.exp(-e.deltaY * 0.0015) });
  };

  /** Everything needed to draw this again. File keys are filled in once the files are saved. */
  design(): Design {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const l = this.layer;
    return {
      v: 1, model: this.model, color: this.color,
      layers: l ? [{ texture: l.texture ?? "", original: l.original, ...l.at }] : [],
      camera: { azimuth: s.theta, polar: s.phi, distance: s.radius },
    };
  }

  /** Put the camera, model and colour back as a design had them (its picture comes back through addImage). */
  apply(d: Design) {
    if (d.model !== this.model) this.setModel(d.model);
    this.setColor(d.color);
    const s = new THREE.Spherical(d.camera.distance, d.camera.polar, d.camera.azimuth);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    const at = d.layers[0];
    if (at && this.layer) this.layer.at = clampPlacement(at);
    this.repaint();
  }

  /** A PNG of the hat as it looks now, at `scale` times the widget's pixels, on a transparent background. */
  async snapshot(scale = 2): Promise<Blob> {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(size.x, size.y, false);
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, "image/png"));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.dirty = true;
    if (!blob) throw new Error("could not take a snapshot");
    return blob;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.seen.disconnect();
    this.worker?.terminate();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** A soft round shadow under the hat: a radial gradient on a quad, no shadow maps to render. */
function contactShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.32)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.31;
  return m;
}
