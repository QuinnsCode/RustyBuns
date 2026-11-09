// Layout: the bus's AI pass: a bus lane with no command leaves into one agent run over every change aboard, its verdict kept per bus
/**
 * A `bus` lane (pipeline.ts) seats changes until it's full, then leaves with them all. One with a `run` command
 * queues that command (checks.ts planLanes); one without leaves into an AI pass, here: one coding agent reads every
 * change aboard at once and says YAY or NAY, the way a hook does at a merge (pipeline-hooks.ts askAi: the cheapest
 * harness, behind healUnavailable and hostedBudget). It costs money, so:
 *
 *   bus_seats    each change on main that took a seat, by commit; the bus's diff runs from before the first one
 *   bus_passes   one verdict per bus, keyed by main's commit it left at: claimed before the agent runs, so a retry
 *                (the same commit's checks again, a release cut on a tip that just sent the bus off) reads it and pays nothing
 *
 * The pass shows as a check run named after the lane on that commit: passed on a yay, failed on a nay with the
 * reason, cancelled when no agent could answer (no CLI, healing off, budget spent), which leaves it to a person.
 * Only main moves seats: a branch's checks read the counts and take no seat.
 */

import { handleFor } from "./archive.ts";
import { diff, type FileDiff } from "./deploy-review.ts";
import { askAi, VERDICT_FILE } from "./pipeline-hooks.ts";
import type { Lane, LaneCall } from "./pipeline.ts";
import { glob } from "./util.ts";
import type { Env } from "./env.ts";

/** A pass reads at most this much diff; the agent is told the rest goes on. */
const MAX_DIFF = 60_000;

export function busPrompt(lane: string, aboard: number) {
  return [
    `You are the ${lane} bus's pass on codeSplitter's pipeline: ${aboard} change${aboard === 1 ? "" : "s"} landed on main and rode this bus, and you read them all at once.`,
    `${VERDICT_FILE} holds them as one diff, after the list of commits. Read it, then replace the whole of ${VERDICT_FILE} with one line:`,
    `YAY, or NAY: <the reason, one sentence a person can act on>.`,
    `Say NAY only for a real problem (a bug, a broken link or build, lost work, a secret committed); taste is not a reason.`,
    `Do not edit any other file, and do not run commands.`,
  ].join("\n");
}

const render = (files: FileDiff[], more: boolean) =>
  files.map((f) => `--- a/${f.path}\n+++ b/${f.path}\n${f.note ? `(${f.note})\n` : ""}${f.lines.join("\n")}\n`).join("") + (more ? "(more files changed than a pass reads)\n" : "");

/** The commits aboard, oldest first, and their diff over the lane's paths from before the first one to `tip`. */
async function aboardDiff(env: Env, owner: string, repo: string, lane: Lane, seats: string[], tip: string) {
  const h = await handleFor(env, owner, repo);
  if (!h) return null;
  const metas = await Promise.all(seats.map((sha) => h.handle.readCommit(sha).catch(() => null)));
  const base = metas[0]?.parents[0] ?? null;
  const d = await diff(h.handle, base, tip);
  const res = lane.paths?.length ? lane.paths.map(glob) : null;
  const files = res ? d.files.filter((f) => res.some((re) => re.test(f.path))) : d.files;
  const list = seats.map((sha, i) => `${sha.slice(0, 12)} ${metas[i]?.message.split("\n")[0]?.slice(0, 200) ?? ""}`.trimEnd()).join("\n");
  const text = `Commits aboard, oldest first:\n${list}\n\n${render(files, d.more)}`;
  return text.length > MAX_DIFF ? `${text.slice(0, MAX_DIFF)}\n(the diff goes on: ${text.length - MAX_DIFF} more characters)\n` : text;
}

/**
 * A change landed on main at `sha` (or a release was cut there, `release`): each bus lane with no command it boards
 * keeps its seat, and each one that leaves runs its AI pass over everything aboard, once per bus.
 */
export async function busRide(env: Env, owner: string, repo: string, sha: string, lanes: { lane: Lane; call: LaneCall }[], by: string, release = false) {
  for (const { lane, call } of lanes) {
    if (lane.cadence !== "bus" || lane.run) continue;
    const seat = () => env.DB.prepare("INSERT INTO bus_seats (owner, repo, lane, sha, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(owner, repo, lane.name, sha, Date.now()).run();
    if (call.go === "board") await seat();
    else if (call.go === "depart" && call.ai) {
      // This bus left already (a retry): its verdict stands, and its seats aren't taken again.
      if (await env.DB.prepare("SELECT 1 FROM bus_passes WHERE owner = ? AND repo = ? AND lane = ? AND sha = ?").bind(owner, repo, lane.name, sha).first()) continue;
      // A release sends the bus off with the seats it has; a change that fills it rides too.
      if (!release) await seat();
      await busPass(env, owner, repo, lane, call, sha, by);
    }
  }
}

async function busPass(env: Env, owner: string, repo: string, lane: Lane, call: LaneCall, sha: string, by: string) {
  const { results } = await env.DB.prepare("SELECT sha FROM bus_seats WHERE owner = ? AND repo = ? AND lane = ? ORDER BY at, rowid").bind(owner, repo, lane.name).all<{ sha: string }>();
  const seats = results.map((r) => r.sha);
  // An empty bus (a release cut right after it left) has nothing to read.
  if (!seats.length) return null;
  // The claim: whoever writes this bus's row first pays for its pass; a retry finds the row and stops.
  const claim = await env.DB.prepare("INSERT INTO bus_passes (owner, repo, lane, sha, say, aboard, at) VALUES (?, ?, ?, ?, 'running', ?, ?) ON CONFLICT DO NOTHING")
    .bind(owner, repo, lane.name, sha, seats.length, Date.now()).run();
  if (!claim.meta.changes) return null;
  await env.DB.prepare("DELETE FROM bus_seats WHERE owner = ? AND repo = ? AND lane = ?").bind(owner, repo, lane.name).run();
  const { recordRun, updateRun } = await import("./checks.ts");
  const run = await recordRun(env, { owner, repo, ref: "main", sha, name: lane.name, runner: "external", status: "running", runner_label: "ai pass" }, by);
  const head = `lane ${lane.name} (bus): ${call.why}\nAn AI pass over the ${seats.length} change${seats.length === 1 ? "" : "s"} aboard: ${seats.map((s) => s.slice(0, 12)).join(", ")}\n`;
  const text = await aboardDiff(env, owner, repo, lane, seats, sha).catch(() => null);
  const r = text ? await askAi(env, owner, busPrompt(lane.name, seats.length), text) : { error: "the changes aboard couldn't be read" };
  const v = "error" in r ? { say: "none", by: "ai", reason: `the AI pass couldn't answer: ${r.error}` } : r;
  await env.DB.prepare("UPDATE bus_passes SET say = ?, by = ?, reason = ?, at = ? WHERE owner = ? AND repo = ? AND lane = ? AND sha = ?")
    .bind(v.say, v.by, v.reason ?? null, Date.now(), owner, repo, lane.name, sha).run();
  const said = v.say === "yay" ? `${v.by} said yay${v.reason ? `: ${v.reason}` : ""}\n` : v.say === "nay" ? `${v.by} said nay: ${v.reason}\n` : `${v.reason}. A person reads them instead.\n`;
  return updateRun(env, run, { status: v.say === "yay" ? "passed" : v.say === "nay" ? "failed" : "cancelled", log: head + said }, by);
}
