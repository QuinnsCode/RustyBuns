// codeSplitter from a shell, for agents that would rather run a command than
// speak MCP. Its commands are the MCP server's tools (src/mcp.ts), which are the
// OpenAPI spec's operations, so the API, MCP and this never drift: each command
// is that HTTP call, made with your personal API token.
//
//   export CODESPLITTER_URL=https://<site> CODESPLITTER_TOKEN=cst_…
//   bun cli.ts tools                         every command, one a line
//   bun cli.ts help read_file                what it takes
//   bun cli.ts read_file --owner ryan --repo lab --path a.ts
//   bun cli.ts edit_lines --owner ryan --repo lab --path a.ts --body '{"ops":[…]}'
//   echo '{"ops":[…]}' | bun cli.ts edit_lines … --body -
//
// --url and --token stand in for the variables. On the desktop (aliases, no
// accounts) --as NAME signs in as that handle instead of a token. The answer is
// printed as the app sent it. A failed call goes through the typed client (client.ts):
// stderr gets the app's sentence (or what to do, for a token or the network), stdout the
// reply's fields (conflicts, files), and it exits 1.
//
// Or install it, no checkout needed (build.ts bundles this to /cli.js, which runs on
// Bun or Node 18+, and the site serves the script at /install.sh):
//
//   curl -fsSL https://<site>/install.sh | sh
//   codesplitter login                      saves the site and your token
//   codesplitter read_file --owner ryan --repo lab --path a.ts

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TRIAGE_USAGE, triage } from "@rustybuns/cli/triage";
import { Effect } from "effect";
import { codesplitter, type Failure } from "./client.ts";
import { agentPrompt } from "./src/agent-prompt.ts";
import { explain } from "./src/failed.ts";
import { tool, tools } from "./src/mcp.ts";
import { isPlainObject } from "./src/util.ts";
import { splittersContext } from "./triage/context.ts";
import PLAYBOOK from "./triage/PLAYBOOK.md" with { type: "text" };

type Out = { code: number; out: string; err: string };
type Fetch = (req: Request) => Promise<Response>;

const USAGE = "usage: codesplitter <command> [--param value …] [--body JSON|-] [--url URL] [--token cst_…|--as NAME]\n       codesplitter tools | help <command> | prompt | login [--url URL] [--token cst_…]\n       codesplitter " + TRIAGE_USAGE;

/** Run one command. `env` and `send` are the process's own unless a test says otherwise. */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, send: Fetch = (r) => fetch(r), stdin = readStdin): Promise<Out> {
  const [name, ...rest] = argv;
  const ok = (out: string): Out => ({ code: 0, out, err: "" }), fail = (err: string, code = 2): Out => ({ code, out: "", err });
  if (!name || name === "--help" || name === "-h") return ok(USAGE);
  if (name === "tools") return ok(tools().map((t) => `${t.name.padEnd(24)} ${t.method === "GET" ? "read " : "write"} ${t.title}`).join("\n"));
  if (name === "help") {
    const t = rest[0] && tool(rest[0]);
    if (!t) return fail(rest[0] ? `no command ${rest[0]}: codesplitter tools lists them` : USAGE);
    const req = new Set<string>(t.inputSchema.required ?? []);
    const params = Object.entries(t.inputSchema.properties as Record<string, any>).map(([k, s]) =>
      `  --${k}${req.has(k) ? " (required)" : ""}  ${k === "body" ? "JSON, or - for stdin" : s.description ?? s.type ?? ""}`);
    return ok([`${t.name}: ${t.description}`, ...params].join("\n"));
  }
  const t = tool(name);
  if (!t) return fail(`no command ${name}: codesplitter tools lists them`);

  const args: Record<string, unknown> = {}, opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!, value = rest[i + 1];
    if (!flag.startsWith("--") || value === undefined) return fail(`expected --param value, got ${flag}\n${USAGE}`);
    const k = flag.slice(2);
    if (k === "url" || k === "token" || k === "as") opts[k] = value;
    else if (k === "body") {
      try { args.body = JSON.parse(value === "-" ? await stdin() : value); } catch { return fail("--body takes JSON"); }
    } else if (k in t.inputSchema.properties) args[k] = value;
    else return fail(`${name} takes no --${k}: codesplitter help ${name}`);
  }
  const site = opts.url ?? envVar(env, "URL"), token = opts.token ?? envVar(env, "TOKEN"), as = opts.as ?? envVar(env, "AS");
  if (!site) return fail("set CODESPLITTER_URL (or --url)");
  if (!token && !as) return fail("set CODESPLITTER_TOKEN (or --token), or run codesplitter login");
  // The desktop app sits behind its launch token too: a URL like http://127.0.0.1:5199/?token=<it>
  // (what RB_NO_BROWSER=1 prints) sends it as the cookie the desktop expects.
  const u = new URL(site), launch = u.searchParams.get("token"), url = u.origin + u.pathname;
  const cookie = [launch && `rb_token_${u.port}=${launch}`, !token && `cs_user=${as}`].filter(Boolean).join("; ");
  // Its own user agent, so the admins' insights page shows CLI calls apart from other token calls.
  const cs = codesplitter({ url, token, send, headers: { "user-agent": "codesplitter-cli/1", ...(cookie && { cookie }) } });
  return Effect.runPromise(cs.call(name, args).pipe(Effect.match({
    onSuccess: (body) => ok(typeof body === "string" ? body : JSON.stringify(body)),
    onFailure: (e): Out => e._tag === "BadArgs" ? fail(`${e.message}: codesplitter help ${name}`)
      : { code: 1, out: "reply" in e && e.reply !== null && typeof e.reply !== "string" ? JSON.stringify(e.reply) : "", err: say(e, url.replace(/\/$/, "")) },
  })));
}

/** A failed call as a sentence a person acts on: the app's own, with what its tag means when the app's is terse; what to do for the rest. */
export function say(e: Failure<string>, site: string): string {
  switch (e._tag) {
    case "Unauthorized": return `${e.message}. Make a token at ${site}/#/me/tokens and run: codesplitter login`;
    case "TokenCantDo": return `${e.message}. Make a token${e.scope ? ` with ${e.scope} scope` : ""} at ${site}/#/me/tokens and run: codesplitter login`;
    case "RateLimited": return `Too many calls for now: try again in ${e.retryAfter} seconds.`;
    case "Transient": return `${site} didn't answer, after a few tries: try again in a minute.`;
    default: return explain(e.message, "reply" in e && isPlainObject(e.reply) ? e.reply.tag : null);
  }
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Which is set: CODESPLITTER_<name>. */
export const envName = (env: Record<string, string | undefined>, name: string) => (env[`CODESPLITTER_${name}`] ? `CODESPLITTER_${name}` : undefined);
export const envVar = (env: Record<string, string | undefined>, name: string) => env[`CODESPLITTER_${name}`];

// `codesplitter login` keeps the site and token here, so neither has to be exported
// every time. The variables and flags still win over it.
const configPath = (env: Record<string, string | undefined>) => `${env.XDG_CONFIG_HOME ?? `${env.HOME ?? "."}/.config`}/codesplitter/config.json`;
function saved(env: Record<string, string | undefined>): { url?: string; token?: string } {
  try { return JSON.parse(readFileSync(configPath(env), "utf8")); } catch {}
  return {};
}

/** `login`, or any command with the saved site and token filled in under the variables. */
export async function run(argv: string[], env: Record<string, string | undefined> = process.env, ask = askLine, send?: Fetch): Promise<Out> {
  const conf = saved(env);
  if (argv[0] === "prompt") {
    const url = (argv[1] === "--url" ? argv[2] : undefined) ?? envVar(env, "URL") ?? conf.url;
    return url ? { code: 0, out: agentPrompt(url.replace(/\/$/, "")), err: "" } : { code: 2, out: "", err: "codesplitter prompt --url https://<site> (or codesplitter login first)" };
  }
  if (argv[0] === "triage") return triageCommand(argv.slice(1), env, conf, send);
  if (argv[0] !== "login") return main(argv, { ...strip(env), CODESPLITTER_URL: envVar(env, "URL") ?? conf.url, CODESPLITTER_TOKEN: envVar(env, "TOKEN") ?? conf.token }, send);
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i]!.replace(/^--/, "");
    if ((k !== "url" && k !== "token") || argv[i + 1] === undefined) return { code: 2, out: "", err: "usage: codesplitter login [--url URL] [--token cst_…]" };
    flags[k] = argv[i + 1]!;
  }
  const url = (flags.url ?? envVar(env, "URL") ?? conf.url)?.replace(/\/$/, "");
  if (!url) return { code: 2, out: "", err: "codesplitter login --url https://<site>" };
  const token = (flags.token ?? (await ask(`Make a token at ${url}/#/me/tokens (sign in first), copy it with its copy button, and paste it here: `)) ?? conf.token)?.trim();
  // A token copied from its box, not its button, comes out masked (cst_••••6x48): don't save that (#729).
  if (token && (token.includes("•") || !token.startsWith("cst_"))) return { code: 2, out: "", err: `That isn't a whole token: it starts with cst_ and has no •. Copy it with the copy button at ${url}/#/me/tokens.` };
  const path = configPath(env);
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, ...(token ? { token } : {}) }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return { code: 0, out: token ? `Signed in to ${url}. Try: codesplitter tools` : `Saved ${url}. Add a token with: codesplitter login --token cst_…`, err: "" };
}

/** `triage`: your coding agent, started on what went wrong with this machine's facts (@rustybuns/cli/triage). */
async function triageCommand(argv: string[], env: Record<string, string | undefined>, conf: { url?: string; token?: string }, send?: Fetch): Promise<Out> {
  // --url/--token/--as pick the site to look at, as for any command; the rest is triage's
  const opts: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!.replace(/^--/, "");
    if ((k === "url" || k === "token" || k === "as") && argv[i + 1] !== undefined) opts[k] = argv[++i]!;
    else rest.push(argv[i]!);
  }
  const from = (flag: string, v: string, c?: string) => opts[flag] ? `--${flag}` : envName(env, v) ?? (c ? configPath(env) : undefined);
  const url = (opts.url ?? envVar(env, "URL") ?? conf.url)?.replace(/\/$/, "");
  const token = opts.token ?? envVar(env, "TOKEN") ?? conf.token;
  const context = await splittersContext({
    url, urlFrom: from("url", "URL", conf.url), token, tokenFrom: from("token", "TOKEN", conf.token),
    as: opts.as ?? envVar(env, "AS"), configPath: configPath(env), send: send && (((u: string, i?: RequestInit) => send(new Request(u, i))) as typeof fetch),
  });
  const code = await triage({
    product: "codeSplitter", command: "codesplitter triage", dir: configPath(env).replace(/config\.json$/, "triage"),
    context, playbook: PLAYBOOK, argv: rest, env,
  });
  return { code, out: "", err: "" };
}

const strip = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v));

/**
 * One line from the terminal, or nothing when there isn't one (the install script, a pipe). What's typed or pasted
 * isn't echoed (it's a token): only the question and, once it's answered, a newline reach the screen.
 */
export async function askLine(q: string, input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<string | undefined> {
  if (!input.isTTY) return undefined;
  const { createInterface } = await import("node:readline/promises");
  const { Writable } = await import("node:stream");
  let quiet = false;
  const screen = new Writable({ write(chunk, _enc, done) { if (!quiet) output.write(chunk); done(); } });
  const rl = createInterface({ input, output: screen, terminal: true });
  try {
    const answer = rl.question(q);
    quiet = true;
    return (await answer).trim() || undefined;
  } finally { rl.close(); output.write("\n"); }
}

if (import.meta.main) {
  run(process.argv.slice(2)).then((r) => {
    if (r.out) console.log(r.out);
    if (r.err) console.error(r.err);
    process.exit(r.code);
  });
}
