#!/usr/bin/env bun
// Team threads in one command (#3742): boots codeSplitter on the local twins (nothing leaves the machine, nothing is
// billed), seeds a repo whose crew has `florence` on it and a running agent thread on one file, and prints a link that
// signs you in as florence. Chat there (the page or the modal), drop a file in, open the file page, or tell the agent
// something from your own Claude Code with the printed MCP line.
//
//   bun run thread-demo [--port 4748] [--real]
//
// The agent is scripted (canned answers, like test/fake-claude.ts), so nothing is billed. --real runs your own
// `claude` CLI login instead. Say "done" in the thread and it finishes, its edit landing on the file; the owner's
// "@agent ..." (sign in as demo, link printed too) starts it again from where it left off.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { give, type Exec } from "../src/agent-run.ts";

export const OWNER = "demo", REPO = "team", CREW = "florence", FILE = "src/greet.ts";
const SOURCE = `// Says hello to whoever opens the repo.\nexport function greet(name: string) {\n  return "hello " + name;\n}\n`;
const TASK = "make greet() friendlier, and ask the crew what tone they want";
/** What ends a scripted run: "done", "ship it", "that's all", "stop". */
const DONE = /\b(done|ship it|that's all|stop)\b/i;

/**
 * An agent that answers from a script: it says it's on the task, answers each note in the thread as it hears it
 * (a file it was sent by name and size, from its folder), and finishes when told "done" or after `maxMs`, adding a
 * comment to `file` for each thing it heard. Its result line names a session, so the next run resumes it.
 */
export function scriptedAgent(file: string, o: { maxMs?: number; ms?: number } = {}): Exec {
  return async (cmd, cwd, signal, ear) => {
    const said = (t: string) => ear?.said?.(t), heard: string[] = [];
    said(`On it: ${TASK}. Talk to me here as I go (drop a file in too); say "done" when you're happy.`);
    for (const end = Date.now() + (o.maxMs ?? 15 * 60_000); Date.now() < end;) {
      if (signal?.aborted) throw new Error("stopped");
      if (ear) {
        await give(cwd, await ear.files?.() ?? []);
        for (const note of await ear.poll()) {
          heard.push(note);
          const sent = /sent a file: (\.thread\/[\w.-]+)/.exec(note)?.[1];
          if (sent) said(`Got ${sent}: ${statSync(join(cwd, sent)).size} bytes, it's in my folder.`);
          else if (DONE.test(note)) said("Wrapping up: putting what you said into the file.");
          else said(`Heard you, ${note.split(":")[0]}: "${note.slice(note.indexOf(":") + 1).trim()}". I'll fold that in.`);
        }
        if (heard.some((n) => DONE.test(n))) break;
      }
      await Bun.sleep(o.ms ?? 200);
    }
    const path = join(cwd, file);
    writeFileSync(path, readFileSync(path, "utf8") + heard.map((n) => `// ${n.replace(/\n/g, " ")}\n`).join(""));
    const session = /--resume (\S+)/.exec(cmd.args.join(" "))?.[1] ?? `demo-${crypto.randomUUID()}`;
    const out = JSON.stringify({ type: "result", session_id: session, result: `Done: greet() is friendlier, with ${heard.length} note${heard.length === 1 ? "" : "s"} from the crew in it.`, usage: { input_tokens: 1, output_tokens: 1 } });
    return { code: 0, out, ...(heard.length && { heard }) };
  };
}

type Call = (user: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** Seeds the demo through the app's own API: the owner, the repo and file, florence on its crew, the agent's run, florence's token. */
export async function seed(call: Call) {
  const post = async (user: string, path: string, body: unknown) => {
    const r = await call(user, "/api" + path, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<unknown>;
  };
  for (const name of [OWNER, CREW]) await post(name, "/login", { name });
  await post(OWNER, "/repos", { name: REPO, visibility: "private" });
  await post(OWNER, `/repos/${OWNER}/${REPO}/files`, { path: FILE, content: SOURCE });
  await post(OWNER, `/repos/${OWNER}/${REPO}/collaborators`, { name: CREW });
  const run = await post(OWNER, `/repos/${OWNER}/${REPO}/agents`, { path: FILE, harness: "claude", task: TASK });
  const id = typeof run === "object" && run && "id" in run ? Number(run.id) : NaN;
  if (!Number.isInteger(id)) throw new Error(`no run id in ${JSON.stringify(run)}`);
  const minted = await post(CREW, "/tokens", { label: "thread demo", scope: "write" });
  const token = typeof minted === "object" && minted && "token" in minted && typeof minted.token === "string" ? minted.token : "";
  return { id, token, thread: `#/t/${OWNER}/${REPO}/${id}`, file: `#/r/${OWNER}/${REPO}/${encodeURIComponent(FILE)}` };
}

/** `/as/<name>` signs in as one of the demo's people (alias mode: a name in the cs_user cookie) and opens `to`. */
export function signIn(req: Request, to: string): Response {
  const name = new URL(req.url).pathname.slice("/as/".length);
  if (name !== CREW && name !== OWNER) return new Response("only florence or demo", { status: 404 });
  return new Response(null, { status: 302, headers: { location: "/" + to, "set-cookie": `cs_user=${name}; Path=/; SameSite=Lax` } });
}

if (import.meta.main) {
  const { serve } = await import("@rustybuns/shell-bun");
  const { default: worker } = await import("../src/worker.ts");
  const { local } = await import("../src/local.ts");
  const i = process.argv.indexOf("--port"), PORT = i > 0 ? Number(process.argv[i + 1]) : 4748, REAL = process.argv.includes("--real");
  if (REAL && !Bun.which("claude")) { console.error("--real needs the claude CLI on your PATH, signed in (claude login)"); process.exit(1); }
  const call = await local({ GH_CLI: "off", ...(!REAL && { AGENT_EXEC: scriptedAgent(FILE) }) });
  if (!(await Bun.file("dist/client/index.html").exists())) await Bun.$`bun run build.ts`.quiet();
  let to = "";
  const shell = serve({ port: PORT, assets: "dist/client", runWorkerFirst: ["/api"], open: { "/as/": (req) => signIn(req, to) },
    reporter: { escaped: (...a: unknown[]) => console.error("[server]", ...a) } as never });
  shell.mount(worker as never, call.env);
  const { id, token, thread, file } = await seed(call);
  to = thread;
  const url = shell.url.replace(/\/$/, "");
  console.log(`
codeSplitter team threads demo: ${REAL ? "your own claude runs the agent" : "a scripted agent, nothing billed"}

  Open this to be florence, in the agent's thread:
    ${url}/as/${CREW}
  The file its runs show on:  ${url}/${file}
  The owner (whose "@agent ..." starts it again):  ${url}/as/${OWNER}

  Plug your own Claude Code in as florence:
    claude mcp add --transport http codesplitter-demo ${url}/api/mcp --header "Authorization: Bearer ${token}"
  then ask it to tell_agent ${OWNER}/${REPO} run ${id} something. Or from this folder:
    bun run cli tell_agent --owner ${OWNER} --repo ${REPO} --id ${id} --body '{"text":"hi from my terminal"}' --url ${url} --as ${CREW}

  Say "done" in the thread to finish the run. Ctrl-C stops the demo (everything is in memory).
`);
}
