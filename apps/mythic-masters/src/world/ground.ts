// The ground's texture layers (blender/ground.py bakes them; public/ground-tex/<layer>.jpg is a detail map and
// <layer>.n.jpg its normal map). A ground vertex says how much of each layer it is (`groundWeights`), as two
// 4-weight attributes; the fragment shader (`groundLook`) lays each layer's texture over the vertex colour, which stays
// the biome's palette. The layers are two texture arrays, so the whole ground costs two samplers.
import * as THREE from "three";
import type { Biome } from "../regions.ts";

export const LAYERS = ["needles", "leaves", "turf", "dirt", "mud", "sand", "rock", "snow"] as const;
export type Layer = (typeof LAYERS)[number];
const L = Object.fromEntries(LAYERS.map((n, i) => [n, i])) as Record<Layer, number>;
export const LAYER_COUNT = LAYERS.length;

/** What the bare ground of each biome is made of, before grass, sand, mud, trails, rock and snow are laid over it. */
const BASE: Record<Biome, Partial<Record<Layer, number>>> = {
  "pine-barrens": { needles: 0.55, sand: 0.25, dirt: 0.2 }, forest: { leaves: 0.5, needles: 0.2, dirt: 0.3 }, rainforest: { leaves: 0.6, mud: 0.2, dirt: 0.2 },
  lake: { dirt: 0.4, sand: 0.2, turf: 0.4 }, desert: { sand: 0.75, dirt: 0.15, rock: 0.1 }, swamp: { mud: 0.6, leaves: 0.2, dirt: 0.2 },
  plains: { dirt: 0.4, turf: 0.6 }, highlands: { turf: 0.4, rock: 0.2, dirt: 0.4 }, jungle: { leaves: 0.5, mud: 0.25, dirt: 0.25 },
  island: { sand: 0.6, dirt: 0.2, turf: 0.2 }, mountains: { rock: 0.5, dirt: 0.3, needles: 0.2 }, river: { dirt: 0.4, turf: 0.3, mud: 0.3 },
  coast: { sand: 0.4, dirt: 0.3, turf: 0.3 }, savanna: { dirt: 0.6, turf: 0.2, sand: 0.2 }, tundra: { dirt: 0.4, rock: 0.3, turf: 0.3 },
  steppe: { dirt: 0.5, turf: 0.5 },
};

export const GROUND_BIOMES = Object.keys(BASE) as Biome[];

/** How much of each thing lies over the biome's ground at a vertex, each 0 to 1 (buildPatch's colour lerps, the same amounts). */
export interface Cover { grass: number; sand: number; mud: number; path: number; rock: number; snow: number }

/** Writes the eight layer weights (they sum to 1) for a vertex into out[o..o+8]: the biome's own mix, then each cover moving
 * that share of everything beneath it over to its layer, in the order the colour is laid. */
export function groundWeights(biome: Biome | undefined, c: Cover, out: ArrayLike<number> & { [i: number]: number }, o = 0) {
  const base = BASE[biome ?? "steppe"];
  for (let i = 0; i < LAYER_COUNT; i++) out[o + i] = base[LAYERS[i]!] ?? 0;
  const over = (layer: Layer, a: number) => {
    const t = a < 0 ? 0 : a > 1 ? 1 : a;
    for (let i = 0; i < LAYER_COUNT; i++) out[o + i] = out[o + i]! * (1 - t);
    out[o + L[layer]] = out[o + L[layer]]! + t;
  };
  over("turf", c.grass); over("sand", c.sand); over("mud", c.mud); over("dirt", c.path); over("rock", c.rock); over("snow", c.snow);
}

const SIZE = 512, NSIZE = 256;
const base = (name: string, ext: string) => `/ground-tex/${name}${ext}`;

export interface GroundTextures { albedo: THREE.DataArrayTexture; normal: THREE.DataArrayTexture }

/** The two arrays, level and neutral at once (the tint alone, no relief) and filled in as each layer's picture arrives. */
export function loadGround(): GroundTextures {
  const make = (size: number, grey: [number, number, number, number], srgb: boolean) => {
    const data = new Uint8Array(size * size * 4 * LAYER_COUNT);
    for (let i = 0; i < data.length; i += 4) { data[i] = grey[0]; data[i + 1] = grey[1]; data[i + 2] = grey[2]; data[i + 3] = grey[3]; }
    const t = new THREE.DataArrayTexture(data, size, size, LAYER_COUNT);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const albedo = make(SIZE, [188, 188, 188, 255], true), normal = make(NSIZE, [128, 128, 128, 255], false);
  const fill = async (tex: THREE.DataArrayTexture, size: number, i: number, url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const cv = new OffscreenCanvas(size, size), cx = cv.getContext("2d", { willReadFrequently: true })!;
      cx.drawImage(bmp, 0, 0, size, size);
      (tex.image.data as Uint8Array).set(cx.getImageData(0, 0, size, size).data, i * size * size * 4);
      tex.needsUpdate = true;
    } catch { /* a layer that fails to load stays the plain tint */ }
  };
  LAYERS.forEach((n, i) => { void fill(albedo, SIZE, i, base(n, ".jpg")); void fill(normal, NSIZE, i, base(n, ".n.jpg")); });
  return { albedo, normal };
}

/** The layer attributes' names on a ground geometry: two vec4 of weights. */
export const WEIGHT_ATTRS = ["gw0", "gw1"] as const;

const GLSL_VERT_DECL = `attribute vec4 gw0;\nattribute vec4 gw1;\nvarying vec4 vGw0;\nvarying vec4 vGw1;\nvarying vec3 vGp;\nvarying vec3 vGn;`;
const GLSL_FRAG_DECL = `
uniform sampler2DArray uGAlb;
uniform sampler2DArray uGNrm;
varying vec4 vGw0;
varying vec4 vGw1;
varying vec3 vGp;
varying vec3 vGn;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}
// one layer's detail at a point: the texture at a 2 m tile times the same texture bigger and turned, so the repeat does not show
vec3 gLayer(float i, vec2 uv, vec2 uv2, vec4 d, vec4 d2, float near) {
  vec3 a = textureGrad(uGAlb, vec3(uv, i), d.xy, d.zw).rgb * 2.0;
  if (near <= 0.0) return a;
  vec3 b = textureGrad(uGAlb, vec3(uv2, i), d2.xy, d2.zw).rgb * 2.0;
  return a * mix(vec3(1.0), b, 0.5);
}
`;
/** The fragment's detail colour (multiplies the vertex colour) and, in gNormal, the way the texture leans the surface. */
const GLSL_FRAG_MAIN = `
  vec3 gDetail = vec3(0.0);
  vec2 gNormal = vec2(0.0);
  {
    float gDist = length(vViewPosition);
    float gNear = 1.0 - smoothstep(30.0, 150.0, gDist);       // relief fades out with distance, grain a good deal later
    float gGrain = 1.0 - smoothstep(90.0, 420.0, gDist);
    vec2 uv = vGp.xz * 0.3125;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    vec2 uv2 = turn * vGp.xz * 0.077;
    vec4 d = vec4(dFdx(uv), dFdy(uv)), d2 = vec4(dFdx(uv2), dFdy(uv2));
    float w[8];
    w[0] = vGw0.x; w[1] = vGw0.y; w[2] = vGw0.z; w[3] = vGw0.w; w[4] = vGw1.x; w[5] = vGw1.y; w[6] = vGw1.z; w[7] = vGw1.w;
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (w[i] < 0.02) continue;
      total += w[i];
      vec3 c = gLayer(float(i), uv, uv2, d, d2, gNear);
      if (i == 6) {
        // rock leans into cliffs: the other two faces of the cube, by the slope
        vec3 n = abs(normalize(vGn)); float side = smoothstep(0.55, 0.85, 1.0 - n.y);
        if (side > 0.01) {
          vec2 ux = vGp.zy * 0.5, uz = vGp.xy * 0.5;
          vec3 cx = textureGrad(uGAlb, vec3(ux, 6.0), dFdx(ux), dFdy(ux)).rgb * 2.0, cz = textureGrad(uGAlb, vec3(uz, 6.0), dFdx(uz), dFdy(uz)).rgb * 2.0;
          c = mix(c, (cx * n.x + cz * n.z) / max(n.x + n.z, 0.001), side);
        }
      }
      gDetail += w[i] * c;
      if (gNear > 0.0) gNormal += w[i] * (textureGrad(uGNrm, vec3(uv, float(i)), d.xy, d.zw).rg * 2.0 - 1.0);
    }
    gDetail = total > 0.0 ? gDetail / total : vec3(1.0);
    gNormal = total > 0.0 ? gNormal / total * gNear : vec2(0.0);
    gDetail = mix(vec3(1.0), max(vec3(1.0) + (gDetail - 1.0) * 2.1, 0.15), gGrain);
    // big soft patches over the lot, so no two hectares match: lighter and darker, a touch warmer and cooler
    float m = gNoise(vGp.xz * 0.031) * 0.55 + gNoise(vGp.xz * 0.0071 + 7.0) * 0.45;
    gDetail *= vec3(1.0 + (m - 0.5) * 0.36, 1.0 + (m - 0.5) * 0.30, 1.0 + (m - 0.5) * 0.2);
  }
`;

/** Dresses a ground material: its fragments take the layers' detail and their normal, the vertices carrying the weights.
 * `key` names the program this makes (three caches programs by the hook's text, which is the same for every hole radius). */
export function groundLook(mat: THREE.MeshStandardMaterial, tex: GroundTextures, hole?: { centre: { value: THREE.Vector2 }; r: number }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGAlb = { value: tex.albedo }; sh.uniforms.uGNrm = { value: tex.normal };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${GLSL_VERT_DECL}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGw0 = gw0; vGw1 = gw1; vGp = position; vGn = normal;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${GLSL_FRAG_DECL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${GLSL_FRAG_MAIN}\n  diffuseColor.rgb *= gDetail;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  {
    vec3 gT = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz), gB = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    gT = normalize(gT - normal * dot(gT, normal)); gB = normalize(gB - normal * dot(gB, normal));
    normal = normalize(normal + (gT * gNormal.x + gB * gNormal.y) * ${NORMAL_STRENGTH});
  }`);
    if (hole) {
      sh.uniforms.uHole = hole.centre;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = position.xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;\nuniform vec2 uHole;")
        .replace("void main() {", `void main() {\n  if (distance(vGround, uHole) < ${hole.r.toFixed(1)}) discard;`);
    }
  };
  mat.side = THREE.DoubleSide; // the skirts under a tile's edge hide the cracks between detail levels
  mat.customProgramCacheKey = () => `ground${hole ? `-hole${hole.r.toFixed(1)}` : ""}`;
}
const NORMAL_STRENGTH = "1.7";
