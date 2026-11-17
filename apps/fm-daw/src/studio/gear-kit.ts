// The gear's surfaces from the shared photo-texture kit (`@rustybuns/models/surfaces`, CC0 from ambientCG, #5021): what
// look.ts's `surface()` hands out for metal, plastic, rubber, tolex, grille cloth, painted steel, ply and grilles, so
// the keys, the cab, the desk and the props' racks and stands are photographed material, not paint from code.
// The kit's maps are bundled by Vite (hashed URLs), so a loading manager turns the kit's `kit/<name>/<map>.jpg` into
// them. A caller's colour is what the surface should average out to: once the colour map is in, the tint is that
// colour over the map's own average, so a "#16191c" keyboard comes out that dark with the plastic's grain on it.
// `low` quality loads nothing and gives the same surfaces in flat colour. Browser only (import.meta.glob).
import * as THREE from "three";
import { surface as kitSurface, type SurfaceName } from "@rustybuns/models/surfaces";
import type { Quality } from "./look.ts";

const FILES = import.meta.glob<string>("../../../../packages/models/textures/*/*.jpg", { eager: true, query: "?url", import: "default" });
const URLS = new Map(Object.entries(FILES).map(([path, url]) => [`kit/${path.split("/textures/")[1]}`, url]));

/** look.ts's names for what gear is made of, and the kit surface each one is. */
const KIT: Record<string, SurfaceName> = { metal: "aluminium", plastic: "plastic", rubber: "rubber", grille: "grille", tolex: "tolex", cloth: "cloth", steel: "steel", ply: "ply" };

/** The average colour of a loaded map, in linear light (what the tint divides by). */
function average(t: THREE.Texture): THREE.Color | null {
  const img = t.image;
  if (!(img instanceof HTMLImageElement || img instanceof ImageBitmap)) return null;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data, sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
  return new THREE.Color().setRGB(sum[0]! / 64 / 255, sum[1]! / 64 / 255, sum[2]! / 64 / 255, THREE.SRGBColorSpace);
}

/** A maker for look.ts (`useKit`): a gear surface by look.ts's name and colour, or null for anything else. */
export function gearKit(quality: Quality): (name: string, color?: string) => THREE.MeshStandardMaterial | null {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => URLS.get(u) ?? u);
  const loader = new THREE.TextureLoader(manager);
  const kits = new Map<SurfaceName, { material: THREE.MeshStandardMaterial; ready: Promise<void> }>();
  const made = new Map<string, THREE.MeshStandardMaterial>();
  return (name, color) => {
    const which = KIT[name];
    if (!which) return null;
    const id = `${which}:${color ?? ""}`, hit = made.get(id);
    if (hit) return hit;
    let kit = kits.get(which);
    if (!kit) kits.set(which, (kit = kitSurface(which, { base: "kit/", quality, loader })));
    const base = kit.material;
    if (!color) { made.set(id, base); return base; }
    const want = new THREE.Color(color), m = base.clone();
    m.name = `${base.name}-${want.getHexString()}`;
    m.color.copy(want);
    // the maps arrive later: share them, and tint so the surface averages out to the colour asked for
    void kit.ready.then(() => {
      m.map = base.map; m.normalMap = base.normalMap; m.normalScale.copy(base.normalScale);
      m.roughnessMap = base.roughnessMap; m.alphaMap = base.alphaMap; m.alphaTest = base.alphaTest; m.alphaToCoverage = base.alphaToCoverage;
      const avg = base.map && average(base.map);
      if (avg) m.color.setRGB(Math.min(2, want.r / Math.max(avg.r, 0.02)), Math.min(2, want.g / Math.max(avg.g, 0.02)), Math.min(2, want.b / Math.max(avg.b, 0.02)));
      m.needsUpdate = true;
    }, () => { /* a missing map leaves the flat colour */ });
    made.set(id, m);
    return m;
  };
}
