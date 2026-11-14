// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The 3D part, loaded only once the widget scrolls into view. Renders on the main thread: one hat is a few draw
// calls, and pointer picking (dragging the picture over the fabric) needs the canvas the pointer is on. It draws
// only when something changed, and not at all while the widget is off screen.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TOPS, type Design, type Made, type Model, type TopModel, type ZoneName } from "../api.ts";
import { buildHat } from "./hats.ts";
import { buildTop } from "./tops.ts";
import { clampPlacement, type Placement } from "./print.ts";
import { GarmentSurface, type Surface, type ZoneInfo } from "./surfaces.ts";
import { prepare, type Prepared } from "./image.ts";
import ImageWorker from "./image-worker.ts?worker&inline";

export type View = "front" | "angle" | "side" | "back";
const VIEWS: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2, back: Math.PI };

export type Layer = { picture: Prepared; at: Placement; texture?: string; original?: string };

export class Viewer {
  readonly canvas: HTMLCanvasElement;
  model: Model = "cap";
  color = "#1f2937";
  /** The pictures on the product, one a zone. */
  layers: Layer[] = [];
  /** The zone the shopper is working on: where a new picture goes, and what the sliders and keys move. */
  zone: ZoneName = "front";
  /** Called after any change the shopper made (drag, colour, model, picture). */
  onChange: () => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  private controls: OrbitControls;
  private surface!: Surface<unknown>;
  private ray = new THREE.Raycaster();
  private dirty = true;
  private visible = true;
  private dragging: { pointer: number; layer: Layer; at: Placement; from: unknown } | null = null;
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
    this.canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    // Dragging has a keyboard way too (WCAG 2.5.7): focus the view, then arrows, + and -, [ and ].
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-roledescription", "3D product view");
    this.canvas.setAttribute("aria-label", "The product in 3D. Drag or Shift and the arrow keys to spin it. With a picture on, drag it, or use the arrow keys to move it, plus and minus to size it, and the square brackets to turn it.");
    this.canvas.addEventListener("keydown", this.key);
    host.append(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.renderer.toneMappingExposure = 0.95;
    pmrem.dispose();
    // The key light rides with the camera (up and to its right), so whichever side the shopper turns to is lit:
    // a top's back print reads as well as its front (the loop turns the room's reflections the same way).
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.4, 2.6, 1);
    this.camera.add(key);
    this.scene.add(this.camera, new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 0.35));
    this.scene.add(contactShadow());

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
    // The room's reflections turn with the camera as the key light does, so no side of the product sits in its shade.
    this.scene.environmentRotation.y = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
    this.renderer.render(this.scene, this.camera);
  };

  /** The picture in the zone being worked on, if it has one. */
  get layer(): Layer | null { return this.layers.find((l) => (l.at.zone ?? "front") === this.zone) ?? null; }

  /** The product's print zones. */
  get zones(): readonly ZoneInfo[] { return this.surface.zones; }

  /** Redraw the pictures on the surface and mark the frame dirty. */
  private repaint(outline = !!this.dragging) {
    const pictures = this.layers.map((l) => ({ image: l.picture.bitmap, aspect: l.picture.aspect, at: l.at }));
    this.surface.draw(this.color, pictures, outline ? this.zone : null);
    this.dirty = true;
  }

  /** Whether the product keeps its own colours (a shop's own model): no swatches. */
  get ownColors() { return this.surface.ownColors; }

  private use(next: Surface<unknown>, m: Model) {
    if (this.surface) { this.scene.remove(this.surface.group); this.surface.dispose(); }
    this.surface = next;
    this.model = m;
    next.group.position.y = -0.3;
    this.scene.add(next.group);
    this.controls.target.copy(next.target).add(next.group.position);
    // Pictures keep their zones where the new product has them (a hat's front is a top's front); the rest come off.
    // One moving between a made product and a shop's model keeps its size and turn and starts in the middle.
    const has = (z: ZoneName) => next.zones.some((x) => x.name === z);
    for (const l of this.layers.filter((l) => !has(l.at.zone ?? "front"))) l.picture.bitmap.close();
    this.layers = this.layers.filter((l) => has(l.at.zone ?? "front"));
    for (const l of this.layers) {
      if (m !== "custom" && !l.at.point) continue;
      const { point, normal, ...rest } = next.start(l.at.zone ?? "front");
      l.at = m === "custom" ? { ...rest, point, normal, scale: l.at.scale, rotation: l.at.rotation } : { ...rest, scale: l.at.scale, rotation: l.at.rotation };
    }
    if (!has(this.zone)) this.zone = next.zones[0]!.name;
    this.setColor(this.color);
  }

  setModel(m: Made) {
    const garment = (TOPS as readonly Made[]).includes(m) ? buildTop(m as TopModel) : buildHat(m as Exclude<Made, TopModel>);
    this.use(new GarmentSurface(garment, Math.min(8, this.renderer.capabilities.getMaxAnisotropy())), m);
  }

  /** Work on another zone: the camera swings round to it. */
  setZone(z: ZoneName) {
    const info = this.zones.find((x) => x.name === z);
    if (!info) return;
    this.zone = z;
    this.view(info.view);
    this.repaint();
    this.onChange();
  }

  /** A shop's own model, from its GLB. */
  async setCustom(url: string) {
    const { loadModel } = await import("./model-surface.ts"); // its own chunk: hats-only pages never load it
    this.use(await loadModel(url), "custom");
  }

  setColor(c: string) {
    this.color = c;
    this.surface.setColor(c);
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

  /** Decode, shrink and hash a photo (in a Worker when allowed), then put it in the middle of `zone` (the one being worked on), in place of any picture there. */
  async addImage(file: Blob, zone: ZoneName = this.zone): Promise<Layer> {
    const info = this.zones.find((x) => x.name === zone);
    if (!info) throw new Error(`This product has no ${zone} to print on`);
    const picture = await this.prepare(file);
    this.zone = zone;
    this.layer?.picture.bitmap.close();
    const layer = { picture, at: this.surface.start(zone) };
    this.layers = [...this.layers.filter((l) => (l.at.zone ?? "front") !== zone), layer];
    this.repaint();
    this.view(info.view);
    this.onChange();
    return layer;
  }

  /** Take the picture off the zone being worked on. */
  removeImage() {
    const l = this.layer;
    if (!l) return;
    l.picture.bitmap.close();
    this.layers = this.layers.filter((x) => x !== l);
    this.repaint();
    this.onChange();
  }

  /** The picture under a pointer spot, the zone being worked on first. */
  private under(spot: unknown) {
    const order = [...this.layers].sort((a, b) => Number((b.at.zone ?? "front") === this.zone) - Number((a.at.zone ?? "front") === this.zone));
    return order.find((l) => this.surface.onPicture(l.at, l.picture.aspect, spot)) ?? null;
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
    return this.surface.hit(this.ray);
  }

  private down = (e: PointerEvent) => {
    if (this.dragging) return;
    const spot = this.pick(e);
    if (!spot) return;
    const l = this.under(spot);
    if (!l) {
      // A press on another zone works on that one from now on (the camera still turns: this press may be a spin).
      const z = this.surface.zoneAt(spot);
      if (z && z !== this.zone) { this.zone = z; this.repaint(false); this.onChange(); }
      return;
    }
    if ((l.at.zone ?? "front") !== this.zone) { this.zone = l.at.zone ?? "front"; this.onChange(); }
    this.dragging = { pointer: e.pointerId, layer: l, at: { ...l.at }, from: spot };
    this.controls.enabled = false;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that already ended */ }
    this.canvas.style.cursor = "grabbing";
    this.repaint(true);
  };

  private move = (e: PointerEvent) => {
    if (!this.layers.length) return;
    if (!this.dragging) {
      const spot = e.pointerType === "mouse" ? this.pick(e) : null;
      this.canvas.style.cursor = spot && this.under(spot) ? "grab" : "";
      return;
    }
    if (e.pointerId !== this.dragging.pointer) return;
    const spot = this.pick(e);
    if (!spot) return;
    this.dragging.layer.at = clampPlacement(this.surface.drag(this.dragging.at, this.dragging.from, spot));
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

  private key = (e: KeyboardEvent) => {
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (step && (e.shiftKey || !this.layer)) {
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      s.theta -= step[0] * 0.26;
      s.phi = THREE.MathUtils.clamp(s.phi + step[1] * 0.12, this.controls.minPolarAngle, this.controls.maxPolarAngle);
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
      this.dirty = true;
      e.preventDefault();
      return;
    }
    const l = this.layer;
    if (!l) return;
    if (step) l.at = clampPlacement(this.surface.nudge(l.at, step[0], step[1], this.camera));
    else if (e.key === "+" || e.key === "=") l.at = clampPlacement({ ...l.at, scale: l.at.scale * 1.1 });
    else if (e.key === "-" || e.key === "_") l.at = clampPlacement({ ...l.at, scale: l.at.scale / 1.1 });
    else if (e.key === "[" || e.key === "]") l.at = clampPlacement({ ...l.at, rotation: l.at.rotation + (e.key === "]" ? 0.1 : -0.1) });
    else return;
    e.preventDefault();
    this.repaint(false);
    this.onChange();
  };

  /** The wheel over the picture resizes it (with Shift, turns it); anywhere else it zooms. */
  private wheel = (e: WheelEvent) => {
    if (!this.layers.length) return;
    const spot = this.pick(e);
    const l = spot ? this.under(spot) : null;
    if (!l) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.zone = l.at.zone ?? "front";
    if (e.shiftKey) this.place({ rotation: l.at.rotation + Math.sign(e.deltaY || e.deltaX) * 0.08 });
    else this.place({ scale: l.at.scale * Math.exp(-e.deltaY * 0.0015) });
  };

  /** Everything needed to draw this again. File keys are filled in once the files are saved. */
  design(): Design {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    return {
      v: 1, model: this.model, color: this.color,
      layers: this.layers.map((l) => ({ texture: l.texture ?? "", original: l.original, ...l.at })),
      camera: { azimuth: s.theta, polar: s.phi, distance: s.radius },
    };
  }

  /** Put the camera, model and colour back as a design had them (its pictures come back through addImage, zone by zone). A custom model is the element's to load first. */
  apply(d: Design) {
    if (d.model !== this.model && d.model !== "custom") this.setModel(d.model);
    this.setColor(d.color);
    const s = new THREE.Spherical(d.camera.distance, d.camera.polar, d.camera.azimuth);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    for (const at of d.layers) {
      const l = this.layers.find((x) => (x.at.zone ?? "front") === (at.zone ?? "front"));
      if (l) l.at = clampPlacement({ ...at, zone: at.zone ?? "front" });
    }
    this.repaint();
  }

  /** A PNG of the product as it looks now, at `scale` times the widget's pixels, on a transparent background. */
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
