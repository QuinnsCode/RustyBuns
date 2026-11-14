// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A shop's own model (a sample from its photos) as a Surface: its picture projected on as a decal (surfaces.ts
// says why). In a chunk of its own with the GLB loader, so a page with only hats never downloads either.
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Picture, Placement } from "./print.ts";
import { disposeTree, type Surface } from "./surfaces.ts";

type SurfacePoint = { point: THREE.Vector3; normal: THREE.Vector3 };
const vec = (a: number[] | undefined, d: THREE.Vector3) => (a && a.length === 3 ? new THREE.Vector3(a[0], a[1], a[2]) : d.clone());

export class ModelSurface implements Surface<SurfacePoint> {
  readonly ownColors = true;
  readonly group = new THREE.Group();
  readonly target: THREE.Vector3;
  private meshes: THREE.Mesh[] = [];
  private decal: THREE.Mesh<DecalGeometry, THREE.MeshStandardMaterial> | null = null;
  private art: { from: CanvasImageSource; tex: THREE.CanvasTexture } | null = null;
  private ray = new THREE.Raycaster();

  /** `scene` scaled to fit the hats' 2-unit box, centred, standing on the floor. */
  constructor(scene: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const k = 2 / Math.max(size.x, size.y, size.z, 1e-6);
    scene.scale.multiplyScalar(k);
    scene.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    this.group.add(scene);
    scene.traverse((o) => { if (o instanceof THREE.Mesh) this.meshes.push(o); });
    this.target = new THREE.Vector3(0, (size.y * k) / 2, 0);
  }

  /** The picture's width on the surface, in world units. */
  private width(at: Placement) { return at.scale * 1.4; }
  private world(at: Placement) {
    this.group.updateMatrixWorld(true);
    return { point: this.group.localToWorld(vec(at.point, this.target)), normal: vec(at.normal, new THREE.Vector3(0, 0, 1)).normalize() };
  }

  hit(ray: THREE.Raycaster): SurfacePoint | null {
    const h = ray.intersectObjects(this.meshes, false)[0];
    if (!h?.face) return null;
    return { point: h.point.clone(), normal: h.face.normal.clone().transformDirection(h.object.matrixWorld) };
  }
  onPicture(at: Placement, _aspect: number, spot: SurfacePoint) {
    return !!at.point && this.world(at).point.distanceTo(spot.point) < this.width(at) * 0.6 + 0.05;
  }
  drag(at: Placement, _from: SurfacePoint, to: SurfacePoint): Placement {
    this.group.updateMatrixWorld(true);
    return { ...at, point: this.group.worldToLocal(to.point.clone()).toArray(), normal: to.normal.toArray() };
  }
  start(): Placement {
    this.group.updateMatrixWorld(true);
    const from = this.group.localToWorld(this.target.clone()).setZ(10);
    this.ray.set(from, new THREE.Vector3(0, 0, -1));
    const h = this.hit(this.ray);
    const at: Placement = { u: 0.5, v: 0.5, scale: 0.45, rotation: 0 };
    return h ? this.drag(at, h, h) : { ...at, point: this.target.toArray(), normal: [0, 0, 1] };
  }
  nudge(at: Placement, dx: number, dy: number, camera: THREE.Camera): Placement {
    const ndc = this.world(at).point.project(camera);
    this.ray.setFromCamera(new THREE.Vector2(ndc.x + dx * 0.05, ndc.y - dy * 0.05), camera);
    const h = this.hit(this.ray);
    return h ? this.drag(at, h, h) : at;
  }
  setColor() { /* a shop's model keeps its own texture */ }

  draw(_color: string, picture: Picture | null, outline: boolean) {
    if (this.decal) { this.group.remove(this.decal); this.decal.geometry.dispose(); }
    if (!picture?.at.point) { this.decal = null; return; }
    const { point, normal } = this.world(picture.at);
    // The mesh under the spot: look back along the facing from just above it.
    this.ray.set(point.clone().addScaledVector(normal, 0.5), normal.clone().negate());
    const mesh = this.ray.intersectObjects(this.meshes, false)[0]?.object;
    if (!(mesh instanceof THREE.Mesh)) { this.decal = null; return; }
    const o = new THREE.Object3D();
    o.position.copy(point);
    o.lookAt(point.clone().add(normal));
    o.rotateZ(picture.at.rotation);
    const w = this.width(picture.at);
    const geo = new DecalGeometry(mesh, point, o.rotation, new THREE.Vector3(w, w / picture.aspect, w));
    geo.applyMatrix4(this.group.matrixWorld.clone().invert()); // decal geometry comes out in world space
    if (this.art?.from !== picture.image) {
      this.art?.tex.dispose();
      const c = document.createElement("canvas");
      const img = picture.image as ImageBitmap;
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.art = { from: picture.image, tex };
    }
    const mat = this.decal?.material ?? new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.8 });
    mat.map = this.art.tex;
    mat.opacity = outline ? 0.85 : 1;
    mat.needsUpdate = true;
    this.decal = new THREE.Mesh(geo, mat);
    this.group.add(this.decal);
  }

  dispose() {
    disposeTree(this.group);
    this.art?.tex.dispose();
  }
}

/** A shop's model from its GLB. */
export async function loadModel(url: string): Promise<ModelSurface> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return new ModelSurface(gltf.scene);
}
