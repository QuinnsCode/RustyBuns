// Layout: the merge train (#3323): one speculative check run per merge-plan wave, a green car merging whole, a red one halving till it finds whose it is
// With the fresh_main check setting (checks.ts, #3314), a branch merging into main makes every other open branch's
// green stale. Rerunning each one alone (a car of one) costs a run per branch per merge. A repo whose pipeline
// (pipeline.ts) has a `train` lane runs a car per wave of the merge plan (branches.ts mergePlan) instead:
//
//   - A car is a row in train_cars and its checks run on ref `train:<id>` (no branch can be named that: git refuses
//     a colon) at `train:<id>@<time>`. The runner clones main and lays the car's tree over it: each branch's own
//     files, the ones two of them change merged in order the way their merges will land them (carFiles, branches.ts).
//   - A wave's branches don't clash with each other (merge-plan.ts), so they ride together; the waves' cars run side by side.
//   - While a car is the newest one a branch rides in and nothing has moved under it (a member edited, or a branch
//     outside it merged, since the runner read it), its runs stand in for the branch's own (refChecks): green, the
//     whole car merges (POST .../merges {car}) without rerunning, since one member landing doesn't stale the others.
//   - A red car splits into two halves, each queued as a car of its own, until a car of one is red: `blocks` names
//     that branch, on it and every car it came from.

import { checkSettings, planLanes, PUSHED, recordRun, type CheckRun } from "./checks.ts";
import { fail, json, type Env } from "./env.ts";
import { parseJson } from "./util.ts";

/** A car's ref: no branch can be named this, since git refuses a colon in a ref. */
export const carRef = (id: number) => `train:${id}`;
export const carId = (ref: string) => Number(/^train:(\d+)$/.exec(ref)?.[1] ?? NaN);

interface CarRow { id: number; branches: string; parent: number | null; split: number; blocks: string | null; created_at: number }
export interface Car { id: number; branches: string[]; parent: number | null; blocks: string | null; created_at: number }
const carOf = (r: CarRow): Car => ({ id: r.id, branches: parseJson<string[]>(r.branches, []), parent: r.parent, blocks: r.blocks, created_at: r.created_at });

/** Whether the repo's pipeline rides the train: a lane with cadence `train` (pipeline.ts). */
export async function trainOn(env: Env, owner: string, repo: string) {
  const p = await (await import("./pipeline-hooks.ts")).repoPipeline(env, owner, repo).catch(() => null);
  return !!p && "pipeline" in p && !!p.pipeline.lanes?.some((l) => l.cadence === "train");
}

async function car(env: Env, owner: string, repo: string, id: number) {
  const r = await env.DB.prepare("SELECT * FROM train_cars WHERE owner = ? AND repo = ? AND id = ?").bind(owner, repo, id).first<CarRow>();
  return r ? carOf(r) : null;
}

/** A car's runs on its latest sha, the newest of each name. */
async function carRuns(env: Env, owner: string, repo: string, id: number) {
  const ref = carRef(id);
  const sha = await env.DB.prepare("SELECT sha FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? ORDER BY id DESC LIMIT 1").bind(owner, repo, ref).first<string>("sha");
  if (!sha) return { sha: null, runs: [] as CheckRun[] };
  const { results } = await env.DB.prepare("SELECT * FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha = ? ORDER BY id").bind(owner, repo, ref, sha).all<CheckRun>();
  return { sha, runs: [...new Map(results.map((r) => [r.name, r])).values()] };
}

const statusOf = (runs: CheckRun[]) =>
  runs.some((r) => r.status === "failed" || r.status === "cancelled") ? "failed"
  : runs.length && runs.every((r) => r.status === "passed") ? "passed"
  : runs.some((r) => r.status === "running") ? "running" : "queued";

/**
 * Queue one car: the checks main plans for the files its branches change, on `train:<id>`. The runner reads the car's
 * tree when it claims a run (carFiles), so a car queued now checks main and the branches as they are then.
 */
export async function queueCar(env: Env, owner: string, repo: string, branches: string[], by: string, why: string, parent: number | null = null) {
  const now = Date.now();
  const id = (await env.DB.prepare("INSERT INTO train_cars (owner, repo, branches, parent, by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(owner, repo, JSON.stringify(branches), parent, by, now).first<number>("id"))!;
  const s = await checkSettings(env, owner, repo);
  const q = branches.map(() => "?").join(", ");
  const paths = (await env.DB.prepare(`SELECT DISTINCT path FROM branch_files WHERE owner = ? AND repo = ? AND merged = 0 AND branch IN (${q})`).bind(owner, repo, ...branches).all<{ path: string }>()).results.map((r) => r.path);
  const runner = env.CI_RUNNER || typeof Bun === "undefined" ? "container" : "desktop";
  // A car a crew member queued carries their mark, like a run their push queued: claimRun keeps it from them, so they can't pass their own branch's checks unrun.
  const mark = by !== owner && by !== "upstream" && by !== "codesplitters" ? PUSHED(by) : "";
  const note = `${mark}merge-train car ${id}: main with ${branches.join(", ")} in. ${why}\n`;
  for (const { name, command, why: lane } of (await planLanes(env, owner, repo, "main", s, paths)).checks) {
    const run = await recordRun(env, { owner, repo, ref: carRef(id), sha: `${carRef(id)}@${now}`, name, runner, command }, by);
    await env.DB.prepare("UPDATE check_runs SET log = ? WHERE id = ?").bind(note + (lane ?? ""), run.id).run();
  }
  await (await import("./ci-runner.ts")).kick(env, owner, repo).catch(() => null);
  return { id, branches };
}

/**
 * A car per merge-plan wave, of the wave's open branches with something to merge that don't wait on another
 * to merge first and whose checks don't already pass (riding a green car, say). Empty waves get none.
 */
export async function queueCars(env: Env, owner: string, repo: string, by: string, why: string) {
  const { mergePlan } = await import("./branches.ts");
  const { refChecks, waiting } = await import("./checks.ts");
  const plan = await mergePlan(env, owner, repo, by);
  const cars: { id: number; branches: string[] }[] = [];
  for (const wave of plan.waves) {
    const riders: string[] = [];
    for (const { branch } of wave) {
      const left = await env.DB.prepare("SELECT 1 FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 LIMIT 1").bind(owner, repo, branch).first();
      if (!left || await waiting(env, owner, repo, branch) || (await refChecks(env, owner, repo, branch)).gate.ok) continue;
      riders.push(branch);
    }
    if (riders.length) cars.push(await queueCar(env, owner, repo, riders, by, why));
  }
  return cars;
}

/**
 * The car whose runs stand in for open branch `branch`'s own (refChecks): the newest it rides in, while nothing has
 * moved under it since the runner read it (a member edited, a branch outside it merged) and none of its runs was
 * cancelled. null: the branch's own runs count.
 */
export async function carFor(env: Env, owner: string, repo: string, branch: string) {
  const { results } = await env.DB.prepare("SELECT * FROM train_cars WHERE owner = ? AND repo = ? AND branches LIKE ? ORDER BY id DESC LIMIT 20")
    .bind(owner, repo, `%${JSON.stringify(branch)}%`).all<CarRow>();
  const c = results.map(carOf).find((c) => c.branches.includes(branch));
  if (!c) return null;
  const { sha, runs } = await carRuns(env, owner, repo, c.id);
  if (!sha || runs.some((r) => r.status === "cancelled")) return null;
  const started = runs.map((r) => r.started_at).filter((t): t is number => t !== null);
  if (started.length) {
    const asOf = Math.min(...started), q = c.branches.map(() => "?").join(", ");
    const moved = await env.DB.prepare(`SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND (
      (status = 'open' AND name IN (${q}) AND changed_at > ?) OR (status = 'merged' AND name NOT IN (${q}) AND merged_at > ?)) LIMIT 1`)
      .bind(owner, repo, ...c.branches, asOf, ...c.branches, asOf).first();
    if (moved) return null;
  }
  return { ...c, ref: carRef(c.id), sha };
}

/**
 * One of a car's runs finished. Red, the car splits once: two halves, each a car of its own, queued now. A red car of
 * one is that branch's to fix: `blocks` names it on the car and every car it came from.
 */
export async function carFinished(env: Env, run: CheckRun) {
  if (run.status !== "failed") return;
  const c = await car(env, run.owner, run.repo, carId(run.ref));
  if (!c) return;
  const took = await env.DB.prepare("UPDATE train_cars SET split = 1 WHERE id = ? AND split = 0").bind(c.id).run();
  if (!took.meta?.changes) return;
  if (c.branches.length > 1) {
    const half = Math.ceil(c.branches.length / 2);
    // The halves are the car's own queuer's, so their mark (above) survives the split.
    const queuer = await env.DB.prepare("SELECT by FROM train_cars WHERE id = ?").bind(c.id).first<string>("by");
    for (const part of [c.branches.slice(0, half), c.branches.slice(half)])
      await queueCar(env, run.owner, run.repo, part, queuer ?? "codesplitters", `Car ${c.id} went red (${run.name}): split to find whose it is.`, c.id);
    return;
  }
  for (let at: Car | null = c; at; at = at.parent ? await car(env, run.owner, run.repo, at.parent) : null)
    await env.DB.prepare("UPDATE train_cars SET blocks = ? WHERE id = ? AND blocks IS NULL").bind(c.branches[0], at.id).run();
}

/** The repo's newest cars, each with its runs' status. */
async function listCars(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare("SELECT * FROM train_cars WHERE owner = ? AND repo = ? ORDER BY id DESC LIMIT 50").bind(owner, repo).all<CarRow>();
  return Promise.all(results.map(async (r) => {
    const { runs } = await carRuns(env, owner, repo, r.id);
    return { ...carOf(r), ref: carRef(r.id), status: statusOf(runs), runs: runs.map((x) => ({ id: x.id, name: x.name, status: x.status })) };
  }));
}

/**
 *   GET  /api/repos/:o/:r/train             {on, cars: [{id, branches, ref, status, blocks, parent, runs}]}
 *   POST /api/repos/:o/:r/train             queue a car per merge-plan wave now: {cars: [{id, branches}]}
 *   GET  /api/repos/:o/:r/train/:id/files   a car's tree over main, for a runner: {branches, files: {path: text | null}}
 */
export async function trainRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null, a: { read: boolean; write: boolean }): Promise<Response | null> {
  if (p[4] !== "train") return null;
  if (!p[5] && req.method === "GET") return json({ on: await trainOn(env, owner, repo), cars: await listCars(env, owner, repo) });
  if (!p[5] && req.method === "POST") {
    if (!a.write || !user) return fail("NoWriteAccess", "no write access");
    if (!(await checkSettings(env, owner, repo)).here) return fail("ChecksElsewhere", "checks don't run here: a car is our own check run (PUT .../checks/settings {where: here})");
    return json({ cars: await queueCars(env, owner, repo, user, `Queued by @${user}.`) });
  }
  if (p[5] && p[6] === "files" && !p[7] && req.method === "GET") {
    // The tree is built with the crew's eyes (private lines' real text): only the crew reads it; a runner reads it in-process (carTree).
    if (!a.write) return fail("NoWriteAccess", "no write access");
    const c = await car(env, owner, repo, Number(p[5]));
    if (!c) return fail("NoSuchCar", "no such car");
    try { return json({ branches: c.branches, files: await (await import("./branches.ts")).carFiles(env, owner, repo, c.branches, user ?? "upstream") }); }
    catch (e) {
      // carFiles says which branches and file; a reader's own failure could carry anything, so that stays in the log.
      console.warn("train car files:", (e as Error).message);
      return fail("CarUnsettled", "the car's branches don't lay over main cleanly: two of them clash in a file, or one can't be read");
    }
  }
  return null;
}

/** For the runners: the tree of the car `ref` names, and what to say about it in the log. */
export async function carTree(env: Env, owner: string, repo: string, ref: string) {
  const c = await car(env, owner, repo, carId(ref));
  if (!c) throw new Error(`no merge-train car ${ref}`);
  const files = await (await import("./branches.ts")).carFiles(env, owner, repo, c.branches, "upstream");
  const n = Object.keys(files).length;
  return { files, said: `main, with ${n} file${n === 1 ? "" : "s"} from merge-train car ${c.id} (${c.branches.join(", ")}) as they are now\n` };
}
