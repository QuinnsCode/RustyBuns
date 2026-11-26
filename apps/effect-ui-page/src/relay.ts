// A room's relay: how an agent in a terminal reaches a page that is open in someone's browser. The page keeps a
// socket to its room; an agent calls a tool over plain HTTP (`POST /api/r/<room>/tools/<name>`, for any agent that
// can run curl, no setup) or MCP (`/api/r/<room>/mcp`, one `mcp add` line in Claude Code, Codex or opencode), and the
// relay sends the call down the socket and answers with what the page said. The page holds the state and checks
// every call; the relay only carries them. No platform here: the Worker's Durable Object (edge/worker.ts) and the
// local dev server (scripts/dev.ts) each hand it the newest page socket.
import { check, field } from "@rustybuns/util/guard";
import { json, parseJson } from "@rustybuns/util/http";
import { FromPage, listTools, type ToPage, toolNames } from "./tools.ts";

export interface Links { page: string; api: string; mcp: string }
export type Answer = { ok: true; result: unknown } | { ok: false; error: string; status: number };

/** Where a room's page and doors are, from the origin it was reached on. */
export const linksFor = (origin: string, room: string): Links => ({
  page: `${origin}/r/${room}`, api: `${origin}/api/r/${room}`, mcp: `${origin}/api/r/${room}/mcp`,
});

/** What the person pastes into their agent: everything it needs, no install. */
export const prompt = (l: Links) => [
  `Build my web page. It is open in my browser at ${l.page} and I'm watching it change.`,
  `You change it over HTTP: \`curl -s ${l.api}/tools\` lists the tools with their JSON Schemas, and`,
  `\`curl -s -X POST ${l.api}/tools/<name> -H 'content-type: application/json' -d '<arguments as JSON>'\` calls one.`,
  `Each call answers with the page after it, or why it couldn't be done. Start with page_read, ask me what the page should say, then build it.`,
].join("\n");

const INSTRUCTIONS = "This page is open in the person's browser and they watch it change as you call these tools. Call page_read first, ask them what the page should say, then build it.";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const WAIT_MS = 20_000;

export class Relay {
  private next = 1;
  private waiting = new Map<number, (r: FromPage) => void>();
  /** `page`: the newest open page socket's send, or null when no page is open. */
  constructor(private page: () => ((frame: string) => void) | null, private waitMs = WAIT_MS) {}

  /** A frame from the page: the answer to a call. Anything else is dropped. */
  heard(v: unknown) {
    const r = check(FromPage, v);
    if (!r) return;
    this.waiting.get(r.id)?.(r);
    this.waiting.delete(r.id);
  }

  /** Run a tool on the page and wait for what it says. */
  call(name: unknown, args: unknown, links: Links): Promise<Answer> {
    if (typeof name !== "string" || !toolNames.has(name)) return Promise.resolve({ ok: false, status: 404, error: `no tool "${String(name)}": the tools are ${[...toolNames].join(", ")}` });
    const send = this.page();
    if (!send) return Promise.resolve({ ok: false, status: 409, error: `the page isn't open: ask the person to open ${links.page} in their browser` });
    const id = this.next++;
    return new Promise((done) => {
      const late = setTimeout(() => { this.waiting.delete(id); done({ ok: false, status: 504, error: `the page didn't answer in ${this.waitMs / 1000} s: is its tab still open?` }); }, this.waitMs);
      this.waiting.set(id, (r) => {
        clearTimeout(late);
        done(r.ok ? { ok: true, result: r.result } : { ok: false, status: 422, error: r.error ?? "the page refused it" });
      });
      send(JSON.stringify({ t: "call", id, name, args: args ?? {} } satisfies ToPage));
    });
  }

  /** A request to the room's doors, `rest` being the path after /api/r/<room>. */
  async http(req: Request, rest: string, links: Links): Promise<Response> {
    if (rest === "" || rest === "/") return json({ ...links, tools: `${links.api}/tools`, prompt: prompt(links) });
    if (rest === "/tools" && req.method === "GET") return json({ page: links.page, tools: listTools() });
    const tool = rest.match(/^\/tools\/([a-z_]+)$/);
    if (tool && req.method === "POST") {
      const text = await req.text();
      const args = text.trim() ? parseJson(text) : {};
      if (args === undefined) return json({ ok: false, error: "the body isn't JSON: send the tool's arguments as a JSON object" }, 400);
      const a = await this.call(tool[1], args, links);
      return a.ok ? json({ ok: true, ...(typeof a.result === "object" && a.result !== null ? a.result : { result: a.result }) }) : json({ ok: false, error: a.error }, a.status);
    }
    if (rest === "/mcp" && req.method === "POST") return this.mcp(parseJson(await req.text()), links);
    if (rest === "/mcp") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    return json({ error: `nothing at ${rest}: try GET ${links.api}/tools` }, 404);
  }

  /** MCP over streamable HTTP, stateless: each request answered with one JSON reply, no session and no stream. */
  async mcp(body: unknown, links: Links): Promise<Response> {
    const id = field(body, "id"), method = field(body, "method"), params = field(body, "params");
    const reply = (result: unknown) => json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
    if (typeof method !== "string") return fail(-32600, "not a JSON-RPC request");
    if (id === undefined) return new Response(null, { status: 202 }); // a notification: nothing to answer
    switch (method) {
      case "initialize": {
        const asked = field(params, "protocolVersion");
        return reply({
          protocolVersion: typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agent-page", title: "Agent Page", version: "0.1.0" },
          instructions: `${INSTRUCTIONS} The page: ${links.page}`,
        });
      }
      case "ping": return reply({});
      case "tools/list": return reply({ tools: listTools() });
      case "tools/call": {
        const a = await this.call(field(params, "name"), field(params, "arguments"), links);
        return reply({ content: [{ type: "text", text: JSON.stringify(a.ok ? a.result : { error: a.error }) }], isError: !a.ok });
      }
      default: return fail(-32601, `no method ${method}`);
    }
  }
}
