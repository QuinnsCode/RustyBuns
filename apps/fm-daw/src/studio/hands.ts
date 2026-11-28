// What the jam room shows of the grants (src/grants.ts): who leads, who has a hand up and for what, what someone who
// doesn't play does instead (runs the console or the lights, talks only, listens only), and who the leader muted. The page puts
// these over each character (badge.ts) and in its list of who's here. The World checks every note against the same
// grants; this only shows them. Pure, so the page and the tests share it.
import type { GuestList } from "@rustybuns/util/guests";
import { isMuted, leaders, type Can, type GrantServer } from "../grants.ts";
import { mayHere } from "../guest-list.ts";
import type { Floor } from "../project.ts";

export interface Marks { lead: boolean; hand: Can | null; listen: boolean; as: string; muted: boolean }
export const NO_MARKS: Marks = { lead: false, hand: null, listen: false, as: "", muted: false };

/** This person's marks, from the World's last grants. None before the grants come, or in a sesh with no floor. */
export function marks(g: GrantServer | null, floor: Floor | undefined, who: string | undefined, guests?: GuestList | null): Marks {
  if (!g || !floor || !who) return NO_MARKS;
  const lead = leaders(g.grants).includes(who);
  const may = (c: Can) => mayHere(guests, g.grants, floor, who, false, c);
  const listen = !lead && !may("play");
  const does = [may("mix") && "Console", may("lights") && "Lights"].filter(Boolean).join(" and ");
  return { lead, hand: g.asks[who] ?? null, listen, as: !listen ? "" : does || (may("speak") ? "Talk only" : "Listen only"), muted: isMuted(g.grants, who) };
}

const ASK: Record<Can, string> = { play: "to play", edit: "to edit the groove", mix: "to mix", lights: "to run the lights", speak: "to speak", lead: "to lead" };
/** The marks as words, in the order the badge shows them. */
export function words(m: Marks): string[] {
  return [m.lead && "Leads", m.hand && `Hand up ${ASK[m.hand]}`, m.listen && m.as, m.muted && "Muted for everyone"].filter((w): w is string => !!w);
}

/** The person ids with a hand up who are in the room now, for the leader to answer. */
export const handsUp = (g: GrantServer | null): string[] => (g ? Object.keys(g.asks).filter((id) => g.here.includes(id)) : []);
