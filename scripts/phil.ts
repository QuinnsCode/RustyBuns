// Phil, the bottom-feeder: `bun run phil` names the oldest open Mythic Masters issue nobody is on, with the baton
// prompt for the worker who takes it. Skipped: MANUAL RUNs (the owner's hands), hill climbs (`bun run climbs --next`
// hands those out), issues a worker already holds (an open PR names it, or a working desk's task does), and the
// issues waiting on the owner in WAITING.
//
//   bun run phil           the next pick and its prompt
//   bun run phil --hire    hire a worker for it through office-workers, as `bun run climbs --next --hire` does
//
// Phil never sends workers home, never merges and never closes issues.
import { arr, check, num, obj, str } from "../packages/util/src/guard.ts";
import { isClimb } from "./climbs.ts";
import { help } from "./help.ts";

/** Waiting on the owner: not a worker's to pick up. */
export const WAITING = new Set([3031, 3279]);

const text = (max: number) => str(max, { min: 0, dflt: "" });
const Row = obj({ number: num(1, 1e9), title: text(400), body: text(200_000), createdAt: text(40) });
export type Row = { number: number; title: string; body: string; createdAt: string };
const Rows = arr(Row, 1000, { drop: true });
const Prs = arr(obj({ number: num(1, 1e9), title: text(400), body: text(200_000) }), 1000, { drop: true });
const Floor = obj({ workers: arr(obj({ status: text(40), task: text(2000) }), 200, { drop: true }) });

/** The oldest issue left once MANUAL RUNs, climbs, held ones and the owner's waiting list are taken out. */
export function pick(rows: Row[], held: Set<number>, waiting = WAITING): Row | null {
  return rows
    .filter((r) => /mythic masters/i.test(r.title) && !/^MANUAL RUN:/i.test(r.title) && !isClimb(r.title, r.body))
    .filter((r) => !held.has(r.number) && !waiting.has(r.number))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number)[0] ?? null;
}

/** Issue numbers named by an open PR or by a desk that is still working. */
export function heldBy(texts: string[]): Set<number> {
  return new Set(texts.flatMap((t) => [...t.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]))));
}

/** What the worker who takes the pick is told. */
export const baton = (r: Row) => `Mythic Masters issue #${r.number}: ${r.title}.
Read AGENTS.md, then the issue with \`bun run issue ${r.number}\`. Finish it in one small PR from main: the fix, one test for the path a player walks, no source-text asserts.
The PR says "Closes #${r.number}" when it is all done, "Part of #${r.number}" if anything is left; file each leftover as its own issue, and anything for the owner's hands as a MANUAL RUN: issue with the \`manual run\` label.
If it is already done or can't be done, comment on #${r.number} with the evidence and stop. Report back with "N of M done", the PR link and every leftover's link.`;

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err.trim() || `${cmd.join(" ")} failed`);
  return out;
}

if (import.meta.main) {
  help(import.meta.path);
  const rows = check(Rows, JSON.parse(await run(["gh", "issue", "list", "--state", "open", "--search", "Mythic Masters in:title", "--limit", "1000", "--json", "number,title,body,createdAt"]))) ?? [];
  const prs = check(Prs, JSON.parse(await run(["gh", "pr", "list", "--state", "open", "--limit", "300", "--json", "number,title,body"]))) ?? [];
  const desks = check(Floor, JSON.parse(await run(["office-workers", "list", "--json"])))?.workers ?? [];
  const held = heldBy([...prs.flatMap((p) => [p.title, p.body]), ...desks.filter((w) => w.status !== "done").map((w) => w.task)]);
  const r = pick(rows, held);
  if (!r) { console.log("Nothing to pick: every open Mythic Masters issue is a MANUAL RUN, a climb, held, or waiting on the owner."); process.exit(0); }
  console.log(`#${r.number}  ${r.createdAt.slice(0, 10)}  ${r.title}\n\n${baton(r)}`);
  if (process.argv.includes("--hire")) {
    const p = Bun.spawn(["office-workers", "hire", "--issue", String(r.number), "--prompt", baton(r)], { stdout: "inherit", stderr: "inherit" });
    process.exit(await p.exited);
  }
}
