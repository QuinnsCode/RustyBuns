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

import { remote } from "./src/local.ts";
import { HARNESSES, type Harness } from "./src/harness.ts";
import { runAgent } from "./src/agent-run.ts";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };

const harness = arg("--harness") as Harness | undefined;
const url = arg("--url"), as = arg("--as"), repoArg = arg("--repo"), path = arg("--path"), task = arg("--task");
if (!harness || !HARNESSES.includes(harness) || !url || !as || !repoArg || !path || !task) {
  console.error(`usage: bun agent.ts --harness ${HARNESSES.join("|")} --url URL --as NAME --repo OWNER/REPO --path FILE --task "..." [--cookie C] [--model M] [--commit MSG]`);
  process.exit(2);
}
const [owner, repo] = repoArg.split("/");
if (!owner || !repo) { console.error("--repo takes OWNER/REPO"); process.exit(2); }

const r = await runAgent(remote(url, arg("--cookie")), {
  user: as, owner, repo, path, harness, task,
  model: arg("--model"), commit: arg("--commit"),
  log: console.log,
});

console.log(`\n${r.harness} on ${r.path}: ${r.changed ? `${r.applied} line ops landed at rev ${r.rev}` : "no changes"}`);
if (r.skipped.length) console.log(`skipped ${r.skipped.length} op(s) the file had moved past; re-run the agent to pick them up`);
if (r.output) console.log(`\n--- ${r.harness} output ---\n${r.output.slice(-1500)}`);
