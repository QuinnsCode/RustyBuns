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
//
//   bun run thread-demo --live --url https://<site> --token cst_…   (an admin token of yours)
//
// Florence on the real site: a private repo of yours with the demo file, and one message to send him (copied to the
// clipboard): his sign-up link, then a paragraph for his Claude Code that claims its own agent invite and opens a thread
// over plain HTTP. His agent answers him there; the site runs nothing, so no bill.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, obj, str } from "@rustybuns/util/guard";
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
    const got: unknown = await r.json();
    return got;
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
  return { id, token, thread: `#/t/${OWNER}/${REPO}/${id}`, file: `#/f/${OWNER}/${REPO}/${encodeURIComponent(FILE)}` };
}

/**
 * The one paragraph Florence pastes into his Claude Code (#3742): it claims the agent invite itself and talks over plain
 * HTTP with the token that gives it, so there's no MCP to add and no restart before it can start.
 */
export const brief = (site: string, owner: string, repo: string, agentLink: string) => {
  const api = `${site.replace(/\/$/, "")}/api`, thread = `${api}/repos/${owner}/${repo}/agents/<id>/thread`;
  return [
    `Join my codeSplitter repo ${owner}/${repo} as my agent and talk with me in a thread there.`,
    `1. Claim your invite: curl -sX POST ${api}/invites/claim -H 'content-type: application/json' -d '{"invite":"${agentLink}","as":"agent","harness":"claude"}'`,
    `   Keep the "token" it returns and send it as "Authorization: Bearer <token>" on every call below.`,
    `2. Open the thread: POST ${api}/repos/${owner}/${repo}/threads with {"path":"${FILE}","task":"${TASK}"}. Its "id" is <id>.`,
    `3. Keep going: every few seconds GET ${thread}?after=<last n you read>. Answer each new message from a person with POST ${thread} {"text":"...","as":"agent"}.`,
    `   When I ask for a change to ${FILE}, make it (the API is described at ${api}/openapi.json) and say what you did.`,
    `4. When I say done, answer with POST ${thread} {"text":"...","done":true} and stop.`,
  ].join("\n");
};

const Link = obj({ link: str(2000) });

/**
 * The live site (#3742): as its owner (your API token), a private repo with the demo file and two invite links, one for
 * Florence to sign up or sign in and join its crew, one for his own agent (its door mints its token and MCP line). Run again,
 * it keeps the repo and file and makes two fresh links. Nothing here runs an agent, so nothing is billed.
 */
export async function seedLive(site: string, token: string, repo = "florence-demo") {
  const base = site.replace(/\/$/, "");
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + "/api" + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "codesplitter-thread-demo/1" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const got: unknown = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, got };
  };
  const me = check(obj({ user: str(100) }), (await call("/session")).got)?.user;
  if (!me) throw new Error("that token signs in as nobody: make one at " + base + "/#/me/tokens");
  const made = await call("/repos", { name: repo, visibility: "private" });
  if (!made.ok && made.status !== 409) throw new Error(`making ${repo}: ${made.status} ${JSON.stringify(made.got)}`);
  const file = await call(`/repos/${me}/${repo}/files`, { path: FILE, content: SOURCE });
  if (!file.ok && file.status !== 409) throw new Error(`adding ${FILE}: ${file.status} ${JSON.stringify(file.got)}`);
  const invite = async (note: string) => {
    const r = await call(`/repos/${me}/${repo}/invites`, { note, days: 30 });
    const link = check(Link, r.got)?.link;
    if (!link) throw new Error(`an invite: ${r.status} ${JSON.stringify(r.got)}`);
    return link;
  };
  const person = await invite("Florence: sign up (or sign in) here and you're on the crew.");
  const agent = await invite("Florence's agent: claim this as an agent to get your own handle and token.");
  const b = brief(base, me, repo, agent);
  return { owner: me, repo, person, agent, brief: b, message: message(person, b) };
}

/** The whole hand-off to Florence, ready to send as one message. */
export const message = (person: string, b: string) => [
  "Hey Florence, here's a codeSplitter repo for you to try team threads with your own Claude Code:",
  "",
  `1. Open this and sign up (or sign in). You land on the repo: ${person}`,
  "2. Paste everything below into Claude Code. It joins as your agent and opens a thread on the repo page; talk to it there.",
  "",
  b,
].join("\n");

/** `/as/<name>` signs in as one of the demo's people (alias mode: a name in the cs_user cookie) and opens `to`. */
export function signIn(req: Request, to: string): Response {
  const name = new URL(req.url).pathname.slice("/as/".length);
  if (name !== CREW && name !== OWNER) return new Response("only florence or demo", { status: 404 });
  return new Response(null, { status: 302, headers: { location: "/" + to, "set-cookie": `cs_user=${name}; Path=/; SameSite=Lax` } });
}

const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

if (import.meta.main && process.argv.includes("--live")) {
  const site = flag("url") ?? process.env.CODESPLITTER_URL, token = flag("token") ?? process.env.CODESPLITTER_TOKEN;
  if (!site || !token) { console.error("--live needs the site and an admin API token of yours (it makes invites; make one on your profile page): --url https://<site> --token cst_… (or CODESPLITTER_URL and CODESPLITTER_TOKEN)"); process.exit(1); }
  const s = await seedLive(site, token, flag("repo"));
  // On a Mac it goes straight to the clipboard, so the next step is just pasting it to Florence.
  const copied = Bun.which("pbcopy") ? (Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(s.message) }).exitCode === 0) : false;
  console.log(`${s.message}

---
${copied ? "Copied. Paste it to Florence as one message." : "Send Florence everything above the line as one message."} Repo: ${s.owner}/${s.repo} on ${site}. Nothing here runs an agent on the site, so nothing is billed. The links work once, for 30 days; run this again for fresh ones.`);
} else if (import.meta.main) {
  const { serve } = await import("@rustybuns/shell-bun");
  const { default: worker } = await import("../src/worker.ts");
  const { local } = await import("../src/local.ts");
  const PORT = Number(flag("port") ?? 4748), REAL = process.argv.includes("--real");
  if (REAL && !Bun.which("claude")) { console.error("--real needs the claude CLI on your PATH, signed in (claude login)"); process.exit(1); }
  const call = await local({ GH_CLI: "off", ...(!REAL && { AGENT_EXEC: scriptedAgent(FILE) }) });
  if (!(await Bun.file("dist/client/index.html").exists())) await Bun.$`bun run build.ts`.quiet();
  let to = "";
  const shell = serve({ port: PORT, assets: "dist/client", runWorkerFirst: ["/api"], open: { "/as/": (req) => signIn(req, to) } });
  shell.mount(worker, call.env);
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
