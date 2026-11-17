// Your ink (#5029 step 11): a flash tattoo earned at each rung of the tour you pass, each with its own place on a
// forearm, and one tattoo of your own from a picture you pick. Plain data and rules here (the test reads them);
// ink-draw.ts paints the skin, ink-view.ts is the scrap on the menu.
import { check, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

export type Arm = "left" | "right";
/** Where a tattoo sits: which forearm, how far from wrist (0) to elbow (1), and how far round from the top (-0.5 to 0.5). */
export type Spot = { arm: Arm; at: number; round: number };

/** One tattoo per rung, by level name, in the order of the ladder. The arms fill from the wrist up as the tour goes. */
export const FLASH: Readonly<Record<string, Spot & { what: string }>> = {
  "first-gig": { what: "a cable roll and a banner", arm: "right", at: 0.2, round: 0 },
  "dive-bar": { what: "a mic plug between two leaves", arm: "left", at: 0.2, round: 0 },
  "bigger-bar": { what: "a breaker's lightning bolt", arm: "right", at: 0.45, round: -0.16 },
  park: { what: "a tree over a speaker", arm: "left", at: 0.45, round: 0.16 },
  desert: { what: "a sun over a stack", arm: "right", at: 0.5, round: 0.14 },
  festival: { what: "a tent and its flag", arm: "left", at: 0.5, round: -0.14 },
  "small-arena": { what: "a chain hoist hook", arm: "right", at: 0.78, round: -0.08 },
  arena: { what: "a line array wing", arm: "left", at: 0.78, round: 0.08 },
  amphitheatre: { what: "two red rocks and a moon", arm: "right", at: 0.8, round: 0.2 },
};

/** The rungs you have passed, each once, in ladder order: the tattoos you have earned. */
export function earned(nights: readonly { level: string; pass: 0 | 1 }[]): string[] {
  const passed = new Set(nights.filter((n) => n.pass === 1).map((n) => n.level));
  return Object.keys(FLASH).filter((level) => passed.has(level));
}

/** Your own tattoo: a picture (a data URL kept in this browser only) and where it sits. */
export const Look = obj({
  own: opt(str(1_500_000)),
  arm: oneOf(["left", "right"]),
  at: num(0.1, 0.9),
  size: num(0.15, 0.7),
  /** Your high-tops' colour (src/you/shoes.ts); black when a save has none. */
  shoes: opt(oneOf(["black", "red", "navy", "cream", "green", "yellow"])),
});
export type Look = Of<typeof Look>;
export const plainLook = (): Look => ({ arm: "left", at: 0.62, size: 0.4 });

/** A saved look read back, or the plain one when it is missing or broken (an old save, a hand edit, a full disk). */
export function readLook(raw: unknown): Look {
  const l = check(Look, raw);
  return l && (l.own === undefined || l.own.startsWith("data:image/")) ? l : plainLook();
}
