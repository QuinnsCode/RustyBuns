// One agent's session with an MCP server, and what it costs: the instructions and tool list (once), then each call's
// arguments and reply. apps/codesplitter/scripts/tool-tokens.ts counts it with Claude's count_tokens against a live
// server; apps/agentworld/test/tokens.test.ts counts it with `estimate` (no key, no network) and holds a budget.
import { arr, obj, opt, raw, str } from "../packages/util/src/guard.ts";

const Schema = obj({ type: opt(str(20)), properties: opt(raw), required: opt(arr(str(200), 200)) });
export const Listed = obj({ name: str(200), description: opt(str(20_000)), inputSchema: opt(Schema) });
const Reply = obj({ result: obj({ tools: arr(Listed, 500) }) });
const Init = obj({ result: obj({ instructions: opt(str(50_000)) }) });
const Called = obj({ result: obj({ content: arr(obj({ type: str(40), text: opt(str(1_000_000)) }), 100), isError: opt(raw) }) });

/** Send one JSON-RPC request, answer with the whole reply. Over HTTP, or straight into a server in this process. */
export type Rpc = (method: string, params: unknown) => Promise<unknown>;
export interface Ask { name: string; args: unknown }

export async function session(rpc: Rpc, asks: readonly Ask[]) {
  const init = Init(await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tool-tokens", version: "1" } }));
  const { tools } = Reply(await rpc("tools/list", {})).result;
  const calls: { name: string; args: string; reply: string; refused: boolean }[] = [];
  for (const a of asks) {
    const out = Called(await rpc("tools/call", { name: a.name, arguments: a.args }));
    calls.push({ name: a.name, args: JSON.stringify(a.args), reply: out.result.content.map((b) => b.text ?? "").join("\n"), refused: out.result.isError === true });
  }
  return { instructions: init.result.instructions ?? "", tools, calls };
}
export type Session = Awaited<ReturnType<typeof session>>;

/** The tool list as a model is given it: name, description and input schema. */
export const asTools = (tools: Session["tools"]) => tools.map((t) => ({
  name: t.name, description: t.description ?? "",
  input_schema: { type: "object" as const, properties: t.inputSchema?.properties ?? {}, ...(t.inputSchema?.required ? { required: t.inputSchema.required } : {}) },
}));

/** A local stand-in for a token count: four characters a token. Good for "did it go up", not for a bill. */
export const estimate = (text: string) => Math.ceil(text.length / 4);

/** A session's estimated tokens: the list and instructions once, each call's arguments, each reply. */
export function cost(s: Session) {
  const list = estimate(s.instructions + (s.tools.length ? JSON.stringify(asTools(s.tools)) : ""));
  const calls = s.calls.map((c) => ({ name: c.name, args: estimate(c.args), reply: estimate(c.reply) }));
  return { list, calls, total: calls.reduce((n, c) => n + c.args + c.reply, list) };
}

/** The same cost as the AI pays it: read (the list or sheet once, every reply), write (every call's arguments), and
 *  how many calls it made. */
export function split(s: Session) {
  const { calls, total } = cost(s);
  const write = calls.reduce((n, c) => n + c.args, 0);
  return { read: total - write, write, total, trips: s.calls.length };
}
