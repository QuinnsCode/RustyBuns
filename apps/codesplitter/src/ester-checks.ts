// Ester on a repo's own check runs (#3923): each red check of an open branch sorted by who owns it (ester-sort.ts, the
// rule scripts/ester.ts uses on Mervin's board), and her memory per repo as plain D1 rows (ester_verdicts). A person's
// answer to a red check becomes a rule: one ruled flaky sorts as flaky on every branch until someone rules it fix or stale.
//
//   GET  /api/repos/:o/:r/checks/ester   her memory: each check's runs and fails here, its answers, and whether a fail is unexplained
//   POST /api/repos/:o/:r/checks/ester   {name, kind: fix | stale | flaky, ref?, note?}: the crew says what a red check was

import { fail, json, need, readBody, type Env } from "./env.ts";
import { obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { sortRed, type Verdict } from "./ester-sort.ts";

export const KINDS = ["fix", "stale", "flaky"] as const;
export type Kind = (typeof KINDS)[number];
const ANSWER = obj({ name: str(200), kind: oneOf(KINDS), ref: opt(str(200)), note: opt(str(500, { min: 0 })) });

interface Answer { name: string; kind: Kind; ref: string | null; note: string | null; by_user: string; at: number }

/** The newest answer for each of `names`. */
async function lastAnswers(env: Env, owner: string, repo: string, names: string[]) {
  if (!names.length) return new Map<string, Answer>();
  const { results } = await env.DB.prepare(`SELECT name, kind, ref, note, by_user, at FROM ester_verdicts WHERE owner = ? AND repo = ? AND name IN (${names.map(() => "?").join(", ")}) ORDER BY id`)
    .bind(owner, repo, ...names).all<Answer>();
  return new Map(results.map((a) => [a.name, a]));
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Sorts the red checks `failed` of open branch `ref`, whose runs are those on `from` at `sha` (`from` is a merge-train
 * car's ref when the branch rides one, and `riders` the car's branches).
 */
export async function sortBranch(env: Env, owner: string, repo: string, ref: string, from: string, sha: string, failed: string[], riders?: string[]): Promise<Verdict<string>[]> {
  if (!failed.length) return [];
  const said = await lastAnswers(env, owner, repo, failed);
  const suspects = riders?.length ? riders : [ref];
  const out: Verdict<string>[] = [];
  for (const name of failed) {
    const refs = [...new Set(["main", ...suspects])];
    const { results } = await env.DB.prepare(`SELECT ref, status FROM check_runs WHERE owner = ? AND repo = ? AND name = ? AND ref IN (${refs.map(() => "?").join(", ")}) ORDER BY id`)
      .bind(owner, repo, name, ...refs).all<{ ref: string; status: string }>();
    const last = new Map(results.map((r) => [r.ref, r.status]));
    const passedHere = await env.DB.prepare("SELECT 1 FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha = ? AND name = ? AND status = 'passed' LIMIT 1").bind(owner, repo, from, sha, name).first();
    const main = last.get("main");
    const a = said.get(name);
    // Alone, the branch's own run is the red one. In a car, each rider's own run says whether it was red on its own.
    const red = riders?.length ? suspects.filter((b) => ["failed", "cancelled"].includes(last.get(b) ?? "")) : [ref];
    const pending = riders?.length ? suspects.filter((b) => ["queued", "running"].includes(last.get(b) ?? "")) : [];
    out.push(sortRed(name, {
      onMain: main === "failed" || main === "cancelled", mainRunning: main === "queued" || main === "running",
      passedOnRerun: passedHere ? true : undefined,
      saidFlaky: a?.kind === "flaky" ? `@${a.by_user} said it's flaky on ${day(a.at)}${a.note ? `: ${a.note}` : ""}` : undefined,
      suspects, red, redWhy: name, pending,
    }));
  }
  return out;
}

/** Her memory: every check this repo ran to an end, its runs and fails, its answers newest last, and whether its last fail is unexplained. */
export async function memory(env: Env, owner: string, repo: string) {
  const { results: runs } = await env.DB.prepare(`SELECT name, COUNT(*) AS runs, SUM(status = 'failed') AS fails, MAX(CASE WHEN status = 'failed' THEN COALESCE(finished_at, created_at) END) AS last_fail
    FROM check_runs WHERE owner = ? AND repo = ? AND status IN ('passed', 'failed') GROUP BY name ORDER BY fails DESC, name`).bind(owner, repo).all<{ name: string; runs: number; fails: number; last_fail: number | null }>();
  const { results: answers } = await env.DB.prepare("SELECT name, kind, ref, note, by_user, at FROM ester_verdicts WHERE owner = ? AND repo = ? ORDER BY id").bind(owner, repo).all<Answer>();
  const by = new Map<string, Answer[]>();
  for (const a of answers) by.set(a.name, [...(by.get(a.name) ?? []), a]);
  return {
    checks: runs.map((r) => {
      const said = by.get(r.name) ?? [];
      const rule = said.at(-1)?.kind === "flaky" ? "flaky" : null;
      return { ...r, answers: said, rule, unexplained: r.fails > 0 && r.last_fail !== null && !said.some((a) => a.at >= r.last_fail!) };
    }),
  };
}

export async function esterRoutes(req: Request, env: Env, owner: string, repo: string, user: string | null, write: boolean): Promise<Response | null> {
  if (req.method === "GET") return json(await memory(env, owner, repo));
  if (req.method !== "POST") return null;
  if (!write || !user) return fail("NoWriteAccess", "no write access");
  const b = need(await readBody(req), ANSWER, "name: the check; kind: fix, stale or flaky; ref and note if you like");
  if (b instanceof Response) return b;
  if (!(await env.DB.prepare("SELECT 1 FROM check_runs WHERE owner = ? AND repo = ? AND name = ? LIMIT 1").bind(owner, repo, b.name).first())) return fail("NoSuchCheck", `no check named ${b.name} has run here`);
  await env.DB.prepare("INSERT INTO ester_verdicts (owner, repo, name, kind, ref, note, by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(owner, repo, b.name, b.kind, b.ref ?? null, b.note?.trim() || null, user, Date.now()).run();
  return json(await memory(env, owner, repo), 201);
}
