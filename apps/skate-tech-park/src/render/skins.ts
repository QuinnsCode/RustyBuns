// One transform, two skins: the fingerboard and the rocket roadster ride the same pose, and Tab swaps
// which one you see. The swap is a short squash-and-pop: the old skin shrinks away as the new one
// grows in, with a ring of puffs where it happens.
import * as THREE from "three";

export type Skin = "fingerboard" | "roadster";
export const SWAP_TIME = 0.28;

/** A pivot to turn about (a kickflip spins the skin about its own middle) with the model offset to sit under it. */
export class Skins {
  readonly root = new THREE.Group();
  private pivots = new Map<Skin, THREE.Group>();
  private from: Skin | null = null;
  private t = 1;
  current: Skin;

  constructor(models: Record<Skin, THREE.Object3D>, first: Skin, pivotY: Record<Skin, number>) {
    for (const k of Object.keys(models) as Skin[]) {
      const pivot = new THREE.Group();
      pivot.position.y = pivotY[k];
      models[k].position.y -= pivotY[k];
      pivot.add(models[k]);
      pivot.visible = k === first;
      this.pivots.set(k, pivot);
      this.root.add(pivot);
    }
    this.current = first;
  }

  pivot(k: Skin = this.current) { return this.pivots.get(k)!; }

  /** Show `skin`; true if that was a change (the caller can puff). */
  show(skin: Skin) {
    if (skin === this.current) return false;
    this.from = this.current;
    this.current = skin;
    this.t = 0;
    this.pivot(skin).visible = true;
    return true;
  }

  get swapping() { return this.t < 1; }

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / SWAP_TIME);
    const out = this.pivot(this.from!), into = this.pivot(this.current);
    const ease = 1 - (1 - this.t) ** 3;
    into.scale.setScalar(0.4 + 0.6 * ease);
    out.scale.setScalar(1 - 0.6 * ease);
    out.visible = this.t < 0.5;
    if (this.t >= 1) {
      out.visible = false;
      out.scale.setScalar(1);
      into.scale.setScalar(1);
    }
  }
}
