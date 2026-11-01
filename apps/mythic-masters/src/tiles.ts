// Ground tiles: a flat disc under each beast, tinted with its field's colour and patterned by what the field is
// (ember cracks pulse, tide rings ripple, gale spirals, ...). A dual-field beast shows two halves blended. A pip on
// the front edge reads the matchup at a glance, by shape so colour isn't needed: a triangle for "strong against
// the other beast", a bar for "resisted by it", nothing for even. One shared plane, one small shader, one material
// per (fields, pip) kept in a cache: sixteen gallery tiles share a handful, and nothing is allocated per frame.
import * as THREE from "three";
import { COLOR, FIELDS, typeMul, type Field } from "./fields.ts";

export type Pip = 0 | 1 | 2; // none, strong against the other, resisted by it

/** How a beast with `mine` fares against one with `theirs`: its best field into them, and whether all of its fields are resisted. */
export function pipOf(mine: readonly Field[], theirs: readonly Field[]): Pip {
  const best = Math.max(...mine.map((f) => typeMul(f, theirs)));
  return best > 1 ? 1 : best < 1 ? 2 : 0;
}

const GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const TIME = { value: 0 };

const FRAG = /* glsl */ `
varying vec2 vP;
uniform float uTime, uA, uB, uPip;
uniform vec3 uColA, uColB;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float line(float v, float w) { return 1.0 - smoothstep(0.0, w, v); }
// each field's pattern: 0..1 brightness at point p (the disc is the unit circle)
float pat(float k, vec2 p, float t) {
  float r = length(p), a = atan(p.y, p.x);
  if (k < 0.5) { // ember: slow pulsing hot cracks
    float v = abs(sin(p.x * 7.0 + sin(p.y * 5.0) * 1.5) * sin(p.y * 6.0 + sin(p.x * 4.0) * 1.5));
    return line(v, 0.14) * (0.55 + 0.45 * sin(t * 1.4 - r * 3.0));
  }
  if (k < 1.5) { // tide: rippling rings
    return pow(0.5 + 0.5 * sin(r * 20.0 - t * 3.0), 5.0) * (1.0 - r * 0.6);
  }
  if (k < 2.5) { // gale: spiral lines
    return pow(0.5 + 0.5 * sin(a * 2.0 + r * 11.0 - t * 3.0), 6.0);
  }
  if (k < 3.5) { // stone: cracked slabs, offset every other row
    vec2 q = p * 3.0; float row = floor(q.y); q.x += row * 0.5;
    vec2 f = abs(fract(q) - 0.5);
    float seam = line(0.5 - max(f.x, f.y), 0.07);
    float crack = line(abs(sin(p.x * 9.0 + p.y * 4.0 + hash(vec2(row, 1.0)) * 6.0)), 0.04) * 0.5;
    return max(seam, crack * step(0.4, hash(floor(q))));
  }
  if (k < 4.5) { // frost: six-fold ice crystals with a twinkle
    float f = abs(mod(a + 0.5236, 1.0472) - 0.5236);
    float arm = line(f * r, 0.05) * smoothstep(1.0, 0.2, r);
    float branch = line(abs(fract(r * 5.0) - 0.5) * 0.5 + f * 1.5 - 0.0, 0.1) * 0.5 * step(f, 0.45) * smoothstep(0.9, 0.2, r);
    return max(arm, branch) * (0.75 + 0.25 * sin(t * 2.0 + r * 8.0));
  }
  if (k < 5.5) { // storm: crackling jagged lines that re-roll several times a second
    float s = floor(t * 7.0);
    float v1 = abs(p.y + 0.28 * sin(p.x * 9.0 + s * 1.7) * sin(p.x * 3.1 + s));
    vec2 q = vec2(p.y, p.x);
    float v2 = abs(q.y + 0.22 * sin(q.x * 11.0 + s * 2.3) * sin(q.x * 2.7 - s));
    return max(line(v1, 0.05), line(v2, 0.05)) * step(0.35, hash(vec2(s, 3.0)) + 0.4);
  }
  if (k < 6.5) { // grove: turning leaves with veins
    float ang = a - t * 0.25;
    float leaf = pow(abs(cos(ang * 2.5)), 5.0) * smoothstep(0.95, 0.25, r) * smoothstep(0.05, 0.3, r);
    float vein = line(abs(sin(ang * 2.5 * 4.0)) * r, 0.05) * leaf;
    return clamp(leaf * 0.7 + vein, 0.0, 1.0);
  }
  if (k < 7.5) { // venom: bubbling puddle
    vec2 q = p * 3.5 + vec2(0.0, t * 0.4); vec2 id = floor(q), f = fract(q) - 0.5;
    float h = hash(id), ph = fract(t * 0.35 + h), rad = 0.08 + 0.3 * ph;
    float ring = line(abs(length(f + (vec2(hash(id + 3.0), hash(id + 7.0)) - 0.5) * 0.3) - rad), 0.05);
    return ring * (1.0 - ph) + 0.12;
  }
  if (k < 8.5) { // spirit: drifting motes
    vec2 q = p * 4.0; q.y -= t * 0.5; vec2 id = floor(q), f = fract(q) - 0.5;
    float h = hash(id);
    vec2 c = vec2(sin(t * 0.8 + h * 6.28), cos(t * 0.6 + h * 9.0)) * 0.25;
    return smoothstep(0.14, 0.0, length(f - c)) * step(0.35, h) * (0.5 + 0.5 * sin(t * 2.0 + h * 20.0));
  }
  if (k < 9.5) { // shadow: a slow dark pool
    return 0.35 + 0.35 * sin(r * 7.0 - t * 1.2 + sin(a * 3.0 + t * 0.5) * 1.2);
  }
  if (k < 10.5) { // iron: plate grid with rivets
    vec2 q = p * 3.0, f = abs(fract(q) - 0.5);
    float seam = line(0.5 - max(f.x, f.y), 0.06);
    float rivet = smoothstep(0.1, 0.05, length(fract(q) - 0.5 - vec2(0.36)) ) + smoothstep(0.1, 0.05, length(fract(q) - 0.5 + vec2(0.36)));
    return max(seam, rivet);
  }
  // wild: claw scuffs, three parallel slashes that flash and fade
  float s = floor(t * 0.7), ph = fract(t * 0.7);
  float ang = hash(vec2(s, 5.0)) * 3.14;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  float slash = line(abs(fract(q.x * 3.2 + 0.5) - 0.5) * 0.6, 0.05) * smoothstep(0.55, 0.0, abs(q.y)) * step(abs(q.x), 0.45);
  return slash * (1.0 - ph) * 1.1;
}
void main() {
  vec2 p = vP; float r = length(p);
  if (r > 1.0) discard;
  float w = uA == uB ? 0.0 : smoothstep(-0.12, 0.12, p.x + p.y * 0.35);
  float pa = pat(uA, p, uTime), pb = uA == uB ? pa : pat(uB, p, uTime);
  float v = mix(pa, pb, w);
  vec3 col = mix(uColA, uColB, w);
  float rim = smoothstep(0.82, 0.93, r) * smoothstep(1.0, 0.95, r);
  float a = 0.4 + 0.55 * v + 0.55 * rim;
  vec3 rgb = col * (0.7 + 0.6 * v) + rim * 0.2;
  // the matchup pip: dark disc on the front edge (the +z side, toward the camera), a triangle or a bar on it
  if (uPip > 0.5) {
    vec2 q = p - vec2(0.0, 0.8);
    float d = length(q);
    float tri = step(abs(q.x), (q.y + 0.13) * 0.62) * step(q.y, 0.1) * step(-0.13, q.y);
    float bar = step(abs(q.x), 0.14) * step(abs(q.y), 0.04);
    float mark = uPip < 1.5 ? tri : bar;
    float bg = smoothstep(0.2, 0.17, d);
    rgb = mix(rgb, vec3(0.04, 0.04, 0.06), bg * 0.85);
    rgb = mix(rgb, vec3(1.0), mark);
    a = max(a, max(bg * 0.9, mark));
  }
  gl_FragColor = vec4(rgb, clamp(a, 0.0, 0.95));
}
`;
const VERT = /* glsl */ `varying vec2 vP; void main() { vP = position.xz * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const cache = new Map<string, THREE.ShaderMaterial>();
function material(fields: readonly Field[], pip: Pip) {
  const a = fields[0] ?? "wild", b = fields[1] ?? a, key = `${a}|${b}|${pip}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: TIME, uA: { value: FIELDS.indexOf(a) }, uB: { value: FIELDS.indexOf(b) },
        uColA: { value: new THREE.Color(COLOR[a]) }, uColB: { value: new THREE.Color(COLOR[b]) }, uPip: { value: pip } },
    });
    cache.set(key, m);
  }
  return m;
}

/** The tile under one beast: a child of its puppet's group, held on the floor and facing the same way whatever the beast does. */
export class Tile {
  readonly mesh: THREE.Mesh;
  private readonly size: number;
  constructor(fields: readonly Field[], radius: number, pip: Pip = 0) {
    this.size = radius * 3.4;
    this.mesh = new THREE.Mesh(GEO, material(fields, pip));
    this.mesh.renderOrder = 0;
    this.mesh.scale.set(this.size, 1, this.size);
  }
  /** `over`: there is floor to lie on; `up`: how far the body is above it; `yaw`: the beast's heading, cancelled so the pip stays toward the camera. */
  place(over: boolean, up: number, yaw: number) {
    const m = this.mesh;
    m.visible = over;
    if (!over) return;
    TIME.value = (performance.now() / 1000) % 600;
    const k = Math.max(0.5, 1 - up / 5) * this.size;
    m.scale.set(k, 1, k);
    m.position.y = 0.03 - up;
    m.rotation.y = yaw;
  }
}
