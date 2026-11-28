// The room's light desk: how bright the room is, what colour the truss's moving heads are and whether its lasers run.
// One setting for the sesh, kept on its groove (the lights edit in project.ts), so everyone sees the same; the lights
// grant (src/grants.ts) is what lets someone work it. Pure, so the World, the page and the tests share it.
import { bool, int, obj, oneOf, type Of } from "@rustybuns/util/guard";

export const LIGHT_LEVELS = ["full", "dim", "dark"] as const;
/** The moving heads' colour picks, after "each its own" (-1): the heads' four (open-air.ts BEAMS). */
export const BEAM_WORDS = ["Magenta", "Cyan", "Amber", "Violet"] as const;
export const StageLights = obj({ level: oneOf(LIGHT_LEVELS), beam: int(-1, BEAM_WORDS.length - 1), lasers: bool() });
export type StageLights = Of<typeof StageLights>;
export const HOUSE_LIGHTS: StageLights = { level: "full", beam: -1, lasers: true };
/** How much of each lamp's own light is left at a level. */
export const LEVEL_GAIN: Record<StageLights["level"], number> = { full: 1, dim: 0.3, dark: 0.03 };
