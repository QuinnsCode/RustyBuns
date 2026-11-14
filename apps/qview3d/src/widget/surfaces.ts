// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// What the picture is printed on. Two kinds, one shape the viewer drives:
//
// - A hat (made in code): its UVs are tidy, so the picture is drawn into one canvas texture at its spot in the
//   print zone (print.ts), and moving it is a redraw.
// - A shop's own model (a sample from its photos): its UVs are whatever Meshy made, patches all over, so the
//   picture is projected onto the surface instead (a decal, like a sticker pressed on along the surface's facing).
//   Moving it projects it again at the new spot. This works on any shape, and its own texture stays as it is.
import * as THREE from "three";
import type { Hat } from "./hats.ts";
import { onPicture, paint, zoneSpot, type Picture, type Placement } from "./print.ts";

/** One printable thing. `S` is where a pointer ray meets it: a spot in the print zone, or a point on the surface. */
export interface Surface<S> {
  readonly group: THREE.Object3D;
  /** Where the camera looks, in the group's own space. */
  readonly target: THREE.Vector3;
  /** A model that keeps its own colours: no swatches. */
  readonly ownColors: boolean;
  hit(ray: THREE.Raycaster): S | null;
  onPicture(at: Placement, aspect: number, spot: S): boolean;
  /** Where a picture grabbed at `from` (when it sat at `at`) goes when the pointer reaches `to`. */
  drag(at: Placement, from: S, to: S): Placement;
  /** Where a new picture goes: the front. */
  start(): Placement;
  /** The picture moved a step by keyboard: dx, dy are -1, 0 or 1 on screen (right, down). */
  nudge(at: Placement, dx: number, dy: number, camera: THREE.Camera): Placement;
  setColor(c: string): void;
  draw(color: string, picture: Picture | null, outline: boolean): void;
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

type ZoneSpot = { u: number; v: number };

export class HatSurface implements Surface<ZoneSpot> {
  readonly ownColors = false;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tex = new THREE.CanvasTexture(this.canvas);

  constructor(private hat: Hat, anisotropy: number) {
    this.canvas.width = 2048;
    this.canvas.height = 1024;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = anisotropy;
    hat.print.material.map = this.tex;
  }
  get group() { return this.hat.group; }
  get target() { return this.hat.target; }
  hit(ray: THREE.Raycaster) {
    const h = ray.intersectObject(this.hat.print, false)[0];
    return h?.uv ? zoneSpot(this.hat.zone, h.uv) : null;
  }
  onPicture(at: Placement, aspect: number, spot: ZoneSpot) { return onPicture(this.hat, at, aspect, spot); }
  drag(at: Placement, from: ZoneSpot, to: ZoneSpot): Placement { return { ...at, u: at.u + to.u - from.u, v: at.v + to.v - from.v }; }
  start(): Placement { return { u: 0.5, v: 0.55, scale: 0.7, rotation: 0 }; }
  nudge(at: Placement, dx: number, dy: number): Placement { return { ...at, u: at.u + dx * 0.04, v: at.v - dy * 0.04 }; }
  setColor(c: string) { for (const m of this.hat.dyed) m.material.color.set(c); }
  draw(color: string, picture: Picture | null, outline: boolean) {
    paint(this.ctx, this.hat, color, picture ? [picture] : [], outline);
    this.tex.needsUpdate = true;
  }
  dispose() { disposeTree(this.hat.group); }
}
