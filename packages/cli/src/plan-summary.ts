// What a `rustybuns plan` does to each live resource, in words and colour, under Alchemy's own plan.
//
// Alchemy marks each resource with a glyph (`·` no change, `~` update, `±` replace), which is easy to misread at the
// one moment it matters: is my bucket kept, or made new? So plan runs Alchemy with its plain log (one
// `[Worker] update` line a resource), reads those lines back, and ends with one row a resource and a verdict:
// KEEP and UPDATE are safe, REPLACE makes a new one and deletes the old one with its data, DELETE deletes; both are black on
// red-orange, so a row that loses data (a database above all) can't be scrolled past.
import { stripVTControlCharacters } from "node:util";

export type PlanAction = "create" | "update" | "adopted" | "replace" | "delete" | "orphaned" | "noop";
const ACTIONS: readonly PlanAction[] = ["create", "update", "adopted", "replace", "delete", "orphaned", "noop"];
export interface PlanRow { id: string; action: PlanAction }

/** The resource rows of Alchemy's plain plan log: `[Worker] update`. A binding's row (`[Worker/BACKUP] noop`) is left out. */
export function readPlanRows(log: string): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const line of stripVTControlCharacters(log).split("\n")) {
    // Alchemy beta.87 starts each plain line `[00:01:08.172] INFO: `; take that off before reading the row.
    const m = /^\[([^\]/]+)\] (\w+)\b/.exec(line.trim().replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] [A-Z]+(?: \(#\d+\))?: ?/, ""));
    const action = ACTIONS.find((a) => a === m?.[2]);
    if (m && action && !rows.some((r) => r.id === m[1])) rows.push({ id: m[1]!, action });
  }
  return rows;
}

/** Black on red-orange: what marks every line about data that goes. */
export const ALARM = "\x1b[1;38;5;16;48;5;202m";

const WORDS: Record<PlanAction, { tag: string; says: string; color: string }> = {
  noop: { tag: "KEEP", says: "no change", color: "\x1b[32m" },
  update: { tag: "UPDATE", says: "changed in place: it stays, and so does its data", color: "\x1b[36m" },
  adopted: { tag: "ADOPT", says: "the one already on the account is taken over as it is", color: "\x1b[36m" },
  create: { tag: "CREATE", says: "made new", color: "\x1b[32m" },
  replace: { tag: "REPLACE", says: "a new one is made and the old one DELETED, with its data", color: ALARM },
  delete: { tag: "DELETE", says: "deleted, with its data", color: ALARM },
  orphaned: { tag: "LET GO", says: "left on the account, no longer managed by this stack", color: "\x1b[33m" },
};

/**
 * The block printed after the plan. `types` names each id's kind (from the generated stack), `kept` the ids
 * `protect: true` covers. Empty when no row could be read, so a change in Alchemy's log never prints a false "safe".
 */
export function formatPlanSummary(rows: PlanRow[], types: Record<string, string> = {}, kept: ReadonlySet<string> = new Set(), color = true): string {
  if (!rows.length) return "";
  const paint = (c: string, s: string) => (color ? `${c}${s}\x1b[0m` : s);
  const idW = Math.max(...rows.map((r) => r.id.length + (types[r.id] ? types[r.id]!.length + 3 : 0)));
  const lines = ["what this deploy does to each resource:"];
  for (const r of rows) {
    const w = WORDS[r.action];
    const name = (types[r.id] ? `${r.id} (${types[r.id]})` : r.id).padEnd(idW);
    const tag = w.tag.padEnd(7);
    // A row that loses data is filled end to end; a safe one colours its word only.
    lines.push(w.color === ALARM ? `  ${paint(ALARM, `${tag}  ${name}  ${w.says}`)}` : `  ${paint(w.color, tag)}  ${name}  ${w.says}`);
  }
  const lost = rows.filter((r) => r.action === "replace" || r.action === "delete");
  if (!lost.length) lines.push(paint("\x1b[1;32m", "safe: nothing is replaced or deleted."));
  else {
    const hit = lost.filter((r) => kept.has(r.id));
    lines.push(paint(ALARM,
      `STOP: ${lost.map((r) => `${r.id} is ${r.action === "replace" ? "replaced" : "deleted"}`).join(", ")}. Its data goes with it. Don't deploy until you know why.`));
    if (hit.length) lines.push(paint(ALARM, `  ${hit.map((r) => r.id).join(", ")} ${hit.length === 1 ? "is" : "are"} protected (protect: true), which only covers destroy.`));
  }
  return lines.join("\n");
}
