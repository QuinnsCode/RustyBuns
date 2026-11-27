// What an AI pays, in tokens, to use an MCP server's tools: the server's instructions and tool list (read once when it
// connects, then in its context every turn after), and the reply to each call you name. Counted by Claude's own
// count_tokens (free), per model, with what a thousand of each would cost at that model's input price. The session
// itself (list, calls, replies) is scripts/mcp-session.ts, which the Agent Page's token budget test counts too.
//
//   cd apps/codesplitter && bunx varlock run -- bun scripts/tool-tokens.ts <mcp url> [--call name '{json args}'] ...
//
//   bunx varlock run -- bun scripts/tool-tokens.ts http://127.0.0.1:4799/api/r/<room>/mcp \
//     --call page_read '{}' --call page_set_profile '{"name":"Ada"}' --call page_set_theme '{"accent":"red"}'
//
// A call really runs, so name only calls you're happy to make (the Agent Page's page has to be open for its tools).
// Needs ANTHROPIC_API_KEY (codeSplitter's .env.schema, through varlock); without it, it prints byte sizes and a rough
// local estimate (four characters a token).
import Anthropic from "@anthropic-ai/sdk";
import { asTools, cost as estimated, session } from "../../../scripts/mcp-session.ts";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);

/** The models it counts for, with their input price in dollars per million tokens. */
const MODELS = [["claude-opus-5-5", 4], ["claude-sonnet-5-5", 2], ["claude-haiku-5-5", 0.1]] as const;

const [url, ...rest] = process.argv.slice(2);
if (!url?.startsWith("http")) { console.error("usage: bun scripts/tool-tokens.ts <mcp url> [--call name '{json}'] ..."); process.exit(1); }
const calls: { name: string; args: string }[] = [];
for (let i = 0; i < rest.length; i++) if (rest[i] === "--call") { calls.push({ name: rest[i + 1] ?? "", args: rest[i + 2] ?? "{}" }); i += 2; }

let id = 0;
const rpc = async (method: string, params: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const text = await r.text();
  // A streamable-HTTP server may answer as one SSE event: the JSON is its data line.
  const body = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text;
  return JSON.parse(body) as unknown;
};

const run = await session(rpc, calls.map((c) => ({ name: c.name, args: JSON.parse(c.args) as unknown })));
const { tools, instructions } = run;
const replies = run.calls.map((c) => ({ label: `${c.name}${c.refused ? " (refused)" : ""}`, text: c.reply }));

const bytes = (s: string) => new TextEncoder().encode(s).length;
const listBytes = bytes(JSON.stringify(tools)) + bytes(instructions);

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(`no ANTHROPIC_API_KEY: byte sizes only (run it through varlock for tokens); the session is about ${estimated(run).total} tokens`);
  console.log(`  tool list + instructions  ${listBytes} bytes, ${tools.length} tools`);
  for (const r of replies) console.log(`  ${r.label.padEnd(24)} ${bytes(r.text)} bytes`);
  process.exit(0);
}

const client = new Anthropic();
const PING: Anthropic.MessageParam[] = [{ role: "user", content: "hi" }];
const count = async (model: string, req: { system?: string; tools?: Anthropic.Tool[]; messages?: Anthropic.MessageParam[] }) =>
  (await client.messages.countTokens({ model, messages: req.messages ?? PING, ...(req.system ? { system: req.system } : {}), ...(req.tools ? { tools: req.tools } : {}) })).input_tokens;

console.log(`${url}: ${tools.length} tools, ${listBytes} bytes of tool list and instructions`);
for (const [model, price] of MODELS) {
  const base = await count(model, {});
  const list = (await count(model, { tools: asTools(tools), ...(instructions ? { system: instructions } : {}) })) - base;
  const cost = (n: number) => `$${((n * 1000 * price) / 1e6).toFixed(n * price < 10 ? 3 : 2)} per 1,000`;
  console.log(`\n${model}`);
  console.log(`  tool list + instructions  ${String(list).padStart(6)} tokens  (${cost(list)} turns that carry it)`);
  for (const r of replies) {
    const n = (await count(model, { messages: [{ role: "user", content: r.text }] })) - base;
    console.log(`  ${r.label.padEnd(24)} ${String(n).padStart(6)} tokens  (${cost(n)} calls)`);
  }
}
