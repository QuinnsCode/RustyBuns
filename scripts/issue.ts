// An issue as a brief: `bun run issue <n> [n ...]` prints each issue's header (state, labels, who, when, the PRs
// that close it), its body cut at a paragraph after `BODY` characters, and the last `COMMENTS` comments, each
// cut at `COMMENT` characters. `gh issue view --comments` hands an agent the whole thread, every time it looks
// (959 looks in 14 days of sessions, 342k result tokens, Dexter counted); this is the third of that, and several
// issues come in one call. `--full` gives the whole body and every comment, when a brief isn't enough.
//
//   bun run issue 2952
//   bun run issue 2952 3046 --full
import { arr, check, num, obj, str } from "../packages/util/src/guard.ts";

const text = (max: number) => str(max, { min: 0, dflt: "" });
const who = obj({ login: text(100) });
export const Issue = obj({
  number: num(1, 1e9), title: text(400), state: text(20), url: text(400), createdAt: text(40), updatedAt: text(40), body: text(200_000), author: who,
  labels: arr(obj({ name: text(100) }), 100, { drop: true }),
  assignees: arr(who, 100, { drop: true }),
  closedByPullRequestsReferences: arr(obj({ number: num(1, 1e9) }), 100, { drop: true }),
  comments: arr(obj({ author: who, createdAt: text(40), body: text(200_000) }), 1000, { drop: true }),
});
export type Issue = ReturnType<typeof Issue>;
export const FIELDS = "number,title,state,url,createdAt,updatedAt,body,author,labels,assignees,closedByPullRequestsReferences,comments";

export const BODY = 1200, COMMENT = 400, COMMENTS = 3;

/** Markdown with the HTML comments and the runs of blank lines gone. */
export const tidy = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** The first `max` characters, cut at the paragraph (then line, then word) before the limit, saying how much is left. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max), para = head.lastIndexOf("\n\n"), line = head.lastIndexOf("\n"), word = head.lastIndexOf(" ");
  const end = para > max * 0.4 ? para : line > max * 0.6 ? line : word > max * 0.5 ? word : max;
  return `${s.slice(0, end).trimEnd()}\n… ${s.length - end} more characters (--full)`;
}

const day = (iso: string) => iso.slice(0, 10);

/** The lines of one issue's brief. `full` keeps the whole body and every comment. */
export function brief(i: Issue, full = false): string[] {
  const labels = i.labels.map((l) => l.name), prs = i.closedByPullRequestsReferences.map((p) => `#${p.number}`), to = i.assignees.map((a) => a.login);
  const head = [`#${i.number} ${i.state} ${i.title}`, `  by ${i.author.login} ${day(i.createdAt)}, updated ${day(i.updatedAt)}` + (labels.length ? `, labels ${labels.join(", ")}` : "") + (to.length ? `, assigned ${to.join(", ")}` : "") + (prs.length ? `, closed by ${prs.join(" ")}` : "") + `, ${i.comments.length} comment${i.comments.length === 1 ? "" : "s"}`];
  const body = tidy(i.body);
  const out = [...head, "", full ? body : cut(body, BODY)];
  const shown = full ? i.comments : i.comments.slice(-COMMENTS);
  if (i.comments.length > shown.length) out.push("", `… ${i.comments.length - shown.length} earlier comment${i.comments.length - shown.length === 1 ? "" : "s"} (--full)`);
  for (const c of shown) out.push("", `-- ${c.author.login} ${day(c.createdAt)}`, full ? tidy(c.body) : cut(tidy(c.body), COMMENT));
  return out;
}

export async function view(n: number): Promise<Issue> {
  const p = Bun.spawn(["gh", "issue", "view", String(n), "--json", FIELDS], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err.trim() || `gh issue view ${n} failed`);
  const i = check(Issue, JSON.parse(out));
  if (!i) throw new Error(`gh issue view ${n}: unexpected shape`);
  return i;
}

if (import.meta.main) {
  const args = process.argv.slice(2), ns = args.filter((a) => /^\d+$/.test(a)).map(Number), full = args.includes("--full");
  if (!ns.length) { console.error("usage: bun run issue <number> [number ...] [--full]"); process.exit(2); }
  let code = 0;
  for (const [k, n] of ns.entries()) {
    if (k) console.log("\n" + "=".repeat(60) + "\n");
    try { console.log(brief(await view(n), full).join("\n")); } catch (e) { console.log(`#${n}: ${(e as Error).message}`); code = 1; }
  }
  process.exit(code);
}
