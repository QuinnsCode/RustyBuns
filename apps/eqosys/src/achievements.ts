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
};

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
