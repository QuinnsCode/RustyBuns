// Layout: git notes as the "why" of a commit (#1580): what an agent's commit says about its run, written and read back
// A commit says what changed; its note says why. When a commit carries an agent's lines, the push that
// makes it also writes a git note under refs/notes/codesplitter (git.ts NOTES_REF): which agent, its
// harness and model, a hash of the prompt (never the prompt), how the run ended, and its DONE / NEXT /
// BROKE / DONT note; once its checks finish on main, a closing `checks: passed | failed (name)` line (#2302). It travels with a clone and a mirror, so the reason outlives the app:
//   git fetch origin refs/notes/codesplitter:refs/notes/codesplitter && git log --notes=codesplitter
// The vein's commit card reads it back:
//   GET /api/repos/:o/:r/commits/:sha/note   {note: text | null}

import { access, handleFor } from "./archive.ts";
import { readNote, writeNote } from "./budget.ts";
import type { ArtifactsRepo, Env } from "./env.ts";
import { NOTES_REF, remoteRefs, setNote } from "./git.ts";
import { DONE, type CheckRun } from "./checks.ts";
import { isPlainObject, parseJson, sha256 } from "./util.ts";

interface RunRow { id: number; agent: string; harness: string; model: string | null; task: string; status: string; result: string | null }

/**
 * The note for a commit of `path` that carries `writers`' edits: one block per agent among them, from
 * its newest run on the file. Null when no agent wrote any of it. `open` is false when the file has
 * private lines: the run's own words could quote them, so only the facts go in.
 */
export async function commitNote(env: Env, owner: string, repo: string, path: string, writers: string[], open: boolean): Promise<string | null> {
  const agents = writers.filter((w) => w.startsWith("agent-"));
  if (!agents.length) return null;
  const { results } = await env.DB.prepare(`SELECT id, agent, harness, model, task, status, result FROM agent_runs WHERE owner = ? AND repo = ? AND path = ? AND agent IN (${agents.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 20`)
    .bind(owner, repo, path, ...agents).all<RunRow>();
  const seen = new Set<string>(), newest = results.filter((r) => !seen.has(r.agent) && !!seen.add(r.agent));
  if (!newest.length) return null;
  const blocks = await Promise.all(newest.map(async (r) => {
    const res: unknown = parseJson(r.result, null), out = isPlainObject(res) ? res : {};
    const handoff = isPlainObject(out.handoff) && typeof out.handoff.note === "string" ? out.handoff.note : null;
    const said = open ? handoff ?? writeNote(readNote(typeof out.output === "string" ? out.output : "")) : "";
    return [
      `agent: ${r.agent}`,
      `harness: ${r.harness}${r.model ? `, model ${r.model}` : ""}`,
      `prompt: sha256:${(await sha256(r.task)).slice(0, 16)}`,
      `run: ${r.id}, ${r.status}${typeof out.error === "string" ? ` (${out.error.split("\n")[0]!.slice(0, 200)})` : ""}`,
      ...said ? [said] : [],
    ].join("\n");
  }));
  return blocks.join("\n\n");
}

/** The codeSplitter note on `sha`, as the repo's git holds it, or null. */
export async function noteOn(handle: ArtifactsRepo, remote: string, sha: string): Promise<string | null> {
  const a = await access(handle, remote, "read", 60);
  const tip = (await remoteRefs(a.remote, a.token)).get(NOTES_REF);
  const tree = tip && (await handle.readCommit(tip))?.treeHash;
  const entry = tree && (await handle.readTree(tree))?.find((e) => e.name === sha);
  const text = entry && await (await handle.readBlob(entry.hash))?.text();
  return text ? text.replace(/\n$/, "") : null;
}

/**
 * A check on main finished: when its commit carries a note, the note gets a `checks:` line (#2302),
 * `failed (names)` as soon as one fails, `passed` once all of that commit's checks are in. A commit
 * without a note is left alone; the line closes the note.
 */
export async function noteChecks(env: Env, run: CheckRun): Promise<void> {
  if (run.ref !== "main" || !/^[0-9a-f]{40}$/.test(run.sha) || (run.status !== "passed" && run.status !== "failed")) return;
  const { results } = await env.DB.prepare("SELECT name, status FROM check_runs WHERE owner = ? AND repo = ? AND ref = 'main' AND sha = ? AND status != 'cancelled' ORDER BY name")
    .bind(run.owner, run.repo, run.sha).all<{ name: string; status: CheckRun["status"] }>();
  const failed = [...new Set(results.filter((r) => r.status === "failed").map((r) => r.name))];
  if (!failed.length && !results.every((r) => DONE.has(r.status))) return;
  const h = await handleFor(env, run.owner, run.repo).catch(() => null);
  const old = h && await noteOn(h.handle, h.remote, run.sha).catch(() => null);
  if (!h || !old) return;
  const line = `checks: ${failed.length ? `failed (${failed.join(", ")})` : "passed"}`;
  const lines = old.split("\n"), rest = lines.filter((l) => !l.startsWith("checks: "));
  if (lines.at(-1) === line && rest.length === lines.length - 1) return;
  const a = await access(h.handle, h.remote, "write", 60);
  await setNote(a.remote, a.token, h.handle, run.sha, [...rest, line].join("\n"));
}
