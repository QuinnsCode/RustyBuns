// `rustybuns skill mcp`: an MCP server as a skill. Loading a server's tools puts every tool's schema in the agent's
// context on every turn; a skill puts one short line there (~20-40 tokens) and the rest only when the agent opens it.
// This reads a server's own instructions and tool list and writes them as a SKILL.md, so "get this from <server>"
// finds the skill, and the skill says which tools to call and how.
//
//   rustybuns skill mcp <url> [--header "K: V"] [--name n] [--dir D] [--print]   a streamable-HTTP server
//   rustybuns skill mcp [--name n] [--dir D] [--print] -- <command> [args...]       a stdio server (spawned, then stopped)
//
// Writes D/mcp-<name>/SKILL.md (D defaults to .claude/skills; .agents/skills for Codex) and prints its token cost.
// Run it again after the server changes its tools.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface McpTool { name: string; description: string; args: string[]; danger: boolean }
export interface McpServer { name: string; instructions: string; tools: McpTool[] }

/** A rough token count (four characters each), what the skill list shows. */
export const tokens = (s: string) => Math.ceil(s.length / 4);

const field = (v: unknown, k: string): unknown => (v && typeof v === "object" && k in v ? Reflect.get(v, k) : undefined);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const firstSentence = (s: string) => (/^[\s\S]*?[.!?](?=\s|$)/.exec(s.replace(/\s+/g, " ").trim())?.[0] ?? s.replace(/\s+/g, " ").trim());
const clip = (s: string, words: number) => { const w = s.split(" "); return w.length <= words ? s : `${w.slice(0, words).join(" ")}...`; };
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "server";

/** One entry of a `tools/list` reply, or null when it has no name. */
export function readTool(v: unknown): McpTool | null {
  const name = text(field(v, "name"));
  if (!name) return null;
  const schema = field(v, "inputSchema"), props = field(schema, "properties"), req = field(schema, "required");
  const required = new Set(Array.isArray(req) ? req.filter((r) => typeof r === "string") : []);
  const args = props && typeof props === "object" ? Object.keys(props).map((k) => (required.has(k) ? k : `${k}?`)) : [];
  return { name, description: text(field(v, "description")), args, danger: field(field(v, "annotations"), "destructiveHint") === true };
}

/** The SKILL.md: a description short enough to sit in every context, then the server's instructions and tools. */
export function serverSkill(s: McpServer): string {
  const lead = firstSentence(s.instructions) || `Tools: ${s.tools.slice(0, 6).map((t) => t.name).join(", ")}.`;
  const description = clip(`${s.name} (MCP): ${lead}`, 30).replace(/\n/g, " ");
  const rows = s.tools.map((t) => `- \`${t.name}(${t.args.join(", ")})\`: ${firstSentence(t.description) || "no description"}${t.danger ? " Ask the person first." : ""}`);
  return [
    `---\nname: mcp-${slug(s.name)}\ndescription: ${JSON.stringify(description)}\n---\n`,
    `# ${s.name}\n`,
    `Its tools come from the \`${s.name}\` MCP server. If they are deferred, load the ones you need by name before calling them.\n`,
    ...(s.instructions ? [`## What the server says\n\n${s.instructions.trim()}\n`] : []),
    `## Tools (${s.tools.length})\n\n${rows.join("\n")}\n`,
  ].join("\n");
}

type Rpc = (method: string, params?: object) => Promise<unknown>;

/** initialize, then every page of tools/list. */
export async function readServer(rpc: Rpc, notify: (method: string) => Promise<void>, fallbackName: string): Promise<McpServer> {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "rustybuns-skill", version: "1" } });
  await notify("notifications/initialized");
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r = await rpc("tools/list", cursor ? { cursor } : {});
    const list = field(r, "tools");
    if (Array.isArray(list)) for (const t of list) { const tool = readTool(t); if (tool) tools.push(tool); }
    cursor = text(field(r, "nextCursor")) || undefined;
    if (!cursor) break;
  }
  const info = field(init, "serverInfo");
  return { name: text(field(info, "title")) || text(field(info, "name")) || fallbackName, instructions: text(field(init, "instructions")), tools };
}

/** A JSON-RPC reply's result, or its error as a thrown Error. */
function result(msg: unknown, method: string): unknown {
  const err = field(msg, "error");
  if (err !== undefined) throw new Error(`${method}: ${text(field(err, "message")) || "error"}`);
  return field(msg, "result");
}

/** The reply with this id out of a JSON body or an SSE stream. */
function pick(body: string, id: number): unknown {
  const lines = body.trimStart().startsWith("{") || body.trimStart().startsWith("[") ? [body] : body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5));
  for (const l of lines) {
    let m: unknown;
    try { m = JSON.parse(l); } catch { continue; }
    for (const one of Array.isArray(m) ? m : [m]) if (field(one, "id") === id) return one;
  }
  return undefined;
}

/** A streamable-HTTP server: POST each message, carrying the session id it hands back. */
export function httpRpc(url: string, headers: Record<string, string> = {}): { rpc: Rpc; notify: (m: string) => Promise<void> } {
  let session = "", id = 0;
  const post = async (msg: object) => {
    const r = await fetch(url, {
      method: "POST", body: JSON.stringify(msg),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}), ...headers },
    });
    session = r.headers.get("mcp-session-id") ?? session;
    if (r.status === 401) throw new Error(`${url} wants a sign-in: pass --header "Authorization: Bearer <token>"`);
    if (!r.ok && r.status !== 202) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  };
  return {
    rpc: async (method, params) => { const n = ++id; return result(pick(await post({ jsonrpc: "2.0", id: n, method, params }), n), method); },
    notify: async (method) => { await post({ jsonrpc: "2.0", method }); },
  };
}

/** A stdio server: newline-delimited JSON-RPC over its stdin and stdout. */
export function stdioRpc(cmd: string[]): { rpc: Rpc; notify: (m: string) => Promise<void>; stop: () => void } {
  const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const waiting = new Map<number, (m: unknown) => void>();
  let id = 0;
  (async () => {
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m: unknown;
        try { m = JSON.parse(line); } catch { continue; }
        const mid = field(m, "id");
        if (typeof mid === "number") waiting.get(mid)?.(m);
      }
    }
  })();
  const send = (msg: object) => { proc.stdin.write(`${JSON.stringify(msg)}\n`); proc.stdin.flush(); };
  return {
    rpc: (method, params) => {
      const n = ++id;
      const reply = new Promise<unknown>((ok, no) => {
        const t = setTimeout(() => no(new Error(`${method}: no reply from \`${cmd.join(" ")}\` in 20s`)), 20_000);
        waiting.set(n, (m) => { clearTimeout(t); ok(m); });
      });
      send({ jsonrpc: "2.0", id: n, method, params });
      return reply.then((m) => result(m, method));
    },
    notify: async (method) => send({ jsonrpc: "2.0", method }),
    stop: () => proc.kill(),
  };
}

export interface McpSkillResult { text: string; path?: string; changed?: boolean; name: string; tools: number; descriptionTokens: number; bodyTokens: number }

const USAGE = "rustybuns skill mcp <url> [--header \"K: V\"] [--name n] [--dir D] [--print], or rustybuns skill mcp [--name n] -- <command> [args...]";

/** Parse the arguments, read the server, and write (or print) its skill. */
export async function mcpSkillCommand(argv: string[], cwd = process.cwd()): Promise<McpSkillResult> {
  const dash = argv.indexOf("--");
  const own = dash >= 0 ? argv.slice(0, dash) : argv, cmd = dash >= 0 ? argv.slice(dash + 1) : [];
  const flag = (k: string) => { const i = own.indexOf(k); const v = i >= 0 ? own[i + 1] : undefined; if (i >= 0 && (!v || v.startsWith("--"))) throw new Error(`${k} needs a value`); return v; };
  const headers: Record<string, string> = {};
  own.forEach((a, i) => {
    if (a !== "--header") return;
    const h = own[i + 1] ?? "", c = h.indexOf(":");
    if (c < 1) throw new Error("--header needs \"Name: value\"");
    headers[h.slice(0, c).trim()] = h.slice(c + 1).trim();
  });
  const url = own.find((a) => /^https?:\/\//.test(a));
  if (!url && !cmd.length) throw new Error(`which server? ${USAGE}`);
  const fallback = flag("--name") ?? (url ? new URL(url).hostname.split(".")[0]! : cmd[0]!.split("/").at(-1)!);
  let server: McpServer;
  if (url) { const c = httpRpc(url, headers); server = await readServer(c.rpc, c.notify, fallback); }
  else { const c = stdioRpc(cmd); try { server = await readServer(c.rpc, c.notify, fallback); } finally { c.stop(); } }
  if (flag("--name")) server.name = flag("--name")!;
  const text = serverSkill(server);
  const description = /^description: (.*)$/m.exec(text)?.[1] ?? "";
  const out: McpSkillResult = { text, name: `mcp-${slug(server.name)}`, tools: server.tools.length, descriptionTokens: tokens(description), bodyTokens: tokens(text) };
  if (own.includes("--print")) return out;
  const dir = join(cwd, flag("--dir") ?? ".claude/skills", out.name), path = join(dir, "SKILL.md");
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== text;
  if (changed) { mkdirSync(dir, { recursive: true }); writeFileSync(path, text); }
  return { ...out, path, changed };
}
