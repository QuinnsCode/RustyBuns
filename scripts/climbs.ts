// Every open hill climb on one board: `bun run climbs` lists the open issues that are climbing a score (a title
// that says "hill climb", a score like "4/10", "aim for 7" or "scorecard", or a body with a `Score:` line), each with
// its last score, its target and how long since anyone touched it. A climb's PR merges and its worker goes
// home, but the climb isn't done until the score reaches the target, so the issue stays open and this is
// where the next round starts.
//
// A climb is a baton, not a pile: the issue carries the score and the next step, one worker runs one round
// and hops the climb to a fresh issue (closing the old one) so it stays at the top of the issue list,
// and `--next` hands the next round to whoever is free. The owner sees a climb once, when a judge scores it
// at the target (one MANUAL RUN for their own score), not every few rounds.
//
// A round ends with a comment on the issue that starts with a line like `Score: 6.0/10 (target 9)` (or
// `Score: 98.1/100`), then a `Next:` line. Without a Score line the board guesses from the last "x/10" it
// can find and marks it `~`. Three rounds with no gain end with a comment that starts `Stalled:`, and the
// climb waits for a person.
//
//   bun run climbs                  the board
//   bun run climbs --next           the round to hand out (not taken by an open PR, not stalled, under target)
//   bun run climbs --next --hire    hire a worker for it through office-workers
//   bun run climbs --json
import { arr, check, num, obj, str } from "../packages/util/src/guard.ts";
import { tidy, view } from "./issue.ts";

const text = (max: number) => str(max, { min: 0, dflt: "" });
const Row = obj({ number: num(1, 1e9), title: text(400), body: text(200_000), updatedAt: text(40) });
const Rows = arr(Row, 1000, { drop: true });
const Prs = arr(obj({ number: num(1, 1e9), title: text(400), body: text(200_000) }), 1000, { drop: true });

export type Climb = {
  number: number; title: string; score: number | null; scale: number; target: number | null; guessed: boolean; touched: string;
  /** The open PR that names it, so a worker is on this round. */ taken: number | null;
  /** The newest comment starts `Stalled:`. */ stalled: boolean;
};

const TITLE = /hill.?climb|\d\s*\/\s*10\b|aim for \d|scorecard/i;
const MARK = /^\s*\**score\**:\**\s*(\d+(?:\.\d+)?)\s*\/\s*(10|100)\b(?:.*?target\D{0,4}(\d+(?:\.\d+)?))?/im;

/** Does this open issue look like a climb? A MANUAL RUN that quotes a score is the owner's to do, never a round to hand out. */
export const isClimb = (title: string, body: string) => !/^MANUAL RUN:/i.test(title) && (TITLE.test(title) || MARK.test(body));

/** The target: "(target 9)" on the newest Score line, else the title's "to 9/10", "reach 7/10" or "aim for 7". */
export function target(title: string, texts: string[]): number | null {
  for (const t of [...texts].reverse()) { const m = MARK.exec(t); if (m?.[3]) return Number(m[3]); }
  const m = /(?:\bto|\breach|aim for)\s+(\d+(?:\.\d+)?)(?:\s*\/\s*10\b|\b)/i.exec(title);
  return m ? Number(m[1]) : null;
}

/** The newest score: a `Score:` line wins; else the last "x/10" or "x / 100" that isn't the target, marked a guess. */
export function score(texts: string[], goal: number | null): { score: number | null; scale: number; guessed: boolean } {
  for (const t of [...texts].reverse()) { const m = MARK.exec(t); if (m) return { score: Number(m[1]), scale: Number(m[2]), guessed: false }; }
  for (const t of [...texts].reverse()) {
    const all = [...t.matchAll(/(?<!(?:\bto|reach|goal:?|target(?: is| was)?:?|aim for|toward(?: the)?)\s*\**\s*)\b(\d+(?:\.\d+)?)\s*\/\s*(10|100)\b(?!\s*goal)/gi)]
      .filter((m) => Number(m[1]) !== goal);
    const last = all.at(-1);
    if (last) return { score: Number(last[1]), scale: Number(last[2]), guessed: true };
  }
  return { score: null, scale: 10, guessed: true };
}

const days = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / 864e5);

/** One line per climb, furthest from its target first. */
export function board(climbs: Climb[], now = Date.now()): string[] {
  const gap = (c: Climb) => (c.score === null || c.target === null ? 1 : 1 - c.score / c.target);
  return [...climbs].sort((a, b) => gap(b) - gap(a)).map((c) => {
    const s = c.score === null ? "?" : `${c.guessed ? "~" : ""}${c.score}`;
    const t = c.target === null ? "?" : String(c.target);
    const d = days(c.touched, now), who = c.taken ? `  (PR #${c.taken})` : c.stalled ? "  (stalled)" : "";
    return `#${c.number}  ${s} of ${t} /${c.scale}`.padEnd(24) + `${d}d`.padStart(4) + `  ${c.title}${who}`;
  });
}

const STALLED = /^\s*\**stalled\**:/i;

/** The round to hand out: under target (or unscored), not taken, not stalled; furthest from target, then idle longest. */
export function next(climbs: Climb[]): Climb | null {
  const open = climbs.filter((c) => !c.taken && !c.stalled && !(c.score !== null && c.target !== null && c.score >= c.target));
  const gap = (c: Climb) => (c.score === null || c.target === null ? 1 : 1 - c.score / c.target);
  return open.sort((a, b) => gap(b) - gap(a) || a.touched.localeCompare(b.touched))[0] ?? null;
}

/** What the worker who takes the baton is told. */
export const baton = (c: Climb) => {
  const t = c.target ?? 9;
  return `Hill climb round on #${c.number}: ${c.title}. Last score ${c.score ?? "none yet"}, target ${c.target ?? "not set, so 9 unless the issue names one"} (\`bun run climbs\` shows every climb).
Read it with \`bun run issue ${c.number}\`; the newest Score and Next lines are where you start. If there is no score, score main first.
One round: shots BEFORE from main, the change the Next line names, shots NOW, then a fresh judge agent scores BEFORE vs NOW out of ${c.scale} without your reasoning. Keep the change only if the score went up.
A judge's number runs about double the owner's (the owner halved every climb's score on 2026-11-05), so report the last score plus half the judge's gain (NOW minus BEFORE), never the judge's own number; a computed score (a formula, a scorecard) is reported at half too. Only a rate that is itself the goal (a win rate to 45%) goes in as measured.
Comment on #${c.number}: first line \`Score: x/${c.scale} (target ${t})\`, then the shots, then \`Next: <the judge's top gap>\`. The PR is from main and says "Part of #${c.number}", never a closing word.
Then hop the climb forward so it stays at the top of the issues: open a new issue with the same title for the next rounds ("rounds N+ (from #${c.number})") whose body carries this one's state, round table and next steps, updated; seed it with that Score/Next comment; comment "Moved up to #<new>" here and close this one.
At or over the target: file one issue titled "MANUAL RUN: score #${c.number} yourself" with the \`manual run\` label, how to see it, and the judge's score; the owner's score decides if it closes. Three rounds with no gain: a comment starting \`Stalled:\` with the blocker. Then stop; the next round goes to the next free worker.`;
};

async function gh(args: string[]): Promise<string> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err.trim() || `gh ${args.join(" ")} failed`);
  return out;
}

export async function climbs(): Promise<Climb[]> {
  const rows = check(Rows, JSON.parse(await gh(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,body,updatedAt"]))) ?? [];
  const hits = rows.filter((r) => isClimb(r.title, r.body));
  const prs = check(Prs, JSON.parse(await gh(["pr", "list", "--state", "open", "--limit", "300", "--json", "number,title,body"]))) ?? [];
  return Promise.all(hits.map(async (r) => {
    const i = await view(r.number);
    const texts = [tidy(i.body), ...i.comments.map((c) => tidy(c.body))];
    const goal = target(i.title, texts), named = new RegExp(`#${i.number}\\b`);
    const taken = prs.find((p) => named.test(p.title) || named.test(p.body))?.number ?? null;
    const stalled = STALLED.test(i.comments.at(-1)?.body ?? "");
    return { number: i.number, title: i.title, target: goal, touched: i.updatedAt, taken, stalled, ...score([i.title, ...texts], goal) };
  }));
}

if (import.meta.main) {
  const all = await climbs(), argv = process.argv;
  if (argv.includes("--next")) {
    const c = next(all);
    if (!c) { console.log("No climb to hand out: each is taken by an open PR, stalled, or at its target."); process.exit(0); }
    console.log(board([c])[0] + "\n\n" + baton(c));
    if (argv.includes("--hire")) {
      const p = Bun.spawn(["office-workers", "hire", "--issue", String(c.number), "--prompt", baton(c)], { stdout: "inherit", stderr: "inherit" });
      process.exit(await p.exited);
    }
  } else if (argv.includes("--json")) console.log(JSON.stringify(all, null, 2));
  else {
    console.log(all.length ? board(all).join("\n") : "No open hill climbs.");
    console.log("\nscore of target, days since the issue moved. ~ is a guess: end each round with a `Score: x/10 (target y)` comment.");
  }
}
