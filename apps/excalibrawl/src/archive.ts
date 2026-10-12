// Replays in R2: matches/<id>.json is a whole fight (its log replays it turn by turn), and
// index.json lists them newest first. The office's slideshow and anyone else tuning in
// read these two, so watching never calls a model.

import type { MatchState } from "./engine/match.ts";

export interface MatchSummary {
  id: string;
  prompt: string;
  fighters: { model: string; name: string }[];
  turns: number;
  startedAt: number;
  endedAt?: number;
  /** Shapes on each fighter's canvas at the end. A fight with none isn't worth replaying. */
  shapes: number[];
}

/** How many fights index.json keeps. */
export const INDEX_MAX = 1_000;

export const MATCH_ID = /^m-\d{10,16}$/;

export const summarize = (m: MatchState): MatchSummary => ({
  id: m.id,
  prompt: m.prompt,
  fighters: m.fighters.map(({ model, name }) => ({ model, name })),
  turns: m.turns,
  startedAt: m.startedAt,
  endedAt: m.endedAt,
  shapes: m.scenes.map((s) => s.length),
});

export function addToIndex(index: MatchSummary[], s: MatchSummary): MatchSummary[] {
  return [s, ...index.filter((x) => x.id !== s.id)].slice(0, INDEX_MAX);
}
