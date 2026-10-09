// Presets: a filename prefix picks the Meshy options, the default size and the origin.
// They live in the workspace as meshy-presets.json so people can edit and share them.
//
// Every Image to 3D option (docs.meshy.ai/en/api/image-to-3d) and every Retexture
// option (docs.meshy.ai/en/api/retexture) can be set here. Deprecated ones
// (ultra_mode, hd_texture, is_a_t_pose, symmetry_mode, lowpoly) are left out.

export type Origin = "bottom" | "center";
/** Target size in meters (height, or the longest side), or Meshy's own AI guess. */
export type Size = { height: number } | { longest: number } | { auto: true };

export const AI_MODELS = ["latest", "meshy-7.1", "meshy-6", "meshy-6-lite", "meshy-t2"] as const;
export const FORMATS = ["glb", "fbx", "obj", "usdz", "stl", "3mf"] as const;
export type Format = (typeof FORMATS)[number];

/** POST /image-to-3d options. The image, texture prompt and texture image come per card. */
export interface MeshyOptions {
  model_type?: "standard" | "smart-topology";
  ai_model?: (typeof AI_MODELS)[number];
  /** Ultra geometry: meshy-7.1 / latest only, +5 credits for 2k or 4k. */
  geometry_resolution?: "standard" | "2k" | "4k";
  should_texture?: boolean;
  enable_pbr?: boolean;
  texture_resolution?: "2k" | "4k" | "8k";
  should_remesh?: boolean;
  topology?: "triangle" | "quad";
  target_polycount?: number;
  /** 1 (ultra) to 4 (low): adaptive polycount; overrides target_polycount. */
  decimation_mode?: 1 | 2 | 3 | 4;
  save_pre_remeshed_model?: boolean;
  pose_mode?: "" | "a-pose" | "t-pose";
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  alpha_thumbnail?: boolean;
  multi_view_thumbnails?: boolean;
  moderation?: boolean;
}

/** POST /retexture options, for texturing a draft later. The style comes per card. */
export interface RetextureOptions {
  ai_model?: "latest" | "meshy-7" | "meshy-6" | "meshy-6-lite";
  /** Keep the model's UVs. Meshy's own models have good ones, so this defaults on. */
  enable_original_uv?: boolean;
  enable_pbr?: boolean;
  texture_resolution?: "2k" | "4k" | "8k";
  remove_lighting?: boolean;
}

export interface Preset {
  /** Matched against the start of the filename, e.g. "flora_". "" is the default preset. */
  prefix: string;
  label: string;
  options: MeshyOptions;
  /** Used by the Texture step on drafts. */
  retexture?: RetextureOptions;
  size: Size;
  origin: Origin;
  /** Formats to download into 001 besides glb (glb is always made: 002 is built from it). */
  formats?: Format[];
}

export const RETEXTURE_DEFAULTS: RetextureOptions = { ai_model: "latest", enable_original_uv: true, texture_resolution: "2k" };

export const STARTER_PRESETS: Preset[] = [
  { prefix: "draft_", label: "Draft (no texture)", size: { height: 1 }, origin: "bottom",
    options: { ai_model: "meshy-6-lite", should_texture: false } },
  { prefix: "item_", label: "Item", size: { longest: 0.5 }, origin: "center",
    options: { model_type: "smart-topology", ai_model: "meshy-t2", target_polycount: 4000, texture_resolution: "2k" } },
  { prefix: "flora_", label: "Flora", size: { height: 6 }, origin: "bottom",
    options: { ai_model: "meshy-6-lite", should_remesh: true, target_polycount: 15000, texture_resolution: "2k" } },
  { prefix: "environ_", label: "Environment", size: { height: 4 }, origin: "bottom",
    options: { ai_model: "meshy-7.1", should_remesh: true, target_polycount: 30000, enable_pbr: true, texture_resolution: "2k" } },
  { prefix: "structure_", label: "Structure", size: { height: 8 }, origin: "bottom",
    options: { ai_model: "meshy-7.1", should_remesh: true, target_polycount: 30000, enable_pbr: true, texture_resolution: "2k" } },
  { prefix: "char_", label: "Character", size: { height: 1.8 }, origin: "bottom",
    options: { ai_model: "meshy-7.1", should_remesh: true, target_polycount: 30000, pose_mode: "t-pose", texture_resolution: "2k" } },
  { prefix: "", label: "Default", size: { height: 1 }, origin: "bottom",
    options: { ai_model: "meshy-6-lite", texture_resolution: "2k" } },
];

/** The preset whose prefix starts the name (longest wins), else the default (prefix ""). */
export function presetFor(name: string, presets: Preset[]): Preset {
  const lower = name.toLowerCase();
  let best: Preset | undefined;
  for (const p of presets) {
    if (p.prefix && lower.startsWith(p.prefix.toLowerCase()) && (!best || p.prefix.length > best.prefix.length)) best = p;
  }
  return best ?? presets.find((p) => !p.prefix) ?? STARTER_PRESETS[STARTER_PRESETS.length - 1]!;
}

/** What a card adds on top of its preset. */
export interface CardInput {
  texturePrompt?: string;
  /** A data URI: the card's texture reference image. */
  textureImage?: string;
  /** Shape only now; texture later with Retexture. */
  draft?: boolean;
}

const isT2 = (o: MeshyOptions) => o.model_type === "smart-topology" || o.ai_model === "meshy-t2";
const isLite = (o: MeshyOptions) => o.ai_model === "meshy-6-lite" || isT2(o);
const is71 = (o: MeshyOptions) => !isT2(o) && (o.ai_model === undefined || o.ai_model === "latest" || o.ai_model === "meshy-7.1");
const textured = (o: MeshyOptions, c: CardInput) => !c.draft && o.should_texture !== false;

/** The options as Meshy should get them: smart topology implies meshy-t2, and settings that don't apply are left out. */
export function effectiveOptions(options: MeshyOptions, card: CardInput = {}): MeshyOptions {
  const o: MeshyOptions = { ...options };
  if (o.model_type === "smart-topology") o.ai_model = "meshy-t2";
  if (o.ai_model === "meshy-t2") o.model_type = "smart-topology";
  if (!textured(o, card)) { o.should_texture = false; delete o.enable_pbr; delete o.texture_resolution; }
  if (!is71(o)) delete o.geometry_resolution;
  if (!o.should_remesh && !isT2(o)) { delete o.topology; delete o.target_polycount; delete o.decimation_mode; delete o.save_pre_remeshed_model; }
  if (o.ai_model !== "meshy-6") delete o.remove_lighting;
  if (!(o.ai_model === "meshy-6" || is71(o))) delete o.image_enhancement;
  return o;
}

/** The request body for POST /image-to-3d. */
export function createBody(imageDataUri: string, preset: Pick<Preset, "options" | "size" | "origin" | "formats">, card: CardInput = {}) {
  const o = effectiveOptions(preset.options, card);
  const tex = textured(preset.options, card);
  return {
    image_url: imageDataUri,
    ...o,
    ...(tex && card.texturePrompt ? { texture_prompt: card.texturePrompt.slice(0, 800) } : {}),
    ...(tex && card.textureImage && !card.texturePrompt ? { texture_image_url: card.textureImage } : {}),
    ...("auto" in preset.size ? { auto_size: true, origin_at: preset.origin } : {}),
    target_formats: [...new Set<Format>(["glb", ...(preset.formats ?? [])])],
  };
}

/** The request body for POST /retexture, texturing a finished Image to 3D task. */
export function retextureBody(taskId: string, options: RetextureOptions | undefined, style: { imageDataUri?: string; prompt?: string }, formats: Format[] = []) {
  const o: RetextureOptions = { ...RETEXTURE_DEFAULTS, ...options };
  if (o.ai_model !== "meshy-6") delete o.remove_lighting;
  return {
    input_task_id: taskId,
    ...(style.prompt ? { text_style_prompt: style.prompt.slice(0, 800) } : { image_style_url: style.imageDataUri }),
    ...o,
    target_formats: [...new Set<Format>(["glb", ...formats])],
  };
}

/**
 * Credits one Image to 3D job costs, from docs.meshy.ai/en/api/pricing (Oct 2026): the model
 * and texture table, +5 for ultra geometry on meshy-7.1, +10 for a texture prompt or texture
 * image (image-to-3d reference). An estimate: Meshy's own count is the truth.
 */
export function estimateCredits(options: MeshyOptions, card: CardInput = {}): number {
  const o = effectiveOptions(options, card);
  const tex = textured(options, card);
  let n = !tex ? (isLite(o) ? 5 : 20) : isLite(o) ? 15 : 30;
  if (tex && o.texture_resolution === "8k") n += 5;
  if (is71(o) && (o.geometry_resolution === "2k" || o.geometry_resolution === "4k")) n += 5;
  if (tex && (card.texturePrompt || card.textureImage)) n += 10;
  return n;
}

/** Retexture: 10 credits at 2k or 4k, 15 at 8k. */
export function estimateRetexture(options?: RetextureOptions): number {
  return ({ ...RETEXTURE_DEFAULTS, ...options }.texture_resolution === "8k") ? 15 : 10;
}

/** Problems Meshy would reject, or settings that would be ignored, in words for the preset editor. */
export function checkPreset(p: Preset): string[] {
  const o = p.options;
  const out: string[] = [];
  if (!/^[a-z0-9-]*_?$/i.test(p.prefix)) out.push("The prefix may only use letters, digits and dashes, ending in _.");
  if (o.ai_model === "meshy-t2" && o.model_type === "standard") out.push("meshy-t2 is the smart-topology model.");
  if (o.model_type === "smart-topology" && o.ai_model && o.ai_model !== "meshy-t2") out.push("Smart topology always uses meshy-t2.");
  if (o.ai_model === "meshy-6-lite" && (o.texture_resolution === "4k" || o.texture_resolution === "8k")) out.push("meshy-6-lite textures at 2k only.");
  if (o.geometry_resolution && o.geometry_resolution !== "standard" && !is71(o)) out.push("Ultra geometry needs meshy-7.1 (or latest).");
  const pc = o.target_polycount;
  if (pc !== undefined) {
    if (isT2(o) && (pc < 100 || pc > 15000)) out.push("Smart topology polycount is 100 to 15,000.");
    if (!isT2(o) && (pc < 100 || pc > 300000)) out.push("Polycount is 100 to 300,000.");
    if (!isT2(o) && !o.should_remesh) out.push("Polycount and topology only apply with remesh on.");
  }
  if (o.decimation_mode !== undefined && ![1, 2, 3, 4].includes(o.decimation_mode)) out.push("Decimation is 1 (ultra) to 4 (low).");
  if (o.remove_lighting !== undefined && o.ai_model !== "meshy-6") out.push("Remove lighting only applies to meshy-6.");
  const r = p.retexture;
  if (r?.ai_model === "meshy-6-lite" && (r.texture_resolution === "4k" || r.texture_resolution === "8k")) out.push("Retexture with meshy-6-lite is 2k only.");
  if ("height" in p.size && !(p.size.height > 0)) out.push("Height must be above 0 m.");
  if ("longest" in p.size && !(p.size.longest > 0)) out.push("Longest side must be above 0 m.");
  return out;
}
