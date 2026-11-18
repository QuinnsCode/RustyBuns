// The loose bits of a hide: fur cards, manes and tufts, spikes and quills. The rigger skins them to the bones
// they sit on, so they turned as stiff as the bone, like cards and quills glued to clay (#4693 round 23). Here
// each one trails its bone instead: every bone carries a damped spring driven by its own acceleration (a lunge
// leaves the cards behind, a stop flings them forward, a hit whips them and they settle), and each vertex of a
// loose part moves by its bone's spring, times how far it sits out from the body, so the root stays put and the
// tip swings. A faint flutter keeps a standing coat alive. The springs live in a one-row float texture the
// vertex shader reads after skinning; nothing allocates per frame.
import * as THREE from "three";
import type { Archetype } from "./roster.ts";

const LOOSE = /tuft|mane|spike|quill|fur|shag|ruff|plume|fluff|hair|frill|feather/;
const STIFF = /spike|quill/;

/** Which parts are loose, by material name: a card or spike material that isn't the body itself (the biggest part:
 * a furred beast's own fur is its skin, not a card). Quills swing at half a card's reach. */
export function looseParts(parts: readonly { name: string; count: number }[]): number[] {
  let body = 0;
  parts.forEach((p, i) => { if (p.count > parts[body]!.count) body = i; });
  return parts.map((p, i) => (i !== body && LOOSE.test(p.name) ? (STIFF.test(p.name) ? 0.5 : 1) : 0));
}

/** Per vertex of a loose part, how far out from the rest of the body it sits, over the model's height `h`, times the
 * part's reach: 0 at a card's root, its length at the tip. `body` is every other vertex (x, y, z), thinned to `max`. */
export function reachOf(pos: ArrayLike<number>, body: ArrayLike<number>, h: number, gain: number, max = 3000): Float32Array {
  const n = pos.length / 3, m = body.length / 3, step = Math.max(1, Math.ceil(m / max)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let best = Infinity;
    for (let j = 0; j < m; j += step) {
      const dx = body[j * 3]! - x, dy = body[j * 3 + 1]! - y, dz = body[j * 3 + 2]! - z, d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    out[i] = (Math.sqrt(best) / h) * gain;
  }
  return out;
}

/** Per archetype: spring stiffness (1/s squared), damping ratio (under 1 overshoots) and how far the springs reach. */
const FEEL: Record<Archetype, { k: number; zeta: number; reach: number }> = {
  tank: { k: 45, zeta: 0.4, reach: 2.2 },
  bruiser: { k: 60, zeta: 0.35, reach: 2.6 },
  flyer: { k: 70, zeta: 0.32, reach: 2.6 },
  skirmisher: { k: 90, zeta: 0.3, reach: 2.4 },
};
const MAX_DT = 1 / 30;
/** The hardest shove a card answers to, m/s squared: a teleport or a respawn is not a whip. */
const MAX_ACC = 80;

export class LooseLag {
  readonly texture: THREE.DataTexture;
  /** The uniforms each loose material shares: the springs, the clock for the flutter, and how far a spring reaches. */
  readonly uniforms: { uLoose: { value: THREE.DataTexture }; uLooseTime: { value: number }; uLooseReach: { value: number } };
  private readonly data: Float32Array;
  private readonly x: Float64Array;
  private readonly v: Float64Array;
  /** Each bone's world position a frame ago and its speed then: what its acceleration is read from. */
  private readonly was: Float64Array;
  private readonly feel;
  private ready = false;
  private readonly d = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();

  constructor(readonly bones: number, archetype: Archetype) {
    this.feel = FEEL[archetype];
    this.data = new Float32Array(bones * 4);
    this.texture = new THREE.DataTexture(this.data, bones, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    this.x = new Float64Array(bones * 3);
    this.v = new Float64Array(bones * 3);
    this.was = new Float64Array(bones * 6);
    this.uniforms = { uLoose: { value: this.texture }, uLooseTime: { value: 0 }, uLooseReach: { value: this.feel.reach } };
  }

  /** One frame: `world(j)` is bone j's position in the world, `inv` the inverse of the skin's world matrix and `h` the body's
   * height in metres. Each spring answers its bone's acceleration and is written, in the skin's own units over its height,
   * into the texture. */
  step(dt: number, world: (j: number, out: THREE.Vector3) => THREE.Vector3, inv: THREE.Matrix4, h: number, clock: number) {
    this.uniforms.uLooseTime.value = clock;
    dt = Math.min(dt, MAX_DT);
    const { k, zeta } = this.feel, c = 2 * zeta * Math.sqrt(k), x = this.x, v = this.v, w = this.was, p = this.d;
    this.rot.copy(inv).setPosition(0, 0, 0);
    for (let j = 0; j < this.bones; j++) {
      world(j, p);
      const i = j * 3, o = j * 6;
      if (!this.ready) { w[o] = p.x; w[o + 1] = p.y; w[o + 2] = p.z; }
      if (dt > 0) for (let a = 0; a < 3; a++) {
        const to = a === 0 ? p.x : a === 1 ? p.y : p.z, speed = (to - w[o + a]!) / dt;
        const acc = this.ready ? Math.max(-MAX_ACC, Math.min(MAX_ACC, (speed - w[o + 3 + a]!) / dt)) : 0;
        w[o + a] = to; w[o + 3 + a] = speed;
        v[i + a] = v[i + a]! + (-k * x[i + a]! - c * v[i + a]! - acc) * dt;
        x[i + a] = x[i + a]! + v[i + a]! * dt;
      }
      // metres in the world to the skin's own units, over the body's height (a big beast's cards swing as far for their size)
      p.set(x[i]!, x[i + 1]!, x[i + 2]!).applyMatrix4(this.rot).multiplyScalar(1 / Math.max(h, 1e-3));
      this.data[j * 4] = p.x; this.data[j * 4 + 1] = p.y; this.data[j * 4 + 2] = p.z;
    }
    this.ready = true;
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}

/** The vertex shader's share: declarations, and the offset added to `transformed` after skinning. `aLoose` is the
 * vertex's reach (reachOf), `uTop` the model's height. A card moves by its bones' springs (by skin weight), never
 * further than 0.6 of its own reach, and flutters a touch on a phase from where it sits. */
export const LOOSE_PARS = "attribute float aLoose;\nuniform sampler2D uLoose;\nuniform float uLooseTime;\nuniform float uLooseReach;\n";
export const LOOSE_VERT = `
  if ( aLoose > 0.0 ) {
    vec3 lag = texelFetch( uLoose, ivec2( int( skinIndex.x ), 0 ), 0 ).xyz * skinWeight.x
      + texelFetch( uLoose, ivec2( int( skinIndex.y ), 0 ), 0 ).xyz * skinWeight.y
      + texelFetch( uLoose, ivec2( int( skinIndex.z ), 0 ), 0 ).xyz * skinWeight.z
      + texelFetch( uLoose, ivec2( int( skinIndex.w ), 0 ), 0 ).xyz * skinWeight.w;
    vec3 off = lag * uLooseReach * aLoose * uTop;
    float most = 0.6 * aLoose * uTop, len = length( off );
    if ( len > most ) off *= most / len;
    float ph = dot( position, vec3( 7.1, 5.3, 6.7 ) ) / max( uTop, 1e-4 ) * 3.0;
    off += aLoose * uTop * 0.05 * vec3( sin( uLooseTime * 2.3 + ph ), 0.4 * sin( uLooseTime * 1.7 + ph * 1.3 ), cos( uLooseTime * 2.9 + ph * 0.7 ) );
    transformed += off;
  }
`;

// A card read as a pale glass shard (#5199 round 29). Three things lit it: the fur grain's strand tips lightened toward
// white (hide.ts), a field look's edge glow (effects.ts) and the sky's reflection and rim at every grazing angle, so a
// near-black mane card flashed silver. A card is now matte and plain: no grain, specular, rim or edge glow; its root
// takes the coat's colour where it grows (the coat's brown is in the body's vertex colours, so a mane read as a
// separate dark plate) and it darkens toward the tip.

/** Which parts are shaded as cards: loose by name, not a quill or spike, and not the coat itself (the part with the
 * baked hide map; with no map, the biggest part). A Rougarou's biggest part is its spiky `tuft`, not its coat. */
export function cardParts(parts: readonly { name: string; count: number; mapped: boolean }[]): boolean[] {
  const mapped = parts.some((p) => p.mapped);
  let body = 0;
  parts.forEach((p, i) => { if (p.count > parts[body]!.count) body = i; });
  return parts.map((p, i) => LOOSE.test(p.name) && !STIFF.test(p.name) && !p.mapped && (mapped || i !== body));
}

/** Per vertex of a card, how far along it is: 0 at the root, 1 at the tip (its reach over the part's 95th percentile). */
export function tipOf(reach: Float32Array): Float32Array {
  const s = Float32Array.from(reach).sort(), top = s[Math.floor((s.length - 1) * 0.95)]! || 1;
  return reach.map((r) => Math.min(1, r / top));
}

/** Per vertex of a card, the coat's colour where it grows (rgb, linear): the nearest coat vertex's colour times `tint`,
 * the coat thinned to `max` vertices. */
export function rootOf(pos: ArrayLike<number>, coat: ArrayLike<number>, colour: ArrayLike<number>, tint: readonly number[], max = 3000): Float32Array {
  const n = pos.length / 3, m = coat.length / 3, step = Math.max(1, Math.ceil(m / max)), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let best = Infinity, at = 0;
    for (let j = 0; j < m; j += step) {
      const dx = coat[j * 3]! - x, dy = coat[j * 3 + 1]! - y, dz = coat[j * 3 + 2]! - z, d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; at = j; }
    }
    for (let k = 0; k < 3; k++) out[i * 3 + k] = colour[at * 3 + k]! * tint[k]!;
  }
  return out;
}

export const CARD_VERT_PARS = "attribute float aTip;\nattribute vec3 aRoot;\nvarying float vCardTip;\nvarying vec3 vCardRoot;\n";
export const CARD_VERT = "vCardTip = aTip; vCardRoot = aRoot;";
export const CARD_FRAG_PARS = "varying float vCardTip;\nvarying vec3 vCardRoot;\n";
/** After the colour is read: the coat's colour at the root, the card's own toward the tip, darker at the very end. */
export const CARD_COLOR = `
  diffuseColor.rgb = mix( vCardRoot, diffuseColor.rgb, smoothstep( 0.1, 0.8, vCardTip ) ) * mix( 1.0, 0.7, vCardTip * vCardTip );`;
/** After the lights and the field look: a card is matte, no sun glint, sky reflection, rim or field-look edge glow. */
export const CARD_LIGHT = "reflectedLight.directSpecular *= 0.0; reflectedLight.indirectSpecular *= 0.0; totalEmissiveRadiance *= 0.0;";
