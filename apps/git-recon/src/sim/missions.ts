// What a level asks of you. Every level is a repo in conflict; the mission is what winning means there:
//   clear   take every compound (down its guards) and the repo is merged
//   carry   a commit sits in the farthest compound's yard; bring it back to HEAD (where you start)
//   defend  hold the branch you start on for N seconds while the compounds send raids at it in waves

export type Mission =
  | { kind: "clear" }
  | { kind: "carry" }
  | { kind: "defend"; seconds: number; wave: number };

/** Each level's mission, by level id. A level not listed is "clear". */
export const MISSIONS: Record<string, Mission> = {
  "el-capitan": { kind: "carry" },
  backyard: { kind: "defend", seconds: 120, wave: 20 },
};

export const missionFor = (levelId: string): Mission => MISSIONS[levelId] ?? { kind: "clear" };

/** The line the HUD and the menu show. */
export function briefing(m: Mission): string {
  if (m.kind === "carry") return "Carry the commit back to HEAD";
  if (m.kind === "defend") return `Defend main for ${Math.round(m.seconds / 60 * 10) / 10} min`;
  return "Merge every folder";
}

/** HEAD for a carry, the branch for a defend: how close counts as there, in metres. */
export const HEAD_RADIUS = 4, BRANCH_RADIUS = 9;
/** Guard-seconds inside the branch before it's overwritten and the defend is lost. */
export const OVERRUN = 6;
