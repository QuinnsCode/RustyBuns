// The I-spy scene: one room full of objects, every splat tagged with the
// object it belongs to. Because we generate it, each object comes with a name,
// a splat range and a bounding box for free, which is what makes "find the
// rubber duck", focusing and dimming possible.
import * as THREE from "three";
import { rng, type Emitter } from "./kit.ts";

export interface SpyObject {
  id: number;
  name: string;
  /** other spellings that count as this object */
  aliases: string[];
  first: number;
  count: number;
  center: THREE.Vector3;
  radius: number;
  /** where the object was placed; splats are stored relative to this, so it can move */
  origin: THREE.Vector3;
}

export interface SpyScene {
  centers: Float32Array;
  /** each splat's position relative to its object's origin (scenery: absolute) */
  locals: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  /** object id per splat; -1 for scenery (floor, walls, shelves) */
  itemOf: Int32Array;
  objects: SpyObject[];
  count: number;
}

/**
 * Light baked into the splats. Splats carry no lighting of their own, so a
 * plain colour makes every object read as a flat silhouette; shading by the
 * surface normal is what gives them form. One key light, a softer fill from
 * the other side, plus ambient and a little per-splat grain.
 */
export const LIGHT = {
  key: new THREE.Vector3(-0.45, 0.8, 0.4).normalize(),
  fill: new THREE.Vector3(0.6, 0.25, 0.6).normalize(),
  keyStrength: 0.62,
  fillStrength: 0.18,
  ambient: 0.34,
  grain: 0.07,
};

/** Collects splats from the shape kit and records which object each belongs to. */
export class SceneBuilder implements Emitter {
  density: number;
  rand: () => number;
  private cx: number[] = [];
  private cc: number[] = [];
  private cs: number[] = [];
  private ci: number[] = [];
  private current = -1;
  private origin = new THREE.Vector3();
  private cl: number[] = [];
  readonly objects: SpyObject[] = [];
  private box = new THREE.Box3();

  constructor(opts: { density?: number; seed?: number } = {}) {
    this.density = opts.density ?? 9000;
    this.rand = rng(opts.seed ?? 20260917);
  }

  /** Scenery: floor, walls, shelves. Not something to find. */
  scenery() {
    this.closeObject();
    this.current = -1;
    return -1;
  }

  object(name: string, aliases: string[] = [], origin = new THREE.Vector3()): number {
    this.closeObject();
    const id = this.objects.length;
    this.origin = origin.clone();
    this.objects.push({ id, name, aliases, first: this.ci.length, count: 0, center: new THREE.Vector3(), radius: 0, origin: origin.clone() });
    this.box.makeEmpty();
    this.current = id;
    return id;
  }

  private closeObject() {
    if (this.current < 0) return;
    const o = this.objects[this.current]!;
    o.count = this.ci.length - o.first;
    if (!this.box.isEmpty()) {
      this.box.getCenter(o.center);
      o.radius = Math.max(0.04, this.box.getSize(new THREE.Vector3()).length() / 2);
    }
    this.current = -1;
  }

  at(p: THREE.Vector3, color: THREE.Color, size: number, normal?: THREE.Vector3) {
    const lit = this.shade(color, normal);
    this.cl.push(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z);
    this.cx.push(p.x, p.y, p.z);
    this.cc.push(lit.r, lit.g, lit.b);
    this.cs.push(size);
    this.ci.push(this.current);
    if (this.current >= 0) this.box.expandByPoint(p);
  }

  private shaded = new THREE.Color();

  /** Bake the lighting into one splat's colour. */
  private shade(color: THREE.Color, normal?: THREE.Vector3): THREE.Color {
    let amount = LIGHT.ambient + LIGHT.keyStrength + LIGHT.fillStrength;   // unlit: flat
    if (normal) {
      amount = LIGHT.ambient
        + LIGHT.keyStrength * Math.max(0, normal.dot(LIGHT.key))
        + LIGHT.fillStrength * Math.max(0, normal.dot(LIGHT.fill));
    }
    amount *= 1 + (this.rand() - 0.5) * LIGHT.grain;
    return this.shaded.setRGB(
      Math.min(1, color.r * amount),
      Math.min(1, color.g * amount),
      Math.min(1, color.b * amount),
    );
  }

  finish(): SpyScene {
    this.closeObject();
    return {
      centers: new Float32Array(this.cx),
      locals: new Float32Array(this.cl),
      colors: new Float32Array(this.cc),
      sizes: new Float32Array(this.cs),
      itemOf: new Int32Array(this.ci),
      objects: this.objects,
      count: this.cs.length,
    };
  }
}

/**
 * Move objects to new places. Splats are stored relative to their object's
 * origin, so shuffling is a rewrite of positions rather than a rebuild of the
 * whole room: cheap enough to do between rounds.
 */
export function placeObjects(scene: SpyScene, slots: THREE.Vector3[]) {
  scene.objects.forEach((o, i) => {
    const slot = slots[i % slots.length]!;
    const dx = slot.x - o.origin.x, dy = slot.y - o.origin.y, dz = slot.z - o.origin.z;
    for (let j = o.first; j < o.first + o.count; j++) {
      scene.centers[j * 3] = scene.locals[j * 3]! + slot.x;
      scene.centers[j * 3 + 1] = scene.locals[j * 3 + 1]! + slot.y;
      scene.centers[j * 3 + 2] = scene.locals[j * 3 + 2]! + slot.z;
    }
    o.origin.copy(slot);
    o.center.add(new THREE.Vector3(dx, dy, dz));
  });
}

/** Deal the slots out in a different order. */
export function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Write a built scene into Spark's splat store. */
export function fillPackedSplats(scene: SpyScene, splats: { ensureSplats(n: number): unknown; setSplat(i: number, c: THREE.Vector3, s: THREE.Vector3, q: THREE.Quaternion, o: number, color: THREE.Color): void; numSplats: number }) {
  splats.ensureSplats(scene.count);
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const color = new THREE.Color();
  for (let i = 0; i < scene.count; i++) {
    center.set(scene.centers[i * 3]!, scene.centers[i * 3 + 1]!, scene.centers[i * 3 + 2]!);
    scales.setScalar(scene.sizes[i]!);
    color.setRGB(scene.colors[i * 3]!, scene.colors[i * 3 + 1]!, scene.colors[i * 3 + 2]!);
    splats.setSplat(i, center, scales, quat, 0.95, color);
  }
  splats.numSplats = scene.count;
}
