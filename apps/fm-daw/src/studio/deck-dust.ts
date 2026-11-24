// Clean prints: the DJ table's gear has sat out in the sand a long while. A film of dust lies over each deck and the
// mixer, thicker in the corners, round the jog's rim and the round keys' wells, thinner where something once dragged
// across it, and a hand wipes it away where it touches: a few soft blobs per press, and they stay wiped. A well-played
// deck shows clean, slightly polished finger tracks over its play, cue and jog while the rest stays dusty.
// It's a texture, not geometry: a small grid over the gear's top (red: the dust now, green: the dust it started with),
// read by every material on that gear through a shader patch that looks the fragment up in the gear's own frame.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

/** Texels across and along the gear's top: about 2.5 mm each on a deck. */
const W = 128, H = 160;
/** The dust's colour: pale, warm, sun-baked sand. */
const SAND = new THREE.Color("#a8987c");

/** Where something on the gear's top dents the dust: crevices where grime gathers (x, z, radius in metres). */
export type Rim = [number, number, number];

export class DustMask {
  readonly data = new Uint8Array(W * H * 4);
  readonly tex = new THREE.DataTexture(this.data, W, H, THREE.RGBAFormat);
  /** The gear's top, in its own frame: x from x0 across w, z from z0 along d. */
  readonly rect: THREE.Vector4;
  private start = 0;
  private now = 0;
  private rand: () => number;

  constructor(w: number, d: number, seed: number, rims: readonly Rim[] = []) {
    this.rect = new THREE.Vector4(-w / 2 - 0.005, -d / 2 - 0.005, w + 0.01, d + 0.01);
    this.rand = mulberry32(seed);
    const coarse = noise(this.rand, 15, 19), fine = noise(this.rand, 33, 41);
    // a few scuffs: thin straight drags where something slid over the top and took the dust with it
    const scuffs = Array.from({ length: 5 }, () => ({ x: this.rand() * w - w / 2, z: this.rand() * d - d / 2, a: this.rand() * Math.PI, l: 0.03 + this.rand() * 0.07 }));
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, v = (j + 0.5) / H, x = this.rect.x + u * this.rect.z, z = this.rect.y + v * this.rect.w;
      let dust = 0.4 + 0.34 * sample(coarse, u, v, 15, 19) + 0.14 * sample(fine, u, v, 33, 41);
      // grime packs into the corners and along the edges
      const edge = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
      dust += 0.5 * Math.exp(-Math.max(0, edge) / 0.012);
      for (const [rx, rz, r] of rims) dust += 0.3 * Math.exp(-Math.abs(Math.hypot(x - rx, z - rz) - r) / 0.0035);
      for (const s of scuffs) {
        const dx = x - s.x, dz = z - s.z, along = dx * Math.cos(s.a) + dz * Math.sin(s.a), across = -dx * Math.sin(s.a) + dz * Math.cos(s.a);
        if (Math.abs(along) < s.l) dust *= 1 - 0.45 * Math.exp(-(across * across) / 0.000004);
      }
      const b = Math.round(Math.min(1, Math.max(0, dust)) * 255), k = (j * W + i) * 4;
      this.data[k] = b; this.data[k + 1] = b; this.data[k + 3] = 255;
      this.start += b;
    }
    this.now = this.start;
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
  }

  /** How clean the gear is: 0 as found, 1 wiped bare. */
  get clean() { return this.start ? 1 - this.now / this.start : 0; }

  /** A hand touches the gear's top at (x, z) in its own frame: `n` soft fingertip blobs about `r` metres round it. */
  wipe(x: number, z: number, n = 3, r = 0.008) {
    for (let b = 0; b < n; b++) {
      const bx = x + (this.rand() - 0.5) * r, bz = z + (this.rand() - 0.5) * r, br = r * (0.7 + this.rand() * 0.5);
      const ci = ((bx - this.rect.x) / this.rect.z) * W - 0.5, cj = ((bz - this.rect.y) / this.rect.w) * H - 0.5;
      const ri = (br / this.rect.z) * W, rj = (br / this.rect.w) * H;
      for (let j = Math.max(0, Math.floor(cj - rj)); j <= Math.min(H - 1, Math.ceil(cj + rj)); j++) {
        for (let i = Math.max(0, Math.floor(ci - ri)); i <= Math.min(W - 1, Math.ceil(ci + ri)); i++) {
          const q = Math.hypot((i - ci) / ri, (j - cj) / rj);
          if (q >= 1) continue;
          const k = (j * W + i) * 4, was = this.data[k]!, fall = 1 - q * q;
          const left = Math.round(was * (1 - 0.6 * fall * fall));
          this.data[k] = left; this.now -= was - left;
        }
      }
    }
    this.tex.needsUpdate = true;
  }
}

/** A seeded grid of values 0..1, `nx` by `nz`, to sample smoothly. */
function noise(rand: () => number, nx: number, nz: number): Float32Array {
  const g = new Float32Array(nx * nz);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return g;
}
function sample(g: Float32Array, u: number, v: number, nx: number, nz: number): number {
  const x = u * (nx - 1), z = v * (nz - 1), i = Math.min(nx - 2, Math.floor(x)), j = Math.min(nz - 2, Math.floor(z));
  const fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = g[j * nx + i]!, b = g[j * nx + i + 1]!, c = g[(j + 1) * nx + i]!, d = g[(j + 1) * nx + i + 1]!;
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz - 0.5;
}

/** What one gear's materials read: its dust, its top's rectangle and the world into its own frame. */
export interface DustUniforms { dustMap: { value: THREE.Texture }; dustRect: { value: THREE.Vector4 }; dustInv: { value: THREE.Matrix4 }; dustColor: { value: THREE.Color }; dustAmount: { value: number } }
export function dustUniforms(mask: DustMask): DustUniforms {
  return { dustMap: { value: mask.tex }, dustRect: { value: mask.rect }, dustInv: { value: new THREE.Matrix4() }, dustColor: { value: SAND }, dustAmount: { value: 0.45 } };
}

/**
 * A copy of `m` dusted by `u`: the colour goes toward sand by how much dust lies there (most on faces looking up,
 * a little down the sides), the dust is matt (roughness up, metal down), and where a hand has wiped it the plastic
 * comes up a little polished. A lamp or a screen under dust shows dimmer and hazier.
 */
export function dusted<M extends THREE.Material>(m: M, u: DustUniforms, amount = 1): M {
  // a clone drops the source's own shader hook (the gear kit's wear and grilles): run it first, then lay the dust on
  const c = m.clone(), own = m.onBeforeCompile.bind(m);
  c.onBeforeCompile = (s, r) => {
    own(s, r);
    Object.assign(s.uniforms, u, { dustScale: { value: amount } });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 dustInv;\nvarying vec3 vDustP;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 dustAt = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dustAt = instanceMatrix * dustAt;
        #endif
        vDustP = (dustInv * modelMatrix * dustAt).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D dustMap; uniform vec4 dustRect; uniform vec3 dustColor; uniform float dustAmount; uniform float dustScale;\nvarying vec3 vDustP;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec2 dustUv = (vDustP.xz - dustRect.xy) / dustRect.zw;
        vec4 dustTx = texture2D(dustMap, clamp(dustUv, 0.0, 1.0));
        vec3 dustN = normalize(cross(dFdx(vDustP), dFdy(vDustP)));
        float dustK = pow(dustTx.r, 1.7) * mix(0.2, 1.0, smoothstep(0.55, 0.95, abs(dustN.y))) * dustAmount * dustScale;
        float dustPolish = max(0.0, dustTx.g - dustTx.r);
        diffuseColor.rgb = mix(diffuseColor.rgb, dustColor, dustK);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor * (1.0 - 0.4 * dustPolish), 1.0, dustK);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - 0.8 * dustK;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - 0.6 * dustK;");
  };
  c.customProgramCacheKey = () => `deck-dust|${m.customProgramCacheKey()}`;
  return c;
}

/**
 * Dust every material on `group` (each a copy of its own, so the next gear's dust is its own), the screen excepted
 * when it's passed. A lamp's basic material takes half as much, so a lit rim still shows through.
 */
export function dustGear(group: THREE.Object3D, u: DustUniforms, except: THREE.Material | null = null) {
  const done = new Map<THREE.Material, THREE.Material>();
  const one = (m: THREE.Material) => {
    if (m === except) return m;
    let c = done.get(m);
    if (!c) done.set(m, (c = dusted(m, u, m instanceof THREE.MeshBasicMaterial ? 0.5 : 1)));
    return c;
  };
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
}
