// The factions as the journey plays them (docs/FACTIONS.md): who is waiting behind you, what they say when you walk
// up, what your answer does, and the team they send. Everything said is picked from data by what you did: the places
// you had been before they met you, how long since you last spoke, how you talk to them, what you did with the other
// two and in what order, and the reading (read.ts). No DOM and no three.js: the page draws it, the tests play it.
import { mulberry32 } from "@rustybuns/util";
import { cleared, mythicOf, sectionLevel, SECTIONS, sections, type Journey } from "../journey.ts";
import { REGIONS } from "../regions.ts";
import { creature, ROSTER } from "../roster.ts";
import { bandOf, deal, fresh, lag, pressure, reading, trendOf } from "./read.ts";
import { Faction, FACTIONS, Weave, type Count, type Crossing, type FactionId, type Factions, type Gap, type Hook, type Line, type Person, type Post, type Rank, type Stage, type Standing, type Style, type When } from "./model.ts";
import { STYLES } from "./model.ts";
import office from "../../content/faction-office.json";
import institute from "../../content/faction-institute.json";
import lamplighters from "../../content/faction-lamplighters.json";
import weave from "../../content/faction-weave.json";

/** The three, checked at load: a broken file fails loudly here rather than as a silent trail. */
export const FACTION: Record<FactionId, Faction> = { office: Faction(office), institute: Faction(institute), lamplighters: Faction(lamplighters) };
export const WEAVE: Weave = Weave(weave);

/** What a moment knows that the save does not: the time, where you stand, the hour, how many of you there are. */
export interface Ctx { now: number; n: number; k: number; night?: boolean; party?: number }
/** One of a team as the fight needs it. */
export interface Foe { id: string; level: number; title?: string }

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** A beaten post asks for another go after this long. */
export const REMATCH_MS = 20 * HOUR;
/** Away this long, and every faction has a word about it. */
export const AWAY_MS = 3 * DAY;

export const factionsOf = (j: Journey): Factions => (j.factions ??= { met: [], flags: [], done: [], by: {}, marks: [] });
export const standingOf = (j: Journey, f: FactionId): Standing => (factionsOf(j).by[f] ??= fresh());
const flag = (j: Journey, fl: string) => { const fs = factionsOf(j).flags; if (!fs.includes(fl)) fs.push(fl); };

/** How many different kinds the Book holds. */
export const kinds = (j: Journey) => new Set([...j.party, ...j.journal].map((m) => m.id)).size;
/** The counts a faction takes of you (model.ts COUNTS), as they stand now. A closed contract is stage 4 (journey.ts `hunts`). */
export function counts(j: Journey): Record<Count, number> {
  return {
    fires: j.fires.length, tapes: j.found.length, sights: j.sights.length, hunts: Object.values(j.hunts ?? {}).filter((s) => s >= 4).length,
    binds: kinds(j), nights: j.nights ?? 0, regions: Object.values(j.cleared).filter((k) => k >= SECTIONS).length,
  };
}

// --- conditions ---------------------------------------------------------------------------------------------------
/** How long since you last spoke to `who`. */
export function gapOf(st: Standing | undefined, who: string, now: number): Gap {
  const at = st?.people[who]?.at;
  if (at === undefined) return "first";
  return now - at < HOUR ? "soon" : now - at < DAY ? "later" : "long";
}
/** The style you use most with `who`; your last one breaks a tie; none before you have answered them. */
export function mannerOf(st: Standing | undefined, who: string): Style | undefined {
  const k = st?.people[who];
  if (!k || !k.talks) return undefined;
  const top = Math.max(...k.styles), best = STYLES.filter((_, i) => k.styles[i] === top);
  return best.length === 1 ? best[0] : k.last && best.includes(k.last) ? k.last : best[0];
}
const atLeast = (want: Partial<Record<Count, number | undefined>> | undefined, have: Record<Count, number>) => !want || Object.entries(want).every(([k, v]) => v === undefined || have[k as Count] >= v);
const under = (want: Partial<Record<Count, number | undefined>> | undefined, have: Record<Count, number>) => !want || Object.entries(want).every(([k, v]) => v === undefined || have[k as Count] < v);

/** Whether `w` holds for faction `f` and person `who` at this moment. No `when` always holds. */
export function holds(w: When | undefined, j: Journey, f: FactionId, who: string, ctx: Ctx): boolean {
  if (!w) return true;
  const fs = factionsOf(j), st = fs.by[f], r = reading(st), intro = st?.intro;
  const has = (fl: string) => fs.flags.includes(fl), owns = (id: string) => [...j.party, ...j.journal].some((m) => m.id === id);
  // a page you had when they met you is one of the first `intro.pages` the journal wrote
  const had = (page: string) => { const i = j.pages.indexOf(page); return !!intro && i >= 0 && i < intro.pages; };
  return (!w.met || w.met.every((x) => fs.met.includes(x))) && (!w.unmet || w.unmet.every((x) => !fs.met.includes(x)))
    && (!w.first || fs.met[0] === w.first)
    && (!w.done || w.done.every((s) => fs.done.includes(s))) && (!w.undone || w.undone.every((s) => !fs.done.includes(s)))
    && (!w.inOrder || w.inOrder.every((s, i) => fs.done.includes(s) && (i === 0 || fs.done.indexOf(w.inOrder![i - 1]!) < fs.done.indexOf(s))))
    && (!w.flags || w.flags.every(has)) && (!w.noFlags || w.noFlags.every((x) => !has(x)))
    && (!w.before || w.before.every(had)) && (!w.notBefore || w.notBefore.every((p) => !had(p)))
    && (!w.had || (!!intro && atLeast(w.had, intro))) && (!w.hadUnder || (!!intro && under(w.hadUnder, intro)))
    && (!w.been || w.been.every((p) => j.pages.includes(p)))
    && atLeast(w.have, counts(j)) && under(w.haveUnder, counts(j))
    && (!w.owns || w.owns.every(owns)) && (!w.lacks || w.lacks.every((id) => !owns(id))) && (!w.starter || j.starter === w.starter)
    && (!w.gap || w.gap.includes(gapOf(st, who, ctx.now))) && (w.night === undefined || w.night === !!ctx.night)
    && (!w.manner || mannerOf(st, who) === w.manner) && (!w.last || st?.people[who]?.last === w.last)
    && (!w.now || w.now.includes(bandOf(r.now))) && (!w.past || w.past.includes(bandOf(r.past))) && (!w.trend || w.trend.includes(trendOf(r.trend)))
    && (!w.won || (st?.won ?? 0) >= w.won) && (!w.lost || (st?.lost ?? 0) >= w.lost)
    && (w.party === undefined || w.party === (ctx.party ?? 1) > 1);
}
/** How much a `when` asks: the line that asks the most, and holds, is the one said. */
export const weight = (w: When | undefined) => (w ? Object.values(w).filter((v) => v !== undefined).length : 0);
/** The one of `list` to use: the first that holds among those asking the most. */
export function pick<T extends { when?: When }>(list: readonly T[], j: Journey, f: FactionId, who: string, ctx: Ctx): T | undefined {
  let best: T | undefined, top = -1;
  for (const l of list) { const wt = weight(l.when); if (wt > top && holds(l.when, j, f, who, ctx)) { best = l; top = wt; } }
  return best;
}

const span = (ms: number) => {
  const of = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return ms >= DAY ? of(Math.floor(ms / DAY), "day") : ms >= HOUR ? of(Math.floor(ms / HOUR), "hour") : of(Math.max(1, Math.floor(ms / 60_000)), "minute");
};
const placeOf = (n: number, k: number) => { const g = REGIONS[n - 1]; return g ? sections(g)[k]?.name ?? g.name : "the trail"; };
/** Fills a line's `{vars}` (model.ts Line) for faction `f`, person `who`, now. */
export function fill(text: string, j: Journey, f: FactionId, who: string, ctx: Ctx): string {
  const st = factionsOf(j).by[f], g = REGIONS[ctx.n - 1], at = st?.people[who]?.at, lead = j.party[0];
  const vars: Record<string, string> = {
    you: FACTION[f].calls, lead: lead ? creature(lead.id).name : "your lead", count: String(kinds(j)),
    place: placeOf(ctx.n, ctx.k), region: g?.name ?? "this region", met: st?.intro ? placeOf(st.intro.n, st.intro.k) : placeOf(ctx.n, ctx.k),
    gap: at === undefined ? "no time" : span(ctx.now - at), mythic: g ? mythicOf(g).name : "the mythic",
  };
  return text.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
}
const say = (lines: readonly Line[], j: Journey, f: FactionId, who: string, ctx: Ctx) => { const l = pick(lines, j, f, who, ctx); return l ? fill(l.text, j, f, who, ctx) : ""; };

// --- meeting them -------------------------------------------------------------------------------------------------
/** The first time a faction speaks to you: it joins the order you met them in, and takes its count of you. */
export function meet(j: Journey, f: FactionId, ctx: Ctx): boolean {
  const fs = factionsOf(j), st = standingOf(j, f);
  if (fs.met.includes(f)) return false;
  fs.met.push(f);
  st.intro = { at: ctx.now, n: ctx.n, k: ctx.k, pages: j.pages.length, ...counts(j), party: Math.max(1, ctx.party ?? 1) };
  return true;
}
/** You spoke to `who` in `style`: when, how often, and how. */
function spoke(st: Standing, who: string, now: number, style?: Style) {
  const k = (st.people[who] ??= { at: now, talks: 0, styles: [0, 0, 0] });
  k.at = now;
  if (style) { k.talks++; k.styles[STYLES.indexOf(style)]!++; k.last = style; }
}

// --- things that happen outside a quest: hooks, echoes, crossings ----------------------------------------------------
/** Something happened that the factions have a word about (model.ts HOOKS). One that can happen again (a second
 * mythic, a second contract) is said again by each. */
export function deed(j: Journey, hook: Hook) {
  flag(j, hook);
  for (const f of FACTIONS) { const st = factionsOf(j).by[f]; if (st) st.heard = st.heard.filter((h) => h !== hook); }
}
/** The journey is open again at `now`: three days away is a deed of its own. */
export function back(j: Journey, now: number) {
  const fs = factionsOf(j);
  if (fs.seen !== undefined && now - fs.seen >= AWAY_MS) deed(j, "long-away");
  fs.seen = now;
}
/** What faction `f` has to say about the rest of your journey before it gets to its own business: the first crossing
 * that holds and it has not said (its standing and flag applied), else its echo of the first waiting hook. Said once. */
export function aside(j: Journey, f: FactionId, who: string, ctx: Ctx): string | null {
  const fs = factionsOf(j), st = standingOf(j, f);
  if (!fs.met.includes(f)) return null;
  const x = WEAVE.crossings.find((c: Crossing) => c.to === f && !st.heard.includes(`x:${c.id}`) && holds(c.when, j, f, who, ctx));
  if (x) {
    st.heard.push(`x:${x.id}`);
    if (x.sway) deal(st, x.sway);
    for (const fl of x.sets ?? []) flag(j, fl);
    return fill(x.text, j, f, who, ctx);
  }
  const hook = WEAVE.order.find((h) => fs.flags.includes(h) && !st.heard.includes(h) && FACTION[f].echoes[h]);
  if (!hook) return null;
  st.heard.push(hook);
  return say(FACTION[f].echoes[hook]!, j, f, who, ctx) || null;
}

// --- the quests ---------------------------------------------------------------------------------------------------
const doneOf = (j: Journey, f: FactionId) => factionsOf(j).done.filter((s) => s.startsWith(`${f}.`)).length;
/** Faction `f`'s next step, or undefined once its quest is closed. */
export const nextStage = (j: Journey, f: FactionId): Stage | undefined => FACTION[f].quest[doneOf(j, f)];
/** Whether that step is waiting for you now: you are past its section, and what it needs holds. */
export function waiting(j: Journey, f: FactionId, ctx: Ctx): Stage | undefined {
  const st = nextStage(j, f);
  return st && cleared(j, st.n) > st.k && holds(st.needs, j, f, st.who, ctx) ? st : undefined;
}
/** Every step waiting behind you now, one a faction at most. */
export const waitingAll = (j: Journey, ctx: Ctx) => FACTIONS.flatMap((f) => { const st = waiting(j, f, ctx); return st ? [{ faction: f, stage: st }] : []; });

/** Section k of region n cleared at `now`: your pace is marked, and each faction whose next step stands at that stone
 * gives itself away behind you. The lines for the toast. */
export function sectionCleared(j: Journey, n: number, k: number, now: number): string[] {
  const fs = factionsOf(j);
  fs.marks = [...fs.marks, now].slice(-8);
  const ctx: Ctx = { now, n, k };
  return FACTIONS.flatMap((f) => {
    const st = waiting(j, f, ctx);
    if (!st || st.n !== n || st.k !== k) return [];
    const tells = FACTION[f].tells;
    return [tells[(n * 7 + k) % tells.length]!];
  });
}

export interface Scene {
  faction: FactionId; stage: Stage; who: Person;
  /** What they say first about the rest of your journey, if anything. */ aside: string | null;
  hail: string;
  /** Null when you are back for a fight you lost: there is nothing left to ask. */ ask: string | null;
  replies: { id: string; style: Style; say: string }[];
  /** The fight starts as soon as you have heard them out (a rematch). */ team: Foe[] | null;
}
const person = (f: FactionId, id: string): Person => FACTION[f].people.find((p) => p.id === id) ?? { id, name: id, role: "" };

/** You walk up to faction `f`'s waiting step. The first time ever, they meet you (and count you) before they speak. */
export function approach(j: Journey, f: FactionId, ctx: Ctx): Scene | null {
  const stage = waiting(j, f, ctx);
  if (!stage) return null;
  const at: Ctx = { ...ctx, n: stage.n, k: stage.k }, st = standingOf(j, f), who = stage.who;
  meet(j, f, at);
  const side = aside(j, f, who, at), again = st.pending === stage.id && !!stage.fight && !!stage.rematch;
  const scene: Scene = {
    faction: f, stage, who: person(f, who), aside: side,
    hail: say(again ? stage.rematch! : stage.hail, j, f, who, at),
    ask: again ? null : say(stage.ask, j, f, who, at),
    replies: again ? [] : stage.replies.map((r) => ({ id: r.id, style: r.style, say: r.say })),
    team: again ? teamOf(j, f, stage, at) : null,
  };
  if (again) spoke(st, who, ctx.now);
  return scene;
}

/** The team a step sends: the one whose `when` holds and asks the most, at the section's level plus each member's
 * own, plus the pressure of your reading, plus a level for every other quest you have already closed. */
export function teamOf(j: Journey, f: FactionId, stage: Stage, ctx: Ctx): Foe[] {
  const t = stage.fight && pick(stage.fight.teams, j, f, stage.who, ctx);
  if (!t) return [];
  const closed = FACTIONS.filter((o) => o !== f && factionsOf(j).flags.includes(`${o}-closed`)).length;
  const base = sectionLevel(stage.n, stage.k) + pressure(reading(factionsOf(j).by[f])) + (stage.id.endsWith(".8") ? closed : 0);
  return t.team.map((m) => ({ id: m.id, level: Math.max(1, Math.min(100, base + m.up)), ...(m.title ? { title: m.title } : {}) }));
}

function finish(j: Journey, f: FactionId, stage: Stage) {
  const fs = factionsOf(j), st = standingOf(j, f);
  if (!fs.done.includes(stage.id)) fs.done.push(stage.id);
  delete st.pending;
  if (stage.id === "office.5") flag(j, "protocol-quiet");
  if (stage.id.endsWith(".8")) {
    // the order the quests close in is part of the story: the first and the last each leave a mark
    const others = FACTIONS.filter((o) => o !== f && fs.flags.includes(`${o}-closed`)).length;
    flag(j, `${f}-closed`);
    if (others === 0) flag(j, `closed-first-${f}`);
    if (others === FACTIONS.length - 1) flag(j, `closed-last-${f}`);
  }
}

/** You answer the scene with reply `id`. What they say back, the team if it starts the fight, and any ink they hand
 * over (it goes to the Book's spare drops, spent on your next world fight). */
export function reply(j: Journey, scene: Scene, id: string, ctx: Ctx): { said: string; team: Foe[] | null; ink: number } | null {
  const { faction: f, stage } = scene, r = stage.replies.find((x) => x.id === id), st = standingOf(j, f);
  if (!r || scene.ask === null || factionsOf(j).done.includes(stage.id) || st.pending === stage.id) return null;
  const at: Ctx = { ...ctx, n: stage.n, k: stage.k };
  // the answer is picked as things stood when you spoke, before this reply changes them
  const said = say(r.answer, j, f, stage.who, at);
  spoke(st, stage.who, ctx.now, r.style);
  deal(st, r.sway);
  for (const fl of r.sets ?? []) {
    // a promise about a creature the Book already holds came too late to break
    const p = WEAVE.promises.find((x) => x.flag === fl);
    if (p && [...j.party, ...j.journal].some((m) => m.id === p.creature)) flag(j, `${fl}-late`);
    flag(j, fl);
  }
  if (r.ink) { const t = (j.talk ??= { heard: [], said: {} }); t.ink = Math.min(3, (t.ink ?? 0) + r.ink); }
  const fights = !!stage.fight && (!!stage.fight.always || !!r.fight);
  if (fights) st.pending = stage.id; else finish(j, f, stage);
  return { said, team: fights ? teamOf(j, f, stage, at) : null, ink: r.ink ?? 0 };
}

/** The step's fight is over. Won: the step is done. Lost: they wait for you to come back. What they say. */
export function fought(j: Journey, f: FactionId, stageId: string, won: boolean, ctx: Ctx): string {
  const stage = FACTION[f].quest.find((s) => s.id === stageId), st = standingOf(j, f);
  if (!stage?.fight || st.pending !== stageId) return "";
  const at: Ctx = { ...ctx, n: stage.n, k: stage.k };
  if (won) { st.won++; deal(st, stage.fight.swayWin); for (const fl of stage.fight.setsWin ?? []) flag(j, fl); finish(j, f, stage); }
  else { st.lost++; deal(st, stage.fight.swayLose); }
  return say(won ? stage.fight.youWin : stage.fight.youLose, j, f, stage.who, at);
}

/** Your record of the quests: every step done, in the order you did them, with its line. */
export function record(j: Journey): { id: string; faction: FactionId; title: string; log: string }[] {
  return factionsOf(j).done.flatMap((id) => {
    const f = FACTIONS.find((x) => id.startsWith(`${x}.`)), st = f && FACTION[f].quest.find((s) => s.id === id);
    return f && st ? [{ id, faction: f, title: st.title, log: st.log }] : [];
  });
}

// --- the posts: rank and file on the trail behind you -----------------------------------------------------------------
export const postId = (f: FactionId, p: Post) => `${f}:${p.n}:${p.k}`;
export interface Manned { id: string; faction: FactionId; post: Post; rank: Rank; /** Beaten, and not yet ready for another go. */ resting: boolean }

/** The posts manned in region n now: a faction you have met holds its posts up to `lag` sections behind the one you
 * are in (all of them once the region's trail is done). */
export function postsIn(j: Journey, n: number, ctx: Ctx): Manned[] {
  const fs = factionsOf(j), at = cleared(j, n), reach = at >= SECTIONS ? SECTIONS : at - lag(j, ctx.now);
  return fs.met.flatMap((f) => FACTION[f].posts.filter((p) => p.n === n && p.k <= reach).flatMap((p) => {
    const rank = FACTION[f].ranks.find((r) => r.id === p.rank), id = postId(f, p), when = fs.by[f]?.beaten[id];
    return rank ? [{ id, faction: f, post: p, rank, resting: when !== undefined && ctx.now - when < REMATCH_MS }] : [];
  }));
}

const NAMES = ["Mabel", "Otis", "June", "Hank", "Dot", "Amos", "Pearl", "Gus", "Ida", "Clem", "Opal", "Virgil"];
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
/** What a faction calls the i-th creature at a post: an asset number, a specimen code, or a first name. */
const titleOf = (f: FactionId, seed: number, i: number) => (f === "office" ? `Asset ${10 + ((seed + i * 17) % 80)}` : f === "institute" ? `Specimen HI-${String(100 + ((seed + i * 29) % 800)).padStart(3, "0")}` : NAMES[(seed + i * 5) % NAMES.length]!);

/** A post's team, the same every time: one to three of the creatures behind you in its region (the wild ones of its
 * own section and the sections before it), the rank's fields first, at the section's level plus the rank's and the
 * pressure of your reading. Back for another go, it is never more than a level under your lead. */
export function postTeam(j: Journey, m: Manned): Foe[] {
  const { post: p, rank, faction: f } = m, g = REGIONS[p.n - 1]!, seed = hash(m.id), rnd = mulberry32(seed);
  const pool = [...new Set(sections(g).filter((s) => s.k <= p.k).flatMap((s) => [...s.wilds, s.keeper]))].filter((id) => ROSTER.some((c) => c.id === id));
  const liked = pool.filter((id) => creature(id).fields.some((x) => rank.fields.includes(x)));
  const size = Math.min(3, 1 + Math.floor((p.n - 1) / 3) + (rank.up >= 2 ? 1 : 0));
  const st = factionsOf(j).by[f], again = st?.beaten[m.id] !== undefined;
  const level = Math.max(sectionLevel(p.n, p.k) + rank.up + pressure(reading(st)), again ? (j.party[0]?.level ?? 1) - 1 : 1);
  const used = new Set<string>();
  return Array.from({ length: size }, (_, i) => {
    // no two the same while the section has others to give
    const fresh = (list: string[]) => { const left = list.filter((id) => !used.has(id)); return left.length ? left : list; };
    const from = fresh(liked.length && (i === 0 || rnd() < 0.6) ? liked : pool), id = from[Math.floor(rnd() * from.length)] ?? pool[0]!;
    used.add(id);
    return { id, level: Math.min(100, level + (i === size - 1 ? 1 : 0)), title: titleOf(f, seed, i) };
  });
}

/** You walk up to a post: what the rest of your journey has earned you, the line about the place, and the rank's hail
 * (or its line for someone back for another go). No team while they rest. */
export function hail(j: Journey, m: Manned, ctx: Ctx): { aside: string | null; line: string; hail: string; team: Foe[] | null } {
  const f = m.faction, st = standingOf(j, f), at: Ctx = { ...ctx, n: m.post.n, k: m.post.k }, who = m.rank.id;
  const side = aside(j, f, who, at), again = st.beaten[m.id] !== undefined;
  const out = { aside: side, line: fill(m.post.line, j, f, who, at), hail: say(again ? m.rank.again : m.rank.hail, j, f, who, at), team: m.resting ? null : postTeam(j, m) };
  spoke(st, who, ctx.now);
  return out;
}
/** A post's fight is over. Won, it rests until tomorrow. What its rank says. */
export function postFought(j: Journey, m: Manned, won: boolean, ctx: Ctx): string {
  const st = standingOf(j, m.faction), at: Ctx = { ...ctx, n: m.post.n, k: m.post.k };
  if (won) { st.won++; st.beaten[m.id] = ctx.now; } else st.lost++;
  return say(won ? m.rank.youWin : m.rank.youLose, j, m.faction, m.rank.id, at);
}
