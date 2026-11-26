// The Event Planner's lesson (#6085, PATHWAYS.md section 5), on /rooms.html: plan the PA for a field. On the Desert
// Gathering with its stacks taken away, stand two stacks apart either side of the front, aim them at the middle of the
// ground, put the rig on a generator that holds it, and take the gear list away. Every step reads the room the
// builder's own edits made (builder.ts) and the same coverage map and power plan the PA panel shows (coverage.ts,
// @rustybuns/gear powerPlan), so a step goes green when the plan really does what it says. Pure: no DOM.
import { type Step, powerPlan } from "@rustybuns/gear";
import type { FloorMap } from "./coverage.ts";
import { rigPlan, roomPa } from "./pa-room.ts";
import type { PageLessonDef } from "./page-lesson.ts";
import type { StudioDef } from "./room.ts";

/** What a step reads: the room as the builder has it, its coverage map (null: no speakers), and whether the gear list went out. */
export type PlanAt = { def: StudioDef; map: FloorMap | null; listed: boolean };

/** The field the lesson starts on, its stacks taken away. */
export const PLAN_ROOM = "desert-gathering";
/** How far apart the two stacks stand, at least, metres; how far off the ground's middle a stack may point, degrees. */
export const STACK_SPREAD_M = 10, AIM_DEG = 20;

const stacks = (def: StudioDef) => roomPa(def)?.stacks ?? [];
const r1 = (v: number) => Math.round(v * 10) / 10;
/** The widest two stacks stand apart, metres. */
const spread = (def: StudioDef) => { const s = stacks(def); let w = 0; for (const a of s) for (const b of s) w = Math.max(w, Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])); return w; };
/** How far each stack points off the ground's middle, degrees (a stack's yaw faces (sin, cos), as the builder places it). */
const offMiddle = (def: StudioDef) => stacks(def).map((s) => {
  const want = Math.atan2(-s.at[0], -s.at[1]), d = Math.atan2(Math.sin(s.yaw - want), Math.cos(s.yaw - want));
  return Math.round((Math.abs(d) * 180) / Math.PI);
});
const power = (def: StudioDef) => { const rp = rigPlan(def); return rp ? powerPlan(rp) : null; };

const STEPS: Step<PlanAt>[] = [
  {
    job: `Stand two stacks ${STACK_SPREAD_M} m or more apart, one each side of the front: the PA tool, then a click on the plan for each`,
    done: ({ def }) => stacks(def).length >= 2 && spread(def) >= STACK_SPREAD_M,
    why: ({ def, map }) => {
      const n = stacks(def).length;
      if (n === 1 && map) return `One stack throws at its own side of the field: the quietest part of the crowd hears it ${Math.round(map.ref - map.stats.min)} dB under the middle. A second stack on the other side fills that in`;
      if (n >= 2) return `The stacks stand ${r1(spread(def))} m apart: the field hears one source, and its edges go quiet. Spread them ${STACK_SPREAD_M} m or more apart (Move drags one)`;
      return null;
    },
  },
  {
    job: `Aim each stack at the middle of the ground, within ${AIM_DEG}°: Turn, then a click on a stack turns it a twelfth (Shift: back)`,
    done: ({ def }) => stacks(def).length >= 2 && offMiddle(def).every((d) => d <= AIM_DEG),
    why: ({ def }) => {
      const off = offMiddle(def), worst = off.reduce((w, d, i) => (d > off[w]! ? i : w), 0), deg = off[worst];
      if (deg === undefined || deg <= AIM_DEG) return null;
      if (deg > 100) return `Stack ${worst + 1} faces away from the crowd: its boxes throw at the back of the field and the crowd hears only what spills out behind. Turn it round to face the middle`;
      return `Stack ${worst + 1} points ${deg}° off the middle: a box is loudest along its axis, so the middle hears it quieter and the edge it points at hears it twice. Turn it in`;
    },
  },
  {
    job: "Pick the generator: in the PA panel, a set that gives more than the rig draws at show level",
    done: ({ def }) => !!def.outdoor?.generator?.set && !!power(def)?.ok,
    why: ({ def }) => {
      if (!def.outdoor) return `This room runs off the venue's mains: a generator stands out of doors. Load the Desert Gathering again to plan one`;
      const p = power(def);
      return def.outdoor.generator?.set && p && !p.ok ? p.why[0] ?? null : null;
    },
  },
  {
    job: "Take the gear list away: Gear list, in the PA panel, has every box, rack, cable run and the power plan",
    done: ({ listed }) => listed,
  },
];

export const PLAN_LESSON: PageLessonDef<PlanAt> = {
  id: "plan", title: "Plan the PA for a field", blurb: "Two stacks either side, aimed at the middle, on a generator that holds them, and the gear list", steps: STEPS,
};
