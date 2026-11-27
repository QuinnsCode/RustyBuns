// The Qollab Studio goals board's subtasks, from GitHub: every open issue and PR on Qollab Studio, and what merged in
// the last month, each filed under the owner's goal it serves (or none).
//   bun run qollab-board                 print the tasks as JSON
//   bun run qollab-board --out <file>    write them to a file (the board artifact's tasks.json, then republish it)
//   bun run qollab-board --days 60       how far back "shipped" reaches (default 30)
// The goals themselves, their order and the owner's notes live in the board artifact's store (board/priorities),
// read with ArtifactData. A goal the owner adds there gets its subtasks once it has a row in GOALS below.
import { writeFileSync } from "node:fs";
import { arr, check, num, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

/** Titles that belong to Qollab Studio or one of its sectors. */
const SCOPE = /Qollab Studio|Q ?Amp|QDAW|FM DAW|fm-daw|Q Builder|Q Instrument|Stage Builder|Event Planner|Qollab Events|Qevent|Real gear for/i;
const SKIP = /Overnight decisions|^MANUAL RUN/i;

/** Goal id (as the board's store names it) by title, first match wins; no match is work that serves no goal. */
export const GOALS: [string, RegExp][] = [
  ["learn", /LEARN|lesson|Sound Guy|guided setup/i],
  ["events", /Qollab Events|RSVP|QR|ticket|lets in only|venue from public photos/i],
  ["plan-show", /Event Planner|Stage Builder|rig's tops|PA stack|coverage|far-stack|sound that travels|temperature|terrain|Qevent/i],
  ["gear", /Q Builder|Q ?Amp|pedal|circuit|Gerber|board files|boards and kits|Cortex/i],
  ["song", /QDAW|FM DAW|fm-daw|desk|piano roll|song mode|sidechain|plugin|VST|CLAP|Audio Unit|Web Audio|DJ|deck|jog|mixer|channel|track|spectrum/i],
  ["real-rooms", /look,? (climb )?round|look like real|Real gear|character|human|avatar|people|hands|studio builder|famous studios|walls|drum kit|cymbal|orchestra room|console room|see-through keys|bass seat|gear room|gear wall|lantern|desert/i],
  ["jam-easy", /door|sign.?in|invite|jam room|gateway|light \/ dark|phone|touch|remote|guest|mute|grant|raised hands|live audio|live guitar|limiter|socket|paths|front|switch studios|guitar|mic\b|vocal|the PA|WebRTC|wind the jam|room setup|jam menu|room card|playthrough|walk into/i],
];

export const goalOf = (title: string) => GOALS.find(([, re]) => re.test(title))?.[0] ?? null;

const Issue = obj({ number: num(0, 1e7), title: str(), labels: arr(obj({ name: str() }), 200), updatedAt: str() });
const Pr = obj({
  number: num(0, 1e7), title: str(), updatedAt: str(), mergedAt: opt(str(40, { min: 0 })),
  closingIssuesReferences: opt(arr(obj({ number: num(0, 1e7) }), 200)),
});

export type Task = {
  n: number; kind: "issue" | "pr"; title: string; goal: string | null;
  status: "idea" | "todo" | "review" | "shipped"; day: string; pr?: number;
};

const tidy = (t: string) => t.replace(/\s*[[(]merge after[^)\]]*[)\]]\s*/gi, " ").replace(/\s*\(lands after[^)]*\)/gi, "").trim();

/** Tasks from GitHub's lists. An open PR that closes an open issue folds into it as "in review". */
export function tasks(issues: unknown, open: unknown, merged: unknown): Task[] {
  const inScope = (t: string) => SCOPE.test(t) && !SKIP.test(t);
  const prs = (check(arr(Pr, 1000), open) ?? []).filter((p) => inScope(p.title));
  const reviewOf = new Map<number, number>();
  for (const p of prs) for (const i of p.closingIssuesReferences ?? []) reviewOf.set(i.number, p.number);
  const out: Task[] = [];
  for (const i of check(arr(Issue, 1000), issues) ?? []) {
    if (!inScope(i.title)) continue;
    const pr = reviewOf.get(i.number);
    const status = pr ? "review" : i.labels.some((l) => l.name === "future-idea") ? "idea" : "todo";
    out.push({ n: i.number, kind: "issue", title: tidy(i.title), goal: goalOf(i.title), status, day: i.updatedAt.slice(0, 10), pr });
  }
  const folded = new Set(out.flatMap((t) => (t.pr ? [t.pr] : [])));
  for (const p of prs) {
    if (folded.has(p.number)) continue;
    out.push({ n: p.number, kind: "pr", title: tidy(p.title), goal: goalOf(p.title), status: "review", day: p.updatedAt.slice(0, 10) });
  }
  for (const p of check(arr(Pr, 2000), merged) ?? []) {
    if (!inScope(p.title) || !p.mergedAt) continue;
    out.push({ n: p.number, kind: "pr", title: tidy(p.title), goal: goalOf(p.title), status: "shipped", day: p.mergedAt.slice(0, 10) });
  }
  return out;
}

async function gh(args: string[]): Promise<unknown> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
  if (code) throw new Error(err.trim() || `gh ${args.join(" ")} failed`);
  return JSON.parse(out);
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const flag = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(flag("--days") ?? 30);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const fields = "number,title,updatedAt,mergedAt,closingIssuesReferences";
  const [issues, open, merged] = await Promise.all([
    gh(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,labels,updatedAt"]),
    gh(["pr", "list", "--state", "open", "--limit", "500", "--json", fields]),
    gh(["pr", "list", "--state", "merged", "--limit", "2000", "--search", `merged:>=${since}`, "--json", fields]),
  ]);
  const json = JSON.stringify({ built: new Date().toISOString(), days, tasks: tasks(issues, open, merged) });
  const out = flag("--out");
  if (out) { writeFileSync(out, json); console.log(`${JSON.parse(json).tasks.length} tasks -> ${out}`); }
  else console.log(json);
}
