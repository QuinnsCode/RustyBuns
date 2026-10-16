// Where the feet work the board, shown like a screen recorder shows clicks: a ring pulses out from the
// tail as the back foot pops it, from the nose as the front foot drags it level, and off one side of
// the nose as a flip is flicked. Each ring rides the spot it marks, so it stays on the board.
import * as THREE from "three";
import type { Foot, Spot } from "../sim.ts";
import type { Skin } from "./skins.ts";

/** Each spot on the deck, about the skin's pivot (the middle of the board, a little under the grip). */
const SPOTS: Record<Skin, Record<Spot, [number, number, number]>> = {
  fingerboard: { tail: [0, 0.15, -1.9], nose: [0, 0.15, 1.9], "nose-left": [0.55, 0.15, 1.5], "nose-right": [-0.55, 0.15, 1.5] },
  roadster: { tail: [0, 0.3, -1.9], nose: [0, 0.3, 1.9], "nose-left": [0.8, 0.3, 1.5], "nose-right": [-0.8, 0.3, 1.5] },
};
export const spotOn = (skin: Skin, at: Spot) => new THREE.Vector3(...SPOTS[skin][at]);

export const TAP_LIFE = 0.6; // seconds a ring lasts

/** The rings in flight: DOM circles over the canvas, moved each frame to where their spot is on screen. */
export class Taps {
  private live: { el: HTMLElement; foot: Foot; age: number }[] = [];
  private v = new THREE.Vector3();
  constructor(private layer: HTMLElement) {}

  add(foot: Foot) {
    const el = document.createElement("div");
    el.className = `tap ${foot.foot}`;
    this.layer.append(el);
    this.live.push({ el, foot, age: 0 });
  }

  update(dt: number, pivot: THREE.Object3D, skin: Skin, camera: THREE.Camera) {
    pivot.updateMatrixWorld();
    this.live = this.live.filter((t) => {
      t.age += dt;
      if (t.age >= TAP_LIFE) { t.el.remove(); return false; }
      const p = pivot.localToWorld(this.v.copy(spotOn(skin, t.foot.at))).project(camera);
      t.el.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
      t.el.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
      t.el.style.visibility = p.z < 1 ? "visible" : "hidden";
      return true;
    });
  }
}
