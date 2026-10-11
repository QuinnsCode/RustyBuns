// codeSplitters from a shell, for agents that would rather run a command than
// speak MCP. Its commands are the MCP server's tools (src/mcp.ts), which are the
// OpenAPI spec's operations, so the API, MCP and this never drift: each command
// is that HTTP call, made with your personal API token.
//
//   export CODESPLITTERS_URL=https://<site> CODESPLITTERS_TOKEN=cst_…
//   bun cli.ts tools                         every command, one a line
//   bun cli.ts help read_file                what it takes
//   bun cli.ts read_file --owner ryan --repo lab --path a.ts
//   bun cli.ts edit_lines --owner ryan --repo lab --path a.ts --body '{"ops":[…]}'
//   echo '{"ops":[…]}' | bun cli.ts edit_lines … --body -
//
// --url and --token stand in for the variables. On the desktop (aliases, no
// accounts) --as NAME signs in as that handle instead of a token. The answer is
// printed as the app sent it; a failed call prints its status to stderr and exits 1.

import { tool, tools, toRequest } from "./src/mcp.ts";

type Out = { code: number; out: string; err: string };
type Fetch = (req: Request) => Promise<Response>;

const USAGE = "usage: bun cli.ts <command> [--param value …] [--body JSON|-] [--url URL] [--token cst_…|--as NAME]\n       bun cli.ts tools | help <command>";

/** Run one command. `env` and `send` are the process's own unless a test says otherwise. */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, send: Fetch = (r) => fetch(r), stdin = () => Bun.stdin.text()): Promise<Out> {
  const [name, ...rest] = argv;
  const ok = (out: string): Out => ({ code: 0, out, err: "" }), fail = (err: string, code = 2): Out => ({ code, out: "", err });
  if (!name || name === "--help" || name === "-h") return ok(USAGE);
  if (name === "tools") return ok(tools().map((t) => `${t.name.padEnd(24)} ${t.method === "GET" ? "read " : "write"} ${t.title}`).join("\n"));
  if (name === "help") {
    const t = rest[0] && tool(rest[0]);
    if (!t) return fail(rest[0] ? `no command ${rest[0]}: bun cli.ts tools lists them` : USAGE);
    const req = new Set<string>(t.inputSchema.required ?? []);
    const params = Object.entries(t.inputSchema.properties as Record<string, any>).map(([k, s]) =>
      `  --${k}${req.has(k) ? " (required)" : ""}  ${k === "body" ? "JSON, or - for stdin" : s.description ?? s.type ?? ""}`);
    return ok([`${t.name}: ${t.description}`, ...params].join("\n"));
  }
  const t = tool(name);
  if (!t) return fail(`no command ${name}: bun cli.ts tools lists them`);

  const args: Record<string, unknown> = {}, opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!, value = rest[i + 1];
    if (!flag.startsWith("--") || value === undefined) return fail(`expected --param value, got ${flag}\n${USAGE}`);
    const k = flag.slice(2);
    if (k === "url" || k === "token" || k === "as") opts[k] = value;
    else if (k === "body") {
      try { args.body = JSON.parse(value === "-" ? await stdin() : value); } catch { return fail("--body takes JSON"); }
    } else if (k in t.inputSchema.properties) args[k] = value;
    else return fail(`${name} takes no --${k}: bun cli.ts help ${name}`);
  }
  const url = opts.url ?? env.CODESPLITTERS_URL, token = opts.token ?? env.CODESPLITTERS_TOKEN, as = opts.as ?? env.CODESPLITTERS_AS;
  if (!url) return fail("set CODESPLITTERS_URL (or --url)");
  if (!token && !as) return fail("set CODESPLITTERS_TOKEN (or --token): make one on your profile page");
  // Its own user agent, so the admins' insights page shows CLI calls apart from other token calls.
  const headers: Record<string, string> = { "user-agent": "codesplitters-cli/1", ...(token ? { authorization: `Bearer ${token}` } : { cookie: `cs_user=${as}` }) };
  const req = toRequest(t, args, url.replace(/\/$/, ""), headers);
  if (typeof req === "string") return fail(`${req}: bun cli.ts help ${name}`);
  const res = await send(req);
  const text = await res.text();
  return res.ok ? ok(text) : { code: 1, out: text, err: `${res.status} ${res.statusText}`.trim() };
}

if (import.meta.main) {
  const r = await main(process.argv.slice(2));
  if (r.out) console.log(r.out);
  if (r.err) console.error(r.err);
  process.exit(r.code);
}
