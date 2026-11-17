// MCP over stdio is JSON-RPC, one message a line: the answer to one line for a list of page commands (the jam
// room's agent tools), so scripts/studio-mcp.ts serves from the CLI exactly what WebMCP serves on the page.
// Only what a client needs: initialize, tools/list, tools/call, ping.
import { int, obj, opt, raw, str, type Of } from "@rustybuns/util/guard";
import type { Command } from "@rustybuns/util/commands";

export const Rpc = obj({ id: opt(int(-1e15, 1e15)), method: str(200), params: opt(obj({ name: opt(str(200)), arguments: opt(raw) })) });
export type Rpc = Of<typeof Rpc>;

/** The reply to one message, or null for a notification (no id). */
export async function mcpAnswer(tools: readonly Command[], m: Rpc): Promise<object | null> {
  const answer = (result: unknown) => (m.id === undefined ? null : { jsonrpc: "2.0", id: m.id, result });
  if (m.method === "initialize") return answer({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "qollab-studio", version: "0.1.0" } });
  if (m.method === "ping") return answer({});
  if (m.method === "tools/list") {
    return answer({ tools: tools.filter((t) => t.agent !== false).map((t) => ({ name: t.name, title: t.title, description: t.description,
      inputSchema: t.inputSchema ?? { type: "object", properties: {} }, ...(t.annotations ? { annotations: t.annotations } : {}) })) });
  }
  if (m.method === "tools/call") {
    const tool = tools.find((t) => t.name === m.params?.name);
    if (!tool) return answer({ content: [{ type: "text", text: `No tool ${m.params?.name ?? ""}` }], isError: true });
    try { return answer({ content: [{ type: "text", text: JSON.stringify(await tool.execute(m.params?.arguments ?? {}, "agent")) }] }); }
    catch (e) { return answer({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }); }
  }
  return m.id === undefined ? null : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `No method ${m.method}` } };
}
