// What the jam room shows of the grants (src/grants.ts): who leads, who has a hand up and for what, who may only
// listen (neither their grant nor the floor lets them play), and who the leader muted for everyone. The page puts
// these over each character (badge.ts) and in its list of who's here. The World checks every note against the same
// grants; this only shows them. Pure, so the page and the tests share it.
import { isMuted, leaders, may, type Can, type GrantServer } from "../grants.ts";
import type { Floor } from "../project.ts";

export interface Marks { lead: boolean; hand: Can | null; listen: boolean; muted: boolean }
export const NO_MARKS: Marks = { lead: false, hand: null, listen: false, muted: false };

/** This person's marks, from the World's last grants. None before the grants come, or in a sesh with no floor. */
export function marks(g: GrantServer | null, floor: Floor | undefined, who: string | undefined): Marks {
  if (!g || !floor || !who) return NO_MARKS;
  const lead = leaders(g.grants).includes(who);
  return { lead, hand: g.asks[who] ?? null, listen: !lead && !may(g.grants, floor, who, false, "play"), muted: isMuted(g.grants, who) };
}

const ASK: Record<Can, string> = { play: "to play", edit: "to edit the groove", mix: "to mix", lead: "to lead" };
/** The marks as words, in the order the badge shows them. */
export function words(m: Marks): string[] {
  return [m.lead && "Leads", m.hand && `Hand up ${ASK[m.hand]}`, m.listen && "Listen only", m.muted && "Muted for everyone"].filter((w): w is string => !!w);
}

/** The person ids with a hand up who are in the room now, for the leader to answer. */
export const handsUp = (g: GrantServer | null): string[] => (g ? Object.keys(g.asks).filter((id) => g.here.includes(id)) : []);
