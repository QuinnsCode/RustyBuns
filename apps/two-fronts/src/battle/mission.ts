// The hero's mission, for the HUD: one place to be and what to do there. Defend a post your side
// holds, take one it doesn't, walk the champion in or stop them. Away from it you're told to make
// your way there; step out of it once you've arrived and you're warned you're leaving the area.
import type { Side } from "./contract.ts";
import { POST_RADIUS, objective, vipUnit, type Battle, type Post } from "./sim.ts";

export type Verb = "Defend" | "Take" | "Escort" | "Stop" | "Reach";
export interface Mission { verb: Verb; name: string; x: number; z: number; r: number }
// travel: on the way; in: inside the area; leaving: just outside it after being in it.
export type Standing = "travel" | "in" | "leaving";

export const AREA = POST_RADIUS * 2.5;   // a post's area: the ring and the ground round it
const ESCORT_AREA = 20;                  // keep this close to the champion
const LEAVE_BAND = 1;                    // past r, out to r * (1 + LEAVE_BAND), you're warned; beyond, you're travelling again

export function mission(b: Battle, side: Side): Mission {
  if (b.mode === "escort") {
    const keep = b.posts.at(-1)!, vip = vipUnit(b), name = vip?.champ === "warbur" ? "Warbur" : "Gumpert";
    if (!vip) return { verb: side === "attacker" ? "Take" : "Defend", name: keep.name, x: keep.x, z: keep.z, r: AREA };
    if (vip.id === b.hero.id) return { verb: "Reach", name: keep.name, x: keep.x, z: keep.z, r: POST_RADIUS };
    return { verb: side === "attacker" ? "Escort" : "Stop", name, x: vip.x, z: vip.z, r: ESCORT_AREA };
  }
  // Outside an escort, objective() hands back the post itself.
  const p = b.mode === "assault" || b.mode === "hill" ? b.posts[b.live]! : (objective(b, side) as Post);
  // A post your side holds is yours to defend; anything else is yours to take.
  return { verb: p.owner === side ? "Defend" : "Take", name: p.name, x: p.x, z: p.z, r: AREA };
}

// Where the hero stands against the mission, given where they stood last time (so "leaving" only
// shows after they've been in the area).
export function standing(m: Mission, at: { x: number; z: number }, was: Standing): Standing {
  const d = Math.hypot(at.x - m.x, at.z - m.z);
  if (d <= m.r) return "in";
  if (d <= m.r * (1 + LEAVE_BAND) && was !== "travel") return "leaving";
  return "travel";
}

// The same mission, give or take a moving champion: when this changes, the objective's done.
export const sameMission = (a: Mission, c: Mission) => a.verb === c.verb && a.name === c.name;
