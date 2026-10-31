// The GitHub shutoff valves (#2498): one switch for the whole office and one per repo, kept in <dataDir>/grants.json
// where connect/ can list it. A repo is allowed, blocked, or unset (the first write there asks once, and Always on the
// card allows the repo). The office switch and a blocked repo stop every write with no card. A file from before this
// listed grants per kind and worker; any repo that had one reads as allowed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Gate { office: boolean; repos: Record<string, boolean> }

const file = (dir: string) => path.join(dir, "grants.json");

/** The saved gate; a missing or damaged file is writes on and every repo unset (the first write there asks). */
export function readGate(dir: string): Gate {
  const gate: Gate = { office: true, repos: {} };
  if (!existsSync(file(dir))) return gate;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file(dir), "utf8")); } catch { return gate; }
  if (typeof raw !== "object" || raw === null) return gate;
  if ("office" in raw && raw.office === false) gate.office = false;
  if ("grants" in raw && Array.isArray(raw.grants))
    for (const r of raw.grants) if (typeof r === "object" && r !== null && "repo" in r && typeof r.repo === "string") gate.repos[r.repo] = true;
  if ("repos" in raw && typeof raw.repos === "object" && raw.repos !== null)
    for (const [repo, on] of Object.entries(raw.repos)) if (typeof on === "boolean") gate.repos[repo] = on;
  return gate;
}

/** What a write on `repo` does: allowed, stopped by a switch (no card), or asked about. */
export const decide = (gate: Gate, repo: string): "allow" | "block-office" | "block-repo" | "ask" =>
  !gate.office ? "block-office" : gate.repos[repo] === false ? "block-repo" : gate.repos[repo] === true ? "allow" : "ask";

const save = (dir: string, gate: Gate) => { writeFileSync(file(dir), JSON.stringify({ office: gate.office, repos: gate.repos }, null, 2)); return gate; };

export const setOffice = (dir: string, on: boolean) => save(dir, { ...readGate(dir), office: on });

/** `on` null forgets the repo, so its next write asks again. */
export function setRepo(dir: string, repo: string, on: boolean | null) {
  const gate = readGate(dir);
  if (on === null) delete gate.repos[repo]; else gate.repos[repo] = on;
  return save(dir, gate);
}
