// Conflicts Mervin saved on this Mac: work that, one PR at a time, would have been a merge conflict an agent fought by
// hand. preflight notes each file Mervin settles for a branch ("preflight"), the office each task it holds so two
// branches never clash ("hold"). One JSON line each in ~/.rustybuns/conflicts-saved.jsonl; the same key twice (preflight
// run again on the same branch) counts once. The daily ledger (apps/agent-office/ester/ledger-daily.ts) reads it beside
// codeSplitter's own count (GET /api/stats/saved).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { num, obj, str, type Of } from "../packages/util/src/guard.ts";

export const SAVED_LOG = path.join(homedir(), ".rustybuns", "conflicts-saved.jsonl");
export const Saved = obj({ at: num(0, 1e14), kind: str(40), key: str(400), n: num(0, 1e6) });
export type Saved = Of<typeof Saved>;

/** Note `n` conflicts saved under `key`. Never throws: a counter must not fail what it counts. */
export function noteSaved(kind: "preflight" | "hold", key: string, n = 1, file = SAVED_LOG): void {
  if (n <= 0) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: Date.now(), kind, key, n }) + "\n");
  } catch { /* a full disk loses a count, not the run */ }
}

/** Every line of the log, the first of each key only, bad lines skipped. */
export function readSaved(file = SAVED_LOG): Saved[] {
  if (!existsSync(file)) return [];
  const seen = new Set<string>(), out: Saved[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let row: Saved;
    try { row = Saved(JSON.parse(line)); } catch { continue; }
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
}
