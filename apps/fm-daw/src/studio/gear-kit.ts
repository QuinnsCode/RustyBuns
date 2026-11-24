// The gear's and the room's surfaces from photographs, not paint from code. What look.ts's `surface()` asks first:
// - Gear (metal, plastic, rubber, tolex, grille cloth, painted steel, ply, grilles) from the shared photo-texture kit
//   (`@rustybuns/models/surfaces`, CC0 from ambientCG, #5021), so the keys, the cab, the desk and the props' racks and
//   stands are photographed material.
// - The room (floorboards, wedge foam, ceiling tiles, drywall and plaster, concrete, brick, walnut veneer, absorber cloth) from this app's own CC0 set in
//   `textures/` (CREDITS.md there), laid in metres like look.ts's painted ones (`metreUV`).
// Vite bundles the maps (hashed URLs). A caller's colour is what the surface should average out to: once the colour map
// is in, the tint is that colour over the map's own average, so a "#16191c" keyboard comes out that dark with the
// plastic's grain on it. `low` quality loads nothing: the gear in flat colour, the room left to look.ts's painting.
// Browser only (import.meta.glob).
import * as THREE from "three";
import { gearSurfaces, surface as kitSurface, type SurfaceName } from "@rustybuns/models/surfaces";
import { gearLook, type GearLook } from "@rustybuns/models/gear";
import { roomMaterial, type Quality } from "./look.ts";
import { MATERIALS } from "./sound.ts";

const FILES = import.meta.glob<string>("../../../../packages/models/textures/*/*.jpg", { eager: true, query: "?url", import: "default" });
const URLS = new Map(Object.entries(FILES).map(([path, url]) => [`kit/${path.split("/textures/")[1]}`, url]));
const ROOM_FILES = import.meta.glob<string>("./textures/*/*.jpg", { eager: true, query: "?url", import: "default" });
const ROOM_URLS = new Map(Object.entries(ROOM_FILES).map(([path, url]) => [path.split("/textures/")[1]!, url]));

/** look.ts's names for what gear is made of, and the kit surface each one is. */
const KIT: Record<string, SurfaceName> = { metal: "aluminium", plastic: "plastic", rubber: "rubber", grille: "grille", tolex: "tolex", cloth: "cloth", steel: "steel", ply: "ply" };

/** The room's surfaces: the folder under textures/, metres one copy covers across (`tall` up, when the photo isn't
 * square), and how rough and bumpy it is. `shade` scales the colour asked for (in linear light): look.ts painted
 * boards darker than their colour (seams, grain), and the rooms were lit for that. `turn` stands the photo on its
 * side (veneer whose grain should run up the wall), and `as` is the sound material whose colour it takes when none is asked. */
interface RoomSurface { dir: string; tile: number; tall?: number; rough: number; color: boolean; normal?: number; shade?: number; tone?: number; wear?: number; turn?: boolean; as?: keyof typeof MATERIALS }
const ROOM: Record<string, RoomSurface> = {
  floorboards: { dir: "floorboards", tile: 1.5, rough: 0.55, color: true, normal: 0.8, shade: 0.32, tone: 0.14, wear: 0.8 },
  foam: { dir: "foam", tile: 1.2, rough: 1, color: false, normal: 0.9 },
  ceilingTile: { dir: "ceilingTile", tile: 3.6, rough: 1, color: true, normal: 1.2, tone: 0.05 },
  drywall: { dir: "drywall", tile: 2.5, rough: 1, color: true, normal: 0.3, tone: 0.07 },
  plaster: { dir: "drywall", tile: 2.5, rough: 1, color: true, normal: 1, tone: 0.08 },
  concrete: { dir: "concrete", tile: 2.5, rough: 1, color: true, normal: 0.8, tone: 0.12, wear: 0.5 },
  // old red brick laid in courses 7.5 cm high: one copy is twelve bricks across and nineteen courses up
  brick: { dir: "bricks", tile: 2.86, tall: 1.43, rough: 1, color: true, normal: 1.1, shade: 0.75, tone: 0.1, wear: 0.25 },
  // walnut veneer on the walls, the grain running up them (look.ts's `walls()` cuts the sheets' joints)
  woodPanel: { dir: "walnut", tile: 1.3, rough: 0.62, color: true, normal: 0.5, shade: 0.55, turn: true, tone: 0.08, as: "wood" },
  // the woven cloth stretched over an absorber's frame
  panel: { dir: "panelCloth", tile: 0.32, rough: 1, color: true, normal: 0.9, tone: 0.04 },
};

/**
 * A photo repeated every metre and a half reads as wallpaper. Over the map, two slow value noises in the map's own
 * coordinates (one copy is 1 across): a tone that drifts `tone` either way over a few metres, so no two copies match,
 * and worn patches (`wear`, 0 to 1) where feet and chairs have dulled the finish, a touch paler and rougher.
 */
function weather(m: THREE.MeshStandardMaterial, tone: number, wear: number) {
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
float qHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float qNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(qHash(i), qHash(i + vec2(1, 0)), f.x), mix(qHash(i + vec2(0, 1)), qHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
#ifdef USE_MAP
  float qTone = qNoise(vMapUv * 0.43) * 0.65 + qNoise(vMapUv * 1.7 + 3.1) * 0.35;
  float qWorn = smoothstep(0.58, 0.86, qNoise(vMapUv * 0.8 + 7.3) * 0.75 + qNoise(vMapUv * 3.1) * 0.25) * ${wear.toFixed(2)};
  diffuseColor.rgb *= 1.0 + (qTone - 0.5) * ${(tone * 2).toFixed(2)};
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.1, 1.04) + 0.004, qWorn);
#endif`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
#ifdef USE_MAP
  roughnessFactor = clamp(roughnessFactor + qWorn * 0.3 - (qTone - 0.5) * 0.12, 0.0, 1.0);
#endif`);
  };
  m.customProgramCacheKey = () => `weather-${tone}-${wear}`;
}

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

/** Tint `m` so that, over its colour map, it averages out to `want`. */
function tintTo(m: THREE.MeshStandardMaterial, want: THREE.Color) {
  const avg = m.map && average(m.map);
  if (avg) m.color.setRGB(Math.min(2, want.r / Math.max(avg.r, 0.02)), Math.min(2, want.g / Math.max(avg.g, 0.02)), Math.min(2, want.b / Math.max(avg.b, 0.02)));
}

/** The gear models' own look made of the photo kit (packages/models gearSurfaces: textured coats, perforated grilles,
 *  brushed metal), the bundled maps standing in for its textures/ folder; flat colours at `low`. One per page. */
let kitLook: GearLook | null = null;
export function gearKitLook(quality: Quality): GearLook {
  if (quality === "low") return gearLook();
  if (kitLook) return kitLook;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => URLS.get(u) ?? u);
  return (kitLook = gearSurfaces({ base: "kit/", quality: "high", loader: new THREE.TextureLoader(manager) }).look);
}

/** A maker for look.ts (`useKit`): a gear or room surface by look.ts's name and colour, or null for anything else. */
export function gearKit(quality: Quality): (name: string, color?: string) => THREE.MeshStandardMaterial | null {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => URLS.get(u) ?? u);
  const loader = new THREE.TextureLoader(manager);
  const kits = new Map<SurfaceName, { material: THREE.MeshStandardMaterial; ready: Promise<void> }>();
  const made = new Map<string, THREE.MeshStandardMaterial>();
  const maps = new Map<string, Promise<THREE.Texture>>();
  const map = (dir: string, which: string, r: RoomSurface, srgb: boolean) => {
    const id = `${dir}/${which}`;
    let p = maps.get(id);
    if (!p) maps.set(id, (p = new Promise<THREE.Texture>((ok, no) => {
      const url = ROOM_URLS.get(`${id}.jpg`);
      if (!url) return no(new Error(`no ${id}`));
      new THREE.TextureLoader().load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / r.tile, 1 / (r.tall ?? r.tile));
        if (r.turn) { t.rotation = Math.PI / 2; t.repeat.set(1 / (r.tall ?? r.tile), 1 / r.tile); }
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        ok(t);
      }, undefined, () => no(new Error(`no ${id}`)));
    })));
    return p;
  };
  const room = (name: string, color: string | undefined) => {
    const r = ROOM[name];
    if (!r || quality === "low") return null;
    const want = new THREE.Color(color ?? MATERIALS[r.as ?? (name as keyof typeof MATERIALS)].color).multiplyScalar(r.shade ?? 1);
    const m = roomMaterial({ color: want, roughness: r.rough, metalness: 0 });
    m.name = `room-${name}-${want.getHexString()}`;
    if (r.tone || r.wear) weather(m, r.tone ?? 0, r.wear ?? 0);
    void Promise.all([
      r.color ? map(r.dir, "color", r, true).then((t) => void (m.map = t)) : undefined,
      map(r.dir, "normal", r, false).then((t) => { m.normalMap = t; m.normalScale.setScalar(r.normal ?? 1); }),
      map(r.dir, "rough", r, false).then((t) => void (m.roughnessMap = t)),
    ]).then(() => { tintTo(m, want); m.needsUpdate = true; }, () => { /* a missing map leaves the flat colour */ });
    return m;
  };
  return (name, color) => {
    const id = `${name}:${color ?? ""}`, hit = made.get(id);
    if (hit) return hit;
    const fromRoom = room(name, color);
    if (fromRoom) { made.set(id, fromRoom); return fromRoom; }
    const which = KIT[name];
    if (!which) return null;
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
      tintTo(m, want);
      m.needsUpdate = true;
    }, () => { /* a missing map leaves the flat colour */ });
    made.set(id, m);
    return m;
  };
}
