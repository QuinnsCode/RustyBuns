// Presets: a filename prefix picks the Meshy options, the default size and the origin.
// They live in the workspace as meshy-presets.json so people can edit and share them.

export type Origin = "bottom" | "center";
/** Target size in meters: height, or the longest side. */
export type Size = { height: number } | { longest: number };

/** The Image to 3D options a preset may set (docs.meshy.ai/en/api/image-to-3d). */
export interface MeshyOptions {
  ai_model?: "latest" | "meshy-7.1" | "meshy-6" | "meshy-6-lite" | "meshy-t2";
  model_type?: "standard" | "smart-topology";
  target_polycount?: number;
  topology?: "triangle" | "quad";
  should_remesh?: boolean;
  should_texture?: boolean;
  enable_pbr?: boolean;
  texture_resolution?: "2k" | "4k" | "8k";
  pose_mode?: "" | "a-pose" | "t-pose";
}

export interface Preset {
  /** Matched against the start of the filename, e.g. "flora_". "" is the default preset. */
  prefix: string;
  label: string;
  options: MeshyOptions;
  size: Size;
  origin: Origin;
}

export const STARTER_PRESETS: Preset[] = [
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

/** The request body for POST /image-to-3d. Always glb only: the app never needs the other formats. */
export function createBody(imageDataUri: string, options: MeshyOptions, texturePrompt?: string) {
  return {
    image_url: imageDataUri,
    ...options,
    ...(texturePrompt ? { texture_prompt: texturePrompt.slice(0, 800) } : {}),
    target_formats: ["glb"],
  };
}

/**
 * Credits one job costs, from docs.meshy.ai/en/api/pricing (Oct 2026), plus 10 for a
 * texture prompt (image-to-3d reference). An estimate: Meshy's own count is the truth.
 */
export function estimateCredits(options: MeshyOptions, texturePrompt?: string): number {
  const lite = options.ai_model === "meshy-6-lite" || options.model_type === "smart-topology" || options.ai_model === "meshy-t2";
  const textured = options.should_texture !== false;
  let n = !textured ? (lite ? 5 : 20) : lite ? 15 : 30;
  if (textured && options.texture_resolution === "8k") n += 5;
  if (textured && texturePrompt) n += 10;
  return n;
}
