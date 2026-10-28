// The live socket (/api/live) between the arena and the page: one type, sent by arena.ts and read by
// app/viewer.ts. Its own file so the page can import the check without the Durable Object.
import type { MatchSummary } from "./archive.ts";
import type { LogEntry, MatchState } from "./engine/match.ts";

/** What a viewer or the office needs to draw the fight so far. */
export type LiveMatch = Omit<MatchState, "log" | "nextId" | "talks">;

/** Everything the live socket sends. */
export type LiveMessage =
  | { t: "hello"; match: LiveMatch | null }
  | { t: "start"; match: LiveMatch }
  | { t: "turn"; id: string; turn: number; entries: LogEntry[] }
  | { t: "end"; id: string; summary: MatchSummary };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isMatch = (v: unknown) => isObj(v) && typeof v.id === "string" && Array.isArray(v.scenes);

/** The arena's message read on the page. The arena is this build's own, so each kind's envelope is what's checked. */
export const isLiveMessage = (m: unknown): m is LiveMessage =>
  isObj(m) && (
    m.t === "hello" ? m.match === null || isMatch(m.match)
    : m.t === "start" ? isMatch(m.match)
    : m.t === "turn" ? typeof m.id === "string" && typeof m.turn === "number" && Array.isArray(m.entries)
    : m.t === "end" ? typeof m.id === "string" && isObj(m.summary)
    : false);
