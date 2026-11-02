// How a fight looks beyond the bodies. The sim says when a move goes off ("move" events), when one lands
// ("hit"), when feet come back down ("land") and when wings are clipped; this turns each into short-lived
// particles in the move's field colour, shaped by the move's `fx` (moves.ts) and by its slot: a jab's sparks, a
// slam's shockwave ring, a launcher's rising column, a nova's shell, rain from above the target, a rampage's
// dust and afterimages, a wave rolling along the ground, a breath that keeps pouring out while the move is live.
// Between the events, each tick: every beast sheds a mote of its element (embers float up, frost mist sinks,
// shadow smokes, storm sparks), a swing leaves a trail, a charge or an ultimate's wind-up pulls light in, a
// dash leaves afterimages, shots fly with a glow and a tail, and feet raise dust and prints. Each fighter also
// wears an aura of its field that brightens for a charge, blazes for an ultimate and flashes white when struck.
// Plain three.js meshes and sprites from a few shared geometries and one soft texture, pooled, so a busy fight
// allocates nothing.
import * as THREE from "three";
import type { Floor } from "./arena.ts";
import { COLOR, type Field } from "./fields.ts";
import type { Fx, Slot } from "./moves.ts";
import { frames, type Event, type Fighter, type Match, type V3 } from "./sim.ts";

type Shape = "dot" | "shard" | "chunk" | "leaf" | "ring" | "shell" | "streak" | "print" | "glow";
interface P { o: THREE.Mesh | THREE.Sprite; vel: THREE.Vector3; life: number; max: number; grow: number; spin: number; alpha: number; acc: number; floor?: number; bounce: number; stick: boolean }
/** `stick`: it stays where it lands (a shard in the ground) and fades only at the end. `floor` + `bounce`: a particle that lands on the ground at that height and hops back up with that share of its speed. */
interface Opt { grow?: number; alpha?: number; spin?: number; acc?: number; blend?: THREE.Blending; floor?: number; bounce?: number; stick?: boolean }

const GEO: Record<Exclude<Shape, "glow">, THREE.BufferGeometry> = {
  dot: new THREE.SphereGeometry(1, 8, 6),
  shard: new THREE.OctahedronGeometry(1),
  chunk: new THREE.BoxGeometry(1, 1, 1),
  leaf: new THREE.PlaneGeometry(1.4, 0.7),
  ring: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
  shell: new THREE.SphereGeometry(1, 24, 16),
  streak: new THREE.CylinderGeometry(0.06, 0.32, 1, 5), // a spark: thin at its head, flaring at the tail
  print: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
};
/** One soft round texture for every glow sprite: an alpha that falls off to the rim. No canvas, so it builds anywhere. */
function softTexture(): THREE.Texture {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2)), a = (1 - d) * (1 - d), i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.needsUpdate = true;
  return t;
}
const SOFT = softTexture();
const DUST = 0xb8a888, WHITE = 0xffffff, SMOKE = 0x160c20;
/** A shield's glass: clear where you look straight through it, glowing at the rim where you see it edge-on. */
function rimMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 1 } },
    vertexShader: "varying vec3 n; varying vec3 v; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-p.xyz); gl_Position = projectionMatrix * p; }",
    fragmentShader: "uniform vec3 color; uniform float opacity; varying vec3 n; varying vec3 v; void main() { float r = pow(1.0 - abs(dot(normalize(n), normalize(v))), 2.2); gl_FragColor = vec4(color * r * opacity, 1.0); }",
  });
}
export const MAX_LIVE = 700, MAX_LIVE_PHONE = 400; // past this the oldest particles go, so a long combo can't bury the frame rate

/** The grain of each field's particles, and how they drift: up (heat, spirit), down (smoke, rain), or not. */
const GRAIN: Record<Field, { shape: Shape; rise: number }> = {
  ember: { shape: "dot", rise: 3 }, tide: { shape: "dot", rise: -4 }, gale: { shape: "streak", rise: 0.5 },
  stone: { shape: "chunk", rise: -9 }, frost: { shape: "shard", rise: -2 }, storm: { shape: "streak", rise: 0 },
  grove: { shape: "leaf", rise: -1 }, venom: { shape: "dot", rise: 1 }, spirit: { shape: "dot", rise: 2 },
  shadow: { shape: "dot", rise: -1.5 }, iron: { shape: "shard", rise: -6 }, wild: { shape: "chunk", rise: -3 },
};
/** How heavy each slot's blow lands, for the kicked-up ground, and the standing-wave order its cymatics draw. */
const WEIGHT: Record<Slot, number> = { light: 0.35, special: 0.55, launcher: 0.8, heavy: 1, beam: 0.9, ultimate: 1.7 };
const ORDER: Record<Slot, number> = { light: 2, heavy: 4, launcher: 3, special: 5, beam: 6, ultimate: 8 };
/** The debris each field's ground throws: rock, cinders, spray, shards, clods, smoke. `lift` scales the throw, `gravity` the fall. */
const DEBRIS: Record<Field, { shape: Shape; color: number; mix: boolean; size: number; lift: number; gravity: number; bounce: number; blend?: THREE.Blending }> = {
  stone: { shape: "chunk", color: 0x8a7a66, mix: true, size: 1.4, lift: 1, gravity: -22, bounce: 0.3 },
  iron: { shape: "shard", color: 0xb0b4bc, mix: false, size: 1.1, lift: 1, gravity: -24, bounce: 0.45 },
  ember: { shape: "chunk", color: 0x2a1a12, mix: true, size: 1.1, lift: 1, gravity: -20, bounce: 0.3 },
  frost: { shape: "shard", color: 0xcfeeff, mix: true, size: 1.1, lift: 1, gravity: -18, bounce: 0.25 },
  tide: { shape: "dot", color: 0x7ec8ff, mix: true, size: 0.9, lift: 1.2, gravity: -16, bounce: 0, blend: THREE.NormalBlending },
  storm: { shape: "chunk", color: 0x6a6a7a, mix: true, size: 1, lift: 1, gravity: -22, bounce: 0.3 },
  grove: { shape: "leaf", color: 0x5a8a3a, mix: true, size: 1.4, lift: 0.9, gravity: -8, bounce: 0, blend: THREE.NormalBlending },
  venom: { shape: "dot", color: 0x8acb3a, mix: true, size: 1.1, lift: 0.9, gravity: -14, bounce: 0, blend: THREE.NormalBlending },
  spirit: { shape: "glow", color: 0xd8ccff, mix: true, size: 2.2, lift: 0.5, gravity: 1, bounce: 0 },
  shadow: { shape: "chunk", color: 0x2a2236, mix: true, size: 1.2, lift: 0.9, gravity: -18, bounce: 0.25 },
  gale: { shape: "chunk", color: 0x9a9080, mix: true, size: 0.8, lift: 1.3, gravity: -10, bounce: 0.3 },
  wild: { shape: "chunk", color: 0x7a6246, mix: true, size: 1.3, lift: 1, gravity: -22, bounce: 0.3 },
};
/** What the ground does to a blow: how big the chunks read, how lively they hop, how much dust it gives up. Soft turf
 * swallows a landing (small, dead chunks, little dust); dry sand and loose pine litter hang in the air; hot basalt
 * throws big, bright, bouncy slabs. */
const GROUND: Record<Floor, { size: number; bounce: number; dust: number }> = {
  grain: { size: 1, bounce: 1, dust: 1 }, turf: { size: 0.75, bounce: 0.55, dust: 0.7 },
  sand: { size: 0.85, bounce: 0.6, dust: 1.7 }, litter: { size: 0.8, bounce: 0.5, dust: 1.2 }, basalt: { size: 1.25, bounce: 1.3, dust: 0.6 },
};
export const groundOf = (floor: Floor) => GROUND[floor];
/** A standing-wave figure's two mode numbers for a move's order (heavier moves draw busier figures). */
export const chladniModes = (order: number): [number, number] => [Math.max(1, Math.floor(order / 2)), Math.max(1, Math.floor(order / 2)) + 1];
/** The faint Chladni lines under a fighter winding up: sand-figure nodal lines of a square plate, `strength` pulsing. */
function chladniMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color() }, strength: { value: 0 }, n: { value: 2 }, m: { value: 3 } },
    vertexShader: "varying vec2 uv2; void main() { uv2 = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 color; uniform float strength; uniform float n; uniform float m; varying vec2 uv2; void main() { float r = length(uv2); float f = cos(n * 3.14159 * uv2.x) * cos(m * 3.14159 * uv2.y) - cos(m * 3.14159 * uv2.x) * cos(n * 3.14159 * uv2.y); float line = 1.0 - smoothstep(0.0, 0.16, abs(f)); float edge = smoothstep(1.0, 0.55, r); gl_FragColor = vec4(color * line * edge * strength, 1.0); }",
  });
}

/** Heavy and ultimate debris reads small from the side camera, so past a heavy blow's weight the chunks grow (up to 1.8x). */
export const chunkScale = (k: number) => 1 + Math.min(0.8, Math.max(0, k - 0.8) * 0.8);
/** The camera shake a landed blow asks for, in metres: its damage, heavier for a heavy or an ultimate. */
export const shakeOf = (damage: number, slot: Slot) => Math.min(0.45, (damage / 80) * (slot === "ultimate" ? 1.5 : slot === "heavy" ? 1.25 : 1));

/** What a standing beast sheds, one mote every `every` ticks: the element on screen before a move is thrown. */
const SHED: Record<Field, { every: number; shape: Shape; size: number; life: number; up: number; alpha: number; blend?: THREE.Blending; color?: number } | null> = {
  ember: { every: 5, shape: "glow", size: 0.16, life: 0.9, up: 1.4, alpha: 0.9 },
  tide: { every: 7, shape: "dot", size: 0.05, life: 0.5, up: -1.5, alpha: 0.8, blend: THREE.NormalBlending },
  gale: { every: 4, shape: "streak", size: 0.06, life: 0.5, up: 0.3, alpha: 0.7 },
  stone: { every: 9, shape: "chunk", size: 0.05, life: 0.6, up: -2, alpha: 0.8, blend: THREE.NormalBlending, color: DUST },
  frost: { every: 5, shape: "glow", size: 0.34, life: 1.3, up: -0.3, alpha: 0.28 },
  storm: { every: 3, shape: "streak", size: 0.05, life: 0.14, up: 0, alpha: 1 },
  grove: { every: 9, shape: "leaf", size: 0.1, life: 1.5, up: -0.6, alpha: 0.9, blend: THREE.NormalBlending },
  venom: { every: 6, shape: "dot", size: 0.06, life: 1, up: 0.7, alpha: 0.7, blend: THREE.NormalBlending },
  spirit: { every: 6, shape: "glow", size: 0.22, life: 1.4, up: 0.8, alpha: 0.45 },
  shadow: { every: 6, shape: "glow", size: 0.24, life: 0.8, up: 0.15, alpha: 0.38, blend: THREE.NormalBlending, color: SMOKE }, // a haze that clings, not smuts in the sky
  iron: { every: 12, shape: "streak", size: 0.04, life: 0.4, up: 1, alpha: 1, color: 0xffd9b0 },
  wild: null,
};

export class MoveFx {
  private readonly live: P[] = [];
  private readonly freeMesh: THREE.Mesh[] = [];
  private readonly freeGlow: THREE.Sprite[] = [];
  private readonly shots: { core: THREE.Mesh; glow: THREE.Sprite }[] = [];
  private readonly auras: THREE.Sprite[] = [];
  private readonly struck = [-99, -99]; // the tick each fighter was last hit, for its flash
  private readonly v = new THREE.Vector3();
  private readonly x = new THREE.Vector3(1, 0, 0);
  private readonly guards: THREE.Mesh[] = [];
  private readonly blocked = [-99, -99]; // the tick each fighter last blocked a hit, for the guard shell's flash
  private readonly plates: THREE.Mesh[] = []; // the Chladni lines under each fighter
  private ground: Floor = "grain"; // what the arena floor is, which sizes and hops the debris
  private readonly dimmed = [-99, -99]; // the tick a shadow nova last struck each fighter, whose aura it dims
  constructor(private readonly scene: THREE.Scene, private readonly rnd: () => number = Math.random, private readonly max = MAX_LIVE) {}

  /** Tell the effects what floor the fight is on (arena.ts `floorOf`): grass swallows chunks, sand hangs in the air. */
  setGround(floor: Floor) { this.ground = floor; }

  /** How much fighter `i` should flash white right now, 0 to 1: bright on the tick it's struck, gone eight ticks later. */
  flashOf(i: 0 | 1, tick: number) { return Math.max(0, 1 - (tick - this.struck[i]!) / 8); }

  /** Read one tick's events, then shed, trail and glow for the tick. */
  events(m: Match, events: Event[]) {
    for (const e of events) {
      if (e.kind === "move") this.cast(e.move.fx, e.move.field, e.at, e.yaw, e.target, m.f[e.by].b.height, m.f[e.by].b.radius);
      else if (e.kind === "hit") { const d = e.by ? 0 : 1; this.impact(e, m.f[d]); if (e.guarded) this.blocked[d] = m.tick; else { this.struck[d] = m.tick; if (e.fx === "nova" && e.field === "shadow") this.dimmed[d] = m.tick; } }
      else if (e.kind === "clash") { this.burst("storm", e.at, 18, 1.6); this.ring(COLOR.storm, e.at, 2.5, 0.25); this.flash(WHITE, e.at, 1.6, 0.15); }
      else if (e.kind === "land") this.land(m.f[e.who], e.speed);
      else if (e.kind === "ledge") this.dust(m.f[e.who].pos, 5, 0.6);
      else if (e.kind === "clipped") {
        const f = m.f[e.who], at = { x: f.pos.x, y: f.pos.y + f.b.height * 0.7, z: f.pos.z };
        for (let i = 0; i < 10; i++) this.spawn("leaf", COLOR[f.c.fields[0]!], at, { x: (this.rnd() - 0.5) * 4, y: 1 + this.rnd() * 2, z: (this.rnd() - 0.5) * 4 }, 0.12, 1.2, { acc: -3, spin: 5, blend: THREE.NormalBlending });
      }
      else if (e.kind === "ko" && e.how !== "time") {
        const f = m.f[e.who], c = { x: f.pos.x, y: f.pos.y + f.b.height * 0.5, z: f.pos.z }, field = m.f[e.who ? 0 : 1].c.fields[0]!;
        this.shell(COLOR[field], c, 6, 0.6); this.burst(field, c, 30, 2.4); this.flash(WHITE, c, 4, 0.3);
      }
    }
    for (const f of m.f) this.tick(m, f);
    for (const s of m.shots) {
      // a tail behind every shot, longer and brighter on a beam
      const beam = s.move.slot !== "special", back = { x: s.pos.x - s.vel.x * 0.02, y: s.pos.y - s.vel.y * 0.02, z: s.pos.z - s.vel.z * 0.02 };
      this.spawn(beam ? "streak" : "glow", COLOR[s.move.field], back, { x: (this.rnd() - 0.5) * 1.5, y: (this.rnd() - 0.5) * 1.5, z: (this.rnd() - 0.5) * 1.5 }, s.radius * (beam ? 0.5 : 1.6), beam ? 0.25 : 0.35, { alpha: 0.7 });
      if (beam) this.aim(this.live[this.live.length - 1]!, s.vel, s.radius * 3);
    }
  }

  /** One tick of a fighter standing, swinging, charging, dashing or burning: what it sheds and trails. */
  private tick(m: Match, f: Fighter) {
    const { b, c } = f, h = b.height, r = b.radius, fwd = { x: Math.cos(f.yaw), z: Math.sin(f.yaw) };
    const field = c.fields[0]!, side = f === m.f[0] ? 0 : 1;
    const onBody = () => ({ x: f.pos.x + (this.rnd() - 0.5) * r * 1.6, y: f.pos.y + h * (0.2 + this.rnd() * 0.7), z: f.pos.z + (this.rnd() - 0.5) * r * 1.6 });
    const chest = { x: f.pos.x, y: f.pos.y + h * 0.55, z: f.pos.z };
    const shed = SHED[field];
    if (shed && (m.tick + side * 3) % shed.every === 0) {
      const at = onBody(), vel = { x: (this.rnd() - 0.5) * 0.6, y: shed.up, z: (this.rnd() - 0.5) * 0.6 };
      if (field === "storm") { const a = this.rnd() * 6.3; vel.x = Math.cos(a) * 5; vel.z = Math.sin(a) * 5; vel.y = (this.rnd() - 0.5) * 5; }
      if (field === "gale") { const a = Math.atan2(at.z - f.pos.z, at.x - f.pos.x); vel.x = -Math.sin(a) * 3; vel.z = Math.cos(a) * 3; }
      const p = this.spawn(shed.shape, shed.color ?? COLOR[field], at, vel, shed.size * (0.7 + this.rnd() * 0.6), shed.life, { alpha: shed.alpha, blend: shed.blend, spin: shed.shape === "leaf" ? 3 : 0, grow: field === "shadow" ? 0.3 : 0 });
      if (field === "storm" || field === "gale") this.aim(p, vel, shed.size * 6);
    }
    // marks that last: a mote of the field drifts off the body while it holds
    const k = f.marks;
    if (m.tick % 5 === 0) {
      if (k.dot > 0 && k.dotField) this.spawn(GRAIN[k.dotField].shape, COLOR[k.dotField], onBody(), { x: 0, y: 1.5, z: 0 }, 0.08, 0.5);
      if (k.chill > 0) this.spawn("shard", COLOR.frost, onBody(), { x: 0, y: -0.5, z: 0 }, 0.07, 0.5, { spin: 6 });
      if (k.root > 0) this.spawn("leaf", COLOR.grove, { x: f.pos.x + (this.rnd() - 0.5) * r * 2, y: f.pos.y + 0.1, z: f.pos.z + (this.rnd() - 0.5) * r * 2 }, { x: 0, y: 0.6, z: 0 }, 0.12, 0.6, { spin: 6 });
    }
    if (f.state === "charge" && m.tick % 2 === 0) this.gather(COLOR[field], chest, 1.4 + r, 0.07, 0.3);
    if (f.state === "charge" && m.tick % 9 === 0) this.cymatics(COLOR[field], f.pos, 1 + r, ORDER.special, 0.5);
    if (f.state === "dash" && m.tick % 2 === 0) this.spawn("glow", COLOR[field], chest, { x: 0, y: 0, z: 0 }, h * 0.9, 0.22, { alpha: 0.3 });
    if (f.state !== "attack" || !f.act) return;
    const { move } = f.act, fr = frames(move), t = f.t, color = COLOR[move.field];
    const front = { x: f.pos.x + fwd.x * (r + 0.5), y: f.pos.y + h * 0.55, z: f.pos.z + fwd.z * (r + 0.5) };
    if (move.slot === "ultimate" && t < fr.startup) {
      // the wind-up of an ultimate: rings close in and rise, light is pulled into the chest, the aura blazes
      if (t % 3 === 0) { const p = this.ring(color, { x: f.pos.x, y: f.pos.y + 0.05, z: f.pos.z }, 0.3, 0.45); p.o.scale.setScalar(1.6 + r); p.grow = -(1.3 + r) / 0.45; p.vel.y = 2.5; }
      this.gather(color, chest, 2.2 + r, 0.1, 0.25);
      this.gather(color, chest, 2.2 + r, 0.1, 0.25);
      if (t % 8 === 0) this.cymatics(color, f.pos, 1.6 + r + 1.5 * (t / fr.startup), ORDER.ultimate, 1 + t / fr.startup);
    }
    const melee = move.slot === "light" || move.slot === "heavy" || move.slot === "launcher" || (move.slot === "ultimate" && !move.ranged);
    const live = t >= fr.startup && t < fr.startup + fr.active + 4;
    if (melee && live) for (let i = 0; i < 2; i++) {
      // the swing's trail: streaks off the front of the body, flung the way it swings
      const up = move.fx === "rise" ? 7 : 0.5;
      const p = this.spawn("streak", color, { x: front.x + (this.rnd() - 0.5) * r, y: front.y + (this.rnd() - 0.5) * h * 0.5, z: front.z + (this.rnd() - 0.5) * r }, { x: fwd.x * 4 + (this.rnd() - 0.5) * 2, y: up + (this.rnd() - 0.5) * 2, z: fwd.z * 4 + (this.rnd() - 0.5) * 2 }, 0.07, 0.3, { alpha: 0.9 });
      this.aim(p, p.vel, 0.5);
      if (move.fx === "rampage" && i === 0) this.dust({ x: f.pos.x - fwd.x * r, y: f.pos.y, z: f.pos.z - fwd.z * r }, 1, 0.5);
    }
    if (move.fx === "breath" && t >= fr.startup && t < fr.startup + fr.active + fr.recovery * 0.6) {
      // a breath pours out for as long as the move holds, from the mouth, widening as it goes
      for (let i = 0; i < 3; i++) {
        const a = f.yaw + (this.rnd() - 0.5) * 0.5, sp = 9 + this.rnd() * 6;
        this.spawn(move.field === "ember" ? "glow" : GRAIN[move.field].shape, color, front, { x: Math.cos(a) * sp, y: (this.rnd() - 0.4) * 2, z: Math.sin(a) * sp }, 0.12 + this.rnd() * 0.12, 0.45, { grow: 1.6, alpha: 0.8, spin: 4 });
      }
      this.spawn("glow", color, front, { x: 0, y: 0, z: 0 }, 0.8, 0.1, { alpha: 0.6 });
    }
  }

  /** What a move looks like the instant it goes off. */
  private cast(fx: Fx, field: Field, at: V3, yaw: number, target: V3, h: number, r: number) {
    const fwd = { x: Math.cos(yaw), z: Math.sin(yaw) }, color = COLOR[field];
    const front = { x: at.x + fwd.x * (r + 0.6), y: at.y + h * 0.55, z: at.z + fwd.z * (r + 0.6) };
    const ground = { x: at.x + fwd.x * r, y: at.y + 0.05, z: at.z + fwd.z * r };
    switch (fx) {
      case "jab": this.burst(field, front, 5, 0.5); this.flash(color, front, 0.6, 0.1); break;
      case "slam": this.ring(color, ground, 3 + r * 1.3, 0.4); this.spawn("ring", DUST, { ...ground, y: ground.y + 0.03 }, { x: 0, y: 0, z: 0 }, 0.3, 0.55, { grow: (4.5 + r * 2) / 0.55, alpha: 0.45, blend: THREE.NormalBlending }); this.burst(field, ground, 14, 1.2); this.dust(ground, 16, 1.7); this.flash(color, ground, 1.4, 0.15); break;
      case "rise":
        for (let i = 0; i < 10; i++) this.spawn(GRAIN[field].shape, color, { x: front.x, y: at.y + i * 0.25, z: front.z }, { x: 0, y: 6 + this.rnd() * 3, z: 0 }, 0.12 + this.rnd() * 0.1, 0.45, { spin: 6 });
        this.spawn("glow", color, front, { x: 0, y: 5, z: 0 }, 1.2, 0.3, { alpha: 0.5 });
        break;
      case "orb": case "beam": this.burst(field, front, fx === "beam" ? 10 : 6, 0.7); this.flash(color, front, fx === "beam" ? 2 : 1, 0.15); break;
      case "nova": {
        const c = { x: at.x, y: at.y + h * 0.5, z: at.z };
        this.shell(color, c, 3 + r * 2, 0.5); this.burst(field, c, 24, 2.2); this.ring(color, { ...c, y: at.y + 0.05 }, 3 + r, 0.5); this.flash(WHITE, c, 3, 0.2);
        break;
      }
      case "rain":
        // falling on where the target stands now, from above the arena's ceiling
        for (let i = 0; i < 14; i++) {
          const x = target.x + (this.rnd() - 0.5) * 3, z = target.z + (this.rnd() - 0.5) * 3;
          const p = this.spawn(field === "storm" ? "streak" : GRAIN[field].shape, color, { x, y: 8 + this.rnd() * 4, z }, { x: 0, y: -16 - this.rnd() * 6, z: 0 }, 0.18, 0.7, { spin: 5 });
          if (field === "storm") p.o.scale.set(0.08, 1.6, 0.08);
        }
        this.ring(color, { x: target.x, y: 0.05, z: target.z }, 2.5, 0.7);
        break;
      case "rampage":
        for (let i = 0; i < 12; i++) this.spawn("chunk", color, { x: at.x - fwd.x * r, y: at.y + 0.1, z: at.z - fwd.z * r },
          { x: -fwd.x * 3 + (this.rnd() - 0.5) * 4, y: 2 + this.rnd() * 3, z: -fwd.z * 3 + (this.rnd() - 0.5) * 4 }, 0.12 + this.rnd() * 0.12, 0.6, { spin: 6, acc: -9 });
        this.ring(color, ground, 1.6 + r, 0.3); this.dust(ground, 10, 1.5);
        break;
      case "wave":
        for (let i = 0; i < 3; i++) {
          const p = this.ring(color, { x: ground.x + fwd.x * i * 1.2, y: 0.06, z: ground.z + fwd.z * i * 1.2 }, 1.5 + i, 0.6 + i * 0.1);
          p.vel.set(fwd.x * 9, 0, fwd.z * 9);
        }
        this.dust(ground, 6, 1);
        break;
      case "breath":
        for (let i = 0; i < 8; i++) {
          const spread = (this.rnd() - 0.5) * 0.5, s = 10 + this.rnd() * 6, a = yaw + spread;
          this.spawn(GRAIN[field].shape, color, front, { x: Math.cos(a) * s, y: (this.rnd() - 0.4) * 2, z: Math.sin(a) * s }, 0.15 + this.rnd() * 0.15, 0.5, { grow: 2.2 });
        }
        break;
    }
    this.look(fx, field, fwd, ground, front, target);
    // a special, beam or ultimate sets the ground humming where it was thrown from
    if (fx === "orb" || fx === "beam" || fx === "breath" || fx === "nova" || fx === "rain" || fx === "wave") this.cymatics(color, { x: at.x, y: at.y, z: at.z }, 1.2 + r, ORDER[fx === "orb" ? "special" : fx === "beam" || fx === "breath" ? "beam" : "ultimate"], 1);
  }

  /** What only this field's big moves do: marks that stay on the ground for a few seconds, or a change of shape. */
  private look(fx: Fx, field: Field, fwd: { x: number; z: number }, ground: V3, front: V3, target: V3) {
    const color = COLOR[field], still = { x: 0, y: 0, z: 0 }, mark = (c: number, at: V3, size: number, life: number, alpha: number, grow = 0) =>
      this.spawn("print", c, { x: at.x, y: 0.03, z: at.z }, still, size, life, { alpha, grow, blend: THREE.NormalBlending });
    if (fx === "nova" && field === "frost") { const r = this.spawn("ring", color, { x: ground.x - fwd.x * 0.5, y: 0.04, z: ground.z - fwd.z * 0.5 }, still, 3.4, 4, { alpha: 0.7, blend: THREE.NormalBlending }); r.o.scale.setScalar(3.4); }
    if (fx === "wave" && field === "grove") for (let i = 0; i < 10; i++) this.spawn("leaf", color, { x: ground.x + fwd.x * i * 0.6, y: 0.1, z: ground.z + fwd.z * i * 0.6 }, { x: fwd.x * 9, y: 1 + this.rnd() * 2, z: fwd.z * 9 }, 0.14, 1.1, { spin: 5, acc: -3, blend: THREE.NormalBlending });
    if (fx === "wave" && field === "tide") for (let i = 0; i < 6; i++) {
      // the crest throws sheets of spray up and over the way it runs
      const s = this.spawn("leaf", 0xbfe6ff, { x: ground.x + fwd.x * (1 + i * 1.2), y: 0.2, z: ground.z + fwd.z * (1 + i * 1.2) }, { x: fwd.x * 6, y: 4 + this.rnd() * 2, z: fwd.z * 6 }, 0.25, 0.8, { acc: -13, spin: 2, alpha: 0.55, blend: THREE.NormalBlending });
      s.o.scale.x *= 1.8;
    }
    if (fx === "wave" && field === "tide") for (let i = 0; i < 4; i++) mark(color, { x: ground.x + fwd.x * (1.5 + i * 1.8), y: 0, z: ground.z + fwd.z * (1.5 + i * 1.8) }, 1.1, 3, 0.3);
    if (fx === "rain" && field === "storm") for (let i = 0; i < 6; i++) {
      // a fork: a streak splitting off the bolt halfway down, flung to one side
      const side = (this.rnd() - 0.5) * 8, p = this.spawn("streak", color, { x: target.x + (this.rnd() - 0.5) * 2, y: 4 + this.rnd() * 2, z: target.z + (this.rnd() - 0.5) * 2 }, { x: side, y: -14, z: (this.rnd() - 0.5) * 8 }, 0.12, 0.35, { alpha: 1 });
      p.o.scale.set(0.06, 1, 0.06); this.aim(p, p.vel, 1.1);
    }
    if (fx === "rampage" && field === "iron") for (let i = 0; i < 14; i++) this.spawn("shard", 0xffd9b0, { x: ground.x - fwd.x * (0.5 + this.rnd() * 3), y: 0.1, z: ground.z - fwd.z * (0.5 + this.rnd() * 3) }, { x: (this.rnd() - 0.5) * 3, y: 3 + this.rnd() * 3, z: (this.rnd() - 0.5) * 3 }, 0.06, 0.6, { spin: 8, acc: -14 });
    if (fx === "breath" && field === "ember") for (let i = 0; i < 3; i++) mark(0x1a0f08, { x: front.x + fwd.x * (2 + i * 2.5), y: 0, z: front.z + fwd.z * (2 + i * 2.5) }, 0.9, 3.5, 0.55);
  }

  /** A hit landing, shaped by the slot that threw it: a jab's sparks, a slam's ring and rubble under the target, a
   * launcher's column, a shot's splash, a beam that keeps going, an ultimate's shell. A rear hit is bigger and red
   * at the core; a guarded one is a flat white disc and a few sparks. */
  private impact(e: Extract<Event, { kind: "hit" }>, d: Fighter) {
    const { field, at, slot, damage } = e, color = COLOR[field];
    if (e.guarded) { this.spawn("print", WHITE, { ...at }, { x: 0, y: 0, z: 0 }, 0.3, 0.2, { grow: 4, alpha: 0.6 }); this.burst(field, at, 4, 0.6); return; }
    const big = Math.min(2.2, 0.6 + damage / 25);
    this.flash(e.rear ? 0xff5040 : WHITE, at, big * (e.rear ? 1.5 : 1), 0.12);
    this.flash(color, at, big * 2, 0.22, 0.5);
    const n = Math.min(26, 6 + damage), sp = 1 + damage / 40;
    // sparks fly out of the wound along the blow, hot white streaks plus a puff of grit off the floor
    const ox = at.x - d.pos.x, oz = at.z - d.pos.z, ol = Math.hypot(ox, oz) || 1;
    for (let i = 0; i < Math.min(10, 3 + Math.round(damage / 6)); i++) {
      const sp2 = (4 + this.rnd() * 6) * sp;
      this.spawn("streak", i % 2 ? WHITE : color, at, { x: (ox / ol) * sp2 + (this.rnd() - 0.5) * 3, y: 1 + this.rnd() * 3, z: (oz / ol) * sp2 + (this.rnd() - 0.5) * 3 }, 0.06, 0.22 + this.rnd() * 0.15, { alpha: 1 });
    }
    if (damage >= 10) this.dust({ x: d.pos.x, y: d.pos.y, z: d.pos.z }, 3 + Math.round(damage / 10), 0.7);
    this.kick(field, slot, { x: d.pos.x, y: d.pos.y, z: d.pos.z }, { x: ox / ol, z: oz / ol }, damage);
    switch (slot) {
      case "light": this.burst(field, at, n, sp); break;
      case "heavy": this.burst(field, at, n, sp * 1.3); this.ring(color, { x: d.pos.x, y: d.pos.y + 0.05, z: d.pos.z }, 2.6 + d.b.radius * 1.3, 0.4); this.dust({ x: d.pos.x, y: d.pos.y, z: d.pos.z }, 14, 1.8); break;
      case "launcher":
        this.burst(field, at, n, sp);
        for (let i = 0; i < 8; i++) this.spawn(GRAIN[field].shape, color, { x: d.pos.x + (this.rnd() - 0.5) * d.b.radius, y: d.pos.y + i * 0.2, z: d.pos.z + (this.rnd() - 0.5) * d.b.radius }, { x: 0, y: 7 + this.rnd() * 3, z: 0 }, 0.1, 0.45, { spin: 6 });
        break;
      case "special": this.burst(field, at, n, sp * 0.8); this.shell(color, at, 1.2, 0.2); break;
      case "beam": this.burst(field, at, n, sp * 1.6); this.shell(color, at, 1.6, 0.25); break;
      case "ultimate": this.shell(color, at, 2.5, 0.4); this.burst(field, at, Math.min(40, n + 12), sp * 1.5); this.ring(color, { x: d.pos.x, y: d.pos.y + 0.05, z: d.pos.z }, 2 + d.b.radius, 0.45); break;
    }
  }

  /** Ground kicked up by a blow: rocks and dust in a big fight-show way. Chunks tumble out along the blow, fall,
   * bounce and settle; dust rolls out low; each field has its own debris (cinders, spray, frost shards, arcs along
   * the floor, leaves and clods, smoke) and each slot its own weight (a jab is a puff, a slam or an ultimate is a
   * rock burst with a shock ring). `foot` is where the target stands, `dir` the way the blow was travelling. */
  private kick(field: Field, slot: Slot, foot: V3, dir: { x: number; z: number }, damage: number) {
    const k = WEIGHT[slot] * (0.7 + Math.min(1, damage / 90) * 0.6), n = Math.round(2 + 9 * k), fl = foot.y + 0.04, color = COLOR[field];
    const g = DEBRIS[field], gr = GROUND[this.ground], tint = new THREE.Color(DUST).lerp(new THREE.Color(color), 0.28).getHex();
    const at = { x: foot.x, y: fl + 0.1, z: foot.z };
    // the dust: a roll of tinted grit low along the floor
    for (let i = 0; i < 2 + Math.round(5 * k * gr.dust); i++) {
      const a = this.rnd() * 6.3, sp = (1 + this.rnd() * 2.5) * (0.6 + k * 0.5);
      this.spawn("glow", tint, at, { x: Math.cos(a) * sp + dir.x * k, y: 0.3 + this.rnd() * 0.8 * k, z: Math.sin(a) * sp + dir.z * k }, 0.25 + 0.2 * k, 0.5 + this.rnd() * 0.4, { alpha: 0.3, grow: 0.8 * k, blend: THREE.NormalBlending, acc: -0.6 });
    }
    // the debris: flung up and along the blow, tumbling, falling, hopping on the floor
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dir.z, dir.x) + (this.rnd() - 0.5) * 2.4, sp = (2 + this.rnd() * 4) * (0.6 + k * 0.5);
      const col = g.mix ? new THREE.Color(g.color).lerp(new THREE.Color(color), this.rnd() * 0.5).getHex() : g.color;
      this.spawn(g.shape, col, at, { x: Math.cos(a) * sp, y: (3 + this.rnd() * 5) * (0.6 + k * 0.4) * g.lift, z: Math.sin(a) * sp }, (0.1 + this.rnd() * 0.12) * g.size * gr.size * (0.7 + k * 0.5) * chunkScale(k), 0.9 + this.rnd() * 0.5,
        { spin: 8, acc: g.gravity, floor: fl, bounce: Math.min(0.7, g.bounce * gr.bounce), blend: g.blend, alpha: g.shape === "glow" ? 0.8 : 1 });
    }
    // a field's own flourish
    if (field === "ember" || field === "iron") for (let i = 0; i < 2 + Math.round(4 * k); i++) this.spawn("glow", field === "iron" ? 0xffd9b0 : color, at, { x: (this.rnd() - 0.5) * 5, y: 2 + this.rnd() * 4, z: (this.rnd() - 0.5) * 5 }, 0.12, 0.6, { acc: -12, floor: fl, bounce: 0.4 });
    if (field === "storm" || field === "gale") for (let i = 0; i < 2 + Math.round(5 * k); i++) {
      const a = this.rnd() * 6.3, p = this.spawn("streak", field === "storm" ? WHITE : color, { x: foot.x, y: fl + 0.05, z: foot.z }, { x: Math.cos(a) * 9, y: 0.2, z: Math.sin(a) * 9 }, 0.05, 0.2, { alpha: 1 });
      this.aim(p, p.vel, 0.9);
      // a storm arc forks: two shorter arcs split off it a third of the way out
      if (field === "storm" && k >= 0.5) for (const side of [-1, 1]) {
        const b = a + side * (0.5 + this.rnd() * 0.4), q = this.spawn("streak", color, { x: foot.x + Math.cos(a) * 1.6, y: fl + 0.05, z: foot.z + Math.sin(a) * 1.6 }, { x: Math.cos(b) * 8, y: 0.2, z: Math.sin(b) * 8 }, 0.04, 0.16, { alpha: 1 });
        this.aim(q, q.vel, 0.6);
      }
    }
    // tide spray comes off as thin sheets that arc out and over, not round drops
    if (field === "tide") for (let i = 0; i < 2 + Math.round(5 * k); i++) {
      const a = Math.atan2(dir.z, dir.x) + (this.rnd() - 0.5) * 1.6, sp = 3 + this.rnd() * 3 * k;
      const sheet = this.spawn("leaf", 0xbfe6ff, at, { x: Math.cos(a) * sp, y: 4 + this.rnd() * 3 * k, z: Math.sin(a) * sp }, 0.2 + 0.1 * k, 0.8, { acc: -14, spin: 2, alpha: 0.55, blend: THREE.NormalBlending });
      sheet.o.scale.x *= 1.8; // long and thin
    }
    // frost shards come down point first and stay stuck in the ground a few seconds
    if (field === "frost") for (let i = 0; i < 2 + Math.round(4 * k); i++) {
      const a = this.rnd() * 6.3, sp = 1 + this.rnd() * 3, p = this.spawn("shard", 0xe6f6ff, at, { x: Math.cos(a) * sp, y: 4 + this.rnd() * 3, z: Math.sin(a) * sp }, (0.09 + this.rnd() * 0.07) * gr.size, 3, { acc: -20, floor: fl - 0.03, bounce: 0, stick: true, blend: THREE.NormalBlending });
      p.o.scale.y *= 2.6; // a long splinter
    }
    if (field === "spirit") for (let i = 0; i < n; i++) this.spawn("glow", color, at, { x: (this.rnd() - 0.5) * 2, y: 1 + this.rnd() * 2, z: (this.rnd() - 0.5) * 2 }, 0.2, 1.1, { alpha: 0.6 });
    // weight: heavy blows crack the floor outward in a pale shock ring and leave a scuff
    if (k >= 0.9) {
      const ring = this.spawn("ring", WHITE, { x: foot.x, y: fl + 0.01, z: foot.z }, { x: 0, y: 0, z: 0 }, 0.3, 0.45, { grow: (3 + 2 * k) / 0.45, alpha: 0.5 });
      ring.o.scale.setScalar(0.3);
      this.spawn("print", 0x2a241c, { x: foot.x, y: fl - 0.01, z: foot.z }, { x: 0, y: 0, z: 0 }, 0.5 + 0.4 * k, 3, { alpha: 0.3, blend: THREE.NormalBlending });
      this.cymatics(color, foot, 1.5, ORDER[slot], k);
    }
  }

  /** The ground humming: sand grains hop where a standing-wave pattern has its antinodes, in rings out from `c`. The
   * order (petal count) rises with the move's weight, so a jab and an ultimate don't draw the same figure. `k`
   * scales how many rings and how high. A first idea for move-timed cymatics, tuned by eye. */
  private cymatics(color: number, c: V3, radius: number, order: number, k: number) {
    const rings = k >= 1.5 ? 3 : k >= 0.8 ? 2 : 1, fl = c.y + 0.04, ph = this.rnd() * 6.3;
    const tight = this.live.length > this.max * 0.75; // near the cap (a phone's 400) the hum draws every other grain
    for (let j = 1; j <= rings; j++) {
      const R = radius * (0.5 + 0.5 * j / rings), count = 14 + order * 4 + j * 4;
      for (let i = 0; i < count; i++) {
        const th = (i / count) * 6.283 + ph, petal = Math.cos(order * th * 0.5 + j);
        if (Math.abs(petal) < 0.35 || (tight && i % 2)) continue; // only where the sand gathers
        const dx = Math.cos(th), dz = Math.sin(th), hop = 1.2 + 1.8 * Math.abs(petal) * k;
        this.spawn("glow", i % 3 ? color : WHITE, { x: c.x + dx * R, y: fl, z: c.z + dz * R }, { x: dx * 0.8 * j, y: hop, z: dz * 0.8 * j }, 0.1 + 0.03 * k, 0.7, { alpha: 0.85, acc: -9, floor: fl, bounce: 0.35 });
      }
      const ring = this.spawn("ring", color, { x: c.x, y: fl, z: c.z }, { x: 0, y: 0, z: 0 }, 0.3, 0.6, { grow: (R * 1.15 - 0.3) / 0.6, alpha: 0.35 });
      ring.o.scale.setScalar(R * 0.5);
    }
  }

  /** Feet back on the ring at `speed`: a puff of dust that grows with the fall, and a print under a hard one. */
  private land(f: Fighter, speed: number) {
    const at = { x: f.pos.x, y: f.pos.y, z: f.pos.z }, k = Math.min(1, speed / 10);
    this.dust(at, 2 + Math.round(k * 8), 0.5 + k);
    if (speed > 3) this.spawn("ring", DUST, { ...at, y: at.y + 0.04 }, { x: 0, y: 0, z: 0 }, 0.3, 0.35, { grow: (1 + f.b.radius + k * 2) / 0.35, alpha: 0.5, blend: THREE.NormalBlending });
    if (speed > 6) this.spawn("print", 0x3a3228, { ...at, y: at.y + 0.02 }, { x: 0, y: 0, z: 0 }, f.b.radius * 0.7, 2.5, { alpha: 0.2, blend: THREE.NormalBlending });
  }

  /** A foot coming down at `speed` (the puppet reports each step): a print that fades, and dust at a run. */
  step(at: V3, speed: number, radius: number) {
    if (speed < 0.5) return;
    this.spawn("print", 0x3a3228, { x: at.x, y: 0.02, z: at.z }, { x: 0, y: 0, z: 0 }, radius * 0.2, 1.5, { alpha: 0.18, blend: THREE.NormalBlending });
    if (speed > 3) this.dust({ x: at.x, y: 0, z: at.z }, 1 + Math.round(speed / 8), 0.25 + speed / 30);
  }

  /** Sparks flung out from a point. */
  private burst(field: Field, at: V3, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      this.v.set(this.rnd() - 0.5, this.rnd() * 0.8, this.rnd() - 0.5).normalize().multiplyScalar((2 + this.rnd() * 4) * speed);
      const shape = GRAIN[field].shape;
      this.spawn(shape, COLOR[field], at, this.v, 0.06 + this.rnd() * 0.08 * speed, 0.35 + this.rnd() * 0.25, { spin: shape === "dot" ? 0 : 6, acc: shape === "chunk" || shape === "shard" ? -9 : 0 });
    }
  }
  /** Grey-brown grit kicked up low off the ground. */
  private dust(at: V3, n: number, size: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * 6.3, sp = 1 + this.rnd() * 2 * size;
      this.spawn("glow", DUST, { x: at.x, y: at.y + 0.1, z: at.z }, { x: Math.cos(a) * sp, y: 0.4 + this.rnd() * size, z: Math.sin(a) * sp }, 0.2 * size, 0.4 + this.rnd() * 0.25, { alpha: 0.35, grow: 0.5 * size, blend: THREE.NormalBlending, acc: -1 });
    }
  }
  /** A mote pulled in toward `to` from `dist` away: light gathering for a charge or an ultimate. */
  private gather(color: number, to: V3, dist: number, size: number, life: number) {
    const a = this.rnd() * 6.3, y = (this.rnd() - 0.5) * dist;
    const from = { x: to.x + Math.cos(a) * dist, y: to.y + y, z: to.z + Math.sin(a) * dist };
    this.spawn("glow", color, from, { x: (to.x - from.x) / life, y: (to.y - from.y) / life, z: (to.z - from.z) / life }, size * 3, life, { alpha: 0.8 });
  }
  /** A soft flash of light that swells and fades. */
  private flash(color: number, at: V3, size: number, life: number, alpha = 0.9) {
    return this.spawn("glow", color, at, { x: 0, y: 0, z: 0 }, size * 0.5, life, { grow: size / life, alpha });
  }
  private ring(color: number, at: V3, size: number, life: number) { return this.spawn("ring", color, at, { x: 0, y: 0, z: 0 }, 0.3, life, { grow: (size - 0.3) / life }); }
  private shell(color: number, at: V3, size: number, life: number) { return this.spawn("shell", color, at, { x: 0, y: 0, z: 0 }, 0.3, life, { grow: (size - 0.3) / life, alpha: 0.35 }); }
  /** Point a streak along `dir` and stretch it to `len`. */
  private aim(p: P, dir: V3, len: number) {
    this.v.set(dir.x, dir.y, dir.z).normalize();
    p.o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.v);
    p.o.scale.y = len;
    p.spin = 0;
  }

  private spawn(shape: Shape, color: number, at: V3, vel: V3, size: number, life: number, opt: Opt = {}): P {
    let o: THREE.Mesh | THREE.Sprite;
    const grain = shape;
    // a round mote reads as a soft blur of light, not a little faceted ball: it draws as a glow sprite
    if (shape === "dot") { shape = "glow"; size *= 2.2; }
    if (shape === "glow") {
      o = this.freeGlow.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, map: SOFT, transparent: true, depthWrite: false }));
    } else {
      o = this.freeMesh.pop() ?? new THREE.Mesh(GEO.dot, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      (o as THREE.Mesh).geometry = GEO[shape];
    }
    const mat = o.material as THREE.MeshBasicMaterial | THREE.SpriteMaterial;
    mat.color.setHex(color);
    mat.blending = opt.blend ?? THREE.AdditiveBlending;
    o.position.set(at.x, at.y, at.z); o.scale.setScalar(size);
    o.rotation.set(shape === "ring" || shape === "print" ? 0 : this.rnd() * 6, shape === "ring" || shape === "print" ? 0 : this.rnd() * 6, 0);
    o.visible = true;
    if (!o.parent) this.scene.add(o);
    const field = fieldOf(color);
    const rise = grain === "ring" || grain === "shell" || grain === "print" || grain === "glow" || !field ? 0 : GRAIN[field].rise;
    const p: P = { o, vel: new THREE.Vector3(vel.x, vel.y + rise * 0.3, vel.z), life, max: life, grow: opt.grow ?? 0, spin: opt.spin ?? 0, alpha: opt.alpha ?? 0.9, acc: opt.acc ?? 0, floor: opt.floor, bounce: opt.bounce ?? 0, stick: opt.stick ?? false };
    mat.opacity = p.alpha;
    if (shape === "streak" && p.vel.lengthSq() > 0.01) this.aim(p, p.vel, size * 5); // a streak flies point first
    this.live.push(p);
    if (this.live.length > this.max) this.retire(0);
    return p;
  }
  private retire(i: number) {
    const p = this.live[i]!;
    p.o.visible = false;
    if (p.o instanceof THREE.Sprite) this.freeGlow.push(p.o); else this.freeMesh.push(p.o);
    this.live.splice(i, 1);
  }

  /** Age every particle by `dt`. */
  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.retire(i); continue; }
      if (p.acc) p.vel.y += p.acc * dt;
      p.o.position.addScaledVector(p.vel, dt);
      if (p.floor !== undefined && p.o.position.y < p.floor && p.vel.y < 0) {
        // landed: hop back up with some of the speed, skid, and tumble less
        p.o.position.y = p.floor; p.vel.y *= -p.bounce; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin *= 0.5;
        if (p.vel.y < 0.6) { p.vel.set(0, 0, 0); p.acc = 0; p.spin = 0; }
      }
      if (p.grow) { p.o.scale.x = Math.max(0.01, p.o.scale.x + p.grow * dt); p.o.scale.z = p.o.scale.x; if (!(p.o instanceof THREE.Mesh && p.o.geometry === GEO.streak)) p.o.scale.y = p.o.scale.x; }
      if (p.spin) { p.o.rotation.x += p.spin * dt; p.o.rotation.y += p.spin * dt * 0.7; }
      (p.o.material as THREE.MeshBasicMaterial).opacity = p.alpha * (p.stick ? Math.min(1, p.life / p.max / 0.25) : p.life / p.max);
    }
  }

  /** Draw what rides the match's state each frame: every shot as a glowing core (a beam is stretched along its
   * flight), and each fighter's aura, which breathes, brightens to charge, blazes through an ultimate's wind-up
   * and flashes white when struck. */
  draw(m: Match) {
    while (this.shots.length < m.shots.length) {
      const core = new THREE.Mesh(GEO.dot, new THREE.MeshBasicMaterial({ toneMapped: false, color: WHITE, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, map: SOFT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
      this.scene.add(core, glow); this.shots.push({ core, glow });
    }
    this.shots.forEach(({ core, glow }, i) => {
      const s = m.shots[i];
      core.visible = glow.visible = !!s;
      if (!s) return;
      const sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z), color = COLOR[s.move.field];
      core.position.set(s.pos.x, s.pos.y, s.pos.z); glow.position.copy(core.position);
      this.v.set(s.vel.x, s.vel.y, s.vel.z).normalize();
      core.quaternion.setFromUnitVectors(this.x, this.v);
      const beam = sp > 20, thin = beam ? 0.55 : 1;
      core.scale.set(s.radius * (1 + sp / 10), s.radius * thin, s.radius * thin);
      (core.material as THREE.MeshBasicMaterial).color.setHex(color).lerp(new THREE.Color(WHITE), 0.3);
      glow.scale.setScalar(s.radius * (beam ? 2.2 : 3.5)); (glow.material as THREE.SpriteMaterial).color.setHex(color);
    });
    m.f.forEach((f, i) => {
      let a = this.auras[i];
      if (!a) { a = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, map: SOFT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); this.scene.add(a); this.auras[i] = a; }
      const h = f.b.height, mat = a.material as THREE.SpriteMaterial;
      let field = f.c.fields[0]!, glow = 0.1 + 0.03 * Math.sin(m.tick * 0.1 + i * 2), size = 1.5;
      if (f.state === "charge") glow += 0.3 + 0.08 * Math.sin(m.tick * 0.8);
      if (f.state === "attack" && f.act) {
        const fr = frames(f.act.move), t = f.t;
        field = f.act.move.field;
        if (f.act.move.slot === "ultimate") { glow += t < fr.startup ? 0.7 * (t / fr.startup) : 0.7 * Math.max(0, 1 - (t - fr.startup) / (fr.active + fr.recovery)); size = 1.5 + 0.8 * Math.min(1, t / fr.startup); }
        else if (t < fr.startup) glow += 0.15 * (t / fr.startup);
      }
      if (f.exhausted) glow *= 0.4;
      const dim = Math.max(0, 1 - (m.tick - this.dimmed[i]!) / 90); // a shadow nova's hit puts the aura out for a moment
      glow *= 1 - dim * 0.85;
      this.guard(f, i, m.tick); this.plate(f, i, m.tick);
      const hit = this.flashOf(i as 0 | 1, m.tick);
      mat.color.setHex(COLOR[field]).lerp(new THREE.Color(WHITE), hit * 0.8);
      mat.opacity = Math.min(1, glow + hit * 0.5);
      a.visible = true;
      a.position.set(f.pos.x, f.pos.y + h * 0.55, f.pos.z);
      a.scale.setScalar(h * size + hit * 0.6);
    });
  }

  /** The Chladni lines on the floor under a fighter winding up a move: they fade in over the startup frames and pulse
   * faster as it nears the blow, in the move's colour, and are gone once it goes off. */
  private plate(f: Fighter, i: number, tick: number) {
    let p = this.plates[i];
    if (!p) { p = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), chladniMaterial()); p.renderOrder = -1; this.scene.add(p); this.plates[i] = p; }
    const act = f.state === "attack" ? f.act : undefined, fr = act && frames(act.move), t = f.t;
    p.visible = !!act && !!fr && t < fr.startup;
    if (!p.visible || !act || !fr) return;
    const u = (p.material as THREE.ShaderMaterial).uniforms, [n, m] = chladniModes(ORDER[act.move.slot]), ramp = t / fr.startup;
    (u.color!.value as THREE.Color).setHex(COLOR[act.move.field]);
    u.n!.value = n; u.m!.value = m;
    u.strength!.value = 0.55 * Math.sin(Math.min(1, ramp * 1.5) * Math.PI / 2) * (0.7 + 0.3 * Math.sin(tick * (0.3 + ramp)));
    p.position.set(f.pos.x, f.pos.y + 0.035, f.pos.z);
    p.scale.setScalar((1.6 + f.b.radius * 1.4) * (0.8 + WEIGHT[act.move.slot] * 0.4));
  }

  /** The guard: a shell of the beast's own field on the body while it holds, flaring white when a hit is blocked. */
  private guard(f: Fighter, i: number, tick: number) {
    let g = this.guards[i];
    if (!g) { g = new THREE.Mesh(GEO.shell, rimMaterial()); this.scene.add(g); this.guards[i] = g; }
    const flare = Math.max(0, 1 - (tick - this.blocked[i]!) / 8), u = (g.material as THREE.ShaderMaterial).uniforms;
    g.visible = f.state === "guard" || flare > 0;
    if (!g.visible) return;
    (u.color!.value as THREE.Color).setHex(COLOR[f.c.fields[0]!]).lerp(new THREE.Color(WHITE), flare * 0.8);
    u.opacity!.value = 0.75 + 0.15 * Math.sin(tick * 0.3) + flare * 0.9;
    g.position.set(f.pos.x, f.pos.y + f.b.height * 0.5, f.pos.z);
    g.scale.set(f.b.radius * 1.5 * (1 + flare * 0.15), f.b.height * 0.62, f.b.radius * 1.5 * (1 + flare * 0.15));
  }

  clear() {
    while (this.live.length) this.retire(this.live.length - 1);
    for (const { core, glow } of this.shots) core.visible = glow.visible = false;
    for (const a of this.auras) a.visible = false;
    for (const g of this.guards) g.visible = false;
    for (const p of this.plates) p.visible = false;
    this.struck[0] = this.struck[1] = this.blocked[0] = this.blocked[1] = this.dimmed[0] = this.dimmed[1] = -99;
  }
}

const FIELD_BY_COLOR = new Map<number, Field>(Object.entries(COLOR).map(([f, c]) => [c, f as Field]));
/** The field a particle colour came from, so its grain knows which way to drift; dust and white have none. */
const fieldOf = (color: number) => FIELD_BY_COLOR.get(color);
