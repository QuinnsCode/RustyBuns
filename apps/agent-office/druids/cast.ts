// Who's at the council, and how each of them acts out what they're doing. You are Qoa; every worker is one of
// the game's enemies, at a standing desk. Pure: no three.js, tested.

/** What a worker is doing, as one of these: walking about, standing, or one of two attacks. */
export type Role = "idle" | "walk" | "run" | "attack" | "strike";

/** Role → clip name in the model (Meshy's `Armature|X|baselayer` wrapping is stripped before matching). Only
 *  people run; workers walk. */
export type Clips = Record<Role, string>;

/** Druids Curse's own models, from druids-curse-votv's models.ts (the clips are the game's too). `file` is under
 *  /non_repo/models/. No Quaternius: just the vale's skeletons, Voidmires, void wolves and the Bound Druid. */
export const CAST = {
  qoa: {
    file: "characters/Qoa_Character_merged",
    clips: { idle: "Idle_5", walk: "walking_man", run: "running", attack: "Weapon_Combo", strike: "Axe_Spin_Attack" },
  },
  skeleton: {
    file: "characters/Skeleton001",
    clips: { idle: "Idle_8", walk: "Walking", run: "Running", attack: "Charged_Slash", strike: "Spartan_Kick" },
  },
  voidmire: {
    file: "characters/Voidmire1",
    clips: { idle: "Idle_5", walk: "walking_man", run: "running", attack: "Right_Hand_Sword_Slash", strike: "Charged_Upward_Slash" },
  },
  void_wolf: {
    file: "characters/VoidWolf1",
    clips: { idle: "Idle_5", walk: "walking_man", run: "running", attack: "Charged_Slash", strike: "Jumping_Punch" },
  },
  /** Kaladen, the Bound Druid: the game's boss. */
  kaladen: {
    file: "characters/Kaladen",
    clips: { idle: "Idle_4", walk: "walking_man", run: "running", attack: "Charged_Spell_Cast", strike: "Charged_Ground_Slam" },
  },
} satisfies Record<string, { file: string; clips: Clips }>;

export type Race = keyof typeof CAST;
export const RACES = Object.keys(CAST) as Race[];
/** You, and everyone else walking around the office. */
export const PLAYER: Race = "qoa";
/** The workers: everyone but Qoa. */
export const ENEMIES = RACES.filter((r) => r !== PLAYER);

/** The clip a model plays for a role. */
export const clipName = (race: Race, role: Role): string => CAST[race].clips[role];

/** Meshy names its clips `Armature|Idle_5|baselayer`; the skeleton's are bare. */
export const bareClip = (name: string) => name.replace(/^Armature\|/, "").replace(/\|baselayer$/, "");

/** What a worker is doing, read off the office's own worker. */
export interface Pose {
  status: string;
  action?: string;
  cheerT: number;
  walking: boolean;
  dancing: unknown;
  leaving: unknown;
  jailed: unknown;
}

/** Office pose → role. Coding is a swing, testing (and cheering a merge) the big strike, reading a look at the
 *  page; a worker who's out of it (jailed, waiting on you, done) just stands. */
export function roleFor(w: Pose): Role {
  if (w.walking) return "walk";
  if (w.jailed || w.leaving) return "idle";
  if (w.dancing || w.cheerT > 0) return "strike";
  if (w.status !== "working") return "idle";
  switch (w.action ?? "type") {
    case "test": return "strike";
    case "read": return "idle";
    default: return "attack"; // type, edit, web, failing
  }
}

/** A worker's name picks their enemy, skipping ones already at a desk, so the same worker usually comes back as
 *  the same enemy and nobody shares one until every enemy is there. */
export function raceFor(name: string, taken: Iterable<string> = []): Race {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const start = (h >>> 0) % ENEMIES.length;
  const busy = new Set(taken);
  for (let i = 0; i < ENEMIES.length; i++) {
    const r = ENEMIES[(start + i) % ENEMIES.length]!;
    if (!busy.has(r)) return r;
  }
  return ENEMIES[start]!;
}

/** What a person (you, or anyone else walking around) is doing, from the office's own person update. */
export function personRole(moving: boolean, speed: number): Role {
  return moving ? (speed > 1.3 ? "run" : "walk") : "idle";
}
