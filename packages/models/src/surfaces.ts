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
};

/** Each surface's folder under textures/ and how it is laid on. */
export const SURFACES = {
  /** Perforated steel speaker grille: round holes on a 3 mm pitch, an alpha map, so the cone shows through. */
  grille: { tile: 0.05, tint: 0x24262a, roughness: 0.5, metalness: 0.7, alpha: true, normalScale: 0.6 },
  /** Woven grille cloth (a guitar cab's front). */
  cloth: { tile: 0.12, tint: 0x8a8070, roughness: 1, metalness: 0, color: true },
  /** Tolex: black textured vinyl over a guitar amp's ply. */
  tolex: { tile: 0.25, tint: 0xffffff, roughness: 0.9, metalness: 0, color: true, normalScale: 1.4 },
  /** Cabinet carpet, dark grey (a sub's or a cab's covering). */
  carpet: { tile: 0.3, tint: 0x4a4a4c, roughness: 1, metalness: 0, color: true },
  rubber: { tile: 0.2, tint: 0x9a9a9a, roughness: 1, metalness: 0, color: true },
  /** Brushed aluminium: stand poles, handles, a heat sink. */
  aluminium: { tile: 0.4, tint: 0xd8dadd, roughness: 1, metalness: 1, color: true, normalScale: 0.4 },
  /** Painted steel: a panel, a rack's ears (the map gives the roughness and dents, `tint` the paint). */
  steel: { tile: 0.5, tint: 0x2e3034, roughness: 0.75, metalness: 0.45, normalScale: 0.5 },
  /** Birch ply, its face grain. */
  ply: { tile: 0.6, tint: 0xffffff, roughness: 0.9, metalness: 0, color: true },
  /** Textured black plastic or polyurea: a moulded PA box, a cable's jacket. */
  plastic: { tile: 0.35, tint: 0x8e8e8e, roughness: 1, metalness: 0, color: true, normalScale: 1.2 },
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
    s.alpha ? load("alpha", false).then((t) => { material.alphaMap = t; material.alphaTest = 0.5; material.alphaToCoverage = true; }) : undefined,
  ]).then(() => void (material.needsUpdate = true));
  return { material, ready };
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
