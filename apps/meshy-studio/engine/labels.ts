// The filename is the label: <prefix>_<name>[_h<meters> | _l<meters> | _auto][_bottom | _center][_draft].png
// flora_oak_h12_bottom.png -> preset "flora_", 12 m tall, origin at the bottom, output flora_oak.glb
// _auto lets Meshy guess the real-world height; _draft makes an untextured shape to texture later.

import type { Origin, Preset, Size } from "./presets.ts";
import { presetFor } from "./presets.ts";

export const IMAGE_EXT = /\.(png|jpe?g)$/i;
/** <stem>.texture.png beside an image is its texture reference, not a job of its own. */
export const TEXTURE_REF = /\.texture\.(png|jpe?g)$/i;

export interface Label {
  preset: Preset;
  /** Output base name with the size/origin tokens stripped, no extension. */
  outName: string;
  /** From the filename, or the preset's default. */
  size: Size;
  origin: Origin;
  /** True when no prefix matched and the default preset was used. */
  unknownPrefix: boolean;
  draft: boolean;
}

const SIZE_TOKEN = /^([hl])(\d+(?:\.\d+)?)$/i;

export function parseLabel(fileName: string, presets: Preset[]): Label {
  const stem = fileName.replace(IMAGE_EXT, "");
  const parts = stem.split("_");
  let size: Size | undefined;
  let origin: Origin | undefined;
  let draft = false;
  // Tokens only count at the end, so "flora_center_piece" keeps its name.
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    const m = SIZE_TOKEN.exec(last);
    if (m && !size) {
      const meters = Number(m[2]);
      if (!(meters > 0)) break;
      size = m[1]!.toLowerCase() === "h" ? { height: meters } : { longest: meters };
    } else if (/^auto$/i.test(last) && !size) {
      size = { auto: true };
    } else if (/^draft$/i.test(last) && !draft) {
      draft = true;
    } else if (/^(bottom|center|centre)$/i.test(last) && !origin) {
      origin = last.toLowerCase() === "bottom" ? "bottom" : "center";
    } else break;
    parts.pop();
  }
  const preset = presetFor(stem, presets);
  return {
    preset,
    outName: parts.join("_"),
    size: size ?? preset.size,
    origin: origin ?? preset.origin,
    unknownPrefix: preset.prefix === "",
    draft,
  };
}

export const describeSize = (s: Size) => "height" in s ? `${s.height} m tall` : "longest" in s ? `longest side ${s.longest} m` : "Meshy's size guess";
