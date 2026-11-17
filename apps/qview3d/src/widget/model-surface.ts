// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A shop's own model (a sample from its photos) as a Surface: each layer projected on as a decal (surfaces.ts
// says why). In a chunk of its own with the GLB loader, so a page with only hats never downloads either.
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PrintArea } from "../api.ts";
import type { Picture, Placement } from "./print.ts";
import { disposeTree, type Surface, type ZoneInfo } from "./surfaces.ts";

type SurfacePoint = { point: THREE.Vector3; normal: THREE.Vector3 };
const vec = (a: number[] | undefined, d: THREE.Vector3) => (a && a.length === 3 ? new THREE.Vector3(a[0], a[1], a[2]) : d.clone());

export class ModelSurface implements Surface<SurfacePoint> {
  readonly ownColors = true;
  /** One picture: anywhere on it, or inside the print area the shop marked. */
  readonly zones: readonly ZoneInfo[] = [{ name: "front", label: "Front", view: "front" }];
  readonly group = new THREE.Group();
  readonly target: THREE.Vector3;
  private meshes: THREE.Mesh[] = [];
  private decals: THREE.Mesh<DecalGeometry, THREE.MeshStandardMaterial>[] = [];
  private art = new Map<CanvasImageSource, THREE.CanvasTexture>();
  private ray = new THREE.Raycaster();
  private outline: THREE.LineLoop | null = null;
  /** The print area's frame, in the group's space: its middle, and right, up and out along its facing. */
  private frame: { at: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; out: THREE.Vector3; half: number } | null = null;

  /** `scene` scaled to fit the hats' 2-unit box, centred, standing on the floor. */
  constructor(scene: THREE.Object3D, readonly area: PrintArea | null = null) {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const k = 2 / Math.max(size.x, size.y, size.z, 1e-6);
    scene.scale.multiplyScalar(k);
    scene.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    this.group.add(scene);
    scene.traverse((o) => { if (o instanceof THREE.Mesh) this.meshes.push(o); });
    this.target = new THREE.Vector3(0, (size.y * k) / 2, 0);
    if (area) {
      const o = new THREE.Object3D();
      const at = vec(area.point, this.target), out = vec(area.normal, new THREE.Vector3(0, 0, 1)).normalize();
      o.lookAt(out);
      this.frame = { at, out, right: new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion), up: new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion), half: area.size / 2 };
      const h = area.size / 2, c = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => at.clone().addScaledVector(this.frame!.right, x!).addScaledVector(this.frame!.up, y!).addScaledVector(out, 0.01));
      this.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineDashedMaterial({ color: 0xf97316, dashSize: 0.04, gapSize: 0.03, depthTest: false }));
      this.outline.computeLineDistances();
      this.outline.visible = false;
      this.group.add(this.outline);
    }
  }

  /** Whether a spot (the group's space) is inside the print area: always, when there is none. */
  inside(p: THREE.Vector3): boolean {
    const f = this.frame;
    if (!f) return true;
    const d = p.clone().sub(f.at);
    return Math.abs(d.dot(f.right)) <= f.half && Math.abs(d.dot(f.up)) <= f.half && Math.abs(d.dot(f.out)) <= f.half;
  }

  /** The picture's width on the surface, in world units. */
  private width(at: Placement) { return Math.min(at.scale * 1.4, this.area?.size ?? Infinity); }
  private world(at: Placement) {
    this.group.updateMatrixWorld(true);
    return { point: this.group.localToWorld(vec(at.point, this.target)), normal: vec(at.normal, new THREE.Vector3(0, 0, 1)).normalize() };
  }

  hit(ray: THREE.Raycaster): SurfacePoint | null {
    const h = ray.intersectObjects(this.meshes, false)[0];
    if (!h?.face) return null;
    return { point: h.point.clone(), normal: h.face.normal.clone().transformDirection(h.object.matrixWorld) };
  }
  zoneAt() { return "front" as const; }
  onPicture(at: Placement, _aspect: number, spot: SurfacePoint) {
    return !!at.point && this.world(at).point.distanceTo(spot.point) < this.width(at) * 0.6 + 0.05;
  }
  drag(at: Placement, _from: SurfacePoint, to: SurfacePoint): Placement {
    this.group.updateMatrixWorld(true);
    const p = this.group.worldToLocal(to.point.clone());
    // Past the print area's edge it stays where it was, so a drag slides along the edge's inside.
    return this.inside(p) ? { ...at, point: p.toArray(), normal: to.normal.toArray() } : at;
  }
  start(): Placement {
    this.group.updateMatrixWorld(true);
    if (this.area) return { zone: "front", u: 0.5, v: 0.5, scale: Math.min(0.45, this.area.size / 1.4), rotation: 0, point: [...this.area.point], normal: [...this.area.normal] };
    const from = this.group.localToWorld(this.target.clone()).setZ(10);
    this.ray.set(from, new THREE.Vector3(0, 0, -1));
    const h = this.hit(this.ray);
    const at: Placement = { zone: "front", u: 0.5, v: 0.5, scale: 0.45, rotation: 0 };
    return h ? this.drag(at, h, h) : { ...at, point: this.target.toArray(), normal: [0, 0, 1] };
  }
  nudge(at: Placement, dx: number, dy: number, camera: THREE.Camera): Placement {
    const ndc = this.world(at).point.project(camera);
    this.ray.setFromCamera(new THREE.Vector2(ndc.x + dx * 0.05, ndc.y - dy * 0.05), camera);
    const h = this.hit(this.ray);
    return h ? this.drag(at, h, h) : at;
  }
  setColor() { /* a shop's model keeps its own texture */ }

  draw(_color: string, pictures: Picture[], outline: string | null) {
    if (this.outline) this.outline.visible = outline !== null;
    for (const d of this.decals) { this.group.remove(d); d.geometry.dispose(); d.material.dispose(); }
    this.decals = [];
    const used = new Set<CanvasImageSource>();
    // One decal a layer, bottom first: each a step further off the surface, so a later one lies on top.
    for (const [i, picture] of pictures.entries()) {
      if (!picture.at.point) continue;
      const { point, normal } = this.world(picture.at);
      // The mesh under the spot: look back along the facing from just above it.
      this.ray.set(point.clone().addScaledVector(normal, 0.5), normal.clone().negate());
      const mesh = this.ray.intersectObjects(this.meshes, false)[0]?.object;
      if (!(mesh instanceof THREE.Mesh)) continue;
      const o = new THREE.Object3D();
      o.position.copy(point);
      o.lookAt(point.clone().add(normal));
      o.rotateZ(picture.at.rotation);
      const w = this.width(picture.at);
      const geo = new DecalGeometry(mesh, point, o.rotation, new THREE.Vector3(w, w / picture.aspect, w));
      geo.applyMatrix4(this.group.matrixWorld.clone().invert()); // decal geometry comes out in world space
      used.add(picture.image);
      const mat = new THREE.MeshStandardMaterial({ map: this.texture(picture.image), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 - i, roughness: 0.8 });
      mat.opacity = outline !== null ? 0.85 : 1;
      const decal = new THREE.Mesh(geo, mat);
      decal.renderOrder = i;
      this.decals.push(decal);
      this.group.add(decal);
    }
    for (const [image, tex] of this.art) if (!used.has(image)) { tex.dispose(); this.art.delete(image); }
  }

  /** A layer's picture as a texture, made once per picture. */
  private texture(image: CanvasImageSource) {
    let tex = this.art.get(image);
    if (!tex) {
      const c = document.createElement("canvas");
      const img = image as ImageBitmap;
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.art.set(image, tex);
    }
    return tex;
  }

  dispose() {
    disposeTree(this.group);
    for (const tex of this.art.values()) tex.dispose();
  }
}

/** A shop's model from its GLB. */
export async function loadModel(url: string, area: PrintArea | null = null): Promise<ModelSurface> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return new ModelSurface(gltf.scene, area);
}
