// Achievements, the way a game launcher keeps them: each game's catalog lives here (so eqosys can show "3 of 8" on the
// home page without asking the game), and a game unlocks one with its token, POST /q/achieve { id }. An unlock is kept
// the first time and never moves. A game can only unlock what its own catalog names, so nobody can invent a title.
// Add a game's list in a PR, the same way it is added to APPS. Every game's list starts with the same ones (SHARED), so
// "played" is number one everywhere, and each has its badge: a lucide icon, or a letter in the console font. A studio's own game
// (listings.ts) has no list here: it gets the shared ones its maturity can unlock, until its studio can add its own.
import { Armchair, Bandage, GraduationCap, Biohazard, Bird, Briefcase, Coins, Crown, Droplet, Earth, Feather, Flag, Flame, Footprints, Gamepad2, GlassWater, Globe, Hourglass, Landmark, Link, MapPin, Medal, Megaphone, Orbit, PiggyBank, PlaneLanding, Radio, Repeat, ScanEye, Search, Shield, ShieldCheck, Sparkles, Spline, SprayCan, Target, Tent, TrendingUp, Trophy, UserRound, Users, Waves, type IconNode } from "lucide";
import type { QApp } from "./apps.ts";
import type { Env } from "./env.ts";
import { appOf, isListing } from "./listings.ts";

export interface Achievement {
  id: string;
  name: string;
  /** What to do for it, in one line. */
  blurb: string;
  /** Hidden ("Secret achievement") until it is unlocked. */
  secret?: boolean;
  /** Its badge: a lucide icon, or a letter or two drawn in the console font. A trophy when there is none. */
  icon?: IconNode | string;
}

/** The first ones in every game's list, the same id, name and badge in each. `alpha` and `beta` only unlock while the app is
 * that (apps.ts), so a game can keep asking for them after it grows up. */
export const SHARED = {
  played: { id: "played", name: "Pressed start", blurb: "Play the game.", icon: Gamepad2 },
  alpha: { id: "alpha", name: "There in alpha", blurb: "Play it while it is still in alpha.", icon: "A" },
  beta: { id: "beta", name: "There in beta", blurb: "Play it while it is in beta.", icon: "B" },
  tutorial: { id: "tutorial", name: "Learned the ropes", blurb: "Finish the tutorial.", icon: GraduationCap },
} satisfies Record<string, Achievement>;

export const ACHIEVEMENTS: Record<string, Achievement[]> = {
  "alien-disc-golf": [
    SHARED.played,
    SHARED.alpha,
    SHARED.tutorial,
    { id: "first-basket", name: "Nothing but chains", blurb: "Put a disc in the basket.", icon: Target },
    { id: "where-are-we", name: "Where are we", blurb: "Name the country a hole tees off in.", icon: MapPin },
    { id: "splash", name: "Splash", blurb: "Land a disc in the sea.", icon: Waves },
    { id: "birdie", name: "Birdie", blurb: "Finish a hole one under par.", icon: Bird },
    { id: "eagle", name: "Eagle", blurb: "Finish a hole two or more under par.", icon: Feather },
    { id: "nine", name: "Nine holes", blurb: "Play a whole round.", icon: Flag },
    { id: "under-par", name: "Under the planet", blurb: "Finish a round under par.", icon: Earth },
    { id: "ace", name: "Across the world in one", blurb: "In the basket on a hole's first throw.", secret: true, icon: Orbit },
  ],
  "skate-tech-park": [
    SHARED.played,
    SHARED.alpha,
    SHARED.tutorial,
    { id: "grind", name: "Metal on metal", blurb: "Grind a rail or a ledge.", icon: Spline },
    { id: "landing", name: "Stick it", blurb: "Land after being airborne.", icon: PlaneLanding },
  ],
  "delayed-reaction": [
    SHARED.played,
    SHARED.tutorial,
    { id: "first-answer", name: "Echo", blurb: "Answer a note a bar later.", icon: Radio },
    { id: "streak-8", name: "In the pocket", blurb: "Answer eight notes in a row.", icon: Flame },
  ],
  "two-fronts": [
    SHARED.played,
    SHARED.alpha,
    SHARED.tutorial,
    { id: "war-played", name: "The war is over", blurb: "See a war through to its end.", icon: Flag },
    { id: "war-won", name: "Both fronts", blurb: "Win a whole war.", icon: Medal },
  ],
  "mythic-masters": [
    SHARED.played,
    SHARED.tutorial,
    { id: "first-fight", name: "Into the arena", blurb: "Finish a fight on the trail.", icon: Shield },
    { id: "first-win", name: "Folklore favoured", blurb: "Win a fight.", icon: Trophy },
    { id: "first-bind", name: "Bound", blurb: "Bind a beast.", icon: Link },
  ],
  "park-hide-seek": [
    SHARED.played,
    SHARED.alpha,
    SHARED.tutorial,
    { id: "camped-out", name: "Nothing to see", blurb: "Hide until the hunt is over without being caught.", icon: Tent },
    { id: "first-catch", name: "Found you", blurb: "Catch a hider as a ranger.", icon: Search },
    { id: "bigfoot", name: "It's real", blurb: "Find Bigfoot.", secret: true, icon: Footprints },
  ],
  "git-recon": [
    SHARED.played,
    SHARED.alpha,
    SHARED.tutorial,
    { id: "first-win", name: "Area clear", blurb: "Win a chapter of the campaign.", icon: ShieldCheck },
    { id: "new-head", name: "A new face", blurb: "Unlock a head.", icon: UserRound },
  ],
  "hippo-tycoon": [
    SHARED.played,
    SHARED.alpha,
    { id: "first-chomp", name: "First barrel", blurb: "Chomp a drop of oil.", icon: Droplet },
    { id: "gold", name: "Black gold", blurb: "Chomp a gold drop.", icon: Coins },
    { id: "sludge", name: "Bad crude", blurb: "Choke on a gulp of sludge.", icon: Biohazard },
    { id: "nail", name: "Sore jaw", blurb: "Bite down on a nail.", icon: Bandage },
    { id: "water", name: "Watered down", blurb: "Swallow water and chomp a dud.", icon: GlassWater },
    { id: "bellow", name: "Hostile takeover", blurb: "Bellow at the other barons.", icon: Megaphone },
    { id: "profitable", name: "First profitable day", blurb: "End a round with oil in the bank.", icon: PiggyBank },
    { id: "first-win", name: "Top baron", blurb: "Win a round.", icon: Crown },
    { id: "tycoon", name: "Tycoon", blurb: "Score 30 in one round.", icon: TrendingUp },
    { id: "gold-rush", name: "Gold rush", blurb: "Chomp five gold drops in one round.", icon: Sparkles },
    { id: "clean-books", name: "Clean books", blurb: "Finish a round without eating sludge, a nail or water.", icon: ShieldCheck },
    { id: "hard-win", name: "Corporate raider", blurb: "Win a round against hard bots.", icon: Briefcase },
    { id: "hat-trick", name: "Winning streak", blurb: "Win three rounds in a row.", icon: Repeat },
    { id: "long-shift", name: "Long shift", blurb: "Finish a 90-second round.", icon: Hourglass },
    { id: "couch", name: "Board meeting", blurb: "Play a round with two people on one machine.", icon: Armchair },
    { id: "online", name: "Overseas office", blurb: "Play a round against someone on another machine.", icon: Globe },
    { id: "full-park", name: "Full basin", blurb: "Play a round with four people and no bots.", icon: Users },
    { id: "oil-baron", name: "Oil baron", blurb: "Score 50 in one round.", secret: true, icon: Landmark },
  ],
  "splat-spray": [
    SHARED.played,
    { id: "first-shot", name: "First coat", blurb: "Take your first shot.", icon: SprayCan },
    { id: "first-find", name: "Eyes on the target", blurb: "Find the target in a real, scanned room.", icon: ScanEye },
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

/** Whether a shared alpha or beta badge can unlock in an app of this maturity (alpha unless said, apps.ts). */
const opens = (a: Achievement, maturity: QApp["maturity"]) => (a.id !== "alpha" && a.id !== "beta") || (maturity ?? "alpha") === a.id;

/** An app's catalog: ours from ACHIEVEMENTS, a studio's game the shared ones its maturity can unlock. */
export const catalogOf = (app: string | QApp): Achievement[] =>
  typeof app !== "string" && isListing(app) ? Object.values(SHARED).filter((a) => opens(a, app.maturity)) : ACHIEVEMENTS[typeof app === "string" ? app : app.id] ?? [];

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
export function shownFor(app: string | QApp, got: Map<string, number> | undefined): Shown[] {
  const list = catalogOf(app).map((a) => show(a, got?.get(a.id) ?? null));
  return [...list.filter((s) => s.at !== null).sort((a, b) => b.at! - a.at!), ...list.filter((s) => s.at === null)];
}

export type Unlocked = { ok: true; achievement: Shown; new: boolean } | { ok: false; status: number; error: string };

/** Unlock `id` in `app` for a person. Unlocking one they already have is fine: `new` is false and `at` is the first time. */
export async function unlock(conf: Env, userId: string, app: string, id: unknown, now = Date.now()): Promise<Unlocked> {
  const q = await appOf(conf, app), a = q && catalogOf(q).find((x) => x.id === id);
  if (!q || !a) return { ok: false, status: 404, error: `${app} has no achievement called that` };
  if (!opens(a, q.maturity)) return { ok: false, status: 409, error: `${app} is not in ${a.id}` };
  const fresh = await conf.DB.prepare("INSERT INTO unlocks (user_id, app, achievement, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING at")
    .bind(userId, app, a.id, now).first<number>("at");
  const at = fresh ?? (await conf.DB.prepare("SELECT at FROM unlocks WHERE user_id = ? AND app = ? AND achievement = ?").bind(userId, app, a.id).first<number>("at")) ?? now;
  return { ok: true, achievement: show(a, at), new: fresh !== null };
}
