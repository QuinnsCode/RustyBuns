// Steps that run on a finished model, one after another, each a Meshy task:
//
//   retexture   paint it (docs.meshy.ai/en/api/retexture)          10, 15 at 8k
//   refine      paint a Text to 3D preview (text-to-3d, refine)     10, 15 at 8k
//   remesh      new topology / polycount (remesh)                   5
//   resize      Meshy-side height or longest side (resize)          1
//   uv-unwrap   new UVs, up to 40,000 faces (uv-unwrap)             5
//   convert     other formats, .blend included (convert)            1
//   rig         humanoid skeleton + walk/run clips (rigging)        5
//   motion      a clip from a text prompt (text-to-motion)          10 prime, 3 swift
//   animate     library actions or a motion clip (animation)        3 per action
//
// And concept images, which become new cards:
//   text-to-image, image-to-image                                    3 to 12 by model

import type { Kind } from "./meshy.ts";
import { estimateRetexture, type RetextureOptions } from "./presets.ts";

export const OUT_FORMATS = ["glb", "fbx", "obj", "usdz", "blend", "stl", "3mf"] as const;
export type OutFormat = (typeof OUT_FORMATS)[number];

export interface RemeshParams { topology?: "triangle" | "quad"; target_polycount?: number; decimation_mode?: 1 | 2 | 3 | 4; target_formats?: OutFormat[]; alpha_thumbnail?: boolean }
export interface ResizeParams { mode: "height" | "longest" | "auto"; meters?: number; origin_at?: "bottom" | "center" }
export interface ConvertParams { target_formats: OutFormat[] }
export interface RigParams { height_meters?: number }
export interface MotionParams { prompt: string; mode?: "prime" | "swift"; duration: number }
export type PostProcess = { operation_type: "change_fps"; fps?: 24 | 25 | 30 | 60 } | { operation_type: "fbx2usdz" } | { operation_type: "extract_armature" };
/** Library actions (1 to 10), or the clip from the motion step just before (fromMotion). */
export interface AnimateParams { action_ids?: number[]; fromMotion?: boolean; post_process?: PostProcess; label?: string }

export type OpParams = {
  retexture: { style?: "prompt" | "image"; prompt?: string; options?: RetextureOptions };
  refine: { options?: RetextureOptions };
  remesh: RemeshParams;
  resize: ResizeParams;
  "uv-unwrap": Record<string, never>;
  convert: ConvertParams;
  rig: RigParams;
  motion: MotionParams;
  animate: AnimateParams;
};
export type OpKind = keyof OpParams;

export const OP_KIND: Record<OpKind, Kind> = {
  retexture: "retexture", refine: "text-to-3d", remesh: "remesh", resize: "resize", "uv-unwrap": "uv-unwrap",
  convert: "convert", rig: "rigging", motion: "text-to-motion", animate: "animations",
};

export const OP_LABEL: Record<OpKind, string> = {
  retexture: "Texture", refine: "Texture (refine)", remesh: "Remesh", resize: "Resize at Meshy", "uv-unwrap": "UV unwrap",
  convert: "Convert", rig: "Rig", motion: "Text to motion", animate: "Animate",
};

/** Steps whose result is the card's model from then on. */
export const MAKES_MODEL: OpKind[] = ["retexture", "refine", "remesh", "resize", "uv-unwrap"];

/** Which earlier tasks each step takes as input_task_id; anything else goes up as the model file. */
export const ACCEPTS: Partial<Record<OpKind, Kind[]>> = {
  retexture: ["text-to-3d", "image-to-3d", "remesh"],
  remesh: ["text-to-3d", "image-to-3d", "retexture"],
  "uv-unwrap": ["image-to-3d", "text-to-3d", "remesh"],
};

/** Whether the model will be textured once a card's queued steps have run (UV unwrap strips it). */
export function texturedAfter(j: { textured?: boolean; ops?: { kind: OpKind; state: string }[] }): boolean {
  let t = !!j.textured;
  for (const o of j.ops ?? []) {
    if (o.state === "failed") continue;
    if (o.kind === "retexture" || o.kind === "refine") t = true;
    if (o.kind === "uv-unwrap") t = false;
  }
  return t;
}

export function estimateOp<K extends OpKind>(kind: K, params: OpParams[K]): number {
  switch (kind) {
    case "retexture": return estimateRetexture((params as OpParams["retexture"]).options);
    case "refine": return estimateRetexture((params as OpParams["refine"]).options);
    case "remesh": return 5;
    case "resize": return 1;
    case "uv-unwrap": return 5;
    case "convert": return 1;
    case "rig": return 5;
    case "motion": return (params as MotionParams).mode === "swift" ? 3 : 10;
    case "animate": { const p = params as AnimateParams; return p.fromMotion ? 3 : 3 * Math.max(1, p.action_ids?.length ?? 1); }
  }
  return 0;
}

/** Problems Meshy would reject, in words. */
export function checkOp<K extends OpKind>(kind: K, params: OpParams[K]): string[] {
  const out: string[] = [];
  if (kind === "remesh") {
    const p = params as RemeshParams;
    if (p.target_polycount !== undefined && (p.target_polycount < 100 || p.target_polycount > 300000)) out.push("Polycount is 100 to 300,000.");
  }
  if (kind === "resize") {
    const p = params as ResizeParams;
    if (p.mode !== "auto" && !(Number(p.meters) > 0)) out.push("Give the size in meters, above 0.");
  }
  if (kind === "convert" && !(params as ConvertParams).target_formats?.length) out.push("Pick at least one format.");
  if (kind === "rig") {
    const h = (params as RigParams).height_meters;
    if (h !== undefined && !(h > 0)) out.push("Height must be above 0 m.");
  }
  if (kind === "motion") {
    const p = params as MotionParams;
    if (!p.prompt?.trim()) out.push("Describe the motion.");
    if ((p.prompt?.length ?? 0) > 400) out.push("The motion prompt is 400 characters at most.");
    if (!(p.duration >= 2 && p.duration <= 10) || (p.duration * 2) % 1 !== 0) out.push("Duration is 2 to 10 seconds, in half seconds.");
  }
  if (kind === "animate") {
    const p = params as AnimateParams;
    const ids = p.action_ids ?? [];
    if (!p.fromMotion && (ids.length < 1 || ids.length > 10)) out.push("Pick 1 to 10 actions.");
    if (new Set(ids).size !== ids.length) out.push("Each action only once.");
  }
  if (kind === "retexture") {
    const p = params as OpParams["retexture"];
    if (p.style === "prompt" && !p.prompt?.trim()) out.push("Describe the texture.");
    if ((p.prompt?.length ?? 0) > 800) out.push("The texture prompt is 800 characters at most.");
  }
  return out;
}

/** Body pieces that are pure params; the workspace adds the input (task id or model file). */
export function opBody<K extends OpKind>(kind: K, params: OpParams[K]): Record<string, unknown> {
  switch (kind) {
    case "remesh": {
      const p = params as RemeshParams;
      return {
        ...(p.topology ? { topology: p.topology } : {}),
        ...(p.decimation_mode ? { decimation_mode: p.decimation_mode } : p.target_polycount ? { target_polycount: p.target_polycount } : {}),
        target_formats: [...new Set(["glb", ...(p.target_formats ?? [])])],
        ...(p.alpha_thumbnail ? { alpha_thumbnail: true } : {}),
      };
    }
    case "resize": {
      const p = params as ResizeParams;
      return {
        ...(p.mode === "height" ? { resize_height: p.meters } : p.mode === "longest" ? { resize_longest_side: p.meters } : { auto_size: true }),
        ...(p.origin_at ? { origin_at: p.origin_at } : {}),
      };
    }
    case "convert": return { target_formats: (params as ConvertParams).target_formats };
    case "rig": { const h = (params as RigParams).height_meters; return h ? { height_meters: h } : {}; }
    case "motion": { const p = params as MotionParams; return { prompt: p.prompt.slice(0, 400), mode: p.mode ?? "prime", duration: p.duration }; }
    case "animate": {
      const p = params as AnimateParams;
      return {
        ...(p.fromMotion ? {} : p.action_ids!.length === 1 ? { action_id: p.action_ids![0] } : { action_ids: p.action_ids }),
        ...(p.post_process ? { post_process: p.post_process } : {}),
      };
    }
  }
  return {};
}

// Concept images ---------------------------------------------------------------

export const IMAGE_MODELS = ["nano-banana", "nano-banana-2", "nano-banana-pro", "gpt-image-2", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst"] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];
const isGpt = (m: ImageModel) => m.startsWith("gpt-image");
export const aspectRatios = (m: ImageModel) => isGpt(m) ? ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] : ["1:1", "16:9", "9:16", "4:3", "3:4"];

export interface ConceptParams {
  ai_model: ImageModel;
  prompt: string;
  generate_multi_view?: boolean;
  /** Text to Image only. */
  pose_mode?: "a-pose" | "t-pose";
  aspect_ratio?: string;
  remove_background?: boolean;
}

/** Per image, from the pricing page. Image to Image costs more on the GPT models. */
export function estimateConcept(kind: "text-to-image" | "image-to-image", m: ImageModel): number {
  if (m === "nano-banana") return 3;
  if (m === "nano-banana-2") return 6;
  if (m === "nano-banana-pro") return 9;
  return kind === "image-to-image" ? 12 : 9;
}

export function checkConcept(kind: "text-to-image" | "image-to-image", p: ConceptParams, references = 0): string[] {
  const out: string[] = [];
  if (!p.prompt?.trim()) out.push("Write a prompt.");
  if (p.generate_multi_view && p.aspect_ratio) out.push("Multi-view images can't take an aspect ratio.");
  if (p.aspect_ratio && !aspectRatios(p.ai_model).includes(p.aspect_ratio)) out.push(`${p.ai_model} doesn't do ${p.aspect_ratio}.`);
  if (kind === "image-to-image" && (references < 1 || references > 5)) out.push("Image to Image takes 1 to 5 reference images.");
  return out;
}

export function conceptBody(kind: "text-to-image" | "image-to-image", p: ConceptParams, references: string[] = []) {
  return {
    ai_model: p.ai_model,
    prompt: p.prompt,
    ...(kind === "image-to-image" ? { reference_image_urls: references.slice(0, 5) } : {}),
    ...(p.generate_multi_view ? { generate_multi_view: true } : p.aspect_ratio ? { aspect_ratio: p.aspect_ratio } : {}),
    ...(kind === "text-to-image" && p.pose_mode ? { pose_mode: p.pose_mode } : {}),
    ...(p.remove_background ? { remove_background: true } : {}),
  };
}
