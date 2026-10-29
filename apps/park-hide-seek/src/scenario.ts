// Jump to a round: a solo room against bots where you are the hider or the seeker, from a URL
// (?role=seeker&bots=2&level=hard) or from an agent (window.parkHideSeek.start). Pure: main.ts starts the room from it.
// ?room=CODE is the other way in (a live online room) and wins when both are given.
import { int, obj, oneOf, type Of } from "@rustybuns/util/guard";

export const Scenario = obj({
  role: oneOf(["hider", "seeker"] as const, "hider"),
  bots: int(1, 7, 3),
  level: oneOf(["easy", "normal", "hard"] as const, "normal"),
});
export type Scenario = Of<typeof Scenario>;

/** The scenario a query string asks for, or null: `?role=` is what asks, and no `?room=`. */
export function fromSearch(search: string): Scenario | null {
  const q = new URLSearchParams(search);
  if (q.has("room") || !q.has("role")) return null;
  const bots = Number(q.get("bots"));
  return Scenario({ role: q.get("role"), bots: q.get("bots") ? bots : undefined, level: q.get("level") });
}

/** The link that lands in the scenario. */
export const toSearch = (s: Scenario) => `?${new URLSearchParams(Object.entries(s).map(([k, v]) => [k, String(v)]))}`;

/** The game's role for the scenario's. */
export const roleOf = (s: Scenario) => (s.role === "seeker" ? "ranger" : "camper") as "ranger" | "camper";
