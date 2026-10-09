// Who's at the council, and how each of them acts out what they're doing. You are Qoa; every worker is one of
// the game's enemies, at a standing desk. Pure: no three.js, tested.

/** What a worker is doing, as one of these. */
export type Role =
  | "idle" | "walk" | "run" | "cast" | "test" | "read" | "victory" | "jump" | "hit" | "carry" | "defeat" | "death";

/** Role → clip name in the model (Meshy's `Armature|X|baselayer` wrapping is stripped before matching).
 *  A role a model has no clip for falls back to idle (or walk, for carry and run). */
export type Clips = Partial<Record<Role, string>>;

const QUATERNIUS: Clips = {
  idle: "Idle", walk: "Walk", run: "Run", cast: "Shoot_OneHanded", test: "SwordSlash", read: "PickUp", victory: "Victory",
  jump: "Jump", hit: "RecieveHit", carry: "Walk_Carry", defeat: "Defeat", death: "Death",
};

/** Every race in Druids Curse, from druids-curse-votv's models.ts. `file` is under /non_repo/models/. */
export const CAST = {
  druid: { file: "player_character", clips: QUATERNIUS },
  witch: { file: "Witch", clips: QUATERNIUS },
  goblin: { file: "Goblin_Male", clips: QUATERNIUS },
  goblin_f: { file: "Goblin_Female", clips: QUATERNIUS },
  ninja: { file: "Ninja_Male", clips: QUATERNIUS },
  ninja_f: { file: "Ninja_Female", clips: QUATERNIUS },
  zombie: { file: "Zombie_Male", clips: QUATERNIUS },
  zombie_f: { file: "Zombie_Female", clips: QUATERNIUS },
  maren: {
    file: "characters/Maren",
    clips: {
      idle: "Idle_3", walk: "walking_man", cast: "Talk_with_Hands_Open", test: "Talk_Passionately", read: "Confused_Scratch",
      victory: "Agree_Gesture", jump: "Wave_for_Help_4", hit: "Confused_Scratch", defeat: "Sit_and_Drink", death: "Sit_and_Drink",
    },
  },
  qoa: {
    file: "characters/Qoa_Character_merged",
    clips: {
      idle: "Idle_5", walk: "walking_man", run: "running", cast: "Push_Forward_and_Stop", test: "Weapon_Combo", read: "Torch_Look_Around",
      victory: "Axe_Spin_Attack", jump: "Basic_Jump", hit: "Stand_Up1", carry: "Spear_Walk", defeat: "Dead", death: "Dead",
    },
  },
  void_wolf: {
    file: "characters/VoidWolf1",
    clips: {
      idle: "Idle_5", walk: "walking_man", cast: "Female_Bow_Charge_Left_Hand", test: "Charged_Slash", read: "Alert",
      victory: "Backflip", jump: "Jump_Run", hit: "Face_Punch_Reaction_1", defeat: "falling_down", death: "Dead",
    },
  },
  voidmire: {
    file: "characters/Voidmire1",
    clips: {
      idle: "Idle_5", walk: "walking_man", cast: "Right_Hand_Sword_Slash", test: "Charged_Upward_Slash", read: "CrouchLookAroundBow",
      victory: "Backflip_and_Rise", jump: "Jump_Run", hit: "Roll_Dodge_1", carry: "Cautious_Crouch_Walk_Forward", defeat: "Dead", death: "Dead",
    },
  },
  toadmire: {
    file: "characters/Toadmire1",
    clips: {
      idle: "Alert", walk: "walking_man", cast: "Skill_01", test: "Punch_Combo_1", read: "Alert_Quick_Turn_Right",
      victory: "Zombie_Scream", jump: "Back_Jump", hit: "Block10", defeat: "Lie_Down_Hands_Spread", death: "dying_backwards",
    },
  },
  skeleton: {
    file: "characters/Skeleton001",
    clips: {
      idle: "Idle_8", walk: "Walking", cast: "Shield_Push_Left", test: "Charged_Slash", read: "Formal_Bow",
      victory: "Spartan_Kick", jump: "Roll_Dodge", hit: "Block4", carry: "Slow_Orc_Walk", defeat: "Sleep_Normally", death: "Knock_Down_1",
    },
  },
  kaladen: {
    file: "characters/Kaladen",
    clips: {
      idle: "Idle_4", walk: "Casual_Walk", cast: "Charged_Spell_Cast", test: "Charged_Ground_Slam", read: "Alert",
      victory: "Angry_Ground_Stomp_2", jump: "Dive_Down_and_Land_2", hit: "Block10", carry: "Injured_Walk",
      defeat: "falling_down", death: "Fall_Dead_from_Abdominal_Injury",
    },
  },
} satisfies Record<string, { file: string; clips: Clips }>;

export type Race = keyof typeof CAST;
export const RACES = Object.keys(CAST) as Race[];
/** You, and everyone else walking around the office. */
export const PLAYER: Race = "qoa";
/** The workers: the game's enemies (not its heroes, Qoa and the druid, nor Maren the villager). */
export const ENEMIES = RACES.filter((r) => !["qoa", "druid", "maren"].includes(r));

/** The clip a model plays for a role, falling back to idle. */
export function clipName(race: Race, role: Role): string {
  const clips: Clips = CAST[race].clips;
  return clips[role] ?? (role === "carry" || role === "run" ? clips.walk : undefined) ?? clips.idle!;
}

/** Meshy names its clips `Armature|Idle_5|baselayer`; Quaternius just `Idle`. */
export const bareClip = (name: string) => name.replace(/^Armature\|/, "").replace(/\|baselayer$/, "");

/** What a worker is doing, read off the office's own worker. */
export interface Pose {
  status: string;
  action?: string;
  bouncing: boolean;
  bounceT: number;
  cheerT: number;
  walking: boolean;
  dancing: unknown;
  leaving: unknown;
  jailed: { dead?: boolean } | null;
}

/** Office pose → role, and whether it loops. Coding is spellcasting. */
export function roleFor(w: Pose): [Role, boolean] {
  if (w.jailed) return [w.jailed.dead ? "death" : "defeat", false];
  if (w.leaving) return [w.walking ? "carry" : "idle", true];
  if (w.dancing) return ["victory", true];
  if (w.walking) return ["walk", true];
  if (w.bounceT > 0 || w.cheerT > 0 || (w.bouncing && w.status === "done"))
    return [w.status === "needs_input" ? "jump" : "victory", true];
  if (w.status !== "working") return ["idle", true];
  switch (w.action ?? "type") {
    case "test": return ["test", true];
    case "read": return ["read", true];
    case "failing": return ["hit", true];
    default: return ["cast", true]; // type, edit, web
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
export function personRole(moving: boolean, airborne: boolean, speed: number): Role {
  return airborne ? "jump" : moving ? (speed > 1.3 ? "run" : "walk") : "idle";
}
