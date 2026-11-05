// Layout: the pipeline's routes: a repo's road for one change (GET .../pipeline), and any pipeline's (POST /api/pipeline)
// The pipeline itself (stops, hooks, lanes) is pipeline.ts; these only read it in and answer.
//
//   GET  /api/repos/:o/:r/pipeline?files=a,b&release=true&counts=unit:2,docs:7
//        the repo's codesplitter.pipeline.json from main (the default without one) and the plan for that change
//   POST /api/pipeline {pipeline?, change: {files, release?, counts?}}
//        the same for a pipeline you send, so an agent can try one before committing it

import { arr, bool, int, obj, opt, rec, str } from "@rustybuns/util/guard";
import { json, need, readBody, type Env } from "./env.ts";
import { repoPipeline } from "./pipeline-hooks.ts";
import { DEFAULT_PIPELINE, Pipeline, plan, tally, type Change, type LaneCall } from "./pipeline.ts";

const Change = obj({ files: arr(str(500), 2000), release: opt(bool()), counts: opt(rec(int(0, 1e6), 50)) });
const Body = obj({ pipeline: opt(Pipeline), change: Change });

/** The plan and what the counts become after it. */
function answer(p: Pipeline, change: Change, source: string) {
  const steps = plan(p, change);
  const lanes: LaneCall[] = steps.flatMap((s) => s.kind === "stop" && s.lanes ? s.lanes : []);
  return { source, pipeline: p, plan: steps, counts: tally(change.counts ?? {}, lanes) };
}

/** `unit:2,docs:7` as counts; a bad pair is left out. */
const countsOf = (s: string | null) => Object.fromEntries((s ?? "").split(",").map((kv) => kv.split(":")).filter(([k, v]) => k && /^\d+$/.test(v ?? "")).map(([k, v]) => [k!, Number(v)]));

export async function pipelineRoutes(req: Request, env: Env, p: string[], url: URL,
  access: (owner: string, repo: string) => Promise<{ read: boolean; write: boolean }>): Promise<Response | null> {
  if (p[1] === "pipeline" && !p[2] && req.method === "POST") {
    const b = need(await readBody(req), Body);
    if (b instanceof Response) return b;
    return json(answer(b.pipeline ?? DEFAULT_PIPELINE, b.change, b.pipeline ? "sent" : "default"));
  }
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "pipeline" && !p[5] && req.method === "GET")) return null;
  const [owner, repo] = [p[2], p[3]];
  const { read, write } = await access(owner, repo);
  if (!read) return json({ error: "not found" }, 404);
  const change: Change = {
    files: (url.searchParams.get("files") ?? "").split(",").map((f) => f.trim()).filter(Boolean),
    release: url.searchParams.get("release") === "true",
    counts: countsOf(url.searchParams.get("counts")),
  };
  const r = await repoPipeline(env, owner, repo);
  if ("error" in r) return json({ error: r.error }, 422);
  // The file is read with the crew's eyes (private lines' real text), so only the crew gets it echoed back; a reader gets the plan.
  const out = answer(r.pipeline, change, r.source);
  return json(write ? out : { source: out.source, plan: out.plan, counts: out.counts });
}
