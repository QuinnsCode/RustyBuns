// qCRM from a shell: every API operation as a subcommand, the same tools the MCP server and the page's
// Cmd/Ctrl-K list (src/mcp-tools.ts), so a script, a cron job or an agent without MCP drives the CRM the same way.
//
//   bun run cli                                    every tool, by tag
//   bun run cli list_contacts --q ann              path and query parameters by name
//   bun run cli create_contact --first_name Ann --email ann@example.com      other flags are body fields
//   bun run cli update_deal --id d_1 --body '{"stage":"won"}'                 or the whole body as JSON
//
// QCRM_URL (default http://localhost:5173) and QCRM_KEY (an org API key, qk_…, from Settings). The org is
// QCRM_ORG, or --org, or the key's first org. Answers print as JSON; a failure prints to stderr and exits 1.

import { tools, toRequest, type Tool } from "../src/mcp-tools.ts";

type Fetcher = (r: Request) => Promise<Response>;
interface Io { out(s: string): void; err(s: string): void }

/** A flag's value: JSON when it parses (numbers, true, lists), the text otherwise. */
const value = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };

function usage(list: Tool[]) {
  const by = Map.groupBy(list, (t) => t.tag);
  const w = Math.max(...list.map((t) => t.name.length));
  return [...by].map(([tag, ts]) => `${tag}\n${ts.map((t) => `  ${t.name.padEnd(w)}  ${t.method.padEnd(6)} ${t.title}${t.risky ? " (risky)" : ""}`).join("\n")}`).join("\n\n")
    + "\n\nbun run cli <tool> [--param value ...] [--field value ... | --body '{json}']   QCRM_URL, QCRM_KEY, QCRM_ORG";
}

/** Run one command line; the exit code comes back. `fetcher` is fetch, or the app in-process in tests. */
export async function cli(argv: string[], o: { url: string; key?: string; org?: string; fetcher?: Fetcher; io?: Io }): Promise<number> {
  const io = o.io ?? { out: (s) => console.log(s), err: (s) => console.error(s) }, send = o.fetcher ?? ((r) => fetch(r));
  const list = tools();
  const [name, ...rest] = argv;
  if (!name || name === "tools" || name === "--help" || name === "-h") { io.out(usage(list)); return 0; }
  const t = list.find((x) => x.name === name);
  if (!t) { io.err(`no tool "${name}": \`bun run cli\` lists them`); return 1; }

  // Path and query flags stay strings; the rest are body fields, which toRequest gathers.
  const args: Record<string, unknown> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (!flag.startsWith("--")) { io.err(`expected --name value, got "${flag}"`); return 1; }
    const k = flag.slice(2), next = rest[i + 1];
    const v = next === undefined || next.startsWith("--") ? true : (i++, next);
    args[k] = typeof v === "string" && !t.pathParams.includes(k) && !t.queryParams.includes(k) ? value(v) : v;
  }
  const headers: Record<string, string> = o.key ? { authorization: `Bearer ${o.key}` } : {};
  if (t.pathParams.includes("org") && args.org === undefined) {
    args.org = o.org;
    if (!args.org) {
      // The key's own org: one call to get_me.
      const me: unknown = await (await send(new Request(`${o.url}/api/me`, { headers }))).json().catch(() => null);
      const orgs: unknown = me && typeof me === "object" ? Reflect.get(me, "orgs") : null;
      const first: unknown = Array.isArray(orgs) && orgs[0] && typeof orgs[0] === "object" ? Reflect.get(orgs[0], "id") : null;
      if (typeof first !== "string") { io.err("no org: set QCRM_ORG or pass --org (is QCRM_KEY set?)"); return 1; }
      args.org = first;
    }
  }
  const req = toRequest(t, args, o.url, headers);
  if (typeof req === "string") { io.err(`${t.name}: ${req}`); return 1; }
  const res = await send(req);
  const text = await res.text();
  let shown = text;
  try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* bytes or text: printed unchanged */ }
  (res.ok ? io.out : io.err)(res.ok ? shown : `${res.status}: ${shown}`);
  return res.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await cli(process.argv.slice(2), { url: (process.env.QCRM_URL ?? "http://localhost:5173").replace(/\/$/, ""), key: process.env.QCRM_KEY, org: process.env.QCRM_ORG }));
}
