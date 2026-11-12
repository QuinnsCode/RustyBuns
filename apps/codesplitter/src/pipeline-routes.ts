// Layout: the pipeline's routes: a repo's road for one change (GET .../pipeline), and any pipeline's (POST /api/pipeline)
// The pipeline itself (stops, hooks, lanes) is pipeline.ts; these only read it in and answer.
//
//   GET  /api/repos/:o/:r/pipeline?files=a,b&release=true
//        the repo's codesplitter.pipeline.json from main (the default without one) and the plan for that change,
//        with each lane's count as the repo keeps it (pipeline-lanes.ts): the checks queue goes by the same plan
//   POST /api/pipeline {pipeline?, change: {files, release?, counts?}}
//        the same for a pipeline you send, so an agent can try one before committing it
//   POST /api/repos/:o/:r/pipeline/release
//        the crew cuts a release at main's tip: every often and release lane runs and every bus leaves (cutRelease
//        in checks.ts). A version tag made here (tags.ts) does the same. 409 without a pipeline file or checks run here

import { arr, bool, int, obj, opt, rec, str } from "@rustybuns/util/guard";
import { fail, json, need, readBody, type Env } from "./env.ts";
import { repoPipeline } from "./pipeline-hooks.ts";
import { laneCounts } from "./pipeline-lanes.ts";
import { DEFAULT_PIPELINE, PIPELINE_FILE, Pipeline, plan, tally, type Change, type LaneCall } from "./pipeline.ts";

const Change = obj({ files: arr(str(500), 2000), release: opt(bool()), counts: opt(rec(int(0, 1e6), 50)) });
const Body = obj({ pipeline: opt(Pipeline), change: Change });

/** The plan and what the counts become after it. */
function answer(p: Pipeline, change: Change, source: string) {
  const steps = plan(p, change);
  const lanes: LaneCall[] = steps.flatMap((s) => s.kind === "stop" && s.lanes ? s.lanes : []);
  return { source, pipeline: p, plan: steps, counts: tally(change.counts ?? {}, lanes) };
}

export async function pipelineRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null,
  access: (owner: string, repo: string) => Promise<{ read: boolean; write: boolean }>): Promise<Response | null> {
  if (p[1] === "repos" && p[2] && p[3] && p[4] === "pipeline" && p[5] === "release" && !p[6] && req.method === "POST") {
    const [owner, repo] = [p[2], p[3]];
    const { read, write } = await access(owner, repo);
    if (!read) return fail("NoSuchRepo", "no such repo");
    if (!write || !user) return fail("NoWriteAccess", "no write access");
    const { cutRelease, headOf, refChecks } = await import("./checks.ts");
    const sha = await headOf(env, owner, repo, "main");
    if (!sha) return fail("NoGit", "main has no commit yet");
    const lanes = await cutRelease(env, owner, repo, sha, user);
    if (!lanes) return fail("NoReleaseLanes", `a release runs the lanes in ${PIPELINE_FILE}: this repo needs one on main, and its checks running here`);
    return json({ sha, lanes, checks: await refChecks(env, owner, repo, "main") }, 202);
  }
  if (p[1] === "pipeline" && !p[2] && req.method === "POST") {
    const b = need(await readBody(req), Body);
    if (b instanceof Response) return b;
    return json(answer(b.pipeline ?? DEFAULT_PIPELINE, b.change, b.pipeline ? "sent" : "default"));
  }
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "pipeline" && !p[5] && req.method === "GET")) return null;
  const [owner, repo] = [p[2], p[3]];
  const { read, write } = await access(owner, repo);
  if (!read) return fail("NoSuchRepo", "no such repo");
  const change: Change = {
    files: (url.searchParams.get("files") ?? "").split(",").map((f) => f.trim()).filter(Boolean),
    release: url.searchParams.get("release") === "true",
    counts: await laneCounts(env, owner, repo),
  };
  const r = await repoPipeline(env, owner, repo);
  if ("error" in r) return fail("PipelineInvalid", r.error);
  // The file is read with the crew's eyes (private lines' real text), so only the crew gets it echoed back; a reader gets the plan.
  const out = answer(r.pipeline, change, r.source);
  if (write) return json(out);
  // A private line can say a lane's name or what it runs: then the plan, made from them, is the crew's too.
  if (r.hides) return json({ source: out.source, hidden: `${PIPELINE_FILE} has private lines: its plan is for the crew` });
  return json({ source: out.source, plan: out.plan, counts: out.counts });
}
