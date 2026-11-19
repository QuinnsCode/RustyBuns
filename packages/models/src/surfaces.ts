// The shared material kit (#5021): CC0 photo textures from ambientCG (textures/CREDITS.md) for the surfaces real
// gear is made of, so the apps stop painting gear materials in code. Each surface is a colour, normal and roughness
// map at 512 px (the grille's holes are an alpha map), 1.8 MB for the nine. `low` quality loads none of them and
// gives the same surfaces in flat colour, so a slow phone pays nothing.
//
//   const { look, ready } = gearSurfaces({ base: "/textures/" });   // the textures/ folder, served at `base`
//   gear("sub-18", { look });
//   surface("carpet", { base })                                      // one surface on its own (a studio prop, a cable)
//
// Textures tile by metres: the gear's UVs are in metres across each face (gear.ts), and `tile` below is how many
// metres one copy of a map covers. Meshes from elsewhere need UVs in metres too, or a `repeat` of their own.
import * as THREE from "three";
import { type GearLook, gearLook } from "./gear.ts";

type Spec = {
  /** Metres one copy of the map covers. */
  tile: number;
  /** Multiplies the colour map (or is the colour, at `low`). */
  tint: number;
  roughness: number;
  metalness: number;
  /** Which maps the folder has besides normal and roughness. */
  color?: boolean;
  alpha?: boolean;
  normalScale?: number;
  /** How solid an alpha map's holes are. */
  backing?: number;
  /** How the surface wears (see `Wear`). */
  wear?: Wear;
};

/** Use, drawn in the shader with no extra textures: `chip` is the colour where the finish has rubbed through on an
 * edge (found from how fast the surface curves on screen, so every rounded edge of any mesh gets it), `metal` how
 * metallic that is (bare steel under paint), `stipple` a fine second layer of the normal map at a sixth of its tile
 * (the pebbled coat a moulded box or a powder-coated panel has), `scuff` the strength of the dull and polished patches
 * and the fine sideways scratches gear gets from sliding into trucks, `matte` the least roughness the coat ever has. */
export type Wear = { chip: number; metal?: number; stipple?: number; scuff?: number; matte?: number };

/** Each surface's folder under textures/ and how it is laid on. */
export const SURFACES = {
  /** Perforated steel speaker grille: round holes on a 3 mm pitch, an alpha map, so the cone shows through, faintly:
   * `backing` is the dark foam behind the holes (0 clear, 1 solid). */
  grille: { tile: 0.05, tint: 0x3a3d41, roughness: 0.7, metalness: 0.3, alpha: true, normalScale: 0.6, backing: 0.72, wear: { chip: 0x6c7076, scuff: 0.7, matte: 0.5 } },
  /** Woven grille cloth (a guitar cab's front). */
  cloth: { tile: 0.12, tint: 0x8a8070, roughness: 1, metalness: 0, color: true },
  /** Tolex: black textured vinyl over a guitar amp's ply. */
  tolex: { tile: 0.25, tint: 0xffffff, roughness: 0.9, metalness: 0, color: true, normalScale: 1.4, wear: { chip: 0x3b3733, scuff: 0.6 } },
  /** Cabinet carpet, dark grey (a sub's or a cab's covering). */
  carpet: { tile: 0.3, tint: 0x4a4a4c, roughness: 1, metalness: 0, color: true },
  rubber: { tile: 0.2, tint: 0x9a9a9a, roughness: 1, metalness: 0, color: true },
  /** Brushed aluminium: stand poles, handles, a heat sink. */
  aluminium: { tile: 0.4, tint: 0xd8dadd, roughness: 1, metalness: 1, color: true, normalScale: 0.4 },
  /** Painted steel: a panel, a rack's ears (the map gives the roughness and dents, `tint` the paint). */
  steel: { tile: 0.5, tint: 0x2e3034, roughness: 0.75, metalness: 0.45, normalScale: 0.5, wear: { chip: 0xb4b6ba, metal: 1, stipple: 0.5, scuff: 0.8 } },
  /** Birch ply, its face grain. */
  ply: { tile: 0.6, tint: 0xffffff, roughness: 0.9, metalness: 0, color: true },
  /** Textured black plastic or polyurea: a moulded PA box, a cable's jacket. */
  plastic: { tile: 0.35, tint: 0x8e8e8e, roughness: 1, metalness: 0, color: true, normalScale: 1.2, wear: { chip: 0x6a6866, stipple: 1.1, scuff: 1, matte: 0.72 } },
} as const satisfies Record<string, Spec>;
export type SurfaceName = keyof typeof SURFACES;
export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];

export type SurfaceOptions = {
  /** Where the textures/ folder is served, ending in "/". */
  base: string;
  /** `low` loads no textures: flat colours only. */
  quality?: "low" | "high";
  /** A loader to share (its manager sees every map). */
  loader?: THREE.TextureLoader;
};

/** The texture files a surface loads, relative to `base` (for a service worker's or a bundler's list). */
export function surfaceFiles(name: SurfaceName): string[] {
  const s: Spec = SURFACES[name];
  return [s.color && "color", "normal", "rough", s.alpha && "alpha"].filter(Boolean).map((m) => `${name}/${m}.jpg`);
}

/** One surface as a material, and a promise that settles once its maps have loaded (at once for `low`). */
export function surface(name: SurfaceName, { base, quality = "high", loader = new THREE.TextureLoader() }: SurfaceOptions): { material: THREE.MeshStandardMaterial; ready: Promise<void> } {
  const s: Spec = SURFACES[name];
  const material = new THREE.MeshStandardMaterial({ color: s.tint, roughness: quality === "low" ? Math.min(s.roughness, 0.85) : s.roughness, metalness: s.metalness });
  material.name = `surface-${name}`;
  if (quality === "low") return { material, ready: Promise.resolve() };
  const load = (map: string, srgb: boolean) => new Promise<THREE.Texture>((ok, no) => {
    loader.load(`${base}${name}/${map}.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / s.tile, 1 / s.tile);
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      ok(t);
    }, undefined, () => no(new Error(`surface ${name}: no ${map} map at ${base}`)));
  });
  const ready = Promise.all([
    s.color ? load("color", true).then((t) => void (material.map = t)) : undefined,
    load("normal", false).then((t) => { material.normalMap = t; material.normalScale.setScalar(s.normalScale ?? 1); }),
    load("rough", false).then((t) => void (material.roughnessMap = t)),
    s.alpha ? load("alpha", false).then((t) => see(material, t)) : undefined,
  ]).then(() => void (material.needsUpdate = true));
  patch(material, s.alpha ? s.backing ?? 0 : 0, s.wear);
  return { material, ready };
}

/** Lays an alpha map of holes on, blended rather than cut: a cut (alpha test) turns 3 mm holes into crawling noise
 * a few metres off, where a blend fades them into an even see-through sheet as the mips shrink. `backing` fills the
 * holes partly, so what is behind (a speaker's cone) shows dark and faint, as through foam. */
function see(material: THREE.MeshStandardMaterial, map: THREE.Texture) {
  map.anisotropy = 8;
  material.alphaMap = map;
  material.transparent = true;
  material.depthWrite = true;
}

const glsl = (n: number) => n.toFixed(4);
const rgb = (hex: number) => { const c = new THREE.Color(hex); return `vec3(${glsl(c.r)}, ${glsl(c.g)}, ${glsl(c.b)})`; };

/** Value noise in the piece's own space (metres), and a three-octave sum of it. */
const NOISE = `
varying vec3 vWearPos;
float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wFbm(vec3 p) { return 0.5 * wNoise(p) + 0.3 * wNoise(p * 2.03 + 7.1) + 0.2 * wNoise(p * 4.1 + 3.3); }
`;

/** `src` with `at` swapped for `by`; throws if `at` is gone (a three.js update renamed a chunk), so a surface never
 * loses its wear without a word. */
function put(src: string, at: string, by: string): string {
  if (!src.includes(at)) throw new Error(`surfaces: no "${at}" in three's shader to hook`);
  return src.replace(at, by);
}

type Shader = { vertexShader: string; fragmentShader: string };

/** A standard material's shader (`THREE.ShaderLib.physical`, or what `onBeforeCompile` hands over) with an alpha
 * map's `backing` and the surface's `wear` written in. */
export function wornShader(shader: Shader, backing: number, wear?: Wear): Shader {
  let { vertexShader: v, fragmentShader: f } = shader;
  if (backing) f = put(f, "#include <alphamap_fragment>", `#ifdef USE_ALPHAMAP
  diffuseColor.a *= mix(${glsl(backing)}, 1.0, texture2D(alphaMap, vAlphaMapUv).g);
#endif`);
  if (wear) {
    const { chip, metal, stipple = 0, scuff = 0, matte = 0 } = wear;
    v = put(put(v, "#include <common>", "#include <common>\nvarying vec3 vWearPos;"), "#include <begin_vertex>", "#include <begin_vertex>\nvWearPos = transformed;");
    f = put(f, "#include <common>", `#include <common>${NOISE}`);
    // The edge: how fast the normal turns per metre on screen (1 / the round's radius), from 7 cm rounds (none) to
    // under 2 cm (full): a faint rub all along it and chips through to `chip`, worse near the floor, where gear gets
    // kicked and dragged. The scratches fade out once a pixel covers more than a few millimetres, so they never
    // crawl at room distance.
    f = put(f, "#include <map_fragment>", `#include <map_fragment>
  float wPx = length(fwidth(vViewPosition));
  float wCurv = length(fwidth(normalize(vNormal))) / max(wPx, 1e-6);
  float wLow = mix(1.35, 0.85, smoothstep(0.02, 0.35, vWearPos.y));
  float wEdge = smoothstep(14.0, 60.0, wCurv) * wLow;
  float wChip = clamp(wEdge * (0.18 + smoothstep(0.6, 0.72, wFbm(vWearPos * 140.0))), 0.0, 1.0);
  float wNear = 1.0 - smoothstep(0.0015, 0.005, wPx);
  float wPatch = (wFbm(vWearPos * 6.0) - 0.5) * ${glsl(scuff)};
  float wSmear = smoothstep(0.62, 0.8, wFbm(vWearPos * vec3(9.0, 22.0, 9.0) + 4.0)) * ${glsl(scuff)};
  // scratches: fine sideways lines, cut into short runs, a few per patch
  float wScratch = smoothstep(0.86, 0.93, wNoise(vWearPos * vec3(7.0, 320.0, 7.0) + wNoise(vWearPos * 40.0) * 2.0))
  * smoothstep(0.58, 0.72, wNoise(vWearPos * vec3(30.0, 60.0, 30.0) + 11.0)) * wNear * ${glsl(scuff)};
  diffuseColor.rgb *= 1.0 + wPatch * 0.25;
  diffuseColor.rgb = mix(diffuseColor.rgb, ${rgb(chip)}, clamp(wChip + wScratch * 0.2 + wSmear * 0.06, 0.0, 1.0));`);
    f = put(f, "#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
  roughnessFactor = clamp(max(roughnessFactor, ${glsl(matte)}) * (1.0 + wPatch * 0.35) - wChip * 0.25 - wScratch * 0.15, 0.08, 1.0);`);
    if (metal !== undefined) f = put(f, "#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, ${glsl(metal)}, wChip);`);
    if (stipple) f = put(f, "#include <normal_fragment_maps>", put(THREE.ShaderChunk.normal_fragment_maps, "mapN.xy *= normalScale;", `mapN.xy *= normalScale;
  mapN.xy += (texture2D(normalMap, vNormalMapUv * 6.0 + 0.37).xy * 2.0 - 1.0) * ${glsl(stipple)} * normalScale;`));
  }
  return { vertexShader: v, fragmentShader: f };
}

/** The shader changes a surface asks for, in one `onBeforeCompile`. */
function patch(material: THREE.MeshStandardMaterial, backing: number, wear?: Wear) {
  if (!backing && !wear) return;
  material.onBeforeCompile = (shader) => void Object.assign(shader, wornShader(shader, backing, wear));
  material.customProgramCacheKey = () => `surface-${backing}-${JSON.stringify(wear ?? null)}`;
}

/** The gear's look made of the kit: cabinets in textured plastic, perforated steel grilles, brushed aluminium,
 * painted steel panels, rubber and tolex; the rest (the guitar's paint, chrome, knobs, LEDs) as `gearLook()` has them. */
export function gearSurfaces(opts: SurfaceOptions): { look: GearLook; ready: Promise<void> } {
  const flat = gearLook(), loader = opts.loader ?? new THREE.TextureLoader();
  const pick = (name: SurfaceName) => surface(name, { ...opts, loader });
  const parts = { paint: pick("plastic"), grille: pick("grille"), metal: pick("aluminium"), rubber: pick("rubber"), panel: pick("steel"), tolex: pick("tolex") };
  const lid = parts.paint.material.clone();
  lid.color.setHex(0xf2c230);
  lid.map = null;
  const lidReady = parts.paint.ready.then(() => { lid.normalMap = parts.paint.material.normalMap; lid.roughnessMap = parts.paint.material.roughnessMap; lid.needsUpdate = true; });
  const look: GearLook = { ...flat, paint: parts.paint.material, grille: parts.grille.material, metal: parts.metal.material, rubber: parts.rubber.material, panel: parts.panel.material, tolex: parts.tolex.material, lid };
  return { look, ready: Promise.all([...Object.values(parts).map((p) => p.ready), lidReady]).then(() => {}) };
}
