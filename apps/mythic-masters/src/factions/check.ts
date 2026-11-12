// What a faction's file must hold to fit the plan in docs/FACTIONS.md, past its shape (model.ts): the quest at the
// places the plan names, the posts on the plan's grid, teams made only of what is behind you, every flag a line waits
// on set somewhere, the manual's English, and enough lines that read the small things (before the intro, the gap, the
// manner, the other two factions, the reading). `bun scripts/factions.ts` prints it; the test holds all three files to it.
import { Bad } from "@rustybuns/util/guard";
import { REGIONS } from "../regions.ts";
import { SECTIONS, sections, STARTERS } from "../journey.ts";
import { ROSTER } from "../roster.ts";
import { lint } from "./ste.ts";
import { Faction, FACTIONS, HOOKS, STYLES, Weave, WHEN_KEYS, type FactionId, type Lines, type When } from "./model.ts";

/** The section (0-based) each quest step waits at, step 1 in region 1 to step 8 in region 8. */
export const SPINE: Record<FactionId, number[]> = {
  office: [4, 5, 0, 7, 5, 1, 4, 8],
  institute: [8, 9, 10, 4, 6, 4, 6, 7],
  lamplighters: [2, 8, 2, 8, 8, 2, 4, 5],
};
/** The sections each faction posts in, by region. */
export const GRID: Record<FactionId, number[][]> = {
  office: [[0, 6, 9], [0, 7, 10], [4, 7, 9], [0, 6, 9], [2, 3, 9], [0, 3, 7], [0, 2, 9], [3, 6, 9]],
  institute: [[3, 6, 10], [3, 6, 7], [1, 5, 9], [1, 5, 9], [0, 9, 10], [5, 7, 9], [1, 2, 8], [2, 4, 9]],
  lamplighters: [[1, 7, 9], [1, 4, 10], [3, 6, 7], [2, 3, 6], [1, 4, 10], [3, 8, 9], [3, 5, 8], [0, 6, 10]],
};
/** The flags each step must be able to set (one reply or its fight), by step number. The engine itself sets
 * `protocol-quiet` when office.5 is done and `<faction>-closed` when a step 8 is. */
export const MUST_SET: Record<FactionId, string[][]> = {
  office: [["office-file", "office-gary"], ["quist-warm"], ["asset-one-wood"], ["tape-copied"], ["quist-turned"], [], ["cache-burned"], []],
  institute: [["sample-given"], ["reagent-taken"], ["squonk-lent"], ["carrow-counted"], ["specimen-freed"], ["meter-read"], ["toby-out"], []],
  lamplighters: [["lamp-carried"], ["message-run"], ["tale-kept"], ["ridge-promise"], ["raid-plan"], ["annex-raided"], ["bay-held"], []],
};
/** Every flag the three quests may set or wait on. */
export const STORY_FLAGS: ReadonlySet<string> = new Set([...HOOKS, ...Object.values(MUST_SET).flat(2)]);
/** The hooks that are a faction's own doing: it has no echo for these. */
const OWN: Record<FactionId, readonly string[]> = {
  office: ["office-file", "office-gary", "protocol-quiet", "cache-burned", "quist-turned", "office-closed"],
  institute: ["sample-given", "reagent-taken", "squonk-lent", "specimen-freed", "toby-out", "institute-closed"],
  lamplighters: ["lamp-carried", "message-run", "ridge-promise", "annex-raided", "bay-held", "lamplighters-closed"],
};
export const echoesOf = (id: FactionId) => HOOKS.filter((h) => !OWN[id].includes(h));

const VARS = new Set(["you", "lead", "count", "place", "region", "met", "gap", "mythic"]);
/** How many lines of a file must read each kind of small thing. */
const DEPTH = { "places before the intro": 6, "the gap between talks": 6, "your manner": 6, "the other factions": 10, "the reading": 4 } as const;
const KIND: Record<keyof typeof DEPTH, readonly (keyof When)[]> = {
  "places before the intro": ["before", "notBefore", "had", "hadUnder"],
  "the gap between talks": ["gap"],
  "your manner": ["manner", "last"],
  "the other factions": ["met", "unmet", "first", "done", "undone", "flags", "noFlags"],
  "the reading": ["now", "past", "trend"],
};

/** The creatures that are behind you by region n: the wild ones and keepers of every section up to it (a region's
 * mythic, on its last stone, is nobody else's to hold), and the starters. */
export function behind(n: number): Set<string> {
  const out = new Set<string>(STARTERS);
  for (const g of REGIONS) if (g.n <= n) for (const s of sections(g)) { for (const w of s.wilds) out.add(w); if (s.k < SECTIONS - 1) out.add(s.keeper); }
  return out;
}

/** Flags the engine sets itself (engine.ts): the order the quests close in, and a promise made too late. */
const engineFlag = (fl: string) => /^closed-(first|last)-(office|institute|lamplighters)$/.test(fl) || /-late$/.test(fl);

/** Everything wrong with the weave (content/faction-weave.json): the lead's crossings between the three. */
export function weaveProblems(raw: unknown): string[] {
  const out: string[] = [];
  strayKeys(raw, "weave", out);
  let w: Weave;
  try { w = Weave(raw); } catch (e) { return [...out, e instanceof Bad ? `${e.path.join(".")}: ${e.why}` : String(e)]; }
  for (const h of HOOKS) if (!w.order.includes(h)) out.push(`order: "${h}" is never said`);
  const sets = new Set(w.crossings.flatMap((c) => c.sets ?? [])), ids = new Set<string>();
  for (const p of w.promises) { if (!ROSTER.some((r) => r.id === p.creature)) out.push(`promises: no creature "${p.creature}"`); if (!STORY_FLAGS.has(p.flag)) out.push(`promises: nothing sets "${p.flag}"`); }
  for (const c of w.crossings) {
    const at = `crossings.${c.id}`;
    if (ids.has(c.id)) out.push(`${at}: two crossings share this id`);
    ids.add(c.id);
    for (const p of lint(c.text)) out.push(`${at}: ${p}`);
    if (!Object.values(c.when).some((v) => v !== undefined)) out.push(`${at}: a crossing with no "when" is just a line`);
    for (const fl of [...(c.when.flags ?? []), ...(c.when.noFlags ?? [])]) if (!STORY_FLAGS.has(fl) && !sets.has(fl) && !engineFlag(fl)) out.push(`${at}: waits on "${fl}", which nothing sets`);
    for (const id of [...(c.when.owns ?? []), ...(c.when.lacks ?? [])]) if (!ROSTER.some((r) => r.id === id)) out.push(`${at}: no creature "${id}"`);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Every `when` in the raw file with a key the model does not know (the guard would drop it and the line would always apply). */
function strayKeys(v: unknown, at: string, out: string[]) {
  if (Array.isArray(v)) v.forEach((x, i) => strayKeys(x, `${at}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
    if ((k === "when" || k === "needs") && isObj(x)) for (const key of Object.keys(x)) if (!WHEN_KEYS.some((w) => w === key)) out.push(`${at}.${k}: "${key}" is not a condition`);
    strayKeys(x, `${at}.${k}`, out);
  }
}

/** Everything wrong with faction `id`'s file; empty when it fits the plan. */
export function problems(id: FactionId, raw: unknown): string[] {
  const out: string[] = [];
  strayKeys(raw, id, out);
  let f: Faction;
  try { f = Faction(raw); } catch (e) { return [...out, e instanceof Bad ? `${e.path.join(".")}: ${e.why}` : String(e)]; }
  if (f.id !== id) out.push(`id is "${f.id}", not "${id}"`);
  const seen = new Map<keyof typeof DEPTH, number>(), sets = new Set<string>(), waits: [string, string][] = [];
  const whenAt = (w: When | undefined, at: string) => {
    if (!w) return;
    for (const [kind, keys] of Object.entries(KIND) as [keyof typeof DEPTH, readonly (keyof When)[]][]) {
      // "the other factions" counts only a line that names another faction, one of its stages or one of its flags
      const hit = kind !== "the other factions" ? keys.some((k) => w[k] !== undefined)
        : [...(w.met ?? []), ...(w.unmet ?? []), ...(w.first ? [w.first] : [])].some((x) => x !== id) || [...(w.done ?? []), ...(w.undone ?? [])].some((s) => !s.startsWith(id)) || [...(w.flags ?? []), ...(w.noFlags ?? [])].some((fl) => FACTIONS.some((o) => o !== id && OWN[o].includes(fl)));
      if (hit) seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    for (const fl of [...(w.flags ?? []), ...(w.noFlags ?? [])]) waits.push([fl, at]);
    for (const c of [...(w.owns ?? []), ...(w.lacks ?? []), ...(w.starter ? [w.starter] : [])]) if (!ROSTER.some((r) => r.id === c)) out.push(`${at}: no creature "${c}"`);
  };
  const say = (text: string, at: string) => {
    for (const p of lint(text)) out.push(`${at}: ${p}`);
    for (const m of text.matchAll(/\{(\w+)\}/g)) if (!VARS.has(m[1]!)) out.push(`${at}: {${m[1]}} is not filled in by the game`);
  };
  const slot = (ls: Lines | undefined, at: string, min = 1) => {
    if (!ls) return;
    if (!ls.some((l) => !l.when || Object.values(l.when).every((v) => v === undefined))) out.push(`${at}: no line without a "when" to fall back on`);
    if (ls.length < min) out.push(`${at}: ${ls.length} lines, ${min} at least`);
    ls.forEach((l, i) => { say(l.text, `${at}[${i}]`); whenAt(l.when, `${at}[${i}]`); });
  };

  say(f.theory, "theory");
  f.tells.forEach((t, i) => say(t, `tells[${i}]`));
  const people = new Set(f.people.map((p) => p.id)), ranks = new Set(f.ranks.map((r) => r.id));
  for (const r of f.ranks) { slot(r.hail, `ranks.${r.id}.hail`, 3); slot(r.again, `ranks.${r.id}.again`, 2); slot(r.youWin, `ranks.${r.id}.youWin`, 2); slot(r.youLose, `ranks.${r.id}.youLose`, 2); }

  // the quest: eight steps, at the plan's places, each with one reply of every style
  f.quest.forEach((st, i) => {
    const at = `quest[${i}]`, n = i + 1, ok = behind(n);
    if (st.id !== `${id}.${n}`) out.push(`${at}: id is "${st.id}", not "${id}.${n}"`);
    if (st.n !== n || st.k !== SPINE[id][i]) out.push(`${at}: stands at ${st.n}:${st.k}, the plan says ${n}:${SPINE[id][i]}`);
    if (!people.has(st.who)) out.push(`${at}: nobody called "${st.who}"`);
    whenAt(st.needs, `${at}.needs`);
    slot(st.hail, `${at}.hail`, 4); slot(st.ask, `${at}.ask`); slot(st.rematch, `${at}.rematch`);
    say(st.log, `${at}.log`);
    for (const s of STYLES) if (st.replies.filter((r) => r.style === s).length !== 1) out.push(`${at}: one "${s}" reply, please`);
    if (new Set(st.replies.map((r) => r.id)).size !== st.replies.length) out.push(`${at}: two replies share an id`);
    for (const r of st.replies) { slot(r.answer, `${at}.replies.${r.id}.answer`); for (const fl of r.sets ?? []) sets.add(fl); if (r.fight && !st.fight) out.push(`${at}.replies.${r.id}: starts a fight the step does not have`); }
    if (st.fight) {
      slot(st.fight.youWin, `${at}.fight.youWin`, 2); slot(st.fight.youLose, `${at}.fight.youLose`, 2);
      for (const fl of st.fight.setsWin ?? []) sets.add(fl);
      if (!st.fight.always && !st.replies.some((r) => r.fight)) out.push(`${at}: a fight no reply starts`);
      if (!st.fight.teams.some((t) => !t.when)) out.push(`${at}.fight: no team without a "when"`);
      if (!st.rematch) out.push(`${at}: a fight needs a "rematch" line for when you come back to it`);
      st.fight.teams.forEach((t, ti) => { whenAt(t.when, `${at}.fight.teams[${ti}]`); for (const m of t.team) if (!ok.has(m.id)) out.push(`${at}.fight.teams[${ti}]: "${m.id}" is not behind you by region ${n}`); });
    }
    const here = new Set([...st.replies.flatMap((r) => r.sets ?? []), ...(st.fight?.setsWin ?? [])]);
    for (const need of MUST_SET[id][i]!) if (!here.has(need)) out.push(`${at}: nothing here sets "${need}"`);
  });

  // the posts: the plan's grid, each held by a rank
  for (let n = 1; n <= 8; n++) {
    const want = [...GRID[id][n - 1]!].sort((a, b) => a - b), got = f.posts.filter((p) => p.n === n).map((p) => p.k).sort((a, b) => a - b);
    if (want.join() !== got.join()) out.push(`posts in region ${n}: sections ${got.join(", ") || "none"}, the plan says ${want.join(", ")}`);
  }
  f.posts.forEach((p, i) => { if (!ranks.has(p.rank)) out.push(`posts[${i}]: no rank "${p.rank}"`); say(p.line, `posts[${i}].line`); });

  // the echoes: a line for every hook that is not their own doing, and none for anything else
  for (const h of echoesOf(id)) if (!f.echoes[h]) out.push(`echoes: nothing for "${h}"`);
  for (const [h, ls] of Object.entries(f.echoes)) { if (!HOOKS.some((x) => x === h)) out.push(`echoes: "${h}" is not a hook`); slot(ls, `echoes.${h}`); }
  if (f.rumours.length < 4) out.push(`rumours: ${f.rumours.length}, 4 at least`);
  for (const [i, r] of f.rumours.entries()) if (!/^(Diner cook|Clerk|Night manager): /.test(r)) out.push(`rumours[${i}]: starts "Diner cook: ", "Clerk: " or "Night manager: "`);

  for (const [fl, at] of waits) if (!STORY_FLAGS.has(fl) && !sets.has(fl)) out.push(`${at}: waits on "${fl}", which nothing sets`);
  for (const [kind, min] of Object.entries(DEPTH) as [keyof typeof DEPTH, number][]) if ((seen.get(kind) ?? 0) < min) out.push(`depth: ${seen.get(kind) ?? 0} lines read ${kind}, ${min} at least`);
  return out;
}
