// A creature walking the open world in its own beast (src/beasts.ts), the same rig the arena poses: you, and the
// wild ones roaming their dens. The capsule stands in until the beast's files load. The puppet is driven by a
// stand-in fighter whose position, speed and heading follow the walker, so its feet step and its head bobs the
// way they do in a fight.
import * as THREE from "three";
import { loadBeast, Puppet } from "../beasts.ts";
import { creatureModel } from "../model.ts";
import type { Creature } from "../roster.ts";
import { newMatch, type Fighter } from "../sim.ts";

const FPS = 60;      // the puppet's idle sways count sim ticks
const JUMP = 6;      // a move further than this in one frame is a teleport: the feet are put down again, not dragged

export class Walker3d {
  readonly capsule: THREE.Group;
  private puppet: Puppet | null = null;
  private readonly f: Fighter;
  private tick = Math.random() * 1000;   // out of step with each other, so a herd doesn't sway as one
  private placed = false;
  private gone = false;

  /** `fly`: a flyer roams on the wing, a couple of metres up. `shroud`: an unknown, a dark smoky shape with no colours to tell it by. */
  constructor(readonly c: Creature, private readonly parent: THREE.Object3D, private readonly fly = false, shroud = false) {
    this.capsule = creatureModel(c);
    if (shroud) this.capsule.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material = o.material.clone(); darken(o.material); } });
    parent.add(this.capsule);
    this.f = newMatch(c, c).f[0];
    this.f.flying = fly;
    this.f.onGround = !fly;
    void loadBeast(c.id).then((beast) => {
      if (!beast || this.gone) return;
      this.puppet = new Puppet(beast, this.f.b, c.archetype);
      if (shroud) this.puppet.materials.forEach(darken);
      this.puppet.group.visible = this.capsule.visible;
      this.capsule.removeFromParent();
      parent.add(this.puppet.group);
    });
  }

  get loaded(): boolean { return this.puppet !== null; }

  set visible(v: boolean) { this.capsule.visible = v; if (this.puppet) this.puppet.group.visible = v; }

  /** Stand at (x, ground, z) facing `yaw` (0 is +x); the speed comes from how far it moved since last frame. */
  update(x: number, ground: number, z: number, yaw: number, dt: number) {
    const f = this.f, y = ground + (this.fly ? 2 : 0);
    const jumped = !this.placed || Math.hypot(x - f.pos.x, z - f.pos.z) > JUMP;
    f.vel = jumped || dt <= 0 ? { x: 0, y: 0, z: 0 } : { x: (x - f.pos.x) / dt, y: 0, z: (z - f.pos.z) / dt };
    f.pos = { x, y, z };
    f.yaw = yaw;
    this.placed = true;
    this.tick += dt * FPS;
    const p = this.puppet;
    if (!p) { this.capsule.position.set(x, y, z); this.capsule.rotation.y = -yaw; return; }
    if (!p.group.visible) return;
    p.ground = ground;
    // a frame off the ground puts every foot back under the body, where the next step starts from
    if (jumped && !this.fly) { f.onGround = false; p.update(f, dt, this.tick); f.onGround = true; }
    p.update(f, dt, this.tick);
  }

  dispose() {
    this.gone = true;
    this.capsule.removeFromParent();
    this.puppet?.dispose();
  }
}

/** An unknown's look, here and in the arena: a dark smoky shape with no colours to tell it by. */
export function darken(m: THREE.MeshStandardMaterial) {
  m.color.setHex(0x16131d); m.emissive.setHex(0x3a3158); m.emissiveIntensity = 0.35; m.map = null;
  m.transparent = true; m.opacity = 0.8; m.toneMapped = true; m.needsUpdate = true;
}
