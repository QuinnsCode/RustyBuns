// Every open hill climb on one board: `bun run climbs` lists the open issues that are climbing a score (a title
// that says "hill climb", a score like "4/10", "aim for 7" or "scorecard", or a body with a `Score:` line), each with
// its last score, its target and how long since anyone touched it. A climb's PR merges and its worker goes
// home, but the climb isn't done until the score reaches the target, so the issue stays open and this is
// where the next round starts.
//
// A round ends with a comment on the issue that starts with a line like `Score: 6.0/10 (target 9)` (or
// `Score: 98.1/100`). Without one the board guesses from the last "x/10" it can find and marks it `~`.
//
//   bun run climbs
//   bun run climbs --json
import { arr, check, num, obj, str } from "../packages/util/src/guard.ts";
import { tidy, view } from "./issue.ts";

const text = (max: number) => str(max, { min: 0, dflt: "" });
const Row = obj({ number: num(1, 1e9), title: text(400), body: text(200_000), updatedAt: text(40) });
const Rows = arr(Row, 1000, { drop: true });

export type Climb = { number: number; title: string; score: number | null; scale: number; target: number | null; guessed: boolean; touched: string };

const TITLE = /hill.?climb|\d\s*\/\s*10\b|aim for \d|scorecard/i;
const MARK = /^\s*\**score\**:\**\s*(\d+(?:\.\d+)?)\s*\/\s*(10|100)\b(?:.*?target\D{0,4}(\d+(?:\.\d+)?))?/im;

/** Does this open issue look like a climb? */
export const isClimb = (title: string, body: string) => TITLE.test(title) || MARK.test(body);

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
    const d = days(c.touched, now);
    return `#${c.number}  ${s} of ${t} /${c.scale}`.padEnd(24) + `${d}d`.padStart(4) + `  ${c.title}`;
  });
}

async function gh(args: string[]): Promise<string> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err.trim() || `gh ${args.join(" ")} failed`);
  return out;
}

export async function climbs(): Promise<Climb[]> {
  const rows = check(Rows, JSON.parse(await gh(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,body,updatedAt"]))) ?? [];
  const hits = rows.filter((r) => isClimb(r.title, r.body));
  return Promise.all(hits.map(async (r) => {
    const i = await view(r.number);
    const texts = [tidy(i.body), ...i.comments.map((c) => tidy(c.body))];
    const goal = target(i.title, texts);
    return { number: i.number, title: i.title, target: goal, touched: i.updatedAt, ...score([i.title, ...texts], goal) };
  }));
}

if (import.meta.main) {
  const all = await climbs();
  if (process.argv.includes("--json")) console.log(JSON.stringify(all, null, 2));
  else {
    console.log(all.length ? board(all).join("\n") : "No open hill climbs.");
    console.log("\nscore of target, days since the issue moved. ~ is a guess: end each round with a `Score: x/10 (target y)` comment.");
  }
}
