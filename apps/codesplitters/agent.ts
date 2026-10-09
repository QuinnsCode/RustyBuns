// Plug a coding agent into a file in codeSplitters. The agent is a collaborator
// on the repo; it reads the file, edits it with its own tools, and its edit
// lands as line ops, live, with the agent's name on the lines it changed.
//
//   bun agent.ts --harness claude --url http://127.0.0.1:PORT \
//     --as agent-claude --cookie 'rb_token_PORT=TOKEN' \
//     --repo owner/name --path src/app.ts --task "add a doc line to every function"
//
// --harness: claude | codex | pi | opencode (the CLI must be installed and logged in)
// --as:      the agent's name, which must already be a collaborator on the repo
// --commit:  optional commit message; catalogues the file after the edit
// --retries: re-runs when someone changes a line the agent also changed (default 2).
//            After the last one, their version is kept and the conflicts are listed.
// --hosted:  the app runs the agent, not this machine (POST /api/repos/:o/:r/agents):
//            in a container on Cloudflare, so the CLI need not be installed here.
//            --as is then the repo's owner; the edit is blamed on agent-<harness>.

import { remote } from "./src/local.ts";
import { HARNESSES, type Harness } from "./src/harness.ts";
import { runAgent, type Result } from "./src/agent-run.ts";
import type { Run } from "./src/agent-routes.ts";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };

const harness = arg("--harness") as Harness | undefined;
const url = arg("--url"), as = arg("--as"), repoArg = arg("--repo"), path = arg("--path"), task = arg("--task");
if (!harness || !HARNESSES.includes(harness) || !url || !as || !repoArg || !path || !task) {
  console.error(`usage: bun agent.ts --harness ${HARNESSES.join("|")} --url URL --as NAME --repo OWNER/REPO --path FILE --task "..." [--cookie C] [--model M] [--commit MSG] [--retries N] [--hosted]`);
  process.exit(2);
}
const [owner, repo] = repoArg.split("/");
if (!owner || !repo) { console.error("--repo takes OWNER/REPO"); process.exit(2); }

const call = remote(url, arg("--cookie"));
const run = { owner, repo, path, harness, task, model: arg("--model"), commit: arg("--commit"),
  retries: arg("--retries") === undefined ? undefined : Number(arg("--retries")) };
let r: Result;
if (process.argv.includes("--hosted")) {
  console.log(`${harness}: working on ${path} on ${url}`);
  const res = await call(as, `/api/repos/${owner}/${repo}/agents`, { method: "POST", body: JSON.stringify({ path, harness, task, model: run.model }) });
  if (!res.ok) { console.error(`${res.status} ${await res.text()}`); process.exit(1); }
  // A container run answers when done; a desktop one at once, so poll for it.
  let h = (await res.json()) as Run;
  while (h.status === "running") {
    await Bun.sleep(2000);
    const all = (await (await call(as, `/api/repos/${owner}/${repo}/agents?path=${encodeURIComponent(path)}`)).json()) as Run[];
    h = all.find((x) => x.id === h.id) ?? h;
  }
  if (h.status === "failed") { console.error(h.error); process.exit(1); }
  r = { harness, path, changed: !!h.applied, applied: h.applied ?? 0, runs: h.runs ?? 1, conflicts: h.conflicts ?? [], rev: h.rev ?? 0, output: h.output ?? "" };
} else r = await runAgent(call, { ...run, user: as, log: console.log });

console.log(`\n${r.harness} on ${r.path}: ${r.changed ? `${r.applied} line ops landed at rev ${r.rev}` : "no changes"}${r.runs > 1 ? ` (${r.runs} runs)` : ""}`);
if (r.conflicts.length) {
  console.log(`\n${r.conflicts.length} edit(s) kept the other writer's version:`);
  for (const { op, now } of r.conflicts) {
    const mine = op.kind === "delete" ? "(delete)" : op.text;
    console.log(now ? `  ${now.id} ${now.by}: ${now.text}\n  ${" ".repeat(now.id.length)} ${as}: ${mine}` : `  (line deleted) ${as}: ${mine}`);
  }
}
if (r.output) console.log(`\n--- ${r.harness} output ---\n${r.output.slice(-1500)}`);
