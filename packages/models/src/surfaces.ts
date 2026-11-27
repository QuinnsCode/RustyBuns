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
import { type GearLook, gearLook, RAMP } from "./gear.ts";

type Spec = {
  /** Metres one copy of the map covers. */
  tile: number;
  /** Multiplies the colour map (or is the colour, at `low`). */
  tint: number;
  roughness: number;
  metalness: number;
  /** The folder under textures/ when it is another surface's (the same photo, laid on another way). */
  dir?: string;
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
 * edge (found from how fast the surface curves on screen, so every rounded edge of any mesh gets it, in patches, as a
 * box wears where it is carried and set down), `metal` how metallic that is (bare steel under paint), `stipple` the
 * height of the pebbled coat a moulded box or a powder-coated panel has (a bump and a speckle from noise, 2 mm grains
 * over 6 mm ones, the same on every face, faded out as the grains shrink under a pixel), `scuff` the strength of the
 * dull and polished patches and the fine sideways scratches gear gets from sliding into trucks, `matte` the least
 * roughness the coat ever has, `speck` the strength of a sprayed polyurea coat's granules: raised grains about a
 * millimetre across, some paler and some darker than the coat, seen only up close (gone once a pixel covers one),
 * `fleck` how far those granules' colour stands off the coat (1, the default, for a black shell's salt-and-pepper;
 * a painted panel's grains are near its own colour, and its 2.5 mm clumps fade faster than its grains). */
export type Wear = { chip: number; metal?: number; stipple?: number; scuff?: number; matte?: number; speck?: number; fleck?: number };

/** Each surface's folder under textures/ and how it is laid on. */
export const SURFACES = {
  /** Perforated steel speaker grille: round holes on a 3 mm pitch, an alpha map, so the cone shows through, faintly:
   * `backing` is the dark foam behind the holes (0 clear, 1 solid). */
  grille: { tile: 0.05, tint: 0x3a3d41, roughness: 0.55, metalness: 0.45, alpha: true, normalScale: 0.6, backing: 0.4, wear: { chip: 0x6c7076, scuff: 0.5, matte: 0.42 } },
  /** A hung line array box's grille: the same perforated steel in a matte dark grey, backed nearly solid, so its hole
   * grid shows darker than the steel but the drivers behind it stay out of sight, as through a real box's foam-lined
   * grille, with a little steel sheen at a low light. */
  mesh: { dir: "grille", tile: 0.05, tint: 0x2c2e32, roughness: 0.6, metalness: 0.45, alpha: true, normalScale: 0.7, backing: 0.88, wear: { chip: 0x45484d, scuff: 0.2, matte: 0.42 } },
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
  plastic: { tile: 0.35, tint: 0x8e8e8e, roughness: 1, metalness: 0, color: true, normalScale: 0.5, wear: { chip: 0x6a6866, stipple: 1.0, scuff: 1, matte: 0.6 } },
  /** A line array box's shell: matte dark-grey sprayed polyurea, an even pebble with millimetre granules in it, worn at the edges (no blotches, no gloss on the top). */
  coat: { dir: "plastic", tile: 0.35, tint: 0x8c8c8c, roughness: 1, metalness: 0, color: true, normalScale: 0.45, wear: { chip: 0x6a6866, stipple: 1.4, scuff: 0.45, matte: 0.82, speck: 1 } },
  /** A line array box's side cheeks: an olive-grey pebble-coat panel (flat colour, no photo map), set off against the black shell. */
  cheek: { dir: "plastic", tile: 0.35, tint: 0x3a3c33, roughness: 0.92, metalness: 0, normalScale: 0.8, wear: { chip: 0x9a988c, stipple: 1.4, scuff: 0.3, matte: 0.75, speck: 1, fleck: 0.5 } },
  /** A dance-stack horn's lining: near-white painted fibreglass with a soft sheen (as the Res2 photo shows it) (flat colour, the plastic's fine relief),
   * greyed where hands and road dust have rubbed it, scuffed where the boxes are stacked. */
  horn: { dir: "plastic", tile: 0.35, tint: 0x6c7176, roughness: 0.42, metalness: 0, normalScale: 0.22, wear: { chip: 0x7d786d, stipple: 0.35, scuff: 0.7, matte: 0.45 } },
  /** The same lining deep in a horn's throat, where no rag reaches: greyed and browned with road dust, matte. */
  grime: { dir: "plastic", tile: 0.35, tint: 0x403f37, roughness: 0.9, metalness: 0, normalScale: 0.3, wear: { chip: 0x3e3b33, stipple: 0.8, scuff: 0.4, matte: 0.7, speck: 1 } },
  /** A dance stack's cabinets: a deep red-leaning violet over birch in a coarse textured coat (the strong pebble a
   * rolled or sprayed cabinet paint has, its grains near the coat's own colour) with a satin sheen, rubbed pale at the edges. */
  violet: { dir: "plastic", tile: 0.35, tint: 0x160a2b, roughness: 0.62, metalness: 0, normalScale: 0.9, wear: { chip: 0x8a7656, stipple: 3, scuff: 0.5, matte: 0.74, speck: 1, fleck: 0.8 } },
  /** The Res2 top's own coat: a smooth near-black navy with a satin sheen (as its photo shows it), a fine even
   * texture with no granules, so soft highlights roll along its rounded edges and top, rubbed paler at the edges. */
  satin: { dir: "plastic", tile: 0.35, tint: 0x15142a, roughness: 0.32, metalness: 0, normalScale: 0.45, wear: { chip: 0x2c2a44, stipple: 1.0, scuff: 0.45, matte: 0.28 } },
  /** The tri-amp rig's cabinets: TurboBlue, a near-black blue semi-matt textured paint over birch, worn at the edges. */
  turbo: { dir: "plastic", tile: 0.35, tint: 0x0e1422, roughness: 0.82, metalness: 0, normalScale: 0.45, wear: { chip: 0x8a7656, stipple: 0.9, scuff: 0.8, matte: 0.65 } },
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
  return [s.color && "color", "normal", "rough", s.alpha && "alpha"].filter(Boolean).map((m) => `${s.dir ?? name}/${m}.jpg`);
}

/** One surface as a material, and a promise that settles once its maps have loaded (at once for `low`). */
export function surface(name: SurfaceName, { base, quality = "high", loader = new THREE.TextureLoader() }: SurfaceOptions): { material: THREE.MeshStandardMaterial; ready: Promise<void> } {
  const s: Spec = SURFACES[name];
  const material = new THREE.MeshStandardMaterial({ color: s.tint, roughness: quality === "low" ? Math.min(s.roughness, 0.85) : s.roughness, metalness: s.metalness });
  material.name = `surface-${name}`;
  if (quality === "low") return { material, ready: Promise.resolve() };
  const load = (map: string, srgb: boolean) => new Promise<THREE.Texture>((ok, no) => {
    loader.load(`${base}${s.dir ?? name}/${map}.jpg`, (t) => {
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
// a pebbled coat's height, about -0.5 to 0.5: 2 mm grains (fine) over 6 mm ones (coarse), and a sprayed coat's
// 1 mm granules standing up out of it (grit)
float wGrainAt(vec3 p, float fine, float coarse, float grit) {
  return (wNoise(p * 520.0) - 0.5) * fine + (wNoise(p * 170.0 + 5.0) - 0.5) * 0.6 * coarse + smoothstep(0.55, 0.8, wNoise(p * 1000.0 + 9.0)) * grit;
}
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
    const { chip, metal, stipple = 0, scuff = 0, matte = 0, speck = 0, fleck = 1 } = wear;
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
  float wWorn = smoothstep(0.38, 0.62, wFbm(vWearPos * 7.0 + 2.0));
  float wChip = clamp(wEdge * (0.04 + wWorn * (0.14 + smoothstep(0.5, 0.66, wFbm(vWearPos * 140.0)))), 0.0, 1.0);
  float wNear = 1.0 - smoothstep(0.0015, 0.005, wPx);
  float wPatch = (wFbm(vWearPos * 6.0) - 0.5) * ${glsl(scuff)};
  float wSmear = smoothstep(0.62, 0.8, wFbm(vWearPos * vec3(9.0, 22.0, 9.0) + 4.0)) * ${glsl(scuff)};
  // scratches: fine sideways lines, cut into short runs, a few per patch
  float wScratch = smoothstep(0.9, 0.95, wNoise(vWearPos * vec3(7.0, 320.0, 7.0) + wNoise(vWearPos * 40.0) * 2.0))
  * smoothstep(0.58, 0.72, wNoise(vWearPos * vec3(30.0, 60.0, 30.0) + 11.0)) * wNear * ${glsl(scuff)};
  // the coat's grain: fine grains and coarser ones under them, each gone once it is smaller than a pixel or two
  float wFine = 1.0 - smoothstep(0.0007, 0.0016, wPx), wCoarse = 1.0 - smoothstep(0.002, 0.0045, wPx);
  float wGrit = ${glsl(speck)} * (1.0 - smoothstep(0.0008, 0.002, wPx)), wFleck = ${glsl(speck * fleck * fleck)} * (1.0 - smoothstep(0.0018, 0.0045, wPx));
  float wGrain = wGrainAt(vWearPos, wFine, wCoarse, wGrit);
  // the granules' colour: paler flecks and darker ones in the same coat, a millimetre across up close and, where a
  // pixel covers a millimetre or more (a face seen at a slant, a step back), the clumps of them 2.5 mm across
  float wLite = smoothstep(0.66, 0.76, wNoise(vWearPos * 1000.0 + 21.0)) * wGrit + smoothstep(0.68, 0.8, wNoise(vWearPos * 400.0 + 61.0)) * wFleck * 0.7;
  float wDark = (1.0 - smoothstep(0.22, 0.32, wNoise(vWearPos * 1000.0 + 37.0))) * wGrit + (1.0 - smoothstep(0.2, 0.32, wNoise(vWearPos * 400.0 + 83.0))) * wFleck * 0.7;
  diffuseColor.rgb *= 1.0 + wPatch * 0.1 + wGrain * ${glsl(stipple * 0.3)} - wDark * ${glsl(0.45 * fleck)};
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 2.4 + 0.035, clamp(wLite, 0.0, 1.0) * ${glsl(0.6 * fleck)});
  diffuseColor.rgb = mix(diffuseColor.rgb, ${rgb(chip)}, clamp(wChip + wScratch * 0.07, 0.0, 1.0));`);
    f = put(f, "#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
  roughnessFactor = clamp(max(roughnessFactor, ${glsl(matte)}) * (1.0 + wPatch * 0.2) - wChip * 0.25 - wScratch * 0.15 - wSmear * 0.06, 0.08, 1.0);`);
    if (metal !== undefined) f = put(f, "#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, ${glsl(metal)}, wChip);`);
    // the grain as a bump: the height's step to the next pixel across and down tilts the normal (as three's own bump
    // map does, but sampled at each pixel, so it has none of dFdx's 2 by 2 blocks)
    if (stipple) f = put(f, "#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  {
    float wDx = wGrainAt(vWearPos + dFdx(vWearPos), wFine, wCoarse, wGrit) - wGrain, wDy = wGrainAt(vWearPos + dFdy(vWearPos), wFine, wCoarse, wGrit) - wGrain;
    vec3 wSx = dFdx(vViewPosition), wSy = dFdy(vViewPosition);
    vec3 wR1 = cross(wSy, normal), wR2 = cross(normal, wSx);
    float wDet = dot(wSx, wR1);
    normal = normalize(abs(wDet) * normal - sign(wDet) * ${glsl(stipple * 0.00035)} * (wDx * wR1 + wDy * wR2));
  }`);
  }
  return { vertexShader: v, fragmentShader: f };
}

/** The shader changes a surface asks for, in one `onBeforeCompile`. */
function patch(material: THREE.MeshStandardMaterial, backing: number, wear?: Wear) {
  if (!backing && !wear) return;
  material.onBeforeCompile = (shader) => void Object.assign(shader, wornShader(shader, backing, wear));
  material.customProgramCacheKey = () => `surface-${backing}-${JSON.stringify(wear ?? null)}`;
}

/** The gear's look made of the kit: cabinets in textured plastic (a line array box's in an even coat with paler
 * cheeks, and a black grille backed nearly solid), perforated steel grilles, brushed aluminium,
 * painted steel panels, rubber and tolex, a dance stack's pale horn lining and violet cabinets; the rest (the guitar's paint, chrome, knobs, LEDs) as `gearLook()` has them. */
export function gearSurfaces(opts: SurfaceOptions): { look: GearLook; ready: Promise<void> } {
  const flat = gearLook(), loader = opts.loader ?? new THREE.TextureLoader();
  const pick = (name: SurfaceName) => surface(name, { ...opts, loader });
  const parts = { paint: pick("plastic"), grille: pick("grille"), metal: pick("aluminium"), rubber: pick("rubber"), panel: pick("steel"), tolex: pick("tolex"), mesh: pick("mesh"), coat: pick("coat"), cheek: pick("cheek"), horn: pick("horn"), grime: pick("grime"), violet: pick("violet"), satin: pick("satin"), facet: pick("horn"), shade: pick("violet"), turbo: pick("turbo") };
  // the violet down a horn cell, darkened per vertex toward the throat (gear.ts's `fade`)
  parts.shade.material.vertexColors = true;
  // the Res2's mid horn lining: the same paint a touch glossier, each face stepped light or dark (gear.ts's `facets`)
  parts.facet.material.vertexColors = true;
  parts.facet.material.roughness = 0.4;
  parts.facet.material.aoMap = RAMP;
  const lid = parts.paint.material.clone();
  lid.color.setHex(0xf2c230);
  lid.map = null;
  const lidReady = parts.paint.ready.then(() => { lid.normalMap = parts.paint.material.normalMap; lid.roughnessMap = parts.paint.material.roughnessMap; lid.needsUpdate = true; });
  const look: GearLook = { ...flat, paint: parts.paint.material, grille: parts.grille.material, metal: parts.metal.material, rubber: parts.rubber.material, panel: parts.panel.material, tolex: parts.tolex.material, lid,
    mesh: parts.mesh.material, coat: parts.coat.material, cheek: parts.cheek.material, horn: parts.horn.material, grime: parts.grime.material, violet: parts.violet.material, satin: parts.satin.material, facet: parts.facet.material, shade: parts.shade.material, turbo: parts.turbo.material };
  return { look, ready: Promise.all([...Object.values(parts).map((p) => p.ready), lidReady]).then(() => {}) };
}
