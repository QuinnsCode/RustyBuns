// Which episode the podcast station plays, and which next. Episodes arrive newest first, as RSS lists them.
import type { Episode } from "./feed.ts";

export interface Place { id: string; t: number }

/** Where to start: back in the episode you left (at the second you left it), else the first of the feed in `order`. */
export function start(episodes: Episode[], order: "oldest" | "newest", saved: Place | null): { ep: Episode; t: number } | null {
  const inOrder = order === "oldest" ? [...episodes].reverse() : episodes;
  const at = saved ? inOrder.find((e) => e.id === saved.id) : undefined;
  if (at && saved) return { ep: at, t: saved.t };
  const first = inOrder[0];
  return first ? { ep: first, t: 0 } : null;
}

/** The episode after `ep`, going through the feed in `order`; null after the last (the station then stops). */
export function after(episodes: Episode[], order: "oldest" | "newest", ep: Episode): Episode | null {
  const inOrder = order === "oldest" ? [...episodes].reverse() : episodes;
  const i = inOrder.findIndex((e) => e.id === ep.id);
  return i < 0 ? null : inOrder[i + 1] ?? null;
}
