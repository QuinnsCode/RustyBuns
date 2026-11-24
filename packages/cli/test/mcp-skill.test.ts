import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpSkillCommand } from "../src/mcp-skill.ts";

setDefaultTimeout(20_000);

const dir = mkdtempSync(join(tmpdir(), "mcp-skill-"));
const INSTRUCTIONS = "Tracker holds the team's issues. Search before you create one, and never close another person's issue.";
const TOOLS = [
  { name: "search_issues", description: "Find issues by text. Returns ids and titles.", inputSchema: { type: "object", properties: { q: { type: "string" }, limit: { type: "number" } }, required: ["q"] } },
  { name: "close_issue", description: "Close an issue.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { destructiveHint: true } },
];

test("a stdio server becomes a skill whose description is a few dozen tokens", async () => {
  const server = join(dir, "server.ts");
  writeFileSync(server, `
    for await (const line of console) {
      const m = JSON.parse(line);
      if (m.id === undefined) continue;
      const result = m.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tracker" }, instructions: ${JSON.stringify(INSTRUCTIONS)} }
        : { tools: ${JSON.stringify(TOOLS)} };
      console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
    }`);
  const r = await mcpSkillCommand(["--", process.execPath, server], dir);
  expect(r).toMatchObject({ name: "mcp-tracker", tools: 2, changed: true, path: join(dir, ".claude/skills/mcp-tracker/SKILL.md") });
  expect(r.descriptionTokens).toBeLessThan(40);
  const skill = readFileSync(r.path!, "utf8");
  expect(skill).toStartWith(`---\nname: mcp-tracker\ndescription: "tracker (MCP): Tracker holds the team's issues."\n---`);
  expect(skill).toContain(INSTRUCTIONS);
  expect(skill).toContain("- `search_issues(q, limit?)`: Find issues by text.");
  expect(skill).toContain("- `close_issue(id)`: Close an issue. Ask the person first.");
  expect((await mcpSkillCommand(["--", process.execPath, server], dir)).changed).toBe(false);
});

const seen: string[] = [];
const http = Bun.serve({
  port: 0,
  async fetch(req) {
    const m = await req.json();
    seen.push(`${m.method} ${req.headers.get("mcp-session-id") ?? "-"} ${req.headers.get("authorization") ?? "-"}`);
    if (m.id === undefined) return new Response(null, { status: 202 });
    const result = m.method === "initialize" ? { serverInfo: { name: "notes-server", title: "Notes" } }
      : m.params?.cursor ? { tools: [TOOLS[1]] } : { tools: [TOOLS[0]], nextCursor: "p2" };
    // Streamable HTTP may answer in an event stream; the session id rides on every later request.
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`,
      { headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" } });
  },
});
afterAll(() => http.stop(true));

test("an HTTP server: SSE replies, its session, a header, every page of tools; --print writes nothing", async () => {
  const r = await mcpSkillCommand([`http://localhost:${http.port}/mcp`, "--header", "Authorization: Bearer t", "--print"], dir);
  expect(r.path).toBeUndefined();
  expect(r.tools).toBe(2);
  expect(r.text).toContain("name: mcp-notes\n");
  expect(r.text).toContain('description: "Notes (MCP): Tools: search_issues, close_issue."');
  expect(seen).toEqual(["initialize - Bearer t", "notifications/initialized s1 Bearer t", "tools/list s1 Bearer t", "tools/list s1 Bearer t"]);
  await expect(mcpSkillCommand(["--name"], dir)).rejects.toThrow("which server?");
});
