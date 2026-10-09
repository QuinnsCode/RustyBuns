// The filename is the label: <prefix>_<name>[_h<meters> | _l<meters>][_bottom | _center].png
// flora_oak_h12_bottom.png -> preset "flora_", 12 m tall, origin at the bottom, output flora_oak.glb

import type { Origin, Preset, Size } from "./presets.ts";
import { presetFor } from "./presets.ts";

export const IMAGE_EXT = /\.(png|jpe?g)$/i;

export interface Label {
  preset: Preset;
  /** Output base name with the size/origin tokens stripped, no extension. */
  outName: string;
  /** From the filename, or the preset's default. */
  size: Size;
  origin: Origin;
  /** True when no prefix matched and the default preset was used. */
  unknownPrefix: boolean;
}

const SIZE_TOKEN = /^([hl])(\d+(?:\.\d+)?)$/i;

export function parseLabel(fileName: string, presets: Preset[]): Label {
  const stem = fileName.replace(IMAGE_EXT, "");
  const parts = stem.split("_");
  let size: Size | undefined;
  let origin: Origin | undefined;
  // Tokens only count at the end, so "flora_center_piece" keeps its name.
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    const m = SIZE_TOKEN.exec(last);
    if (m && !size) {
      const meters = Number(m[2]);
      if (!(meters > 0)) break;
      size = m[1]!.toLowerCase() === "h" ? { height: meters } : { longest: meters };
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
  };
}

export const describeSize = (s: Size) => "height" in s ? `${s.height} m tall` : `longest side ${s.longest} m`;
