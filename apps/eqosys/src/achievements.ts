// Achievements, the way a game launcher keeps them: each game's catalog lives here (so eqosys can show "3 of 8" on the
// home page without asking the game), and a game unlocks one with its token, POST /q/achieve { id }. An unlock is kept
// the first time and never moves. A game can only unlock what its own catalog names, so nobody can invent a title.
// Add a game's list in a PR, the same way it is added to APPS.
import type { Env } from "./env.ts";

export interface Achievement {
  id: string;
  name: string;
  /** What to do for it, in one line. */
  blurb: string;
  /** Hidden ("Secret achievement") until it is unlocked. */
  secret?: boolean;
}

export const ACHIEVEMENTS: Record<string, Achievement[]> = {
  "alien-disc-golf": [
    { id: "first-basket", name: "Nothing but chains", blurb: "Put a disc in the basket." },
    { id: "where-are-we", name: "Where are we", blurb: "Name the country a hole tees off in." },
    { id: "splash", name: "Splash", blurb: "Land a disc in the sea." },
    { id: "birdie", name: "Birdie", blurb: "Finish a hole one under par." },
    { id: "eagle", name: "Eagle", blurb: "Finish a hole two or more under par." },
    { id: "nine", name: "Nine holes", blurb: "Play a whole round." },
    { id: "under-par", name: "Under the planet", blurb: "Finish a round under par." },
    { id: "ace", name: "Across the world in one", blurb: "In the basket on a hole's first throw.", secret: true },
  ],
  "skate-tech-park": [
    { id: "grind", name: "Metal on metal", blurb: "Grind a rail or a ledge." },
    { id: "landing", name: "Stick it", blurb: "Land after being airborne." },
  ],
  "delayed-reaction": [
    { id: "first-answer", name: "Echo", blurb: "Answer a note a bar later." },
    { id: "streak-8", name: "In the pocket", blurb: "Answer eight notes in a row." },
  ],
  "two-fronts": [
    { id: "war-played", name: "The war is over", blurb: "See a war through to its end." },
    { id: "war-won", name: "Both fronts", blurb: "Win a whole war." },
  ],
  "mythic-masters": [
    { id: "first-fight", name: "Into the arena", blurb: "Finish a fight on the trail." },
    { id: "first-win", name: "Folklore favoured", blurb: "Win a fight." },
    { id: "first-bind", name: "Bound", blurb: "Bind a beast." },
  ],
  "park-hide-seek": [
    { id: "camped-out", name: "Nothing to see", blurb: "Hide until the hunt is over without being caught." },
    { id: "first-catch", name: "Found you", blurb: "Catch a hider as a ranger." },
    { id: "bigfoot", name: "It's real", blurb: "Find Bigfoot.", secret: true },
  ],
  "git-recon": [
    { id: "first-win", name: "Area clear", blurb: "Win a chapter of the campaign." },
    { id: "new-head", name: "A new face", blurb: "Unlock a head." },
  ],
  "splat-rooms": [
    { id: "first-find", name: "Eyes on the target", blurb: "Find the target in a captured room." },
  ],
  "splat-spray": [
    { id: "first-shot", name: "First coat", blurb: "Take your first shot." },
  ],
};

/** The achievements in every game's catalog: what a friend's count is "of". */
export const TOTAL = Object.values(ACHIEVEMENTS).reduce((n, l) => n + l.length, 0);

/** How many each of `ids` has unlocked (people with none are left out). */
export async function countsOf(conf: Env, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { results } = await conf.DB.prepare(`SELECT user_id, count(*) AS n FROM unlocks WHERE user_id IN (${ids.map(() => "?").join(",")}) GROUP BY user_id`)
    .bind(...ids).all<{ user_id: string; n: number }>();
  for (const r of results) out.set(r.user_id, r.n);
  return out;
}

/** A catalog entry as a person sees it: `at` when they have it, and a secret one's name and line kept back until then. */
export interface Shown { id: string; name: string; blurb: string; secret: boolean; at: number | null }

export const catalogOf = (app: string) => ACHIEVEMENTS[app] ?? [];

const show = (a: Achievement, at: number | null): Shown =>
  a.secret && at === null ? { id: a.id, name: "Secret achievement", blurb: "Keep playing.", secret: true, at } : { id: a.id, name: a.name, blurb: a.blurb, secret: !!a.secret, at };

/** One person's unlocks in every app (or just `app`), as app id -> achievement id -> when. */
export async function unlocksOf(conf: Env, userId: string, app?: string) {
  const { results } = await conf.DB.prepare(`SELECT app, achievement, at FROM unlocks WHERE user_id = ?${app ? " AND app = ?" : ""}`)
    .bind(...[userId, ...(app ? [app] : [])]).all<{ app: string; achievement: string; at: number }>();
  const out = new Map<string, Map<string, number>>();
  for (const r of results) {
    let m = out.get(r.app);
    if (!m) out.set(r.app, m = new Map());
    m.set(r.achievement, r.at);
  }
  return out;
}

/** An app's whole catalog for one person, unlocked first (newest on top), then the rest in catalog order. */
export function shownFor(app: string, got: Map<string, number> | undefined): Shown[] {
  const list = catalogOf(app).map((a) => show(a, got?.get(a.id) ?? null));
  return [...list.filter((s) => s.at !== null).sort((a, b) => b.at! - a.at!), ...list.filter((s) => s.at === null)];
}

export type Unlocked = { ok: true; achievement: Shown; new: boolean } | { ok: false; status: number; error: string };

/** Unlock `id` in `app` for a person. Unlocking one they already have is fine: `new` is false and `at` is the first time. */
export async function unlock(conf: Env, userId: string, app: string, id: unknown, now = Date.now()): Promise<Unlocked> {
  const a = catalogOf(app).find((x) => x.id === id);
  if (!a) return { ok: false, status: 404, error: `${app} has no achievement called that` };
  const fresh = await conf.DB.prepare("INSERT INTO unlocks (user_id, app, achievement, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING at")
    .bind(userId, app, a.id, now).first<number>("at");
  const at = fresh ?? (await conf.DB.prepare("SELECT at FROM unlocks WHERE user_id = ? AND app = ? AND achievement = ?").bind(userId, app, a.id).first<number>("at")) ?? now;
  return { ok: true, achievement: show(a, at), new: fresh !== null };
}
