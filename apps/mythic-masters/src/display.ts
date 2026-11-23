// Settings > Display, the parts with no page in them: which quality the player chose (a tier, or Auto: the machine's
// guess held to the frame budget), remembering or forgetting it, and what the Rendering and Vision rows ask of the
// renderer and the camera. main.ts applies them; test/settings.test.ts reads them here.
import { type Settings } from "@rustybuns/game-controls";
import { pickQuality, type Quality, QUALITY, saveQuality, STORE_KEY } from "@rustybuns/util/quality";

export type Choice = "auto" | Quality;
export const CHOICES: [Choice, string][] = [["auto", "Auto"], ["low", "Low"], ["mid", "Mid"], ["high", "High"]];
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The tier to start on and whether the player chose it (`?quality=` or a saved pick) or left it to Auto. */
export function startChoice(opts: Parameters<typeof pickQuality>[0] = {}): { tier: Quality; choice: Choice } {
  const p = pickQuality(opts);
  return { tier: p.quality, choice: p.why === "machine" ? "auto" : p.quality };
}

/** Remember a hand-picked tier, or (Auto) forget it so the next load guesses again. */
export function choose(c: Choice, store: Store | null) {
  if (c === "auto") { try { store?.removeItem(STORE_KEY); } catch { /* private window */ } }
  else saveQuality(c, store);
}

/** What the Display rows ask for: the scene's brightness, how hard a hit shakes the camera (none with reduced motion), still pages, bloom. */
export function looksOf(s: Settings, osStill: boolean) {
  const still = osStill || s.more.reduceMotion === true;
  const shake = typeof s.more.shake === "number" ? s.more.shake : 1;
  return { brightness: s.brightness, shake: still ? 0 : shake, still, bloom: s.more.bloom !== false };
}

/** The line under the quality picker: what draws now, who steers it, and whether edge smoothing waits for a reload. */
export function qualityNote(drawn: Quality, choice: Choice, loadedAntialias: boolean): string {
  const who = choice === "auto" ? "Auto: the frame budget steps it down when frames run slow." : "Held where you put it.";
  const aa = QUALITY[drawn].antialias !== loadedAntialias ? " Edge smoothing follows on the next reload." : "";
  return `Drawing at ${drawn[0]!.toUpperCase()}${drawn.slice(1)}. ${who} Detail, shadows, bloom and plant reach change at once.${aa}`;
}
