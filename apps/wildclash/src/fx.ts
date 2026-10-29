// How moves look. The sim says when a move goes off ("move" events) and when one lands ("hit"); this turns
// each into short-lived particles in the move's field colour, shaped by its `fx` (moves.ts): a jab's sparks, a
// slam's shockwave ring, a launcher's rising column, a nova's shell, rain from above the target, a rampage's
// dust and afterimages, a wave rolling along the ground, a breath's cone. Each field adds its own grain:
// ember flickers up, frost is shards, stone is chunks, grove is leaves, shadow is smoke that sinks.
// Plain three.js meshes from a few shared geometries, pooled, so a busy fight allocates nothing.
import * as THREE from "three";
import { COLOR, type Field } from "./fields.ts";
import type { Fx } from "./moves.ts";
import type { Event, Match, V3 } from "./sim.ts";

type Shape = "dot" | "shard" | "chunk" | "leaf" | "ring" | "shell" | "streak";
interface P { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; grow: number; spin: number }

const GEO: Record<Shape, THREE.BufferGeometry> = {
  dot: new THREE.SphereGeometry(1, 8, 6),
  shard: new THREE.OctahedronGeometry(1),
  chunk: new THREE.BoxGeometry(1, 1, 1),
  leaf: new THREE.PlaneGeometry(1.4, 0.7),
  ring: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
  shell: new THREE.SphereGeometry(1, 24, 16),
  streak: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
};
/** The grain of each field's particles, and how they drift: up (heat, spirit), down (smoke, rain), or not. */
const GRAIN: Record<Field, { shape: Shape; rise: number }> = {
  ember: { shape: "dot", rise: 3 }, tide: { shape: "dot", rise: -4 }, gale: { shape: "streak", rise: 0.5 },
  stone: { shape: "chunk", rise: -9 }, frost: { shape: "shard", rise: -2 }, storm: { shape: "streak", rise: 0 },
  grove: { shape: "leaf", rise: -1 }, venom: { shape: "dot", rise: 1 }, spirit: { shape: "dot", rise: 2 },
  shadow: { shape: "dot", rise: -1.5 }, iron: { shape: "shard", rise: -6 }, wild: { shape: "chunk", rise: -3 },
};

export class MoveFx {
  private readonly live: P[] = [];
  private readonly free: THREE.Mesh[] = [];
  private readonly v = new THREE.Vector3();
  constructor(private readonly scene: THREE.Scene, private readonly rnd: () => number = Math.random) {}

  /** Read one tick's events. */
  events(m: Match, events: Event[]) {
    for (const e of events) {
      if (e.kind === "move") this.cast(e.move.fx, e.move.field, e.at, e.yaw, e.target, m.f[e.by].b.height, m.f[e.by].b.radius);
      else if (e.kind === "hit") this.burst(e.field, e.at, e.guarded ? 4 : Math.min(26, 6 + e.damage), e.guarded ? 0.6 : 1 + e.damage / 40);
      else if (e.kind === "clash") { this.burst("storm", e.at, 18, 1.6); this.ring("storm", e.at, 2.5, 0.25); }
    }
    // Marks that last: a mote of the field drifts off the body every few ticks while it holds.
    if (m.tick % 5) return;
    for (const f of m.f) {
      const k = f.marks, at = () => ({ x: f.pos.x + (this.rnd() - 0.5) * f.b.radius * 2, y: f.pos.y + this.rnd() * f.b.height, z: f.pos.z + (this.rnd() - 0.5) * f.b.radius * 2 });
      if (k.dot > 0 && k.dotField) this.spawn(k.dotField, GRAIN[k.dotField].shape, at(), { x: 0, y: 1.5, z: 0 }, 0.08, 0.5);
      if (k.chill > 0) this.spawn("frost", "shard", at(), { x: 0, y: -0.5, z: 0 }, 0.07, 0.5);
      if (k.root > 0) this.spawn("grove", "leaf", { x: f.pos.x + (this.rnd() - 0.5) * f.b.radius * 2, y: f.pos.y + 0.1, z: f.pos.z + (this.rnd() - 0.5) * f.b.radius * 2 }, { x: 0, y: 0.6, z: 0 }, 0.12, 0.6);
    }
  }

  private cast(fx: Fx, field: Field, at: V3, yaw: number, target: V3, h: number, r: number) {
    const fwd = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const front = { x: at.x + fwd.x * (r + 0.6), y: at.y + h * 0.55, z: at.z + fwd.z * (r + 0.6) };
    const ground = { x: at.x + fwd.x * r, y: at.y + 0.05, z: at.z + fwd.z * r };
    switch (fx) {
      case "jab": this.burst(field, front, 5, 0.5); break;
      case "slam": this.ring(field, ground, 2.2 + r, 0.35); this.burst(field, ground, 12, 1); break;
      case "rise":
        for (let i = 0; i < 10; i++) this.spawn(field, GRAIN[field].shape, { x: front.x, y: at.y + i * 0.25, z: front.z }, { x: 0, y: 6 + this.rnd() * 3, z: 0 }, 0.12 + this.rnd() * 0.1, 0.45);
        break;
      case "orb": case "beam": this.burst(field, front, fx === "beam" ? 10 : 6, 0.7); break;
      case "nova": {
        const c = { x: at.x, y: at.y + h * 0.5, z: at.z };
        this.shell(field, c, 3 + r * 2, 0.5); this.burst(field, c, 24, 2.2); this.ring(field, { ...c, y: at.y + 0.05 }, 4 + r * 2, 0.5);
        break;
      }
      case "rain":
        // Falling on where the target stands now, from above the arena's ceiling.
        for (let i = 0; i < 14; i++) {
          const x = target.x + (this.rnd() - 0.5) * 3, z = target.z + (this.rnd() - 0.5) * 3;
          const p = this.spawn(field, field === "storm" ? "streak" : GRAIN[field].shape, { x, y: 8 + this.rnd() * 4, z }, { x: 0, y: -16 - this.rnd() * 6, z: 0 }, 0.18, 0.7);
          if (field === "storm") p.mesh.scale.set(0.08, 1.6, 0.08);
        }
        this.ring(field, { x: target.x, y: 0.05, z: target.z }, 2.5, 0.7);
        break;
      case "rampage":
        for (let i = 0; i < 12; i++) this.spawn(field, "chunk", { x: at.x - fwd.x * r, y: at.y + 0.1, z: at.z - fwd.z * r },
          { x: -fwd.x * 3 + (this.rnd() - 0.5) * 4, y: 2 + this.rnd() * 3, z: -fwd.z * 3 + (this.rnd() - 0.5) * 4 }, 0.12 + this.rnd() * 0.12, 0.6);
        this.ring(field, ground, 1.6 + r, 0.3);
        break;
      case "wave":
        for (let i = 0; i < 3; i++) {
          const p = this.ring(field, { x: ground.x + fwd.x * i * 1.2, y: 0.06, z: ground.z + fwd.z * i * 1.2 }, 1.5 + i, 0.6 + i * 0.1);
          p.vel.set(fwd.x * 9, 0, fwd.z * 9);
        }
        break;
      case "breath":
        for (let i = 0; i < 22; i++) {
          const spread = (this.rnd() - 0.5) * 0.5, s = 10 + this.rnd() * 6, a = yaw + spread;
          this.spawn(field, GRAIN[field].shape, front, { x: Math.cos(a) * s, y: (this.rnd() - 0.4) * 2, z: Math.sin(a) * s }, 0.15 + this.rnd() * 0.15, 0.5, 2.2);
        }
        break;
    }
  }

  /** Sparks flung out from a point. */
  private burst(field: Field, at: V3, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      this.v.set(this.rnd() - 0.5, this.rnd() * 0.8, this.rnd() - 0.5).normalize().multiplyScalar((2 + this.rnd() * 4) * speed);
      this.spawn(field, GRAIN[field].shape, at, this.v, 0.06 + this.rnd() * 0.08 * speed, 0.35 + this.rnd() * 0.25);
    }
  }
  private ring(field: Field, at: V3, size: number, life: number) { return this.spawn(field, "ring", at, { x: 0, y: 0, z: 0 }, 0.3, life, (size - 0.3) / life); }
  private shell(field: Field, at: V3, size: number, life: number) { return this.spawn(field, "shell", at, { x: 0, y: 0, z: 0 }, 0.3, life, (size - 0.3) / life); }

  private spawn(field: Field, shape: Shape, at: V3, vel: V3, size: number, life: number, grow = 0): P {
    const mesh = this.free.pop() ?? new THREE.Mesh(GEO.dot, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.geometry = GEO[shape];
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(COLOR[field]); mat.opacity = shape === "shell" ? 0.35 : 0.9;
    mat.blending = field === "shadow" ? THREE.NormalBlending : THREE.AdditiveBlending;
    mesh.position.set(at.x, at.y, at.z); mesh.scale.setScalar(size); mesh.rotation.set(this.rnd() * 6, this.rnd() * 6, 0);
    mesh.visible = true;
    if (!mesh.parent) this.scene.add(mesh);
    const rise = shape === "ring" || shape === "shell" ? 0 : GRAIN[field].rise;
    const p: P = { mesh, vel: new THREE.Vector3(vel.x, vel.y, vel.z), life, max: life, grow, spin: shape === "leaf" || shape === "shard" || shape === "chunk" ? 6 : 0 };
    p.vel.y += rise * 0.3;
    this.live.push(p);
    return p;
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; this.free.push(p.mesh); this.live.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.grow) p.mesh.scale.addScalar(p.grow * dt);
      if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * dt * 0.7; }
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (p.mesh.geometry === GEO.shell ? 0.35 : 0.9) * (p.life / p.max);
    }
  }

  clear() { for (const p of this.live) { p.mesh.visible = false; this.free.push(p.mesh); } this.live.length = 0; }
}
