// Layout: the pipeline's hooks at a merge: an AI's or a person's yay or nay, kept per branch and hook against the branch's hash
/**
 * The hooks in a repo's `codesplitter.pipeline.json` (pipeline.ts), acted on when a branch merges (branches.ts
 * mergeBranch). Mervin's dry run has said the branch merges; before anything lands on main, each hook that's on
 * has its say, in road order:
 *
 *   after-mervin, before-ester   the merged change is read before the tests are trusted with it
 *   after-ester                  the last word, asked once the required checks are green (mergeBlock passed)
 *
 * `ai`: a coding agent reads the change (the cheapest there is, as a merge's leftovers are asked) and answers
 * YAY or NAY with a reason. `ask`: the merge holds as a card for a person, who answers with
 * POST .../branches/:b/hooks/:hook {say, reason?}. A nay holds the branch, with the reason, until the branch
 * changes or a person says yay. A verdict is kept against the branch's hash (branchHash), so an edit asks again,
 * and an AI that can't run, or doesn't answer, leaves the card to a person rather than ask again on every merge.
 *
 * An agent run can take minutes, so the merge doesn't wait for it: the hook's row is claimed as `running` (one claim per
 * hash, so a merge tried again meanwhile pays nothing), the merge answers 409 with the card saying so, and the review runs
 * off the request (offRequest): a JOBS message when hosted, in this process on the desktop. Merging again once it answers goes on.
 */

import { arr, check, int, obj, oneOf, opt, raw, str, type Of } from "@rustybuns/util/guard";
import { docIn, fileDoc, toFile } from "./archive.ts";
import { text } from "./lines.ts";
import { hunks } from "./patch.ts";
import { harnessCommand } from "./harness.ts";
import { localSandbox, type Exec, type Sandbox } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { hostedBudget, installedHarnesses } from "./agent-routes.ts";
import { cheapest } from "./conflict-agent.ts";
import { healUnavailable } from "./heal.ts";
import { parseJson } from "./util.ts";
import { errorIn, type Env } from "./env.ts";
import { DEFAULT_PIPELINE, HOOKS, Lane, PIPELINE_FILE, Pipeline, type Hook } from "./pipeline.ts";

/** The repo's pipeline from main, the default without a file, or why the file isn't one. */
export async function repoPipeline(env: Env, owner: string, repo: string): Promise<{ pipeline: Pipeline; source: string } | { error: string }> {
  const res = await toFile(env, owner, repo, PIPELINE_FILE, owner, "file").catch(() => null);
  const doc = res?.ok ? await docIn(res) : null;
  const body = doc ? text(doc) : "";
  if (!body.trim()) return { pipeline: DEFAULT_PIPELINE, source: "default" };
  const parsed = check(Pipeline, parseJson<unknown>(body, null));
  return parsed ? { pipeline: parsed, source: PIPELINE_FILE } : { error: `${PIPELINE_FILE} on main isn't a pipeline: see POST /api/pipeline for what it takes` };
}

export interface Verdict { hook: Hook; hash: string; say: "yay" | "nay" | "waiting" | "running"; by: string; reason?: string }
/** What a person sends to a hook: yay or nay, and why. */
export const Said = obj({ say: oneOf(["yay", "nay"] as const), hash: str(64), reason: opt(str(4000)) });

/** The hooks that are on, in road order. */
export const hooksOn = (p: Pipeline) => HOOKS.flatMap((at) => {
  const mode = p.hooks?.[at] ?? "off";
  return mode === "off" ? [] : [{ at, mode }];
});

/** The kept verdicts on `branch`, any hash. */
export async function verdicts(env: Env, owner: string, repo: string, branch: string): Promise<Verdict[]> {
  const { results } = await env.DB.prepare("SELECT hook, hash, say, by, reason FROM hook_verdicts WHERE owner = ? AND repo = ? AND branch = ?")
    .bind(owner, repo, branch).all<Omit<Verdict, "reason"> & { reason: string | null }>();
  return results.map(({ reason, ...v }) => ({ ...v, ...(reason && { reason }) }));
}

export async function keepVerdict(env: Env, owner: string, repo: string, branch: string, v: Verdict) {
  await env.DB.prepare(`INSERT INTO hook_verdicts (owner, repo, branch, hook, hash, say, by, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner, repo, branch, hook) DO UPDATE SET hash = excluded.hash, say = excluded.say, by = excluded.by, reason = excluded.reason, at = excluded.at`)
    .bind(owner, repo, branch, v.hook, v.hash, v.say, v.by, v.reason ?? null, Date.now()).run();
}

export const forgetVerdicts = (env: Env, owner: string, repo: string, branch: string) =>
  env.DB.prepare("DELETE FROM hook_verdicts WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, branch).run();

/** The change a hook reads: each file's hunks against where the branch left main, as `git diff` prints them. */
export async function branchDiff(env: Env, owner: string, repo: string, branch: string, files: { path: string; deleted: number; blob: string | null }[], user: string) {
  const read = (path: string, op: string) => fileDoc(env, owner, repo, path, user, op, branch).then(text, () => "");
  const parts = await Promise.all(files.map(async (f) => {
    if (f.deleted) return `--- a/${f.path}\n+++ /dev/null\n(deleted)\n`;
    if (f.blob) return `--- a/${f.path}\n+++ b/${f.path}\n(binary)\n`;
    const [base, mine] = await Promise.all([read(f.path, "base"), read(f.path, "file")]);
    return `--- a/${f.path}\n+++ b/${f.path}\n${hunks(base, mine)}`;
  }));
  return parts.join("");
}

/** The file the reviewing agent rewrites with its answer. */
export const VERDICT_FILE = "VERDICT.md";
const MAX_DIFF = 60_000;

export function reviewPrompt(hook: Hook, branch: string) {
  return [
    `You are the ${hook} review on codeSplitter's pipeline: branch ${branch} merges into main cleanly, and you say whether it should.`,
    `${VERDICT_FILE} holds the change as a diff. Read it, then replace the whole of ${VERDICT_FILE} with one line:`,
    `YAY, or NAY: <the reason, one sentence a person can act on>.`,
    `Say NAY only for a real problem (a bug, a broken build, lost work, a secret committed); taste is not a reason.`,
    `Do not edit any other file, and do not run commands.`,
  ].join("\n");
}

/** The agent's yay or nay from what it left in the file, or why there isn't one. */
export function readVerdict(run: { code: number; out: string; text: string | null }, harness: string): { say: "yay" | "nay"; reason?: string } | { error: string } {
  if (run.code !== 0) return { error: `${harness} exited ${run.code}: ${run.out.trim().slice(-500)}` };
  const m = /^\s*\**\s*(YAY|NAY)\b\**[\s:.,-]*(.*)/i.exec(run.text ?? "");
  if (!m) return { error: `${harness} didn't answer YAY or NAY` };
  const reason = m[2]!.trim().slice(0, 4000);
  return m[1]!.toLowerCase() === "nay" ? { say: "nay", reason: reason || "no reason given" } : { say: "yay", ...(reason && { reason }) };
}

/**
 * One AI review of `diff`, asked with `prompt` (reviewPrompt, or the bus's pass in pipeline-bus.ts): the verdict, or why it
 * couldn't give one. The cheapest coding agent installed, and nothing when healing is off or the site's hosted budget is spent.
 */
export async function askAi(env: Env, owner: string, prompt: string, diff: string): Promise<{ say: "yay" | "nay"; reason?: string; by: string } | { error: string }> {
  const off = healUnavailable(env, owner), cheap = off ? null : cheapest(installedHarnesses(env));
  if (!cheap) return { error: off ?? "no coding agent's CLI is installed here" };
  const spent = await hostedBudget(env);
  if (spent) return { error: await errorIn(spent, "the site's hosted budget is spent") };
  const box: Sandbox = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
  const given = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n(the diff goes on: ${diff.length - MAX_DIFF} more characters)\n` : diff;
  const run = await box(harnessCommand(cheap.harness, prompt, { model: cheap.model }), { path: VERDICT_FILE, text: given })
    .catch((e) => ({ code: 1, out: String((e as Error)?.message ?? e), text: null }));
  const v = readVerdict(run, cheap.harness);
  return "error" in v ? v : { ...v, by: `ai:${cheap.harness}${cheap.model ? `/${cheap.model}` : ""}` };
}

/** Work an AI review does off the request: a hook's review at a merge, or a bus's pass (pipeline-bus.ts). */
const HookReview = obj({ review: oneOf(["hook"] as const), owner: str(200), repo: str(200), branch: str(500), at: oneOf(HOOKS), hash: str(64), user: str(200) });
const BusReview = obj({ review: oneOf(["bus"] as const), owner: str(200), repo: str(200), lane: Lane, seats: arr(str(64), 1000), sha: str(64), run: int(1, Number.MAX_SAFE_INTEGER), by: str(200) });
export type ReviewMessage = Of<typeof HookReview> | Of<typeof BusReview>;
/** A JOBS message's review, or null when the body isn't one. */
export const reviewOf = (b: unknown): ReviewMessage | null => {
  const m = check(obj({ review: raw }), b)?.review;
  return m === undefined ? null : check(HookReview, m) ?? check(BusReview, m);
};

/** Reviews started in this process (the desktop, tests) and not done yet. */
const live = new Set<Promise<unknown>>();
/** Settles once every review started in this process has answered: for tests, which read the verdict after. */
export const reviewsDone = async () => { while (live.size) await Promise.all([...live]); };

/** Runs `m` after the request answers: on the JOBS queue when hosted (an agent run outlasts a request's waitUntil), else in this process. */
export async function offRequest(env: Env, m: ReviewMessage) {
  if (env.AGENT_SANDBOX) return env.JOBS.send({ review: m });
  const p = runReview(env, m).catch(() => null).finally(() => live.delete(p));
  live.add(p);
}

/** The JOBS queue's reviews (worker.ts), side by side, since each is an agent run. */
export const runQueuedReviews = (messages: readonly { body: unknown; ack(): void }[], env: Env) =>
  Promise.all(messages.map(async (m) => { const r = reviewOf(m.body); if (r) await runReview(env, r).catch(() => null); m.ack(); }));

async function runReview(env: Env, m: ReviewMessage) {
  if (m.review === "bus") return (await import("./pipeline-bus.ts")).finishPass(env, m);
  const { branchHash } = await import("./branches.ts");
  const forget = () => env.DB.prepare("DELETE FROM hook_verdicts WHERE owner = ? AND repo = ? AND branch = ? AND hook = ? AND hash = ? AND say = 'running'").bind(m.owner, m.repo, m.branch, m.at, m.hash).run();
  // The branch changed (or merged) since the claim: that change is asked about at its own merge, and this one pays nothing.
  if (await branchHash(env, m.owner, m.repo, m.branch).catch(() => null) !== m.hash) return forget();
  const { results: files } = await env.DB.prepare("SELECT path, deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 ORDER BY path")
    .bind(m.owner, m.repo, m.branch).all<{ path: string; deleted: number; blob: string | null }>();
  const r = await askAi(env, m.owner, reviewPrompt(m.at, m.branch), await branchDiff(env, m.owner, m.repo, m.branch, files, m.user));
  const v = "error" in r ? { say: "waiting", by: "ai", reason: `the AI review couldn't answer: ${r.error}` } : r;
  // Only over its own claim: a person who answered meanwhile, or a newer hash, stands.
  await env.DB.prepare("UPDATE hook_verdicts SET say = ?, by = ?, reason = ?, at = ? WHERE owner = ? AND repo = ? AND branch = ? AND hook = ? AND hash = ? AND say = 'running'")
    .bind(v.say, v.by, v.reason ?? null, Date.now(), m.owner, m.repo, m.branch, m.at, m.hash).run();
}

/** Why a merge holds at a hook, shaped for its 409. */
export interface Held { error: string; hook: { at: Hook; mode: "ai" | "ask"; say: Verdict["say"]; by?: string; reason?: string } }

/**
 * The hooks' say on merging `branch` as it is (`hashOf`, read only when a hook is on), Mervin's dry run having passed: null when every hook that's on
 * said yay (or none is on), else why it holds. An `ai` hook with no verdict at this hash claims one and asks an agent off the request.
 * `base` is the repo's API path, for the card's address.
 */
export async function hookGate(env: Env, owner: string, repo: string, branch: string, hashOf: () => Promise<string>, user: string, base: string): Promise<Held | null> {
  const p = await repoPipeline(env, owner, repo);
  // A pipeline file that doesn't parse can't hold every merge, the one that fixes it included: it runs as the default.
  const on = hooksOn("error" in p ? DEFAULT_PIPELINE : p.pipeline);
  if (!on.length) return null;
  const hash = await hashOf();
  const kept = new Map((await verdicts(env, owner, repo, branch)).filter((v) => v.hash === hash).map((v) => [v.hook, v]));
  const card = `${base}/branches/${encodeURIComponent(branch)}/hooks`;
  for (const { at, mode } of on) {
    let v = kept.get(at);
    if (!v && mode === "ask") await keepVerdict(env, owner, repo, branch, v = { hook: at, hash, say: "waiting", by: "" });
    else if (!v) {
      // The claim: whoever writes this hash's row first pays for its review. An AI that can't answer leaves the card to a person,
      // since asking again on every merge spends for nothing.
      v = { hook: at, hash, say: "running", by: "ai" };
      const claim = await env.DB.prepare(`INSERT INTO hook_verdicts (owner, repo, branch, hook, hash, say, by, reason, at) VALUES (?, ?, ?, ?, ?, 'running', 'ai', NULL, ?)
        ON CONFLICT (owner, repo, branch, hook) DO UPDATE SET hash = excluded.hash, say = excluded.say, by = excluded.by, reason = NULL, at = excluded.at WHERE hook_verdicts.hash != excluded.hash`)
        .bind(owner, repo, branch, at, hash, Date.now()).run();
      if (claim.meta.changes) await offRequest(env, { review: "hook", owner, repo, branch, at, hash, user });
    }
    if (v.say === "yay") continue;
    const hook = { at, mode, say: v.say, ...(v.by && { by: v.by }), ...(v.reason && { reason: v.reason }) };
    if (v.say === "running") return { error: `the ${at} hook's AI review is reading the branch: merge again once it answers (GET ${card})`, hook };
    if (v.say === "nay") return { error: `the ${at} hook said nay${v.by ? ` (${v.by})` : ""}: ${v.reason ?? "no reason given"}. Change the branch, or a person says yay: POST ${card}/${at}`, hook };
    return { error: `the ${at} hook waits for a person's yay or nay${v.reason ? ` (${v.reason})` : ""}: POST ${card}/${at} {say: "yay" | "nay", reason?}`, hook };
  }
  return null;
}
