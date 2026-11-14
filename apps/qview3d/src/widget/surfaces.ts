// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// What the picture is printed on. Two kinds, one shape the viewer drives:
//
// - A hat or a top (made in code): its UVs are tidy, so each picture is drawn into one canvas texture at its spot
//   in its print zone (print.ts), and moving it is a redraw. A hat has one zone, a top three.
// - A shop's own model (a sample from its photos): its UVs are whatever Meshy made, patches all over, so the
//   picture is projected onto the surface instead (a decal, like a sticker pressed on along the surface's facing).
//   Moving it projects it again at the new spot. This works on any shape, and its own texture stays as it is.
import * as THREE from "three";
import type { ZoneName } from "../api.ts";
import type { Garment } from "./hats.ts";
import { onPicture, paint, zoneAt, zoneOf, zoneSpot, type Picture, type Placement, type Side } from "./print.ts";

/** A print zone as the viewer sees it: its name, its button label, and the side the camera swings to for it. */
export type ZoneInfo = { name: ZoneName; label: string; view: Side };

/** One printable thing. `S` is where a pointer ray meets it: a spot in the print zone, or a point on the surface. */
export interface Surface<S> {
  readonly group: THREE.Object3D;
  /** Where the camera looks, in the group's own space. */
  readonly target: THREE.Vector3;
  /** A model that keeps its own colours: no swatches. */
  readonly ownColors: boolean;
  /** Where pictures may go, one picture each; the first is where a new picture starts. */
  readonly zones: readonly ZoneInfo[];
  hit(ray: THREE.Raycaster): S | null;
  /** The zone under a spot, if any. */
  zoneAt(spot: S): ZoneName | null;
  onPicture(at: Placement, aspect: number, spot: S): boolean;
  /** Where a picture grabbed at `from` (when it sat at `at`) goes when the pointer reaches `to`. */
  drag(at: Placement, from: S, to: S): Placement;
  /** Where a new picture goes in `zone`: its middle. */
  start(zone: ZoneName): Placement;
  /** The picture moved a step by keyboard: dx, dy are -1, 0 or 1 on screen (right, down). */
  nudge(at: Placement, dx: number, dy: number, camera: THREE.Camera): Placement;
  setColor(c: string): void;
  /** Paint the colour and every picture; outline `outline`'s zone while the shopper edits it. */
  draw(color: string, pictures: Picture[], outline: ZoneName | null): void;
  dispose(): void;
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    if (!(n instanceof THREE.Mesh || n instanceof THREE.LineSegments)) return;
    n.geometry.dispose();
    for (const m of [n.material].flat() as THREE.Material[]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

/** Where a pointer ray met a garment: the UV in its print atlas. */
type AtlasSpot = { x: number; y: number };

export class GarmentSurface implements Surface<AtlasSpot> {
  readonly ownColors = false;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tex = new THREE.CanvasTexture(this.canvas);

  constructor(private garment: Garment, anisotropy: number) {
    this.canvas.width = 2048;
    this.canvas.height = 1024;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = anisotropy;
    for (const m of garment.prints) m.material.map = this.tex;
  }
  get group() { return this.garment.group; }
  get target() { return this.garment.target; }
  get zones() { return this.garment.zones; }
  hit(ray: THREE.Raycaster): AtlasSpot | null {
    const uv = ray.intersectObjects(this.garment.prints, false)[0]?.uv;
    return uv ? { x: uv.x, y: uv.y } : null;
  }
  zoneAt(spot: AtlasSpot) { return zoneAt(this.garment.zones, spot)?.name ?? null; }
  /** A spot in the placement's own zone: a drag off its edge still moves the picture, clamped to the zone. */
  private local(at: Placement, spot: AtlasSpot) { return zoneSpot(zoneOf(this.garment.zones, at), spot); }
  onPicture(at: Placement, aspect: number, spot: AtlasSpot) {
    return this.zoneAt(spot) === zoneOf(this.garment.zones, at).name && onPicture(zoneOf(this.garment.zones, at), at, aspect, this.local(at, spot));
  }
  drag(at: Placement, from: AtlasSpot, to: AtlasSpot): Placement {
    const a = this.local(at, from), b = this.local(at, to);
    return { ...at, u: at.u + b.u - a.u, v: at.v + b.v - a.v };
  }
  start(zone: ZoneName): Placement {
    const z = zoneOf(this.garment.zones, { zone, u: 0, v: 0, scale: 1, rotation: 0 });
    return { zone: z.name, u: 0.5, v: z.name === "front" ? 0.55 : 0.5, scale: z.name === "left-sleeve" ? 0.85 : 0.7, rotation: 0 };
  }
  nudge(at: Placement, dx: number, dy: number): Placement { return { ...at, u: at.u + dx * 0.04, v: at.v - dy * 0.04 }; }
  setColor(c: string) { for (const m of this.garment.dyed) m.material.color.set(c); }
  draw(color: string, pictures: Picture[], outline: ZoneName | null) {
    paint(this.ctx, this.garment.zones, color, pictures, outline);
    this.tex.needsUpdate = true;
  }
  dispose() { disposeTree(this.garment.group); }
}
