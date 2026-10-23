// The other riders in a room: each one a board drawn on the pose they send, eased toward the latest one
// so 20 updates a second look smooth. They are drawn only; your own sim never touches them.
import * as THREE from "three";
import { fingerboard, roadster } from "../models.ts";
import type { Rider } from "../net/room.ts";
import { Skins } from "./skins.ts";

const PIVOT_Y = { fingerboard: 0.45, roadster: 0.6 };
/** One tint per slot, so a name tag and its board read as a pair. */
export const TINTS = ["#ff7a3d", "#3dd6c6", "#c58bff", "#ffd23d"];

class Ghost {
  readonly skins = new Skins({ fingerboard: fingerboard(), roadster: roadster() }, "fingerboard", PIVOT_Y);
  readonly tag = document.createElement("div");
  private seen = false;
  private target: number[] = [];

  constructor(slot: number, name: string) {
    this.tag.className = "ghost-tag";
    this.tag.textContent = name;
    this.tag.style.setProperty("--tint", TINTS[slot % TINTS.length]!);
    document.body.append(this.tag);
  }

  set(r: Rider) {
    if (!r.pose) return;
    this.tag.textContent = r.name;
    this.skins.show(r.pose.skin);
    this.target = r.pose.n;
    if (!this.seen) { this.seen = true; this.apply(1); }
  }

  /** Ease the drawn board toward the pose last heard. */
  apply(k: number) {
    const t = this.target;
    if (t.length !== 10) return;
    const root = this.skins.root, pivot = this.skins.pivot();
    root.position.lerp(new THREE.Vector3(t[0], t[1], t[2]), k);
    // A turn can wrap, so ease the angle the short way round.
    const turn = (a: number, b: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
    root.rotation.set(turn(root.rotation.x, t[3]!), turn(root.rotation.y, t[4]!), turn(root.rotation.z, t[5]!), "YXZ");
    pivot.rotation.set(t[6]!, t[7]!, t[8]!);
    pivot.position.y = t[9]!;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.skins.root);
    this.tag.remove();
  }
}

export class Ghosts {
  private ghosts = new Map<string, Ghost>();
  private head = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  /** Draw exactly these riders: add the new, drop the gone. */
  set(riders: Rider[]) {
    for (const [id, g] of this.ghosts) if (!riders.some((r) => r.id === id)) { g.dispose(this.scene); this.ghosts.delete(id); }
    for (const r of riders) {
      let g = this.ghosts.get(r.id);
      if (!g) { g = new Ghost(r.slot, r.name); this.ghosts.set(r.id, g); this.scene.add(g.skins.root); }
      g.set(r);
    }
  }

  update(dt: number, camera: THREE.Camera) {
    const k = 1 - Math.exp(-14 * dt);
    for (const g of this.ghosts.values()) {
      g.skins.update(dt);
      g.apply(k);
      this.head.copy(g.skins.root.position).add(new THREE.Vector3(0, 2.2, 0)).project(camera);
      const on = this.head.z < 1 && Math.abs(this.head.x) < 1.1 && Math.abs(this.head.y) < 1.1;
      g.tag.style.display = on ? "block" : "none";
      if (on) g.tag.style.transform = `translate(-50%, -50%) translate(${((this.head.x + 1) / 2) * innerWidth}px, ${((1 - this.head.y) / 2) * innerHeight}px)`;
    }
  }
}
