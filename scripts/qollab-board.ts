// The Qollab Studio board's cards, from GitHub: every open issue and PR across Qollab Studio's sectors, and what merged
// in the last week, each with its sector and where it stands (idea, to do, in review, shipped).
//   bun run qollab-board                 print the cards as JSON
//   bun run qollab-board --out <file>    write them to a file (the board artifact's cards.json)
//   bun run qollab-board --days 14       how far back "shipped" reaches (default 7)
// The owner's priorities live in the artifact's own store, not here: rerunning this only refreshes the cards.
import { writeFileSync } from "node:fs";
import { arr, check, num, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

/** Titles that belong to Qollab Studio or one of its sectors. */
const SCOPE = /Qollab Studio|Q ?Amp|QDAW|FM DAW|fm-daw|Q Builder|Q Instrument|Stage Builder|Event Planner|Qollab Events|Qevent|Real gear for/i;
const SKIP = /Overnight decisions|^MANUAL RUN/i;

/** Sector by title, first match wins. The seven sectors from #6024 plus the shared layers they all sit on. */
export const SECTORS: [string, RegExp][] = [
  ["Look", /look,? (climb )?round|look like real|Real gear|hill climb/i],
  ["LEARN", /LEARN|lesson|Sound Guy/i],
  ["Events", /Qollab Events|Qevent|RSVP|lets in only/i],
  ["Event Planner", /Event Planner|Stage Builder|rig's tops|PA stack|coverage/i],
  ["Q Builder", /Q Builder|circuit|Gerber|board files|boards and kits/i],
  ["Q Amps", /Q ?Amp|pedal/i],
  ["Plugins", /plugin|VST|CLAP|Audio Unit|Web Audio/i],
  ["QDAW", /QDAW|FM DAW|fm-daw|desk|piano roll|song mode|sidechain/i],
  ["Q Instruments", /Q Instrument|DJ|deck|jog|keys|drum/i],
  ["People", /character|avatar|human|hands/i],
  ["Door", /door|sign.?in|light \/ dark|landing|invite|front/i],
  ["Rooms", /./],
];

export const sectorOf = (title: string) => SECTORS.find(([, re]) => re.test(title))?.[0] ?? "Rooms";

const Label = obj({ name: str() });
const Issue = obj({ number: num(0, 1e7), title: str(), labels: arr(Label, 200), updatedAt: str() });
const Pr = obj({
  number: num(0, 1e7), title: str(), updatedAt: str(), mergedAt: opt(str(40, { min: 0 })),
  closingIssuesReferences: opt(arr(obj({ number: num(0, 1e7) }), 200)),
});

export type Card = {
  n: number; kind: "issue" | "pr"; title: string; sector: string;
  status: "idea" | "todo" | "review" | "shipped"; updated: string; pr?: number; labels: string[];
};

async function gh(args: string[]): Promise<unknown> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
  if (code) throw new Error(err.trim() || `gh ${args.join(" ")} failed`);
  return JSON.parse(out);
}

/** Cards from GitHub's lists: an open PR that closes an open issue folds into it as "in review". */
export function cards(issues: unknown, open: unknown, merged: unknown, since: string): Card[] {
  const inScope = (t: string) => SCOPE.test(t) && !SKIP.test(t);
  const prs = (check(arr(Pr, 1000), open) ?? []).filter((p) => inScope(p.title));
  const reviewOf = new Map<number, number>();
  for (const p of prs) for (const i of p.closingIssuesReferences ?? []) reviewOf.set(i.number, p.number);
  const out: Card[] = [];
  for (const i of check(arr(Issue, 1000), issues) ?? []) {
    if (!inScope(i.title)) continue;
    const labels = i.labels.map((l) => l.name);
    const pr = reviewOf.get(i.number);
    const status = pr ? "review" : labels.includes("future-idea") ? "idea" : "todo";
    out.push({ n: i.number, kind: "issue", title: i.title, sector: sectorOf(i.title), status, updated: i.updatedAt.slice(0, 10), pr, labels });
  }
  const folded = new Set(reviewOf.values());
  for (const p of prs) {
    if (folded.has(p.number) && out.some((c) => c.pr === p.number)) continue;
    out.push({ n: p.number, kind: "pr", title: p.title, sector: sectorOf(p.title), status: "review", updated: p.updatedAt.slice(0, 10), labels: [] });
  }
  for (const p of check(arr(Pr, 1000), merged) ?? []) {
    if (!inScope(p.title) || !p.mergedAt || p.mergedAt < since) continue;
    out.push({ n: p.number, kind: "pr", title: p.title, sector: sectorOf(p.title), status: "shipped", updated: p.mergedAt.slice(0, 10), labels: [] });
  }
  return out;
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const flag = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(flag("--days") ?? 7);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const prFields = "number,title,updatedAt,mergedAt,closingIssuesReferences";
  const [issues, open, merged] = await Promise.all([
    gh(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,labels,updatedAt"]),
    gh(["pr", "list", "--state", "open", "--limit", "300", "--json", prFields]),
    gh(["pr", "list", "--state", "merged", "--limit", "400", "--json", prFields]),
  ]);
  const json = JSON.stringify({ built: new Date().toISOString(), days, cards: cards(issues, open, merged, since) });
  const out = flag("--out");
  if (out) { writeFileSync(out, json); console.log(`${JSON.parse(json).cards.length} cards -> ${out}`); }
  else console.log(json);
}
