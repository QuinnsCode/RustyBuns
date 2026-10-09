// Presets: a filename prefix picks the Meshy options, the default size and the origin.
// They live in the workspace as meshy-presets.json so people can edit and share them.
// Each card can override any option on top of its preset (Job.overrides).
//
// One option set drives three generation endpoints, each taking what applies to it:
//   image  -> POST /v1/image-to-3d         (docs.meshy.ai/en/api/image-to-3d)
//   multi  -> POST /v1/multi-image-to-3d   (docs.meshy.ai/en/api/multi-image-to-3d)
//   text   -> POST /v2/text-to-3d, preview then refine (docs.meshy.ai/en/api/text-to-3d)
// Deprecated aliases (ultra_mode, hd_texture, is_a_t_pose, symmetry_mode, art_style, meshy-7)
// are not offered: each has a current equivalent. lowpoly is, until Meshy retires it on 2026-10-30.

export type Origin = "bottom" | "center";
/** Target size in meters (height, or the longest side), or Meshy's own AI guess. */
export type Size = { height: number } | { longest: number } | { auto: true };
export type Source = "image" | "multi" | "text";

export const AI_MODELS = ["latest", "meshy-7.1", "meshy-6", "meshy-6-lite", "meshy-t2"] as const;
export const FORMATS = ["glb", "fbx", "obj", "usdz", "stl", "3mf"] as const;
export type Format = (typeof FORMATS)[number];
export const LOWPOLY_RETIRES = "2026-10-30";

/** Generation options. The image, prompts and texture images come per card. */
export interface MeshyOptions {
  /** lowpoly is deprecated and retires 2026-10-30; it ignores ai_model, topology, polycount and remesh. */
  model_type?: "standard" | "smart-topology" | "lowpoly";
  ai_model?: (typeof AI_MODELS)[number];
  /** Ultra geometry: meshy-7.1 / latest only, +5 credits. Multi-image allows 2k, not 4k. */
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

/** Retexture options (and the model for Text to 3D refine), for texturing a draft later. */
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

/** The models a card can pick, each as the option patch it applies. */
export const MODEL_CHOICES = [
  { id: "meshy-7.1", label: "Meshy 7.1", patch: { model_type: "standard", ai_model: "meshy-7.1" } },
  { id: "meshy-6", label: "Meshy 6", patch: { model_type: "standard", ai_model: "meshy-6" } },
  { id: "meshy-6-lite", label: "Meshy 6 Lite", patch: { model_type: "standard", ai_model: "meshy-6-lite" } },
  { id: "meshy-t2", label: "Smart topology (T2)", patch: { model_type: "smart-topology", ai_model: "meshy-t2" } },
  { id: "lowpoly", label: `Low poly (retires ${LOWPOLY_RETIRES})`, patch: { model_type: "lowpoly", ai_model: undefined } },
] as const satisfies readonly { id: string; label: string; patch: MeshyOptions }[];
export type ModelId = (typeof MODEL_CHOICES)[number]["id"];

/**
 * The overrides that switch these options to a model, adjusting what the new model can't take:
 * a polycount over smart topology's 15,000 goes back to Meshy's default, a 4k/8k texture on
 * meshy-6-lite becomes 2k. null means "Meshy's default" (not sent).
 */
export function modelPatch(base: MeshyOptions, id: ModelId): Partial<Record<keyof MeshyOptions, unknown>> {
  const c = MODEL_CHOICES.find((m) => m.id === id)!;
  const patch: Partial<Record<keyof MeshyOptions, unknown>> = { model_type: c.patch.model_type, ai_model: "ai_model" in c.patch && c.patch.ai_model ? c.patch.ai_model : null };
  const pc = base.target_polycount;
  if (id === "meshy-t2" && pc !== undefined && (pc < 100 || pc > 15000)) patch.target_polycount = null;
  // Smart topology's polycount means nothing to a standard model without remesh.
  if (id !== "meshy-t2" && modelOf(base) === "meshy-t2" && pc !== undefined && !base.should_remesh) patch.target_polycount = null;
  if (id === "meshy-6-lite" && (base.texture_resolution === "4k" || base.texture_resolution === "8k")) patch.texture_resolution = "2k";
  return patch;
}

/** Which model these options pick. */
export function modelOf(o: MeshyOptions): ModelId {
  if (o.model_type === "lowpoly") return "lowpoly";
  if (o.model_type === "smart-topology" || o.ai_model === "meshy-t2") return "meshy-t2";
  if (o.ai_model === "meshy-6" || o.ai_model === "meshy-6-lite") return o.ai_model;
  return "meshy-7.1";
}

/** The models each endpoint accepts. */
export function modelsFor(source: Source): ModelId[] {
  return source === "multi" ? ["meshy-7.1", "meshy-6", "meshy-6-lite"] : ["meshy-7.1", "meshy-6", "meshy-6-lite", "meshy-t2", "lowpoly"];
}

/** A preset's options with a card's overrides on top. An override of undefined removes the preset's value. */
export function mergeOptions(base: MeshyOptions, overrides?: Partial<Record<keyof MeshyOptions, unknown>>): MeshyOptions {
  const o: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === null) delete o[k];
    else if (v !== undefined) o[k] = v;
  }
  return o as MeshyOptions;
}

/** What a card adds on top of its preset. */
export interface CardInput {
  texturePrompt?: string;
  /** Data URIs: the card's texture reference image(s). */
  textureImage?: string;
  textureImages?: string[];
  /** Shape only now; texture later. */
  draft?: boolean;
}

const isT2 = (o: MeshyOptions) => o.model_type === "smart-topology" || o.ai_model === "meshy-t2";
const isLow = (o: MeshyOptions) => o.model_type === "lowpoly";
const isLite = (o: MeshyOptions) => !isLow(o) && (o.ai_model === "meshy-6-lite" || isT2(o));
const is71 = (o: MeshyOptions) => !isT2(o) && !isLow(o) && (o.ai_model === undefined || o.ai_model === "latest" || o.ai_model === "meshy-7.1");
const textured = (o: MeshyOptions, c: CardInput) => !c.draft && o.should_texture !== false;

/** The options as an endpoint should get them: implied settings filled in, ones that don't apply left out. */
export function effectiveOptions(options: MeshyOptions, card: CardInput = {}, source: Source = "image"): MeshyOptions {
  const o: MeshyOptions = { ...options };
  if (isLow(o)) { delete o.ai_model; delete o.topology; delete o.target_polycount; delete o.should_remesh; delete o.save_pre_remeshed_model; delete o.decimation_mode; }
  else if (o.model_type === "smart-topology") o.ai_model = "meshy-t2";
  else if (o.ai_model === "meshy-t2") o.model_type = "smart-topology";
  if (o.model_type === "standard") delete o.model_type;
  if (!textured(o, card)) { o.should_texture = false; delete o.enable_pbr; delete o.texture_resolution; }
  if (!is71(o)) delete o.geometry_resolution;
  if (source === "multi" && o.geometry_resolution === "4k") o.geometry_resolution = "2k";
  if (!o.should_remesh && !isT2(o)) { delete o.topology; delete o.target_polycount; delete o.decimation_mode; delete o.save_pre_remeshed_model; }
  if (isT2(o)) delete o.should_remesh;
  const lightingOk = o.ai_model === "meshy-6" || (source === "multi" && is71(o));
  if (!lightingOk) delete o.remove_lighting;
  if (!(o.ai_model === "meshy-6" || is71(o))) delete o.image_enhancement;
  if (source === "multi") { delete o.model_type; }
  return o;
}

type SizeFields = Pick<Preset, "options" | "size" | "origin" | "formats">;
const sizeFields = (p: SizeFields) => ("auto" in p.size ? { auto_size: true, origin_at: p.origin } : {});
const formatList = (p: Pick<Preset, "formats">) => [...new Set<Format>(["glb", ...(p.formats ?? [])])];
const textureFields = (o: MeshyOptions, card: CardInput, many = false) => {
  if (!textured(o, card)) return {};
  if (card.texturePrompt) return { texture_prompt: card.texturePrompt.slice(0, 800) };
  if (many && card.textureImages && card.textureImages.length > 1 && is71(o)) return { texture_image_urls: card.textureImages.slice(0, 4) };
  const one = card.textureImage ?? card.textureImages?.[0];
  return one ? { texture_image_url: one } : {};
};

/** POST /image-to-3d. `input` is a data URI, or { input_task_id } for an image Meshy made. */
export function createBody(input: string | { input_task_id: string }, preset: SizeFields, card: CardInput = {}) {
  const o = effectiveOptions(preset.options, card, "image");
  return {
    ...(typeof input === "string" ? { image_url: input } : input),
    ...o, ...textureFields(preset.options, card), ...sizeFields(preset),
    target_formats: formatList(preset),
  };
}

/** POST /multi-image-to-3d: 1 to 4 views of one object, front first. */
export function multiBody(input: string[] | { input_task_id: string }, preset: SizeFields, card: CardInput = {}) {
  const o = effectiveOptions(preset.options, card, "multi");
  return {
    ...(Array.isArray(input) ? { image_urls: input.slice(0, 4) } : input),
    ...o, ...textureFields(preset.options, card, true), ...sizeFields(preset),
    target_formats: formatList(preset),
  };
}

const PREVIEW_KEYS = ["model_type", "ai_model", "geometry_resolution", "should_remesh", "topology", "decimation_mode", "target_polycount", "pose_mode", "moderation", "alpha_thumbnail"] as const;

/** POST /v2/text-to-3d, mode preview: the untextured shape from a prompt. */
export function textPreviewBody(prompt: string, preset: SizeFields) {
  const o = effectiveOptions(preset.options, { draft: true }, "text");
  if (isT2(o)) delete o.topology; // smart topology is triangles only here
  const picked = Object.fromEntries(PREVIEW_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return { mode: "preview", prompt: prompt.slice(0, 800), ...picked, ...sizeFields(preset), target_formats: formatList(preset) };
}

/** POST /v2/text-to-3d, mode refine: texture a finished preview. */
export function textRefineBody(previewTaskId: string, preset: SizeFields & Pick<Preset, "retexture">, card: CardInput = {}) {
  const o = preset.options;
  const r = preset.retexture ?? {};
  const model = r.ai_model ?? (o.ai_model && o.ai_model !== "meshy-t2" ? o.ai_model : undefined);
  const lite = model === "meshy-6-lite";
  const res = r.texture_resolution ?? o.texture_resolution;
  return {
    mode: "refine", preview_task_id: previewTaskId,
    ...(model ? { ai_model: model } : {}),
    ...((r.enable_pbr ?? o.enable_pbr) !== undefined ? { enable_pbr: r.enable_pbr ?? o.enable_pbr } : {}),
    ...(res && !(lite && res !== "2k") ? { texture_resolution: res } : {}),
    ...(card.texturePrompt ? { texture_prompt: card.texturePrompt.slice(0, 800) } : card.textureImage ? { texture_image_url: card.textureImage } : {}),
    ...(model === "meshy-6" && (r.remove_lighting ?? o.remove_lighting) !== undefined ? { remove_lighting: r.remove_lighting ?? o.remove_lighting } : {}),
    ...(o.moderation ? { moderation: true } : {}),
    ...(o.alpha_thumbnail ? { alpha_thumbnail: true } : {}),
    ...sizeFields(preset),
    target_formats: formatList(preset),
  };
}

/** POST /retexture, texturing a finished model (input_task_id, or the model file as a data URI). */
export function retextureBody(input: string | { model_url: string }, options: RetextureOptions | undefined, style: { imageDataUri?: string; prompt?: string }, formats: Format[] = []) {
  const o: RetextureOptions = { ...RETEXTURE_DEFAULTS, ...options };
  if (o.ai_model !== "meshy-6") delete o.remove_lighting;
  return {
    ...(typeof input === "string" ? { input_task_id: input } : input),
    ...(style.prompt ? { text_style_prompt: style.prompt.slice(0, 800) } : { image_style_url: style.imageDataUri }),
    ...o,
    target_formats: [...new Set<Format>(["glb", ...formats])],
  };
}

/**
 * Credits for one generation, from docs.meshy.ai/en/api/pricing (Oct 2026): the model and
 * texture table, +5 for ultra geometry on meshy-7.1, +10 for a texture prompt or image
 * (image-to-3d reference), lowpoly priced as meshy-6. Text to 3D is preview + refine.
 * An estimate: Meshy's own count is the truth.
 */
export function estimateCredits(options: MeshyOptions, card: CardInput = {}, source: Source = "image", retexture?: RetextureOptions): number {
  const o = effectiveOptions(options, card, source);
  const ultra = is71(o) && (o.geometry_resolution === "2k" || o.geometry_resolution === "4k") ? 5 : 0;
  if (source === "text") {
    const preview = (isLite(o) ? 5 : 20) + ultra;
    return textured(options, card) ? preview + estimateRetexture({ texture_resolution: retexture?.texture_resolution ?? options.texture_resolution }) : preview;
  }
  const tex = textured(options, card);
  let n = !tex ? (isLite(o) ? 5 : 20) : isLite(o) ? 15 : 30;
  if (tex && o.texture_resolution === "8k") n += 5;
  if (tex && (card.texturePrompt || card.textureImage || card.textureImages?.length)) n += 10;
  return n + ultra;
}

/** Retexture and Text to 3D refine: 10 credits at 2k or 4k, 15 at 8k. */
export function estimateRetexture(options?: RetextureOptions): number {
  return ({ ...RETEXTURE_DEFAULTS, ...options }.texture_resolution === "8k") ? 15 : 10;
}

/** Problems Meshy would reject, or settings that would be ignored, in words for the editors. */
export function checkOptions(o: MeshyOptions, source: Source = "image"): string[] {
  const out: string[] = [];
  if (o.ai_model === "meshy-t2" && o.model_type === "standard") out.push("meshy-t2 is the smart-topology model.");
  if (o.model_type === "smart-topology" && o.ai_model && o.ai_model !== "meshy-t2") out.push("Smart topology always uses meshy-t2.");
  if (isLow(o) && o.ai_model === "meshy-6-lite") out.push("Low poly doesn't work with meshy-6-lite.");
  if (isLow(o)) out.push(`Low poly is deprecated: Meshy retires it on ${LOWPOLY_RETIRES}. Smart topology replaces it.`);
  if (source === "multi" && (isT2(o) || isLow(o))) out.push("Multi-Image to 3D has no smart topology or low poly model.");
  if (o.ai_model === "meshy-6-lite" && (o.texture_resolution === "4k" || o.texture_resolution === "8k")) out.push("meshy-6-lite textures at 2k only.");
  if (o.geometry_resolution && o.geometry_resolution !== "standard" && !is71(o)) out.push("Ultra geometry only applies to meshy-7.1 (or latest); it isn't sent.");
  if (source === "multi" && o.geometry_resolution === "4k") out.push("Multi-Image to 3D allows 2k geometry, not 4k.");
  if (source === "text" && isT2(o) && o.topology === "quad") out.push("Text to 3D smart topology is triangles only.");
  const pc = o.target_polycount;
  if (pc !== undefined) {
    if (isT2(o) && (pc < 100 || pc > 15000)) out.push("Smart topology polycount is 100 to 15,000.");
    if (!isT2(o) && (pc < 100 || pc > 300000)) out.push("Polycount is 100 to 300,000.");
    if (!isT2(o) && !o.should_remesh && !isLow(o)) out.push("Polycount and topology only apply with remesh on; they aren't sent.");
  }
  if (o.decimation_mode !== undefined && ![1, 2, 3, 4].includes(o.decimation_mode)) out.push("Decimation is 1 (ultra) to 4 (low).");
  if (o.remove_lighting !== undefined && o.ai_model !== "meshy-6" && !(source === "multi" && is71(o))) out.push("Remove lighting only applies to meshy-6; it isn't sent.");
  return out;
}

export function checkPreset(p: Preset): string[] {
  const out = checkOptions(p.options).filter((m) => !m.startsWith("Low poly is deprecated"));
  if (!/^[a-z0-9-]*_?$/i.test(p.prefix)) out.unshift("The prefix may only use letters, digits and dashes, ending in _.");
  const r = p.retexture;
  if (r?.ai_model === "meshy-6-lite" && (r.texture_resolution === "4k" || r.texture_resolution === "8k")) out.push("Retexture with meshy-6-lite is 2k only.");
  if ("height" in p.size && !(p.size.height > 0)) out.push("Height must be above 0 m.");
  if ("longest" in p.size && !(p.size.longest > 0)) out.push("Longest side must be above 0 m.");
  return out;
}

/** Messages that are warnings, not reasons to refuse a save. */
export const isWarning = (m: string) => m.includes("only appl") || m.startsWith("Low poly is deprecated");
